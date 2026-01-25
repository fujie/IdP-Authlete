import { Request, Response } from 'express';
import { AuthleteClient } from '../authlete/client';
import { logger } from '../utils/logger';
import { 
  EntityConfiguration, 
  FederationEntityMetadata,
  OpenIDProviderMetadata
} from '../federation/types';
import { DynamicRegistrationService, DynamicRegistrationRequest } from '../federation/dynamicRegistration';

export interface FederationController {
  handleEntityConfiguration(req: Request, res: Response): Promise<void>;
  handleFederationFetch(req: Request, res: Response): Promise<void>;
  handleFederationList(req: Request, res: Response): Promise<void>;
  handleFederationResolve(req: Request, res: Response): Promise<void>;
  handleDynamicRegistration(req: Request, res: Response): Promise<void>;
}

export class FederationControllerImpl implements FederationController {
  private dynamicRegistrationService: DynamicRegistrationService;

  constructor(private authleteClient: AuthleteClient) {
    this.dynamicRegistrationService = new DynamicRegistrationService(authleteClient);
  }

  async handleEntityConfiguration(req: Request, res: Response): Promise<void> {
    try {
      logger.logInfo(
        'Processing entity configuration request',
        'FederationController',
        {
          host: req.get('host'),
          userAgent: req.get('user-agent')
        }
      );

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const now = Math.floor(Date.now() / 1000);
      const expiration = now + (24 * 60 * 60); // 24 hours

      // Create entity configuration for this OpenID Provider
      const entityConfiguration: EntityConfiguration = {
        iss: baseUrl,
        sub: baseUrl,
        iat: now,
        exp: expiration,
        jwks: {
          keys: [] // In production, this would contain actual signing keys
        },
        metadata: {
          openid_provider: this.createOpenIDProviderMetadata(baseUrl),
          federation_entity: this.createFederationEntityMetadata(baseUrl)
        },
        authority_hints: [
          'https://trust-anchor.example.com', // Example Trust Anchor
          'https://intermediate.example.com'   // Example Intermediate Authority
        ]
      };

      // In a real implementation, this would be signed as a JWT
      // For now, return the unsigned JSON for development/testing
      res.setHeader('Content-Type', 'application/entity-statement+jwt');
      res.json(entityConfiguration);

      logger.logInfo(
        'Entity configuration response sent',
        'FederationController',
        {
          issuer: entityConfiguration.iss,
          subject: entityConfiguration.sub,
          authorityHints: entityConfiguration.authority_hints?.length || 0
        }
      );

    } catch (error) {
      logger.logError({
        message: 'Failed to process entity configuration request',
        component: 'FederationController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error processing entity configuration'
      });
    }
  }

  async handleFederationFetch(req: Request, res: Response): Promise<void> {
    try {
      const { iss, sub } = req.body;

      if (!iss || !sub) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameters: iss and sub'
        });
        return;
      }

      logger.logInfo(
        'Processing federation fetch request',
        'FederationController',
        { iss, sub }
      );

      const response = await this.authleteClient.federationFetch({ iss, sub });

      if (response.action === 'OK' && response.entity_configuration) {
        res.setHeader('Content-Type', 'application/entity-statement+jwt');
        res.send(response.entity_configuration);
      } else if (response.action === 'NOT_FOUND') {
        res.status(404).json({
          error: 'not_found',
          error_description: 'Entity not found'
        });
      } else {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Invalid federation fetch request'
        });
      }

    } catch (error) {
      logger.logError({
        message: 'Failed to process federation fetch request',
        component: 'FederationController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error processing federation fetch'
      });
    }
  }

  async handleFederationList(req: Request, res: Response): Promise<void> {
    try {
      const { iss, entity_type } = req.body;

      if (!iss) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameter: iss'
        });
        return;
      }

      logger.logInfo(
        'Processing federation list request',
        'FederationController',
        { iss, entity_type }
      );

      const response = await this.authleteClient.federationList({ iss, entity_type });

      if (response.action === 'OK') {
        res.json({
          entity_ids: response.entity_ids || []
        });
      } else {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Invalid federation list request'
        });
      }

    } catch (error) {
      logger.logError({
        message: 'Failed to process federation list request',
        component: 'FederationController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error processing federation list'
      });
    }
  }

  async handleFederationResolve(req: Request, res: Response): Promise<void> {
    try {
      const { sub, anchor, type } = req.body;

      if (!sub || !anchor) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameters: sub and anchor'
        });
        return;
      }

      logger.logInfo(
        'Processing federation resolve request',
        'FederationController',
        { sub, anchor, type }
      );

      const response = await this.authleteClient.federationResolve({ sub, anchor, type });

      if (response.action === 'OK' && response.trust_chain) {
        res.json({
          trust_chain: response.trust_chain,
          metadata: response.metadata
        });
      } else if (response.action === 'NOT_FOUND') {
        res.status(404).json({
          error: 'not_found',
          error_description: 'Trust chain not found'
        });
      } else {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Invalid federation resolve request'
        });
      }

    } catch (error) {
      logger.logError({
        message: 'Failed to process federation resolve request',
        component: 'FederationController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error processing federation resolve'
      });
    }
  }

  async handleDynamicRegistration(req: Request, res: Response): Promise<void> {
    try {
      logger.logInfo(
        'Processing dynamic client registration request',
        'FederationController',
        {
          method: req.method,
          contentType: req.get('content-type'),
          hasBody: !!req.body
        }
      );

      // Validate request method
      if (req.method !== 'POST') {
        res.status(405).json({
          error: 'invalid_request',
          error_description: 'Dynamic registration requires POST method'
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

      // Extract registration request
      const registrationRequest: DynamicRegistrationRequest = {
        redirect_uris: req.body.redirect_uris,
        client_name: req.body.client_name,
        client_uri: req.body.client_uri,
        logo_uri: req.body.logo_uri,
        contacts: req.body.contacts,
        tos_uri: req.body.tos_uri,
        policy_uri: req.body.policy_uri,
        jwks_uri: req.body.jwks_uri,
        jwks: req.body.jwks,
        software_statement: req.body.software_statement,
        entity_id: req.body.entity_id
      };

      // Process registration
      const result = await this.dynamicRegistrationService.registerClient(registrationRequest);

      // Check if registration failed
      if ('error' in result) {
        const statusCode = result.error === 'invalid_client_metadata' ? 400 : 500;
        res.status(statusCode).json(result);
        return;
      }

      // Registration successful
      res.status(201).json(result);

      logger.logInfo(
        'Dynamic client registration completed successfully',
        'FederationController',
        {
          entityId: registrationRequest.entity_id,
          clientId: result.client_id,
          trustAnchor: result.trust_chain_validation.trustAnchor
        }
      );

    } catch (error) {
      logger.logError({
        message: 'Failed to process dynamic client registration',
        component: 'FederationController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error processing dynamic registration'
      });
    }
  }

  private createOpenIDProviderMetadata(baseUrl: string): OpenIDProviderMetadata {
    return {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      userinfo_endpoint: `${baseUrl}/userinfo`,
      jwks_uri: `${baseUrl}/.well-known/jwks.json`,
      scopes_supported: [
        'openid',
        'profile',
        'email',
        'address',
        'phone',
        'offline_access'
      ],
      response_types_supported: [
        'code',
        'id_token',
        'code id_token'
      ],
      response_modes_supported: [
        'query',
        'fragment',
        'form_post'
      ],
      grant_types_supported: [
        'authorization_code',
        'refresh_token'
      ],
      subject_types_supported: [
        'public'
      ],
      id_token_signing_alg_values_supported: [
        'RS256',
        'ES256',
        'HS256'
      ],
      token_endpoint_auth_methods_supported: [
        'client_secret_basic',
        'client_secret_post'
      ],
      claims_supported: [
        'sub',
        'name',
        'given_name',
        'family_name',
        'middle_name',
        'nickname',
        'preferred_username',
        'profile',
        'picture',
        'website',
        'email',
        'email_verified',
        'gender',
        'birthdate',
        'zoneinfo',
        'locale',
        'phone_number',
        'phone_number_verified',
        'address',
        'updated_at'
      ]
    };
  }

  private createFederationEntityMetadata(baseUrl: string): FederationEntityMetadata {
    return {
      federation_fetch_endpoint: `${baseUrl}/federation/fetch`,
      federation_list_endpoint: `${baseUrl}/federation/list`,
      federation_resolve_endpoint: `${baseUrl}/federation/resolve`,
      organization_name: 'OpenID Connect Authorization Server',
      homepage_uri: baseUrl,
      contacts: ['admin@example.com']
    };
  }
}