import { Request, Response } from 'express';
import { AuthleteClient } from '../authlete/client';
import { AuthorizationRequest, AuthorizationResponse } from '../authlete/types';
import { logger } from '../utils/logger';

export interface AuthorizationController {
  handleAuthorizationRequest(req: Request, res: Response): Promise<void>;
}

export class AuthorizationControllerImpl implements AuthorizationController {
  constructor(private authleteClient: AuthleteClient) {}

  async handleAuthorizationRequest(req: Request, res: Response): Promise<void> {
    const requestId = logger.generateRequestId();
    const childLogger = logger.createChildLogger({ requestId });

    try {
      // Parse and validate authorization request parameters
      const queryParams = this.parseAuthorizationParameters(req);
      const clientId = req.query.client_id as string;
      const scopes = req.query.scope ? (req.query.scope as string).split(' ') : [];
      const responseType = req.query.response_type as string;
      const redirectUri = req.query.redirect_uri as string;
      const state = req.query.state as string;
      
      // Create Authlete authorization request
      const authorizationRequest: AuthorizationRequest = {
        parameters: queryParams,
        clientId: clientId
      };

      // Call Authlete /auth/authorization API
      const authorizationResponse = await this.authleteClient.authorization(authorizationRequest);

      // Log authorization request with outcome
      const outcome = authorizationResponse.action === 'INTERACTION' || authorizationResponse.action === 'NO_INTERACTION' ? 'success' : 'error';
      
      childLogger.logAuthorizationRequest({
        message: `Authorization request processed`,
        clientId: clientId,
        scopes: scopes,
        responseType: responseType,
        redirectUri: redirectUri,
        state: state,
        outcome: outcome,
        ...(outcome === 'error' && { 
          errorCode: authorizationResponse.action,
          errorDescription: 'Authorization request failed'
        })
      });

      // Handle different response actions
      await this.handleAuthorizationResponse(req, res, authorizationResponse);

    } catch (error) {
      // Log error with detailed information and stack trace
      childLogger.logError({
        message: 'Authorization request processing failed',
        component: 'AuthorizationController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack }),
          code: (error as any)?.code || (error as any)?.status
        },
        context: {
          clientId: req.query.client_id,
          responseType: req.query.response_type,
          redirectUri: req.query.redirect_uri
        }
      });

      // Log authorization request with error outcome
      childLogger.logAuthorizationRequest({
        message: `Authorization request failed`,
        clientId: req.query.client_id as string,
        scopes: req.query.scope ? (req.query.scope as string).split(' ') : [],
        responseType: req.query.response_type as string,
        redirectUri: req.query.redirect_uri as string,
        state: req.query.state as string,
        outcome: 'error',
        errorCode: 'server_error',
        errorDescription: error instanceof Error ? error.message : 'Internal server error'
      });
      
      // Return OAuth 2.0 compliant error response
      const errorResponse = this.createErrorResponse(error);
      res.status(400).json(errorResponse);
    }
  }

  private parseAuthorizationParameters(req: Request): string {
    // Extract OAuth 2.0 authorization parameters
    const params = new URLSearchParams();
    
    // Required parameters
    if (req.query.response_type) {
      params.append('response_type', req.query.response_type as string);
    }
    if (req.query.client_id) {
      params.append('client_id', req.query.client_id as string);
    }
    
    // Optional parameters
    if (req.query.redirect_uri) {
      params.append('redirect_uri', req.query.redirect_uri as string);
    }
    if (req.query.scope) {
      params.append('scope', req.query.scope as string);
    }
    if (req.query.state) {
      params.append('state', req.query.state as string);
    }
    if (req.query.code_challenge) {
      params.append('code_challenge', req.query.code_challenge as string);
    }
    if (req.query.code_challenge_method) {
      params.append('code_challenge_method', req.query.code_challenge_method as string);
    }

    return params.toString();
  }

  private async handleAuthorizationResponse(
    req: Request, 
    res: Response, 
    authResponse: AuthorizationResponse
  ): Promise<void> {
    switch (authResponse.action) {
      case 'INTERACTION':
        // Valid request - proceed to authentication/consent flow
        // Store ticket in session for later use
        req.session.authorizationTicket = authResponse.ticket;
        req.session.clientInfo = authResponse.client;
        req.session.scopes = authResponse.scopes || [];
        
        // Check if user is already authenticated
        if (req.session.userId) {
          // User is authenticated, proceed to consent
          res.redirect('/consent');
        } else {
          // User needs to authenticate
          res.redirect('/login');
        }
        break;

      case 'NO_INTERACTION':
        // Authorization can proceed without user interaction
        if (authResponse.responseContent) {
          // Parse the response content and redirect
          const responseData = JSON.parse(authResponse.responseContent);
          if (responseData.location) {
            res.redirect(responseData.location);
          } else {
            res.status(200).json(responseData);
          }
        } else {
          res.status(500).json({ error: 'server_error', error_description: 'Missing response content' });
        }
        break;

      case 'BAD_REQUEST':
        res.status(400).json(this.parseErrorResponse(authResponse.responseContent));
        break;

      case 'UNAUTHORIZED':
        res.status(401).json(this.parseErrorResponse(authResponse.responseContent));
        break;

      case 'FORBIDDEN':
        res.status(403).json(this.parseErrorResponse(authResponse.responseContent));
        break;

      case 'INTERNAL_SERVER_ERROR':
        res.status(500).json({ error: 'server_error', error_description: 'Internal server error' });
        break;

      default:
        res.status(500).json({ error: 'server_error', error_description: 'Unknown response action' });
    }
  }

  private parseErrorResponse(responseContent?: string): any {
    if (responseContent) {
      try {
        return JSON.parse(responseContent);
      } catch (error) {
        logger.logError({
          message: 'Failed to parse error response content',
          component: 'AuthorizationController',
          error: {
            name: error instanceof Error ? error.name : 'UnknownError',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error && error.stack && { stack: error.stack })
          },
          context: { responseContent }
        });
      }
    }
    
    return { error: 'invalid_request', error_description: 'Invalid authorization request' };
  }

  private createErrorResponse(error: any): any {
    // Create OAuth 2.0 compliant error response
    if (error.name === 'AuthleteApiError') {
      return {
        error: 'server_error',
        error_description: 'Authorization server error'
      };
    }

    return {
      error: 'invalid_request',
      error_description: 'Invalid authorization request parameters'
    };
  }
}