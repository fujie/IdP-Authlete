// Federation Request Object Handler
// Implements Requirements 5.1, 5.2, 5.3, 5.4, 5.5

import { jwtVerify, importJWK, JWK as JoseJWK } from 'jose';
import { logger } from '../utils/logger';
import { 
  JWKSet, 
  JWK, 
  RequestObjectValidation, 
  RegistrationParameters,
  ValidationError
} from './types';
import { 
  FederationRequestObjectHandler as IFederationRequestObjectHandler 
} from './interfaces';
import { 
  JWTUtils, 
  ValidationUtils, 
  TimeUtils 
} from './utils';
import { FEDERATION_CONSTANTS } from './constants';

/**
 * Federation Request Object Handler
 * 
 * Handles validation and processing of signed federation request objects
 * for dynamic client registration according to OpenID Federation 1.0
 */
export class FederationRequestObjectHandler implements IFederationRequestObjectHandler {
  
  constructor() {
    logger.logInfo(
      'FederationRequestObjectHandler initialized',
      'FederationRequestObjectHandler',
      { 
        supportedAlgorithms: FEDERATION_CONSTANTS.SUPPORTED_SIGNING_ALGORITHMS,
        maxAge: FEDERATION_CONSTANTS.MAX_REQUEST_OBJECT_AGE
      }
    );
  }

  /**
   * Validate federation request object signature
   * Implements Requirements 5.1, 5.2
   */
  async validateRequestObject(
    requestObject: string, 
    clientJwks: JWKSet
  ): Promise<RequestObjectValidation> {
    logger.logInfo(
      'Starting request object validation',
      'FederationRequestObjectHandler',
      { 
        keyCount: clientJwks.keys.length
      }
    );

    try {
      // Decode JWT header to get key ID and algorithm
      const decoded = JWTUtils.decodeJWT(requestObject);
      const header = decoded.header;
      const payload = decoded.payload;
      
      // Validate JWT structure
      const structureErrors = this.validateJWTStructure(requestObject, header);
      if (structureErrors.length > 0) {
        return {
          isValid: false,
          errors: structureErrors.map(e => e.message)
        };
      }

      // Validate request object claims
      const claimErrors = this.validateRequestObjectClaims(payload);
      if (claimErrors.length > 0) {
        return {
          isValid: false,
          errors: claimErrors.map(e => e.message)
        };
      }

      // Find matching public key for signature verification
      const publicKey = this.findMatchingPublicKey(clientJwks, header.kid, header.alg);
      if (!publicKey) {
        return {
          isValid: false,
          errors: [`No matching public key found for kid: ${header.kid}, alg: ${header.alg}`]
        };
      }

      // Convert JWK to JOSE format and verify signature
      const joseKey = await this.convertJWKToJose(publicKey);
      const verificationResult = await jwtVerify(requestObject, joseKey, {
        algorithms: [header.alg]
      });

      logger.logInfo(
        'Request object validation successful',
        'FederationRequestObjectHandler',
        { 
          iss: payload.iss,
          aud: payload.aud,
          exp: payload.exp,
          algorithm: header.alg,
          keyId: header.kid
        }
      );

      return {
        isValid: true,
        payload: verificationResult.payload
      };

    } catch (error) {
      logger.logError({
        message: 'Request object validation failed',
        component: 'FederationRequestObjectHandler',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      // Determine error type based on the error
      let errorMessage = 'Request object validation failed';

      if (error instanceof Error) {
        if (error.message.includes('signature')) {
          errorMessage = 'Invalid request object signature';
        } else if (error.message.includes('expired')) {
          errorMessage = 'Request object has expired';
        } else if (error.message.includes('audience')) {
          errorMessage = 'Invalid request object audience';
        }
      }

      return {
        isValid: false,
        errors: [errorMessage]
      };
    }
  }

  /**
   * Extract registration parameters from validated request object
   * Implements Requirements 5.3, 5.4, 5.5
   */
  extractRegistrationParameters(requestObject: string): RegistrationParameters {
    logger.logInfo(
      'Extracting registration parameters from request object',
      'FederationRequestObjectHandler'
    );

    try {
      const decoded = JWTUtils.decodeJWT(requestObject);
      const payload = decoded.payload;

      // Extract client metadata from the request object
      const clientMetadata = payload.client_metadata || {};

      // Build registration parameters according to OpenID Connect Dynamic Client Registration
      const registrationParams: RegistrationParameters = {
        // Required parameters
        redirect_uris: clientMetadata.redirect_uris || [],
        
        // Optional client information
        ...(clientMetadata.client_name && { client_name: clientMetadata.client_name }),
        ...(clientMetadata.client_uri && { client_uri: clientMetadata.client_uri }),
        ...(clientMetadata.logo_uri && { logo_uri: clientMetadata.logo_uri }),
        ...(clientMetadata.contacts && { contacts: clientMetadata.contacts }),
        ...(clientMetadata.tos_uri && { tos_uri: clientMetadata.tos_uri }),
        ...(clientMetadata.policy_uri && { policy_uri: clientMetadata.policy_uri }),
        
        // Key material
        ...(clientMetadata.jwks_uri && { jwks_uri: clientMetadata.jwks_uri }),
        ...(clientMetadata.jwks && { jwks: clientMetadata.jwks }),
        
        // OAuth/OIDC configuration
        ...(clientMetadata.response_types && { response_types: clientMetadata.response_types }),
        ...(clientMetadata.grant_types && { grant_types: clientMetadata.grant_types }),
        ...(clientMetadata.application_type && { application_type: clientMetadata.application_type }),
        ...(clientMetadata.subject_type && { subject_type: clientMetadata.subject_type }),
        ...(clientMetadata.id_token_signed_response_alg && { 
          id_token_signed_response_alg: clientMetadata.id_token_signed_response_alg 
        }),
        ...(clientMetadata.token_endpoint_auth_method && { 
          token_endpoint_auth_method: clientMetadata.token_endpoint_auth_method 
        })
      };

      // Validate extracted parameters
      const validationErrors = ValidationUtils.validateClientMetadata(registrationParams);
      if (validationErrors.length > 0) {
        logger.logWarn(
          'Registration parameters validation failed',
          'FederationRequestObjectHandler',
          { 
            errors: validationErrors.map(e => e.message),
            parameters: registrationParams
          }
        );
        
        // Still return the parameters, but log the validation issues
        // The caller can decide how to handle validation errors
      }

      logger.logInfo(
        'Registration parameters extracted successfully',
        'FederationRequestObjectHandler',
        { 
          redirectUriCount: registrationParams.redirect_uris.length,
          hasClientName: !!registrationParams.client_name,
          hasJwks: !!registrationParams.jwks,
          hasJwksUri: !!registrationParams.jwks_uri
        }
      );

      return registrationParams;

    } catch (error) {
      logger.logError({
        message: 'Failed to extract registration parameters',
        component: 'FederationRequestObjectHandler',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      // Return minimal parameters on error
      return {
        redirect_uris: []
      };
    }
  }

  /**
   * Validate both signed and unsigned request objects
   * Implements Requirement 5.5 (support for both signed and unsigned requests)
   */
  async validateRequestObjectWithOptionalSignature(
    requestObject: string, 
    clientJwks?: JWKSet
  ): Promise<RequestObjectValidation> {
    logger.logInfo(
      'Validating request object with optional signature',
      'FederationRequestObjectHandler',
      { 
        hasSigning: !!clientJwks,
        keyCount: clientJwks?.keys.length || 0
      }
    );

    try {
      const decoded = JWTUtils.decodeJWT(requestObject);
      const header = decoded.header;
      const payload = decoded.payload;

      // Always validate basic JWT structure and claims
      const structureErrors = this.validateJWTStructure(requestObject, header);
      if (structureErrors.length > 0) {
        return {
          isValid: false,
          errors: structureErrors.map(e => e.message)
        };
      }

      const claimErrors = this.validateRequestObjectClaims(payload);
      if (claimErrors.length > 0) {
        return {
          isValid: false,
          errors: claimErrors.map(e => e.message)
        };
      }

      // If no client JWKs provided, treat as unsigned request object
      if (!clientJwks || clientJwks.keys.length === 0) {
        logger.logInfo(
          'Processing unsigned request object',
          'FederationRequestObjectHandler',
          { iss: payload.iss }
        );

        return {
          isValid: true,
          payload: payload
        };
      }

      // If client JWKs provided, validate signature
      return await this.validateRequestObject(requestObject, clientJwks);

    } catch (error) {
      logger.logError({
        message: 'Request object validation with optional signature failed',
        component: 'FederationRequestObjectHandler',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      return {
        isValid: false,
        errors: ['Request object validation failed']
      };
    }
  }

  /**
   * Validate JWT structure and header
   */
  private validateJWTStructure(jwt: string, header: any): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check JWT format
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          'Request object must be a valid JWT with 3 parts'
        )
      );
      return errors;
    }

    // Check algorithm
    if (!header.alg) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          'Request object header missing required alg parameter'
        )
      );
    } else if (header.alg === 'none') {
      // Allow 'none' algorithm for unsigned request objects
      logger.logInfo(
        'Request object uses none algorithm (unsigned)',
        'FederationRequestObjectHandler'
      );
    } else if (!FEDERATION_CONSTANTS.SUPPORTED_SIGNING_ALGORITHMS.includes(header.alg)) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          `Unsupported request object algorithm: ${header.alg}`
        )
      );
    }

    // Check type
    if (header.typ && header.typ !== 'JWT') {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          `Invalid request object type: ${header.typ}`
        )
      );
    }

    return errors;
  }

  /**
   * Validate request object claims
   */
  private validateRequestObjectClaims(payload: any): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check required claims for federation request objects
    if (!payload.iss) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          'Request object payload missing required iss claim'
        )
      );
    } else if (typeof payload.iss !== 'string') {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          `Request object iss claim must be a string, got ${typeof payload.iss}`
        )
      );
    }

    if (!payload.aud) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          'Request object payload missing required aud claim'
        )
      );
    } else if (typeof payload.aud !== 'string' && !Array.isArray(payload.aud)) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          `Request object aud claim must be a string or array, got ${typeof payload.aud}`
        )
      );
    }

    if (!payload.exp) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          'Request object payload missing required exp claim'
        )
      );
    } else if (typeof payload.exp !== 'number') {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          `Request object exp claim must be a number, got ${typeof payload.exp}`
        )
      );
    }

    if (!payload.iat) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          'Request object payload missing required iat claim'
        )
      );
    } else if (typeof payload.iat !== 'number') {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          `Request object iat claim must be a number, got ${typeof payload.iat}`
        )
      );
    }

    // Check expiration (only if exp is a valid number)
    if (payload.exp && typeof payload.exp === 'number' && TimeUtils.isExpired(payload.exp, FEDERATION_CONSTANTS.REQUEST_OBJECT_CLOCK_SKEW)) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          `Request object expired at ${TimeUtils.formatTimestamp(payload.exp)}`
        )
      );
    }

    // Check not before if present (only if nbf is a valid number)
    if (payload.nbf && typeof payload.nbf === 'number' && TimeUtils.isNotYetValid(payload.nbf, FEDERATION_CONSTANTS.REQUEST_OBJECT_CLOCK_SKEW)) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
          `Request object not yet valid, not before ${TimeUtils.formatTimestamp(payload.nbf)}`
        )
      );
    }

    // Check maximum age (only if iat is a valid number)
    if (payload.iat && typeof payload.iat === 'number') {
      const age = TimeUtils.now() - payload.iat;
      if (age > FEDERATION_CONSTANTS.MAX_REQUEST_OBJECT_AGE) {
        errors.push(
          ValidationUtils.createValidationError(
            FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST_OBJECT,
            `Request object too old, issued ${age} seconds ago (max age: ${FEDERATION_CONSTANTS.MAX_REQUEST_OBJECT_AGE})`
          )
        );
      }
    }

    // Validate client metadata if present
    if (payload.client_metadata) {
      const metadataErrors = ValidationUtils.validateClientMetadata(payload.client_metadata);
      errors.push(...metadataErrors);
    }

    return errors;
  }

  /**
   * Find matching public key from JWK Set
   */
  private findMatchingPublicKey(jwks: JWKSet, keyId?: string, algorithm?: string): JWK | null {
    for (const key of jwks.keys) {
      // Match by key ID if provided
      if (keyId && key.kid !== keyId) {
        continue;
      }

      // Match by algorithm if provided
      if (algorithm && key.alg && key.alg !== algorithm) {
        continue;
      }

      // Check if key can be used for signature verification
      if (key.use && key.use !== 'sig') {
        continue;
      }

      // Check key operations
      if (key.key_ops && !key.key_ops.includes('verify')) {
        continue;
      }

      return key;
    }

    return null;
  }

  /**
   * Convert JWK to JOSE KeyLike format
   */
  private async convertJWKToJose(jwk: JWK): Promise<any> {
    try {
      // Convert our JWK format to JOSE JWK format
      const joseJWK: JoseJWK = {
        kty: jwk.kty,
        ...(jwk.use && { use: jwk.use }),
        ...(jwk.key_ops && { key_ops: jwk.key_ops }),
        ...(jwk.alg && { alg: jwk.alg }),
        ...(jwk.kid && { kid: jwk.kid }),
        // RSA keys
        ...(jwk.n && { n: jwk.n }),
        ...(jwk.e && { e: jwk.e }),
        // EC keys
        ...(jwk.crv && { crv: jwk.crv }),
        ...(jwk.x && { x: jwk.x }),
        ...(jwk.y && { y: jwk.y }),
        // Symmetric keys
        ...(jwk.k && { k: jwk.k })
      };

      return await importJWK(joseJWK);
    } catch (error) {
      logger.logError({
        message: 'Failed to convert JWK to JOSE format',
        component: 'FederationRequestObjectHandler',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: { jwk }
      });
      throw error;
    }
  }

  /**
   * Get supported signing algorithms
   */
  getSupportedAlgorithms(): string[] {
    return [...FEDERATION_CONSTANTS.SUPPORTED_SIGNING_ALGORITHMS];
  }
}