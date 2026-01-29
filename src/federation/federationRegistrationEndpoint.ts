// Federation Registration Endpoint Implementation
// Implements Requirements 1.1, 1.2, 1.3

import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { 
  FederationRegistrationRequest,
  FederationRegistrationResponse,
  EntityStatement
} from './types';
import { 
  FederationRegistrationEndpoint as IFederationRegistrationEndpoint 
} from './interfaces';
import { IntegratedTrustChainValidator } from './integratedTrustChainValidator';
import { FederationRequestObjectHandler } from './federationRequestObjectHandler';
import { AuthleteIntegrationServiceImpl } from './authleteIntegrationService';
import { AuthleteClient } from '../authlete/client';
import { 
  AuthleteFederationRegistrationRequest,
  AuthleteFederationRegistrationResponse 
} from '../authlete/types';
import { ValidationUtils } from './utils';

/**
 * Federation Registration Endpoint
 * 
 * Purpose: Handles dynamic client registration requests from federated entities
 * 
 * Requirements: 1.1, 1.2, 1.3
 */
export class FederationRegistrationEndpoint implements IFederationRegistrationEndpoint {
  private readonly trustChainValidator: IntegratedTrustChainValidator;
  private readonly requestObjectHandler: FederationRequestObjectHandler;
  private readonly authleteIntegrationService: AuthleteIntegrationServiceImpl;

  constructor(
    authleteClient: AuthleteClient,
    trustAnchors?: string[]
  ) {
    this.trustChainValidator = new IntegratedTrustChainValidator(trustAnchors);
    this.requestObjectHandler = new FederationRequestObjectHandler();
    this.authleteIntegrationService = new AuthleteIntegrationServiceImpl(authleteClient);

    logger.logInfo(
      'FederationRegistrationEndpoint initialized',
      'FederationRegistrationEndpoint',
      { 
        trustAnchors: this.trustChainValidator.getTrustAnchors()
      }
    );
  }

  /**
   * Handle POST requests to /federation/registration
   * Implements Requirements 1.1, 1.2, 1.3
   */
  async registerClient(request: FederationRegistrationRequest): Promise<FederationRegistrationResponse> {
    logger.logInfo(
      'Processing federation registration request',
      'FederationRegistrationEndpoint',
      {
        hasEntityConfiguration: !!request.entityConfiguration,
        hasTrustChain: !!request.trustChain,
        hasRequestObject: !!request.requestObject,
        trustChainLength: request.trustChain?.length || 0
      }
    );

    try {
      // Step 1: Extract entity ID and trust chain from request
      const { entityId, trustChain } = await this.extractEntityInformation(request);

      // Step 2: Validate trust chain
      logger.logInfo(
        'Validating trust chain for federation registration',
        'FederationRegistrationEndpoint',
        { entityId, trustChainLength: trustChain?.length || 0 }
      );

      const validationResult = await this.trustChainValidator.validateTrustChain(entityId, trustChain);
      
      if (!validationResult.isValid) {
        logger.logWarn(
          'Trust chain validation failed for federation registration',
          'FederationRegistrationEndpoint',
          { 
            entityId,
            errors: validationResult.errors?.map(e => e.message) || []
          }
        );

        throw new FederationRegistrationError(
          'invalid_client_metadata',
          `Trust chain validation failed: ${validationResult.errors?.[0]?.message || 'Unknown error'}`,
          400
        );
      }

      // Step 3: Process federation request object if present
      let registrationParameters = validationResult.clientMetadata!;
      
      if (request.requestObject) {
        logger.logInfo(
          'Processing federation request object',
          'FederationRegistrationEndpoint',
          { entityId }
        );

        const requestObjectValidation = await this.requestObjectHandler.validateRequestObjectWithOptionalSignature(
          request.requestObject,
          validationResult.clientMetadata?.jwks
        );

        if (!requestObjectValidation.isValid) {
          logger.logWarn(
            'Request object validation failed',
            'FederationRegistrationEndpoint',
            { 
              entityId,
              errors: requestObjectValidation.errors || []
            }
          );

          throw new FederationRegistrationError(
            'invalid_request',
            `Request object validation failed: ${requestObjectValidation.errors?.[0] || 'Unknown error'}`,
            400
          );
        }

        // Extract and merge registration parameters from request object
        const extractedParams = this.requestObjectHandler.extractRegistrationParameters(request.requestObject);
        registrationParameters = this.mergeRegistrationParameters(registrationParameters, extractedParams);
      }

      // Step 4: Call Authlete federation registration API
      logger.logInfo(
        'Registering client with Authlete federation API',
        'FederationRegistrationEndpoint',
        { 
          entityId,
          trustAnchor: validationResult.trustAnchor,
          clientName: registrationParameters.client_name,
          redirectUriCount: registrationParameters.redirect_uris.length
        }
      );

      // Prepare Authlete federation registration request
      // According to Authlete's specification, the request should contain
      // EITHER entityConfiguration (JWT string) OR trustChain (JSON string)
      const authleteRequest: AuthleteFederationRegistrationRequest = {
        // Required: redirect_uris for fallback to standard registration
        redirect_uris: registrationParameters.redirect_uris,
        // Federation-specific: entityConfiguration JWT (only if present)
        ...(request.entityConfiguration && { entityConfiguration: request.entityConfiguration }),
        // Optional: trustChain as array of JWTs
        ...(trustChain && trustChain.length > 0 && { 
          trustChain: trustChain.map(stmt => stmt.jwt) 
        }),
        // Optional: trustAnchorId for reference
        ...(validationResult.trustAnchor && { 
          trustAnchorId: validationResult.trustAnchor 
        }),
        // Optional client metadata (for fallback to standard registration)
        ...(registrationParameters.client_name && { client_name: registrationParameters.client_name }),
        ...(registrationParameters.client_uri && { client_uri: registrationParameters.client_uri }),
        ...(registrationParameters.contacts && { contacts: registrationParameters.contacts }),
        response_types: registrationParameters.response_types || ['code'],
        grant_types: registrationParameters.grant_types || ['authorization_code'],
        application_type: registrationParameters.application_type || 'web',
        subject_type: registrationParameters.subject_type || 'public',
        id_token_signed_response_alg: registrationParameters.id_token_signed_response_alg || 'RS256',
        token_endpoint_auth_method: registrationParameters.token_endpoint_auth_method || 'client_secret_basic'
      };

      const authleteResponse = await this.authleteIntegrationService.registerFederatedClient(authleteRequest);

      // Step 5: Process Authlete response and return client credentials
      const registrationResponse = this.processAuthleteResponse(
        authleteResponse,
        validationResult.trustAnchor!
      );

      logger.logInfo(
        'Federation registration completed successfully',
        'FederationRegistrationEndpoint',
        {
          entityId,
          clientId: registrationResponse.clientId,
          trustAnchor: registrationResponse.trustAnchorId,
          hasClientSecret: !!registrationResponse.clientSecret
        }
      );

      return registrationResponse;

    } catch (error) {
      // Handle and transform errors appropriately
      if (error instanceof FederationRegistrationError) {
        logger.logError({
          message: 'Federation registration failed with known error',
          component: 'FederationRegistrationEndpoint',
          error: {
            name: error.name,
            message: error.message
          }
        });
        throw error;
      }

      logger.logError({
        message: 'Federation registration failed with unexpected error',
        component: 'FederationRegistrationEndpoint',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      throw new FederationRegistrationError(
        'server_error',
        'Internal server error during federation registration',
        500
      );
    }
  }

  /**
   * Extract entity ID and trust chain from registration request
   */
  private async extractEntityInformation(
    request: FederationRegistrationRequest
  ): Promise<{ entityId: string; trustChain?: EntityStatement[] }> {
    
    // Case 1: Trust chain provided directly
    if (request.trustChain && request.trustChain.length > 0) {
      const leafStatement = request.trustChain[0];
      return {
        entityId: leafStatement.payload.sub,
        trustChain: request.trustChain
      };
    }

    // Case 2: Entity configuration provided
    if (request.entityConfiguration) {
      try {
        const decoded = ValidationUtils.decodeJWT(request.entityConfiguration);
        const entityId = decoded.payload.sub || decoded.payload.iss;
        
        if (!entityId) {
          throw new FederationRegistrationError(
            'invalid_request',
            'Entity configuration missing entity ID (sub or iss claim)',
            400
          );
        }

        // Create entity statement from configuration
        const entityStatement: EntityStatement = {
          jwt: request.entityConfiguration,
          payload: decoded.payload
        };

        return {
          entityId,
          trustChain: [entityStatement]
        };
      } catch (error) {
        throw new FederationRegistrationError(
          'invalid_request',
          `Invalid entity configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
          400
        );
      }
    }

    // Case 3: Request object contains entity information
    if (request.requestObject) {
      try {
        const decoded = ValidationUtils.decodeJWT(request.requestObject);
        const entityId = decoded.payload.iss;
        
        if (!entityId) {
          throw new FederationRegistrationError(
            'invalid_request',
            'Request object missing issuer (iss claim)',
            400
          );
        }

        return { entityId };
      } catch (error) {
        throw new FederationRegistrationError(
          'invalid_request',
          `Invalid request object: ${error instanceof Error ? error.message : 'Unknown error'}`,
          400
        );
      }
    }

    throw new FederationRegistrationError(
      'invalid_request',
      'Registration request must include entity configuration, trust chain, or request object',
      400
    );
  }

  /**
   * Merge registration parameters from trust chain and request object
   */
  private mergeRegistrationParameters(
    trustChainMetadata: any,
    requestObjectParams: any
  ): any {
    // Request object parameters take precedence over trust chain metadata
    return {
      ...trustChainMetadata,
      ...requestObjectParams,
      // Ensure redirect_uris is always an array
      redirect_uris: requestObjectParams.redirect_uris || trustChainMetadata.redirect_uris || []
    };
  }

  /**
   * Process Authlete response and create federation registration response
   */
  private processAuthleteResponse(
    authleteResponse: AuthleteFederationRegistrationResponse,
    trustAnchorId: string
  ): FederationRegistrationResponse {
    
    if (authleteResponse.action !== 'CREATED') {
      throw new FederationRegistrationError(
        'registration_failed',
        `Authlete registration failed: ${authleteResponse.action} - ${authleteResponse.resultMessage || 'Unknown error'}`,
        this.getStatusCodeForAuthleteAction(authleteResponse.action)
      );
    }

    if (!authleteResponse.client_id) {
      throw new FederationRegistrationError(
        'server_error',
        'Authlete response missing client_id',
        500
      );
    }

    return {
      clientId: authleteResponse.client_id!,
      ...(authleteResponse.client_secret && { clientSecret: authleteResponse.client_secret }),
      entityStatement: authleteResponse.entityStatement || '',
      trustAnchorId
    };
  }

  /**
   * Get HTTP status code for Authlete action
   */
  private getStatusCodeForAuthleteAction(action: string): number {
    switch (action) {
      case 'BAD_REQUEST':
        return 400;
      case 'UNAUTHORIZED':
        return 401;
      case 'FORBIDDEN':
        return 403;
      case 'NOT_FOUND':
        return 404;
      case 'INTERNAL_SERVER_ERROR':
        return 500;
      default:
        return 400;
    }
  }
}

/**
 * Federation Registration Error
 */
export class FederationRegistrationError extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly errorDescription: string,
    public readonly statusCode: number = 400
  ) {
    super(errorDescription);
    this.name = 'FederationRegistrationError';
  }
}

/**
 * Express middleware handler for federation registration endpoint
 */
export function createFederationRegistrationHandler(
  authleteClient: AuthleteClient,
  trustAnchors?: string[]
) {
  const endpoint = new FederationRegistrationEndpoint(authleteClient, trustAnchors);

  return async (req: Request, res: Response): Promise<void> => {
    try {
      logger.logInfo(
        'Processing federation registration HTTP request',
        'FederationRegistrationHandler',
        {
          method: req.method,
          contentType: req.get('content-type'),
          hasBody: !!req.body,
          userAgent: req.get('user-agent')
        }
      );

      // Validate HTTP method
      if (req.method !== 'POST') {
        res.status(405).json({
          error: 'invalid_request',
          error_description: 'Federation registration requires POST method'
        });
        return;
      }

      // Validate content type
      const contentType = req.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Content-Type must be application/json'
        });
        return;
      }

      // Extract federation registration request
      const federationRequest: FederationRegistrationRequest = {
        entityConfiguration: req.body.entity_configuration,
        trustChain: req.body.trust_chain,
        requestObject: req.body.request_object
      };

      // Process registration
      const result = await endpoint.registerClient(federationRequest);

      // Return successful response
      res.status(201).json({
        client_id: result.clientId,
        client_secret: result.clientSecret,
        entity_statement: result.entityStatement,
        trust_anchor_id: result.trustAnchorId
      });

    } catch (error) {
      if (error instanceof FederationRegistrationError) {
        res.status(error.statusCode).json({
          error: error.errorCode,
          error_description: error.errorDescription
        });
        return;
      }

      logger.logError({
        message: 'Unexpected error in federation registration handler',
        component: 'FederationRegistrationHandler',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error processing federation registration'
      });
    }
  };
}