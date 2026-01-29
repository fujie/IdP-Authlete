import { AuthleteClient, AuthleteApiError } from '../authlete/client';
import { 
  AuthleteFederationRegistrationRequest, 
  AuthleteFederationRegistrationResponse,
  AuthleteFederationConfigurationRequest,
  AuthleteFederationConfigurationResponse,
  AuthleteDynamicRegistrationRequest
} from '../authlete/types';
import { AuthleteIntegrationService } from './interfaces';
import { logger } from '../utils/logger';

/**
 * Federation Registration Error
 * 
 * Represents errors that occur during federation registration processing
 */
export class FederationRegistrationError extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly errorDescription: string,
    public readonly statusCode: number = 400,
    public readonly authleteResponse?: any
  ) {
    super(errorDescription);
    this.name = 'FederationRegistrationError';
  }
}

/**
 * Processed Registration Response
 * 
 * Contains extracted client credentials and metadata from Authlete response
 */
export interface ProcessedRegistrationResponse {
  clientId: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
  entityStatement?: string;
  trustAnchorId?: string;
  redirectUris: string[];
  clientName?: string;
  clientUri?: string;
  logoUri?: string;
  contacts?: string[];
  tosUri?: string;
  policyUri?: string;
  jwksUri?: string;
  jwks?: any;
  responseTypes?: string[];
  grantTypes?: string[];
  applicationType?: string;
  subjectType?: string;
  idTokenSignedResponseAlg?: string;
  tokenEndpointAuthMethod?: string;
}

/**
 * Authlete Integration Service
 * 
 * Purpose: Interfaces with Authlete federation APIs for dynamic client registration
 * and entity configuration management.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */
export class AuthleteIntegrationServiceImpl implements AuthleteIntegrationService {
  constructor(private authleteClient: AuthleteClient) {}

  /**
   * Register a federated client using Authlete's federation/registration API
   * 
   * @param request Federation registration request with trust chain and metadata
   * @returns Authlete registration response with client credentials
   * 
   * Requirements: 3.1, 3.2, 3.3
   */
  async registerFederatedClient(
    request: AuthleteFederationRegistrationRequest
  ): Promise<AuthleteFederationRegistrationResponse> {
    logger.logInfo(
      'Registering federated client with Authlete',
      'AuthleteIntegrationService',
      {
        clientName: request.client_name,
        redirectUrisCount: request.redirect_uris?.length || 0,
        hasTrustChain: !!request.trustChain,
        hasEntityConfiguration: !!request.entityConfiguration,
        trustAnchorId: request.trustAnchorId
      }
    );

    try {
      // Try Authlete's federation registration API first
      try {
        const response = await this.authleteClient.federationRegistration(request);
        
        // Process and validate the response
        const processedResponse = this.processRegistrationResponse(response);

        // Log successful registration
        logger.logInfo(
          'Federated client registered successfully with Authlete federation API',
          'AuthleteIntegrationService',
          {
            action: response.action,
            clientId: processedResponse.clientId,
            hasClientSecret: !!processedResponse.clientSecret,
            hasEntityStatement: !!processedResponse.entityStatement,
            trustAnchorId: processedResponse.trustAnchorId
          }
        );

        return response;
      } catch (federationApiError) {
        // If federation API fails with 400/404, fall back to standard client registration
        if (federationApiError instanceof AuthleteApiError && 
            (federationApiError.statusCode === 400 || federationApiError.statusCode === 404)) {
          
          logger.logWarn(
            'Federation registration API not available, falling back to standard client registration',
            'AuthleteIntegrationService',
            {
              error: federationApiError.message,
              statusCode: federationApiError.statusCode
            }
          );

          // Use standard client registration endpoint
          const standardRequest = {
            redirect_uris: request.redirect_uris!,
            client_name: request.client_name,
            client_uri: request.client_uri,
            contacts: request.contacts,
            response_types: request.response_types,
            grant_types: request.grant_types,
            application_type: request.application_type,
            subject_type: request.subject_type,
            id_token_signed_response_alg: request.id_token_signed_response_alg,
            token_endpoint_auth_method: request.token_endpoint_auth_method
          } as AuthleteDynamicRegistrationRequest;

          const standardResponse = await this.authleteClient.dynamicClientRegistration(standardRequest);
          
          // Convert standard response to federation response format
          const federationResponse: AuthleteFederationRegistrationResponse = {
            ...standardResponse,
            // Add federation-specific fields
            trustAnchorId: request.trustAnchorId,
            entityConfiguration: request.entityConfiguration
          };

          logger.logInfo(
            'Federated client registered successfully with standard client registration API',
            'AuthleteIntegrationService',
            {
              action: federationResponse.action,
              clientId: federationResponse.client_id,
              hasClientSecret: !!federationResponse.client_secret
            }
          );

          return federationResponse;
        }
        
        // Re-throw if it's not a 400/404 error
        throw federationApiError;
      }
    } catch (error) {
      // Handle and transform errors
      const federationError = this.handleRegistrationError(error);
      
      logger.logError({
        message: 'Failed to register federated client with Authlete',
        component: 'AuthleteIntegrationService',
        error: {
          name: federationError.name,
          message: federationError.message
        },
        context: {
          clientName: request.client_name,
          redirectUrisCount: request.redirect_uris?.length || 0,
          trustAnchorId: request.trustAnchorId
        }
      });

      // Re-throw the processed error
      throw federationError;
    }
  }

  /**
   * Process and extract client credentials from Authlete registration response
   * 
   * @param response Raw Authlete registration response
   * @returns Processed response with extracted credentials
   * 
   * Requirements: 3.3
   */
  private processRegistrationResponse(
    response: AuthleteFederationRegistrationResponse
  ): ProcessedRegistrationResponse {
    // Validate response action - accept both OK and CREATED
    if (response.action !== 'CREATED' && response.action !== 'OK') {
      throw new FederationRegistrationError(
        'registration_failed',
        `Registration failed with action: ${response.action}`,
        this.getStatusCodeForAction(response.action),
        response
      );
    }

    // Validate required fields
    if (!response.client_id) {
      throw new FederationRegistrationError(
        'invalid_response',
        'Missing client_id in Authlete response',
        500,
        response
      );
    }

    if (!response.redirect_uris || response.redirect_uris.length === 0) {
      throw new FederationRegistrationError(
        'invalid_response',
        'Missing redirect_uris in Authlete response',
        500,
        response
      );
    }

    // Extract and return processed response
    const result: ProcessedRegistrationResponse = {
      clientId: response.client_id!,
      redirectUris: response.redirect_uris!
    };

    // Add optional fields only if they exist
    if (response.client_secret) result.clientSecret = response.client_secret;
    if (response.client_id_issued_at) result.clientIdIssuedAt = response.client_id_issued_at;
    if (response.client_secret_expires_at) result.clientSecretExpiresAt = response.client_secret_expires_at;
    if (response.entityStatement) result.entityStatement = response.entityStatement;
    if (response.trustAnchorId) result.trustAnchorId = response.trustAnchorId;
    if (response.client_name) result.clientName = response.client_name;
    if (response.client_uri) result.clientUri = response.client_uri;
    if (response.logo_uri) result.logoUri = response.logo_uri;
    if (response.contacts) result.contacts = response.contacts;
    if (response.tos_uri) result.tosUri = response.tos_uri;
    if (response.policy_uri) result.policyUri = response.policy_uri;
    if (response.jwks_uri) result.jwksUri = response.jwks_uri;
    if (response.jwks) result.jwks = response.jwks;
    if (response.response_types) result.responseTypes = response.response_types;
    if (response.grant_types) result.grantTypes = response.grant_types;
    if (response.application_type) result.applicationType = response.application_type;
    if (response.subject_type) result.subjectType = response.subject_type;
    if (response.id_token_signed_response_alg) result.idTokenSignedResponseAlg = response.id_token_signed_response_alg;
    if (response.token_endpoint_auth_method) result.tokenEndpointAuthMethod = response.token_endpoint_auth_method;

    return result;
  }

  /**
   * Handle and transform registration errors into federation-specific errors
   * 
   * @param error Original error from Authlete API
   * @returns Transformed federation registration error
   * 
   * Requirements: 3.4, 3.5
   */
  private handleRegistrationError(
    error: any
  ): FederationRegistrationError {
    // Handle Authlete API errors
    if (error instanceof AuthleteApiError) {
      const errorCode = this.mapAuthleteErrorToFederationError(error.statusCode, error.authleteResponse);
      const errorDescription = this.getErrorDescription(errorCode, error.message);
      
      return new FederationRegistrationError(
        errorCode,
        errorDescription,
        error.statusCode,
        error.authleteResponse
      );
    }

    // Handle federation registration errors (already processed)
    if (error instanceof FederationRegistrationError) {
      return error;
    }

    // Handle generic errors
    return new FederationRegistrationError(
      'server_error',
      `Internal server error during registration: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }

  /**
   * Map Authlete API error codes to federation error codes
   * 
   * @param statusCode HTTP status code from Authlete
   * @param authleteResponse Authlete response body
   * @returns Federation error code
   */
  private mapAuthleteErrorToFederationError(statusCode: number, authleteResponse: any): string {
    switch (statusCode) {
      case 400:
        // Check for specific Authlete error conditions
        if (authleteResponse?.resultMessage?.includes('trust chain')) {
          return 'invalid_client_metadata';
        }
        if (authleteResponse?.resultMessage?.includes('redirect_uri')) {
          return 'invalid_redirect_uri';
        }
        return 'invalid_request';
      
      case 401:
        return 'invalid_client';
      
      case 403:
        return 'access_denied';
      
      case 429:
        return 'temporarily_unavailable';
      
      case 500:
      case 502:
      case 503:
      case 504:
        return 'server_error';
      
      default:
        return 'server_error';
    }
  }

  /**
   * Get human-readable error description for federation error codes
   * 
   * @param errorCode Federation error code
   * @param originalMessage Original error message from Authlete
   * @returns Human-readable error description
   */
  private getErrorDescription(errorCode: string, originalMessage: string): string {
    const descriptions: Record<string, string> = {
      'invalid_request': 'The registration request is malformed or contains invalid parameters',
      'invalid_client': 'Client authentication failed or client is not authorized',
      'invalid_client_metadata': 'The client metadata in the trust chain is invalid or incomplete',
      'invalid_redirect_uri': 'One or more redirect URIs are invalid',
      'access_denied': 'The client is not authorized to register with this authorization server',
      'temporarily_unavailable': 'The registration service is temporarily unavailable due to rate limiting',
      'server_error': 'An internal server error occurred during registration',
      'registration_failed': 'Client registration failed'
    };

    const baseDescription = descriptions[errorCode] || 'An error occurred during registration';
    return `${baseDescription}. ${originalMessage}`;
  }

  /**
   * Get appropriate HTTP status code for Authlete action
   * 
   * @param action Authlete response action
   * @returns HTTP status code
   */
  private getStatusCodeForAction(action: string): number {
    switch (action) {
      case 'BAD_REQUEST':
        return 400;
      case 'UNAUTHORIZED':
        return 401;
      case 'FORBIDDEN':
        return 403;
      case 'INTERNAL_SERVER_ERROR':
        return 500;
      default:
        return 400;
    }
  }

  /**
   * Get the authorization server's entity configuration from Authlete
   * 
   * @returns JWT entity configuration string
   * 
   * Requirements: 7.1, 7.2, 7.3
   */
  async getEntityConfiguration(): Promise<string> {
    logger.logDebug(
      'Retrieving entity configuration from Authlete',
      'AuthleteIntegrationService'
    );

    try {
      // Call Authlete's federation configuration API
      const request: AuthleteFederationConfigurationRequest = {};
      const response = await this.authleteClient.federationConfiguration(request);

      // Process and validate the response
      const entityConfiguration = this.processConfigurationResponse(response);

      logger.logDebug(
        'Entity configuration retrieved successfully from Authlete',
        'AuthleteIntegrationService',
        {
          action: response.action,
          hasEntityConfiguration: !!entityConfiguration
        }
      );

      return entityConfiguration;
    } catch (error) {
      // Handle and transform errors
      const federationError = this.handleConfigurationError(error);
      
      logger.logError({
        message: 'Failed to retrieve entity configuration from Authlete',
        component: 'AuthleteIntegrationService',
        error: {
          name: federationError.name,
          message: federationError.message
        }
      });

      // Re-throw the processed error
      throw federationError;
    }
  }

  /**
   * Process and validate entity configuration response from Authlete
   * 
   * @param response Raw Authlete configuration response
   * @returns Entity configuration JWT string
   */
  private processConfigurationResponse(
    response: AuthleteFederationConfigurationResponse
  ): string {
    // Validate response action
    if (response.action !== 'OK') {
      throw new FederationRegistrationError(
        'configuration_unavailable',
        `Entity configuration unavailable: ${response.action} - ${response.resultMessage || 'Unknown error'}`,
        this.getStatusCodeForAction(response.action),
        response
      );
    }

    // Validate entity configuration presence
    if (!response.entityConfiguration) {
      throw new FederationRegistrationError(
        'configuration_unavailable',
        'Entity configuration not available in Authlete response',
        500,
        response
      );
    }

    return response.entityConfiguration;
  }

  /**
   * Handle and transform configuration errors into federation-specific errors
   * 
   * @param error Original error from Authlete API
   * @returns Transformed federation registration error
   */
  private handleConfigurationError(error: any): FederationRegistrationError {
    // Handle Authlete API errors
    if (error instanceof AuthleteApiError) {
      return new FederationRegistrationError(
        'configuration_unavailable',
        `Failed to retrieve entity configuration: ${error.message}`,
        error.statusCode,
        error.authleteResponse
      );
    }

    // Handle federation registration errors (already processed)
    if (error instanceof FederationRegistrationError) {
      return error;
    }

    // Handle generic errors
    return new FederationRegistrationError(
      'server_error',
      `Internal server error retrieving entity configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
}