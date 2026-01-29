// JWT Signature Verification for Entity Statements
// Implements Requirements 2.1, 2.3

import { jwtVerify, importJWK, JWK as JoseJWK, JWTPayload } from 'jose';
import { logger } from '../utils/logger';
import { 
  EntityStatement, 
  JWKSet, 
  JWK, 
  ValidationError 
} from './types';
import { 
  JWTUtils, 
  ValidationUtils, 
  TimeUtils 
} from './utils';
import { FEDERATION_CONSTANTS } from './constants';

/**
 * JWT Signature Verifier Service
 * 
 * Handles JWT signature verification for entity statements
 * according to OpenID Federation 1.0 specification
 */
export class JWTSignatureVerifier {
  
  constructor() {
    logger.logInfo(
      'JWTSignatureVerifier initialized',
      'JWTSignatureVerifier',
      { 
        supportedAlgorithms: FEDERATION_CONSTANTS.SUPPORTED_SIGNING_ALGORITHMS
      }
    );
  }

  /**
   * Verify entity statement JWT signature
   * Implements Requirements 2.1, 2.3
   */
  async verifyEntityStatement(
    jwt: string, 
    publicKeys: JWKSet, 
    expectedIssuer?: string
  ): Promise<EntityStatementVerificationResult> {
    logger.logInfo(
      'Starting entity statement verification',
      'JWTSignatureVerifier',
      { 
        expectedIssuer,
        keyCount: publicKeys.keys.length
      }
    );

    try {
      // Decode JWT header to get key ID and algorithm
      const decoded = JWTUtils.decodeJWT(jwt);
      const header = decoded.header;
      
      // Validate JWT structure
      const structureErrors = this.validateJWTStructure(jwt, header);
      if (structureErrors.length > 0) {
        return {
          isValid: false,
          errors: structureErrors
        };
      }

      // Find matching public key
      const publicKey = this.findMatchingPublicKey(publicKeys, header.kid, header.alg);
      if (!publicKey) {
        return {
          isValid: false,
          errors: [
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
              `No matching public key found for kid: ${header.kid}, alg: ${header.alg}`
            )
          ]
        };
      }

      // Convert JWK to JOSE format and verify signature
      const joseKey = await this.convertJWKToJose(publicKey);
      const verificationResult = await jwtVerify(jwt, joseKey, {
        algorithms: [header.alg],
        ...(expectedIssuer && { issuer: expectedIssuer })
      });

      // Validate payload claims
      const payload = verificationResult.payload;
      const claimErrors = this.validateEntityStatementClaims(payload, expectedIssuer);
      
      if (claimErrors.length > 0) {
        return {
          isValid: false,
          errors: claimErrors
        };
      }

      logger.logInfo(
        'Entity statement verification successful',
        'JWTSignatureVerifier',
        { 
          iss: payload.iss,
          sub: payload.sub,
          exp: payload.exp,
          algorithm: header.alg,
          keyId: header.kid
        }
      );

      return {
        isValid: true,
        payload: payload,
        header: header
      };

    } catch (error) {
      logger.logError({
        message: 'Entity statement verification failed',
        component: 'JWTSignatureVerifier',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: { expectedIssuer }
      });

      // Determine error type based on the error
      let errorCode: string = FEDERATION_CONSTANTS.ERRORS.SERVER_ERROR;
      let errorMessage = 'JWT verification failed due to internal error';

      if (error instanceof Error) {
        if (error.message.includes('signature')) {
          errorCode = FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA;
          errorMessage = 'Invalid JWT signature';
        } else if (error.message.includes('expired')) {
          errorCode = FEDERATION_CONSTANTS.ERRORS.ENTITY_STATEMENT_EXPIRED;
          errorMessage = 'JWT has expired';
        } else if (error.message.includes('issuer')) {
          errorCode = FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA;
          errorMessage = 'Invalid JWT issuer';
        }
      }

      return {
        isValid: false,
        errors: [
          ValidationUtils.createValidationError(errorCode, errorMessage)
        ]
      };
    }
  }

  /**
   * Verify multiple entity statements in a trust chain
   * Implements Requirements 2.1, 2.3
   */
  async verifyTrustChain(trustChain: EntityStatement[]): Promise<TrustChainVerificationResult> {
    logger.logInfo(
      'Starting trust chain verification',
      'JWTSignatureVerifier',
      { chainLength: trustChain.length }
    );

    const verificationResults: EntityStatementVerificationResult[] = [];
    const allErrors: ValidationError[] = [];

    for (let i = 0; i < trustChain.length; i++) {
      const statement = trustChain[i];
      
      // For the first statement (leaf entity), we need to get the public key from the next statement
      // For subsequent statements, we get the public key from the statement itself (self-signed)
      let publicKeys: JWKSet;
      let expectedIssuer: string | undefined;

      if (i === 0 && trustChain.length > 1) {
        // Leaf entity - verify using parent's public keys
        const parentStatement = trustChain[i + 1];
        if (!parentStatement.payload.jwks) {
          allErrors.push(
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
              `Parent entity ${parentStatement.payload.iss} missing public keys`
            )
          );
          continue;
        }
        publicKeys = parentStatement.payload.jwks;
        expectedIssuer = parentStatement.payload.iss;
      } else {
        // Self-signed entity statement
        if (!statement.payload.jwks) {
          allErrors.push(
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
              `Entity ${statement.payload.iss} missing public keys for self-signed statement`
            )
          );
          continue;
        }
        publicKeys = statement.payload.jwks;
        expectedIssuer = statement.payload.iss;
      }

      const result = await this.verifyEntityStatement(
        statement.jwt, 
        publicKeys, 
        expectedIssuer
      );

      verificationResults.push(result);
      
      if (!result.isValid && result.errors) {
        allErrors.push(...result.errors);
      }
    }

    const isValid = verificationResults.every(r => r.isValid);

    logger.logInfo(
      'Trust chain verification completed',
      'JWTSignatureVerifier',
      { 
        chainLength: trustChain.length,
        isValid,
        errorCount: allErrors.length
      }
    );

    return {
      isValid,
      verificationResults,
      ...(allErrors.length > 0 && { errors: allErrors })
    };
  }

  /**
   * Validate JWT structure and header
   */
  private validateJWTStructure(_jwt: string, header: any): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check algorithm
    if (!header.alg) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          'JWT header missing required alg parameter'
        )
      );
    } else if (!FEDERATION_CONSTANTS.SUPPORTED_SIGNING_ALGORITHMS.includes(header.alg)) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          `Unsupported JWT algorithm: ${header.alg}`
        )
      );
    }

    // Check type - OpenID Federation uses 'entity-statement+jwt'
    if (header.typ && header.typ !== 'JWT' && header.typ !== 'entity-statement+jwt') {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          `Invalid JWT type: ${header.typ}`
        )
      );
    }

    return errors;
  }

  /**
   * Validate entity statement claims
   */
  private validateEntityStatementClaims(payload: JWTPayload, expectedIssuer?: string): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check required claims
    if (!payload.iss) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          'JWT payload missing required iss claim'
        )
      );
    }

    if (!payload.sub) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          'JWT payload missing required sub claim'
        )
      );
    }

    if (!payload.exp) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          'JWT payload missing required exp claim'
        )
      );
    }

    // Check issuer if expected
    if (expectedIssuer && payload.iss !== expectedIssuer) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          `JWT issuer mismatch: expected ${expectedIssuer}, got ${payload.iss}`
        )
      );
    }

    // Check expiration
    if (payload.exp && TimeUtils.isExpired(payload.exp as number, FEDERATION_CONSTANTS.ENTITY_STATEMENT_CLOCK_SKEW)) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.ENTITY_STATEMENT_EXPIRED,
          `JWT expired at ${TimeUtils.formatTimestamp(payload.exp as number)}`
        )
      );
    }

    // Check not before if present
    if (payload.nbf && TimeUtils.isNotYetValid(payload.nbf as number, FEDERATION_CONSTANTS.ENTITY_STATEMENT_CLOCK_SKEW)) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          `JWT not yet valid, not before ${TimeUtils.formatTimestamp(payload.nbf as number)}`
        )
      );
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
        component: 'JWTSignatureVerifier',
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

/**
 * Entity Statement Verification Result
 */
export interface EntityStatementVerificationResult {
  isValid: boolean;
  payload?: JWTPayload;
  header?: any;
  errors?: ValidationError[];
}

/**
 * Trust Chain Verification Result
 */
export interface TrustChainVerificationResult {
  isValid: boolean;
  verificationResults: EntityStatementVerificationResult[];
  errors?: ValidationError[];
}