import { Request, Response } from 'express';
import { AuthleteClient } from '../authlete/client';
import { logger } from '../utils/logger';
import { createFederationRegistrationHandler } from '../federation/federationRegistrationEndpoint';
import { config } from '../config';

export interface FederationController {
  handleEntityConfiguration(req: Request, res: Response): Promise<void>;
  handleFederationFetch(req: Request, res: Response): Promise<void>;
  handleFederationList(req: Request, res: Response): Promise<void>;
  handleFederationResolve(req: Request, res: Response): Promise<void>;
  handleDynamicRegistration(req: Request, res: Response): Promise<void>;
}

export class FederationControllerImpl implements FederationController {
  private federationRegistrationHandler: (req: Request, res: Response) => Promise<void>;

  constructor(private authleteClient: AuthleteClient) {
    // Initialize the federation registration handler with configured trust anchors
    const trustAnchors = config.federation?.trustAnchors || [];
    const federationEnabled = config.federation?.enabled || false;
    
    if (federationEnabled && trustAnchors.length === 0) {
      logger.logWarn(
        'Federation is enabled but no trust anchors configured',
        'FederationController',
        { 
          federationEnabled,
          trustAnchorCount: trustAnchors.length
        }
      );
    }
    
    this.federationRegistrationHandler = createFederationRegistrationHandler(
      authleteClient, 
      trustAnchors.length > 0 ? trustAnchors : undefined
    );

    logger.logInfo(
      'FederationController initialized',
      'FederationController',
      {
        federationEnabled,
        trustAnchorCount: trustAnchors.length,
        trustAnchors: trustAnchors
      }
    );
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

      // Call Authlete's federation configuration API to get the signed entity configuration JWT
      const response = await this.authleteClient.federationConfiguration({});

      if (response.action === 'OK' && response.entityConfiguration) {
        // Return the properly signed entity configuration JWT from Authlete
        res.setHeader('Content-Type', 'application/entity-statement+jwt');
        res.send(response.entityConfiguration);

        logger.logInfo(
          'Entity configuration response sent from Authlete',
          'FederationController',
          {
            action: response.action,
            hasEntityConfiguration: !!response.entityConfiguration
          }
        );
      } else {
        // Handle error response from Authlete
        logger.logError({
          message: 'Authlete federation configuration API returned error',
          component: 'FederationController',
          error: {
            name: 'AuthleteError',
            message: `Action: ${response.action}, Code: ${response.resultCode}, Message: ${response.resultMessage || 'Unknown error'}`
          }
        });

        res.status(500).json({
          error: 'server_error',
          error_description: 'Entity configuration unavailable'
        });
      }

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
    // Delegate to the new federation registration handler
    await this.federationRegistrationHandler(req, res);
  }
}