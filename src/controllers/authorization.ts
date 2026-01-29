import { Request, Response } from 'express';
import { AuthleteClient } from '../authlete/client';
import { AuthorizationRequest, AuthorizationResponse } from '../authlete/types';
import { logger } from '../utils/logger';
import { RequestObjectProcessor } from '../federation/requestObject';

export interface AuthorizationController {
  handleAuthorizationRequest(req: Request, res: Response): Promise<void>;
}

export class AuthorizationControllerImpl implements AuthorizationController {
  private requestObjectProcessor: RequestObjectProcessor;

  constructor(private authleteClient: AuthleteClient) {
    this.requestObjectProcessor = new RequestObjectProcessor(authleteClient);
  }

  async handleAuthorizationRequest(req: Request, res: Response): Promise<void> {
    const requestId = logger.generateRequestId();
    const childLogger = logger.createChildLogger({ requestId });

    try {
      // Check for Request Object parameter (OpenID Federation 1.0)
      const requestObject = req.query.request as string;
      let authorizationParams: Record<string, string> = {};
      let clientRegistrationResult: any = null;

      if (requestObject) {
        childLogger.logInfo(
          'Processing authorization request with Request Object',
          'AuthorizationController',
          {
            hasRequestObject: true,
            requestObjectLength: requestObject.length
          }
        );

        // Parse Request Object
        const requestObjectResult = this.requestObjectProcessor.parseRequestObject(requestObject);
        
        if (!requestObjectResult.isValid) {
          childLogger.logWarn(
            'Invalid Request Object in authorization request',
            'AuthorizationController',
            {
              error: requestObjectResult.error,
              errorDescription: requestObjectResult.errorDescription
            }
          );

          res.status(400).json({
            error: requestObjectResult.error,
            error_description: requestObjectResult.errorDescription
          });
          return;
        }

        const claims = requestObjectResult.claims!;
        
        // Check if client is already registered by checking if client_id is a URL
        const isUnregisteredClient = claims.client_id.startsWith('https://');
        
        if (isUnregisteredClient && claims.client_metadata) {
          childLogger.logInfo(
            'Unregistered Federation client detected, attempting dynamic registration',
            'AuthorizationController',
            {
              clientId: claims.client_id,
              clientName: claims.client_metadata.client_name
            }
          );

          // Attempt client registration
          clientRegistrationResult = await this.requestObjectProcessor.processClientRegistration(claims);
          
          if (!clientRegistrationResult.success) {
            childLogger.logWarn(
              'Client registration failed for Federation client',
              'AuthorizationController',
              {
                clientId: claims.client_id,
                error: clientRegistrationResult.error,
                errorDescription: clientRegistrationResult.errorDescription
              }
            );

            res.status(400).json({
              error: clientRegistrationResult.error,
              error_description: clientRegistrationResult.errorDescription
            });
            return;
          }

          childLogger.logInfo(
            'Client registration successful for Federation client',
            'AuthorizationController',
            {
              originalClientId: claims.client_id,
              registeredClientId: clientRegistrationResult.clientId
            }
          );

          // Update client_id to use the registered client ID
          claims.client_id = clientRegistrationResult.clientId;
        }

        // Extract authorization parameters from Request Object
        authorizationParams = this.requestObjectProcessor.extractAuthorizationParameters(claims);
        
      } else {
        // Standard OAuth 2.0 authorization request (no Request Object)
        childLogger.logInfo(
          'Processing standard authorization request (no Request Object)',
          'AuthorizationController',
          {
            hasRequestObject: false,
            clientId: req.query.client_id
          }
        );

        authorizationParams = this.extractStandardAuthorizationParameters(req);
      }

      // Parse and validate authorization request parameters
      const queryParams = this.buildAuthorizationParameters(authorizationParams);
      const clientId = authorizationParams.client_id;
      const scopes = authorizationParams.scope ? authorizationParams.scope.split(' ') : [];
      const responseType = authorizationParams.response_type;
      const redirectUri = authorizationParams.redirect_uri;
      const state = authorizationParams.state;
      
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
        requestObjectUsed: !!requestObject,
        clientRegistered: !!clientRegistrationResult?.success,
        ...(outcome === 'error' && { 
          errorCode: authorizationResponse.action,
          errorDescription: 'Authorization request failed'
        })
      });

      // Store client registration info in session if applicable
      if (clientRegistrationResult?.success) {
        req.session.federationClientRegistration = {
          originalClientId: (req.query.client_id as string) || authorizationParams.client_id,
          registeredClientId: clientRegistrationResult.clientId!,
          clientSecret: clientRegistrationResult.clientSecret!
        };
      }

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
          redirectUri: req.query.redirect_uri as string,
          hasRequestObject: !!req.query.request
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
      
      // Return OpenID Connect compliant error response
      const errorResponse = this.createErrorResponse(error);
      res.status(400).json(errorResponse);
    }
  }

  private extractStandardAuthorizationParameters(req: Request): Record<string, string> {
    const params: Record<string, string> = {};
    
    // Required parameters
    if (req.query.response_type) {
      params.response_type = req.query.response_type as string;
    }
    if (req.query.client_id) {
      params.client_id = req.query.client_id as string;
    }
    if (req.query.redirect_uri) {
      params.redirect_uri = req.query.redirect_uri as string;
    }
    
    // Optional parameters
    if (req.query.scope) {
      params.scope = req.query.scope as string;
    }
    if (req.query.state) {
      params.state = req.query.state as string;
    }
    if (req.query.nonce) {
      params.nonce = req.query.nonce as string;
    }
    if (req.query.code_challenge) {
      params.code_challenge = req.query.code_challenge as string;
    }
    if (req.query.code_challenge_method) {
      params.code_challenge_method = req.query.code_challenge_method as string;
    }

    return params;
  }

  private buildAuthorizationParameters(params: Record<string, string>): string {
    const urlParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        urlParams.append(key, value);
      }
    });

    return urlParams.toString();
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
    // Create OpenID Connect compliant error response
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