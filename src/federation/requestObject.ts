import { logger } from '../utils/logger';
import { DynamicRegistrationService } from './dynamicRegistration';
import { AuthleteClient } from '../authlete/client';
import { EntityDiscoveryService } from './entityDiscovery';

export interface RequestObjectClaims {
  // Standard JWT claims
  iss: string; // Issuer (client_id)
  sub?: string; // Subject
  aud: string | string[]; // Audience (authorization server)
  exp: number; // Expiration time
  nbf?: number; // Not before
  iat: number; // Issued at
  jti?: string; // JWT ID

  // OAuth 2.0 Authorization Request parameters
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  nonce?: string;
  code_challenge?: string;
  code_challenge_method?: string;

  // OpenID Federation specific claims
  client_metadata?: {
    client_name?: string;
    client_uri?: string;
    logo_uri?: string;
    contacts?: string[];
    tos_uri?: string;
    policy_uri?: string;
    jwks_uri?: string;
    jwks?: {
      keys: any[];
    };
    redirect_uris: string[];
    response_types?: string[];
    grant_types?: string[];
    application_type?: string;
    subject_type?: string;
    id_token_signed_response_alg?: string;
    token_endpoint_auth_method?: string;
  };

  // Additional Federation metadata
  trust_chain?: string[];
  trust_anchor_id?: string;
}

export interface RequestObjectValidationResult {
  isValid: boolean;
  claims?: RequestObjectClaims;
  error?: string;
  errorDescription?: string;
}

export interface ClientRegistrationResult {
  success: boolean;
  entityId?: string; // URI形式のentity_id
  clientSecret?: string | undefined;
  error?: string;
  errorDescription?: string;
}

export class RequestObjectProcessor {
  private dynamicRegistrationService: DynamicRegistrationService;
  private entityDiscoveryService: EntityDiscoveryService;

  constructor(authleteClient: AuthleteClient) {
    this.dynamicRegistrationService = new DynamicRegistrationService(authleteClient);
    this.entityDiscoveryService = new EntityDiscoveryService();
  }

  /**
   * Parse and validate Request Object JWT
   */
  parseRequestObject(requestObjectJwt: string): RequestObjectValidationResult {
    try {
      logger.logInfo(
        'Parsing Request Object JWT',
        'RequestObjectProcessor',
        {
          jwtLength: requestObjectJwt.length,
          jwtPrefix: requestObjectJwt.substring(0, 50) + '...'
        }
      );

      // Split JWT into parts
      const parts = requestObjectJwt.split('.');
      if (parts.length !== 3) {
        return {
          isValid: false,
          error: 'invalid_request_object',
          errorDescription: 'Request Object must be a valid JWT with 3 parts'
        };
      }

      // Decode header
      const header = this.decodeBase64Url(parts[0]);
      JSON.parse(header); // Validate header format

      // Decode payload (claims)
      const payload = this.decodeBase64Url(parts[1]);
      const claims: RequestObjectClaims = JSON.parse(payload);

      // Basic validation
      const validationResult = this.validateRequestObjectClaims(claims);
      if (!validationResult.isValid) {
        return validationResult;
      }

      logger.logInfo(
        'Request Object parsed successfully',
        'RequestObjectProcessor',
        {
          issuer: claims.iss,
          clientId: claims.client_id,
          audience: claims.aud,
          responseType: claims.response_type,
          hasClientMetadata: !!claims.client_metadata
        }
      );

      return {
        isValid: true,
        claims: claims
      };

    } catch (error) {
      logger.logError({
        message: 'Failed to parse Request Object',
        component: 'RequestObjectProcessor',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      return {
        isValid: false,
        error: 'invalid_request_object',
        errorDescription: 'Failed to parse Request Object JWT'
      };
    }
  }

  /**
   * Process client registration from Request Object
   */
  async processClientRegistration(claims: RequestObjectClaims): Promise<ClientRegistrationResult> {
    try {
      // Check if client is using HTTPS scheme (required by OpenID Federation 1.0)
      // Allow HTTP for localhost development
      const isLocalhost = this.isLocalhost(claims.client_id);
      if (!claims.client_id.startsWith('https://') && !isLocalhost) {
        return {
          success: false,
          error: 'invalid_client_metadata',
          errorDescription: 'client_id must use HTTPS scheme for Federation clients (OpenID Federation 1.0 requirement)'
        };
      }

      logger.logInfo(
        'Processing Federation client registration from Request Object',
        'RequestObjectProcessor',
        {
          clientId: claims.client_id,
          clientName: claims.client_metadata?.client_name,
          redirectUris: claims.client_metadata?.redirect_uris,
          isLocalhost: isLocalhost
        }
      );

      // Step 1: Perform Federation Entity Discovery
      logger.logInfo(
        'Performing Federation Entity Discovery',
        'RequestObjectProcessor',
        { entityId: claims.client_id }
      );

      const discoveryResult = await this.entityDiscoveryService.discoverEntityConfiguration(claims.client_id);
      
      if (!discoveryResult.success) {
        logger.logWarn(
          'Federation Entity Discovery failed',
          'RequestObjectProcessor',
          {
            entityId: claims.client_id,
            error: discoveryResult.error,
            errorDescription: discoveryResult.errorDescription
          }
        );

        return {
          success: false,
          error: discoveryResult.error || 'discovery_failed',
          errorDescription: discoveryResult.errorDescription || 'Failed to discover entity configuration'
        };
      }

      const entityConfiguration = discoveryResult.entityConfiguration!;
      
      // Step 2: Extract client metadata from Entity Configuration
      const discoveredMetadata = this.entityDiscoveryService.extractClientMetadata(entityConfiguration);
      
      // Step 3: Merge client metadata from Request Object and Entity Configuration
      // Request Object metadata takes precedence over discovered metadata
      const mergedMetadata = this.mergeClientMetadata(claims.client_metadata, discoveredMetadata);

      if (!mergedMetadata || !mergedMetadata.redirect_uris || mergedMetadata.redirect_uris.length === 0) {
        return {
          success: false,
          error: 'invalid_client_metadata',
          errorDescription: 'No valid redirect_uris found in Request Object or Entity Configuration'
        };
      }

      logger.logInfo(
        'Entity Configuration discovered and metadata merged',
        'RequestObjectProcessor',
        {
          entityId: claims.client_id,
          hasDiscoveredMetadata: !!discoveredMetadata,
          hasRequestObjectMetadata: !!claims.client_metadata,
          finalRedirectUris: mergedMetadata.redirect_uris
        }
      );

      // Step 4: Create dynamic registration request with merged metadata
      const registrationRequest = {
        entity_id: claims.client_id,
        redirect_uris: mergedMetadata.redirect_uris,
        client_name: mergedMetadata.client_name || undefined,
        client_uri: mergedMetadata.client_uri || undefined,
        logo_uri: mergedMetadata.logo_uri || undefined,
        contacts: mergedMetadata.contacts || undefined,
        tos_uri: mergedMetadata.tos_uri || undefined,
        policy_uri: mergedMetadata.policy_uri || undefined,
        jwks_uri: mergedMetadata.jwks_uri || undefined,
        jwks: mergedMetadata.jwks || undefined
      };

      // Step 5: Attempt dynamic registration
      const registrationResult = await this.dynamicRegistrationService.registerClient(registrationRequest);

      if ('error' in registrationResult) {
        logger.logWarn(
          'Client registration failed from Request Object',
          'RequestObjectProcessor',
          {
            clientId: claims.client_id,
            error: registrationResult.error,
            errorDescription: registrationResult.error_description
          }
        );

        return {
          success: false,
          error: registrationResult.error,
          errorDescription: registrationResult.error_description
        };
      }

      logger.logInfo(
        'Client registration successful from Request Object with Entity Discovery',
        'RequestObjectProcessor',
        {
          entityId: claims.client_id,
          trustAnchor: registrationResult.trust_chain_validation.trustAnchor,
          discoveryPerformed: true
        }
      );

      return {
        success: true,
        entityId: claims.client_id, // URI形式のentity_idを返す
        clientSecret: registrationResult.client_secret || undefined
      };

    } catch (error) {
      logger.logError({
        message: 'Client registration processing error',
        component: 'RequestObjectProcessor',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: {
          clientId: claims.client_id
        }
      });

      return {
        success: false,
        error: 'server_error',
        errorDescription: 'Internal server error during client registration'
      };
    }
  }

  /**
   * Extract authorization parameters from Request Object claims
   */
  extractAuthorizationParameters(claims: RequestObjectClaims): Record<string, string> {
    const params: Record<string, string> = {
      response_type: claims.response_type,
      client_id: claims.client_id,
      redirect_uri: claims.redirect_uri
    };

    // Add optional parameters
    if (claims.scope) params.scope = claims.scope;
    if (claims.state) params.state = claims.state;
    if (claims.nonce) params.nonce = claims.nonce;
    if (claims.code_challenge) params.code_challenge = claims.code_challenge;
    if (claims.code_challenge_method) params.code_challenge_method = claims.code_challenge_method;

    return params;
  }

  private validateRequestObjectClaims(claims: RequestObjectClaims): RequestObjectValidationResult {
    // Validate required claims
    if (!claims.iss) {
      return {
        isValid: false,
        error: 'invalid_request_object',
        errorDescription: 'Request Object must contain iss claim'
      };
    }

    if (!claims.aud) {
      return {
        isValid: false,
        error: 'invalid_request_object',
        errorDescription: 'Request Object must contain aud claim'
      };
    }

    if (!claims.exp || typeof claims.exp !== 'number') {
      return {
        isValid: false,
        error: 'invalid_request_object',
        errorDescription: 'Request Object must contain valid exp claim'
      };
    }

    if (!claims.iat || typeof claims.iat !== 'number') {
      return {
        isValid: false,
        error: 'invalid_request_object',
        errorDescription: 'Request Object must contain valid iat claim'
      };
    }

    // Validate OAuth 2.0 parameters
    if (!claims.response_type) {
      return {
        isValid: false,
        error: 'invalid_request_object',
        errorDescription: 'Request Object must contain response_type'
      };
    }

    if (!claims.client_id) {
      return {
        isValid: false,
        error: 'invalid_request_object',
        errorDescription: 'Request Object must contain client_id'
      };
    }

    if (!claims.redirect_uri) {
      return {
        isValid: false,
        error: 'invalid_request_object',
        errorDescription: 'Request Object must contain redirect_uri'
      };
    }

    // Validate client_id matches iss for Federation (only for unregistered clients)
    // For registered clients, client_id will be the registered client ID (numeric)
    // and iss will be the entity ID (URL)
    const isUnregisteredClient = claims.client_id.startsWith('https://') || claims.client_id.startsWith('http://');
    if (isUnregisteredClient && claims.client_id !== claims.iss) {
      return {
        isValid: false,
        error: 'invalid_request_object',
        errorDescription: 'client_id must match iss claim in Request Object for unregistered clients'
      };
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp <= now) {
      return {
        isValid: false,
        error: 'invalid_request_object',
        errorDescription: 'Request Object has expired'
      };
    }

    // Check not before (if present)
    if (claims.nbf && claims.nbf > now) {
      return {
        isValid: false,
        error: 'invalid_request_object',
        errorDescription: 'Request Object is not yet valid'
      };
    }

    return { isValid: true };
  }

  private decodeBase64Url(str: string): string {
    // Add padding if needed
    const padding = '='.repeat((4 - (str.length % 4)) % 4);
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;
    
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  /**
   * Merge client metadata from Request Object and Entity Configuration
   * Request Object metadata takes precedence
   */
  private mergeClientMetadata(requestObjectMetadata: any, discoveredMetadata: any): any {
    if (!requestObjectMetadata && !discoveredMetadata) {
      return null;
    }

    // Start with discovered metadata as base
    const merged = { ...discoveredMetadata };

    // Override with Request Object metadata (takes precedence)
    if (requestObjectMetadata) {
      Object.keys(requestObjectMetadata).forEach(key => {
        if (requestObjectMetadata[key] !== undefined) {
          merged[key] = requestObjectMetadata[key];
        }
      });
    }

    return merged;
  }

  /**
   * Check if entity identifier is localhost
   */
  private isLocalhost(entityId: string): boolean {
    try {
      const url = new URL(entityId);
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }
}