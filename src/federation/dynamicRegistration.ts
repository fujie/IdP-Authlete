import { logger } from '../utils/logger';
import { TrustChainService, TrustChainValidationResult } from './trustChain';
import { AuthleteClient } from '../authlete/client';
import { AuthleteDynamicRegistrationRequest, AuthleteDynamicRegistrationResponse, AuthleteClientCreateRequest, AuthleteFederationRegistrationRequest } from '../authlete/types';
import { findPreRegisteredClient } from './preRegisteredClients';

export interface DynamicRegistrationRequest {
  redirect_uris: string[];
  client_name?: string | undefined;
  client_uri?: string | undefined;
  logo_uri?: string | undefined;
  contacts?: string[] | undefined;
  tos_uri?: string | undefined;
  policy_uri?: string | undefined;
  jwks_uri?: string | undefined;
  jwks?: {
    keys: any[];
  } | undefined;
  software_statement?: string; // JWT containing client metadata
  // Federation-specific
  entity_id: string; // The client's entity identifier
}

export interface DynamicRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
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
  // Federation-specific response
  trust_chain_validation: TrustChainValidationResult;
  authlete_registration: AuthleteDynamicRegistrationResponse;
}

export interface DynamicRegistrationError {
  error: string;
  error_description: string;
  trust_chain_validation?: TrustChainValidationResult;
}

// In-memory client registry for demo purposes
const registeredClients = new Map<string, DynamicRegistrationResponse>();

export class DynamicRegistrationService {
  private trustChainService: TrustChainService;
  private authleteClient: AuthleteClient;

  constructor(authleteClient: AuthleteClient) {
    this.trustChainService = new TrustChainService();
    this.authleteClient = authleteClient;
  }

  /**
   * Process dynamic client registration request
   */
  async registerClient(request: DynamicRegistrationRequest): Promise<DynamicRegistrationResponse | DynamicRegistrationError> {
    logger.logInfo(
      'Processing dynamic client registration',
      'DynamicRegistrationService',
      {
        entityId: request.entity_id,
        clientName: request.client_name,
        redirectUris: request.redirect_uris
      }
    );

    try {
      // Step 1: Validate Trust Chain
      const trustChainValidation = await this.trustChainService.validateTrustChain(request.entity_id);
      
      if (!trustChainValidation.isValid) {
        logger.logWarn(
          'Client registration rejected - invalid Trust Chain',
          'DynamicRegistrationService',
          {
            entityId: request.entity_id,
            error: trustChainValidation.error
          }
        );

        return {
          error: 'invalid_client_metadata',
          error_description: `Trust Chain validation failed: ${trustChainValidation.error}`,
          trust_chain_validation: trustChainValidation
        };
      }

      // Step 2: Validate request parameters
      const validationError = this.validateRegistrationRequest(request);
      if (validationError) {
        return validationError;
      }

      // Step 3: Check for pre-registered client first (for both HTTP and HTTPS)
      const preRegisteredClient = findPreRegisteredClient(request.entity_id);
      if (preRegisteredClient) {
        logger.logInfo(
          'Using pre-registered client for Federation entity',
          'DynamicRegistrationService',
          {
            entityId: request.entity_id,
            clientId: preRegisteredClient.clientId,
            trustAnchor: trustChainValidation.trustAnchor
          }
        );

        const registrationResponse: DynamicRegistrationResponse = {
          client_id: preRegisteredClient.clientId,
          client_secret: preRegisteredClient.clientSecret,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_secret_expires_at: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year
          redirect_uris: preRegisteredClient.redirectUris,
          client_name: preRegisteredClient.clientName,
          trust_chain_validation: trustChainValidation,
          authlete_registration: {
            action: 'CREATED',
            client_id: preRegisteredClient.clientId,
            client_secret: preRegisteredClient.clientSecret,
            redirect_uris: preRegisteredClient.redirectUris,
            client_name: preRegisteredClient.clientName
          } as AuthleteDynamicRegistrationResponse,
          // Optional properties from request
          ...(request.client_uri && { client_uri: request.client_uri }),
          ...(request.logo_uri && { logo_uri: request.logo_uri }),
          ...(request.contacts && { contacts: request.contacts }),
          ...(request.tos_uri && { tos_uri: request.tos_uri }),
          ...(request.policy_uri && { policy_uri: request.policy_uri }),
          ...(request.jwks_uri && { jwks_uri: request.jwks_uri }),
          ...(request.jwks && { jwks: request.jwks })
        };

        // Store client registration locally for reference
        registeredClients.set(preRegisteredClient.clientId, registrationResponse);

        return registrationResponse;
      }

      // Step 4: For HTTPS entity identifiers, try Authlete Federation Registration API
      // For HTTP entity identifiers, fall back to standard dynamic registration
      const useAuthleteAPI = request.entity_id.startsWith('https://');
      
      if (!useAuthleteAPI) {      }

      // Step 4: Try Authlete Federation Registration API
      logger.logInfo(
        'Using Authlete Federation Registration API for HTTPS entity identifier',
        'DynamicRegistrationService',
        {
          entityId: request.entity_id,
          trustAnchor: trustChainValidation.trustAnchor
        }
      );
      
      // Generate software statement (entity statement) for Federation
      const softwareStatement = this.generateSoftwareStatement(request.entity_id, trustChainValidation);
      
      const federationRegistrationRequest: AuthleteFederationRegistrationRequest = {
        redirect_uris: request.redirect_uris,
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
        application_type: 'web',
        subject_type: 'public',
        id_token_signed_response_alg: 'RS256',
        token_endpoint_auth_method: 'client_secret_basic',
        // Federation-specific parameters
        software_statement: softwareStatement,
        ...(trustChainValidation.chain && { trust_chain: trustChainValidation.chain }),
        ...(trustChainValidation.trustAnchor && { trust_anchor_id: trustChainValidation.trustAnchor }),
        // Optional properties - only include if present
        ...(request.client_name && { client_name: request.client_name }),
        ...(request.client_uri && { client_uri: request.client_uri }),
        ...(request.logo_uri && { logo_uri: request.logo_uri }),
        ...(request.contacts && { contacts: request.contacts }),
        ...(request.tos_uri && { tos_uri: request.tos_uri }),
        ...(request.policy_uri && { policy_uri: request.policy_uri }),
        ...(request.jwks_uri && { jwks_uri: request.jwks_uri }),
        ...(request.jwks && { jwks: request.jwks })
      };

      logger.logInfo(
        'Registering client with Authlete Federation Registration API',
        'DynamicRegistrationService',
        {
          entityId: request.entity_id,
          clientName: request.client_name
        }
      );

      try {
        const federationResponse = await this.authleteClient.federationRegistration(federationRegistrationRequest);

        if (federationResponse.action === 'CREATED') {
          logger.logInfo(
            'Client registered successfully using Authlete Federation Registration API',
            'DynamicRegistrationService',
            {
              entityId: request.entity_id,
              clientId: federationResponse.client_id,
              trustAnchor: trustChainValidation.trustAnchor
            }
          );

          const registrationResponse: DynamicRegistrationResponse = {
            client_id: federationResponse.client_id!,
            client_secret: federationResponse.client_secret!,
            client_id_issued_at: federationResponse.client_id_issued_at!,
            client_secret_expires_at: federationResponse.client_secret_expires_at!,
            redirect_uris: federationResponse.redirect_uris!,
            trust_chain_validation: trustChainValidation,
            authlete_registration: {
              action: 'CREATED',
              client_id: federationResponse.client_id,
              client_secret: federationResponse.client_secret,
              client_id_issued_at: federationResponse.client_id_issued_at,
              client_secret_expires_at: federationResponse.client_secret_expires_at,
              redirect_uris: federationResponse.redirect_uris,
              client_name: federationResponse.client_name,
              client_uri: federationResponse.client_uri,
              logo_uri: federationResponse.logo_uri,
              contacts: federationResponse.contacts,
              tos_uri: federationResponse.tos_uri,
              policy_uri: federationResponse.policy_uri,
              jwks_uri: federationResponse.jwks_uri,
              jwks: federationResponse.jwks,
              response_types: federationResponse.response_types,
              grant_types: federationResponse.grant_types,
              application_type: federationResponse.application_type,
              subject_type: federationResponse.subject_type,
              id_token_signed_response_alg: federationResponse.id_token_signed_response_alg,
              token_endpoint_auth_method: federationResponse.token_endpoint_auth_method
            } as AuthleteDynamicRegistrationResponse,
            // Optional properties - only include if present
            ...(federationResponse.client_name && { client_name: federationResponse.client_name }),
            ...(federationResponse.client_uri && { client_uri: federationResponse.client_uri }),
            ...(federationResponse.logo_uri && { logo_uri: federationResponse.logo_uri }),
            ...(federationResponse.contacts && { contacts: federationResponse.contacts }),
            ...(federationResponse.tos_uri && { tos_uri: federationResponse.tos_uri }),
            ...(federationResponse.policy_uri && { policy_uri: federationResponse.policy_uri }),
            ...(federationResponse.jwks_uri && { jwks_uri: federationResponse.jwks_uri }),
            ...(federationResponse.jwks && { jwks: federationResponse.jwks })
          };

          // Store client registration locally for reference
          registeredClients.set(federationResponse.client_id!, registrationResponse);

          return registrationResponse;
        } else {
          logger.logWarn(
            'Authlete Federation Registration failed, trying fallback methods',
            'DynamicRegistrationService',
            {
              entityId: request.entity_id,
              federationAction: federationResponse.action,
              federationResponse: federationResponse.responseContent
            }
          );
        }
      } catch (federationError) {
        logger.logWarn(
          'Authlete Federation Registration API error, trying fallback methods',
          'DynamicRegistrationService',
          {
            entityId: request.entity_id,
            federationError: federationError instanceof Error ? federationError.message : String(federationError)
          }
        );
      }

      // Step 5: Fallback to standard dynamic registration
      const authleteRegistrationRequest: AuthleteDynamicRegistrationRequest = {
        redirect_uris: request.redirect_uris,
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
        application_type: 'web',
        subject_type: 'public',
        id_token_signed_response_alg: 'RS256',
        token_endpoint_auth_method: 'client_secret_basic',
        // Federation-specific metadata
        software_id: request.entity_id,
        software_version: '1.0.0',
        // Optional properties - only include if present
        ...(request.client_name && { client_name: request.client_name }),
        ...(request.client_uri && { client_uri: request.client_uri }),
        ...(request.logo_uri && { logo_uri: request.logo_uri }),
        ...(request.contacts && { contacts: request.contacts }),
        ...(request.tos_uri && { tos_uri: request.tos_uri }),
        ...(request.policy_uri && { policy_uri: request.policy_uri }),
        ...(request.jwks_uri && { jwks_uri: request.jwks_uri }),
        ...(request.jwks && { jwks: request.jwks }),
        ...(request.software_statement && { software_statement: request.software_statement })
      };

      logger.logInfo(
        'Registering client with Authlete',
        'DynamicRegistrationService',
        {
          entityId: request.entity_id,
          clientName: request.client_name
        }
      );

      const authleteResponse = await this.authleteClient.dynamicClientRegistration(authleteRegistrationRequest);

      if (authleteResponse.action !== 'CREATED') {
        logger.logWarn(
          'Authlete dynamic registration failed, trying client create API',
          'DynamicRegistrationService',
          {
            entityId: request.entity_id,
            authleteAction: authleteResponse.action,
            authleteResponse: authleteResponse.responseContent
          }
        );

        // Step 6: Try using client create API as fallback
        const clientCreateRequest: AuthleteClientCreateRequest = {
          redirect_uris: request.redirect_uris,
          response_types: ['code'],
          grant_types: ['authorization_code', 'refresh_token'],
          application_type: 'web',
          subject_type: 'public',
          id_token_signed_response_alg: 'RS256',
          token_endpoint_auth_method: 'client_secret_basic',
          // Federation-specific metadata
          software_id: request.entity_id,
          software_version: '1.0.0',
          // Optional properties - only include if present
          ...(request.client_name && { client_name: request.client_name }),
          ...(request.client_uri && { client_uri: request.client_uri }),
          ...(request.logo_uri && { logo_uri: request.logo_uri }),
          ...(request.contacts && { contacts: request.contacts }),
          ...(request.tos_uri && { tos_uri: request.tos_uri }),
          ...(request.policy_uri && { policy_uri: request.policy_uri }),
          ...(request.jwks_uri && { jwks_uri: request.jwks_uri }),
          ...(request.jwks && { jwks: request.jwks }),
          ...(request.software_statement && { software_statement: request.software_statement })
        };

        try {
          const createResponse = await this.authleteClient.createClient(clientCreateRequest);
          
          if (createResponse.action === 'CREATED') {
            logger.logInfo(
              'Client created successfully using Authlete create API',
              'DynamicRegistrationService',
              {
                entityId: request.entity_id,
                clientId: createResponse.client_id,
                trustAnchor: trustChainValidation.trustAnchor
              }
            );

            // Convert client_id from number to string for consistency
            const clientIdString = createResponse.client_id!.toString();

            const registrationResponse: DynamicRegistrationResponse = {
              client_id: clientIdString,
              client_secret: createResponse.client_secret!,
              client_id_issued_at: createResponse.client_id_issued_at!,
              client_secret_expires_at: createResponse.client_secret_expires_at!,
              redirect_uris: createResponse.redirect_uris!,
              trust_chain_validation: trustChainValidation,
              authlete_registration: {
                action: 'CREATED',
                client_id: clientIdString,
                client_secret: createResponse.client_secret!,
                client_id_issued_at: createResponse.client_id_issued_at!,
                client_secret_expires_at: createResponse.client_secret_expires_at!,
                redirect_uris: createResponse.redirect_uris!,
                ...(createResponse.client_name && { client_name: createResponse.client_name }),
                ...(createResponse.client_uri && { client_uri: createResponse.client_uri }),
                ...(createResponse.logo_uri && { logo_uri: createResponse.logo_uri }),
                ...(createResponse.contacts && { contacts: createResponse.contacts }),
                ...(createResponse.tos_uri && { tos_uri: createResponse.tos_uri }),
                ...(createResponse.policy_uri && { policy_uri: createResponse.policy_uri }),
                ...(createResponse.jwks_uri && { jwks_uri: createResponse.jwks_uri }),
                ...(createResponse.jwks && { jwks: createResponse.jwks }),
                ...(createResponse.response_types && { response_types: createResponse.response_types }),
                ...(createResponse.grant_types && { grant_types: createResponse.grant_types }),
                ...(createResponse.application_type && { application_type: createResponse.application_type }),
                ...(createResponse.subject_type && { subject_type: createResponse.subject_type }),
                ...(createResponse.id_token_signed_response_alg && { id_token_signed_response_alg: createResponse.id_token_signed_response_alg }),
                ...(createResponse.token_endpoint_auth_method && { token_endpoint_auth_method: createResponse.token_endpoint_auth_method })
              } as AuthleteDynamicRegistrationResponse,
              // Optional properties - only include if present
              ...(createResponse.client_name && { client_name: createResponse.client_name }),
              ...(createResponse.client_uri && { client_uri: createResponse.client_uri }),
              ...(createResponse.logo_uri && { logo_uri: createResponse.logo_uri }),
              ...(createResponse.contacts && { contacts: createResponse.contacts }),
              ...(createResponse.tos_uri && { tos_uri: createResponse.tos_uri }),
              ...(createResponse.policy_uri && { policy_uri: createResponse.policy_uri }),
              ...(createResponse.jwks_uri && { jwks_uri: createResponse.jwks_uri }),
              ...(createResponse.jwks && { jwks: createResponse.jwks })
            };

            // Store client registration locally for reference
            registeredClients.set(clientIdString, registrationResponse);

            return registrationResponse;
          }
        } catch (createError) {
          logger.logWarn(
            'Authlete client create API also failed, falling back to local registration',
            'DynamicRegistrationService',
            {
              entityId: request.entity_id,
              createError: createError instanceof Error ? createError.message : String(createError)
            }
          );
        }

        // Step 7: Final fallback to local registration for development/testing
        const clientId = this.generateClientId(request.entity_id);
        const clientSecret = this.generateClientSecret();
        const issuedAt = Math.floor(Date.now() / 1000);
        const secretExpiresAt = issuedAt + (365 * 24 * 60 * 60); // 1 year

        const fallbackResponse: DynamicRegistrationResponse = {
          client_id: clientId,
          client_secret: clientSecret,
          client_id_issued_at: issuedAt,
          client_secret_expires_at: secretExpiresAt,
          redirect_uris: request.redirect_uris,
          trust_chain_validation: trustChainValidation,
          authlete_registration: authleteResponse,
          // Optional properties - only include if present
          ...(request.client_name && { client_name: request.client_name }),
          ...(request.client_uri && { client_uri: request.client_uri }),
          ...(request.logo_uri && { logo_uri: request.logo_uri }),
          ...(request.contacts && { contacts: request.contacts }),
          ...(request.tos_uri && { tos_uri: request.tos_uri }),
          ...(request.policy_uri && { policy_uri: request.policy_uri }),
          ...(request.jwks_uri && { jwks_uri: request.jwks_uri }),
          ...(request.jwks && { jwks: request.jwks })
        };

        // Store client registration locally
        registeredClients.set(clientId, fallbackResponse);

        logger.logInfo(
          'Client registration completed using local fallback',
          'DynamicRegistrationService',
          {
            entityId: request.entity_id,
            clientId: clientId,
            trustAnchor: trustChainValidation.trustAnchor,
            reason: 'Authlete APIs not available'
          }
        );

        return fallbackResponse;
      }

      // Step 4: Create registration response (for successful dynamic registration)
      const registrationResponse: DynamicRegistrationResponse = {
        client_id: authleteResponse.client_id!,
        client_secret: authleteResponse.client_secret!,
        client_id_issued_at: authleteResponse.client_id_issued_at!,
        client_secret_expires_at: authleteResponse.client_secret_expires_at!,
        redirect_uris: authleteResponse.redirect_uris!,
        trust_chain_validation: trustChainValidation,
        authlete_registration: authleteResponse,
        // Optional properties - only include if present
        ...(authleteResponse.client_name && { client_name: authleteResponse.client_name }),
        ...(authleteResponse.client_uri && { client_uri: authleteResponse.client_uri }),
        ...(authleteResponse.logo_uri && { logo_uri: authleteResponse.logo_uri }),
        ...(authleteResponse.contacts && { contacts: authleteResponse.contacts }),
        ...(authleteResponse.tos_uri && { tos_uri: authleteResponse.tos_uri }),
        ...(authleteResponse.policy_uri && { policy_uri: authleteResponse.policy_uri }),
        ...(authleteResponse.jwks_uri && { jwks_uri: authleteResponse.jwks_uri }),
        ...(authleteResponse.jwks && { jwks: authleteResponse.jwks })
      };

      // Step 5: Store client registration locally for reference (for successful dynamic registration)
      registeredClients.set(authleteResponse.client_id!, registrationResponse);

      logger.logInfo(
        'Client registration successful',
        'DynamicRegistrationService',
        {
          entityId: request.entity_id,
          clientId: authleteResponse.client_id,
          trustAnchor: trustChainValidation.trustAnchor
        }
      );

      return registrationResponse;

    } catch (error) {
      logger.logError({
        message: 'Dynamic client registration error',
        component: 'DynamicRegistrationService',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: { entityId: request.entity_id }
      });

      return {
        error: 'server_error',
        error_description: 'Internal server error during client registration'
      };
    }
  }

  /**
   * Get registered client information
   */
  getRegisteredClient(clientId: string): DynamicRegistrationResponse | null {
    return registeredClients.get(clientId) || null;
  }

  /**
   * Check if client is registered
   */
  isClientRegistered(clientId: string): boolean {
    return registeredClients.has(clientId);
  }

  /**
   * Get all registered clients (for testing)
   */
  getAllRegisteredClients(): DynamicRegistrationResponse[] {
    return Array.from(registeredClients.values());
  }

  /**
   * Validate registration request parameters
   */
  private validateRegistrationRequest(request: DynamicRegistrationRequest): DynamicRegistrationError | null {
    // Validate redirect URIs
    if (!request.redirect_uris || request.redirect_uris.length === 0) {
      return {
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris is required and must not be empty'
      };
    }

    // Validate redirect URI format
    for (const uri of request.redirect_uris) {
      try {
        const url = new URL(uri);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return {
            error: 'invalid_redirect_uri',
            error_description: `Invalid redirect URI protocol: ${uri}`
          };
        }
      } catch (error) {
        return {
          error: 'invalid_redirect_uri',
          error_description: `Invalid redirect URI format: ${uri}`
        };
      }
    }

    // Validate entity ID
    if (!request.entity_id) {
      return {
        error: 'invalid_client_metadata',
        error_description: 'entity_id is required for Federation clients'
      };
    }

    return null;
  }

  /**
   * Generate software statement (entity statement) for Federation registration
   * In a real implementation, this would be a properly signed JWT
   */
  private generateSoftwareStatement(entityId: string, trustChainValidation: TrustChainValidationResult): string {
    // Create entity statement payload
    const now = Math.floor(Date.now() / 1000);
    const entityStatement = {
      iss: entityId,
      sub: entityId,
      iat: now,
      exp: now + (24 * 60 * 60), // 24 hours
      aud: trustChainValidation.trustAnchor,
      // Client metadata
      metadata: {
        openid_relying_party: {
          client_name: 'Federation Test Client',
          redirect_uris: ['http://localhost:3002/callback'],
          response_types: ['code'],
          grant_types: ['authorization_code', 'refresh_token'],
          application_type: 'web',
          subject_type: 'public',
          id_token_signed_response_alg: 'RS256',
          token_endpoint_auth_method: 'client_secret_basic'
        }
      },
      // Trust chain information
      trust_chain: trustChainValidation.chain,
      trust_anchor_id: trustChainValidation.trustAnchor
    };

    // In a real implementation, this would be signed with the entity's private key
    // For now, return a mock JWT structure
    const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(entityStatement)).toString('base64url');
    const signature = 'mock-signature-for-development';
    
    return `${header}.${payload}.${signature}`;
  }

  /**
   * Generate client ID based on entity ID
   */
  private generateClientId(entityId: string): string {
    // Create a deterministic client ID based on entity ID
    const hash = this.simpleHash(entityId);
    return `fed_${hash}`;
  }

  /**
   * Generate client secret
   */
  private generateClientSecret(): string {
    // Generate a random client secret
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let result = '';
    for (let i = 0; i < 64; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Simple hash function for demo purposes
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}