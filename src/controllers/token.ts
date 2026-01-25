import { Request, Response } from 'express';
import { AuthleteClient } from '../authlete/client';
import { TokenRequest } from '../authlete/types';
import { logger } from '../utils/logger';

export interface TokenController {
  handleTokenRequest(req: Request, res: Response): Promise<void>;
}

export interface ClientInfo {
  clientId: string;
  clientSecret: string;
}

export class TokenControllerImpl implements TokenController {
  constructor(private authleteClient: AuthleteClient) {}

  async handleTokenRequest(req: Request, res: Response): Promise<void> {
    const requestId = logger.generateRequestId();
    const childLogger = logger.createChildLogger({ requestId });

    try {
      // Parse token request parameters
      const { grant_type, code } = req.body;

      // Validate required parameters
      if (!grant_type) {
        childLogger.logTokenIssuance({
          message: 'Token request missing grant_type parameter',
          outcome: 'error',
          errorCode: 'invalid_request',
          errorDescription: 'Missing grant_type parameter'
        });

        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing grant_type parameter'
        });
        return;
      }

      if (grant_type !== 'authorization_code') {
        childLogger.logTokenIssuance({
          message: 'Unsupported grant type requested',
          grantType: grant_type,
          outcome: 'error',
          errorCode: 'unsupported_grant_type',
          errorDescription: 'Only authorization_code grant type is supported'
        });

        res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Only authorization_code grant type is supported'
        });
        return;
      }

      if (!code) {
        childLogger.logTokenIssuance({
          message: 'Token request missing authorization code',
          grantType: grant_type,
          outcome: 'error',
          errorCode: 'invalid_request',
          errorDescription: 'Missing code parameter'
        });

        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing code parameter'
        });
        return;
      }

      // Extract client credentials using both authentication methods
      const clientInfo = this.extractClientCredentials(req);
      
      // Debug: Log client credentials extraction
      childLogger.logInfo('Client credentials extraction', 'TokenController', {
        hasClientInfo: !!clientInfo,
        clientId: clientInfo?.clientId,
        hasClientSecret: !!clientInfo?.clientSecret,
        clientSecretLength: clientInfo?.clientSecret?.length,
        authMethod: req.body.client_id ? 'client_secret_post' : 'client_secret_basic'
      });
      
      if (!clientInfo) {
        childLogger.logTokenIssuance({
          message: 'Client authentication failed',
          grantType: grant_type,
          outcome: 'error',
          errorCode: 'invalid_client',
          errorDescription: 'Client authentication failed'
        });

        res.status(401).json({
          error: 'invalid_client',
          error_description: 'Client authentication failed'
        });
        return;
      }

      // Update child logger with client context
      const clientLogger = logger.createChildLogger({ requestId, clientId: clientInfo.clientId });

      // Prepare token request for Authlete
      const tokenRequest: TokenRequest = {
        parameters: this.buildParametersString(req.body),
        clientId: clientInfo.clientId,
        clientSecret: clientInfo.clientSecret
      };

      // Call Authlete token API
      const tokenResponse = await this.authleteClient.token(tokenRequest);

      // Handle response based on action
      switch (tokenResponse.action) {
        case 'OK':
          if (tokenResponse.responseContent) {
            const responseData = JSON.parse(tokenResponse.responseContent);
            
            // Log successful token issuance
            clientLogger.logTokenIssuance({
              message: 'Access token issued successfully',
              grantType: grant_type,
              scopes: responseData.scope ? responseData.scope.split(' ') : [],
              outcome: 'success',
              tokenType: responseData.token_type,
              expiresIn: responseData.expires_in
            });

            res.status(200).json(responseData);
          } else {
            clientLogger.logTokenIssuance({
              message: 'Token issuance failed - invalid response from authorization server',
              grantType: grant_type,
              outcome: 'error',
              errorCode: 'server_error',
              errorDescription: 'Invalid response from authorization server'
            });

            res.status(500).json({
              error: 'server_error',
              error_description: 'Invalid response from authorization server'
            });
          }
          break;

        case 'INVALID_CLIENT':
          clientLogger.logTokenIssuance({
            message: 'Token request failed - invalid client',
            grantType: grant_type,
            outcome: 'error',
            errorCode: 'invalid_client',
            errorDescription: 'Client authentication failed'
          });

          res.status(401).json({
            error: 'invalid_client',
            error_description: 'Client authentication failed'
          });
          break;

        case 'INVALID_REQUEST':
          clientLogger.logTokenIssuance({
            message: 'Token request failed - invalid request',
            grantType: grant_type,
            outcome: 'error',
            errorCode: 'invalid_request',
            errorDescription: 'The request is missing a required parameter or is otherwise malformed'
          });

          res.status(400).json({
            error: 'invalid_request',
            error_description: 'The request is missing a required parameter or is otherwise malformed'
          });
          break;

        case 'INVALID_GRANT':
          clientLogger.logTokenIssuance({
            message: 'Token request failed - invalid grant',
            grantType: grant_type,
            outcome: 'error',
            errorCode: 'invalid_grant',
            errorDescription: 'The provided authorization grant is invalid, expired, or revoked'
          });

          res.status(400).json({
            error: 'invalid_grant',
            error_description: 'The provided authorization grant is invalid, expired, or revoked'
          });
          break;

        case 'INTERNAL_SERVER_ERROR':
        default:
          clientLogger.logTokenIssuance({
            message: 'Token request failed - server error',
            grantType: grant_type,
            outcome: 'error',
            errorCode: 'server_error',
            errorDescription: 'The authorization server encountered an unexpected condition'
          });

          res.status(500).json({
            error: 'server_error',
            error_description: 'The authorization server encountered an unexpected condition'
          });
          break;
      }
    } catch (error) {
      // Log error with detailed information and stack trace
      childLogger.logError({
        message: 'Token request processing error',
        component: 'TokenController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack }),
          code: (error as any)?.code || (error as any)?.status
        },
        context: {
          grantType: req.body?.grant_type,
          clientId: req.body?.client_id
        }
      });

      // Log failed token issuance
      childLogger.logTokenIssuance({
        message: 'Token request failed due to server error',
        grantType: req.body?.grant_type,
        outcome: 'error',
        errorCode: 'server_error',
        errorDescription: error instanceof Error ? error.message : 'Internal server error'
      });

      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error'
      });
    }
  }

  /**
   * Extract client credentials from request using both client_secret_basic and client_secret_post methods
   */
  private extractClientCredentials(req: Request): ClientInfo | null {
    // Method 1: client_secret_post - credentials in request body
    if (req.body.client_id && req.body.client_secret) {
      return {
        clientId: req.body.client_id,
        clientSecret: req.body.client_secret
      };
    }

    // Method 2: client_secret_basic - credentials in Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Basic ')) {
      try {
        const base64Credentials = authHeader.substring(6);
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
        const [clientId, clientSecret] = credentials.split(':');
        
        if (clientId && clientSecret) {
          return {
            clientId: decodeURIComponent(clientId),
            clientSecret: decodeURIComponent(clientSecret)
          };
        }
      } catch (error) {
        logger.logError({
          message: 'Error parsing Basic authentication header',
          component: 'TokenController',
          error: {
            name: error instanceof Error ? error.name : 'UnknownError',
            message: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error && error.stack && { stack: error.stack })
          },
          context: { authHeader }
        });
      }
    }

    return null;
  }

  /**
   * Build URL-encoded parameters string from request body
   */
  private buildParametersString(body: any): string {
    const params = new URLSearchParams();
    
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    }
    
    return params.toString();
  }
}