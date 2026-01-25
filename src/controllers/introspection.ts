import { Request, Response } from 'express';
import { AuthleteClient } from '../authlete/client';
import { IntrospectionRequest } from '../authlete/types';
import { logger } from '../utils/logger';

export interface IntrospectionController {
  handleIntrospectionRequest(req: Request, res: Response): Promise<void>;
}

export interface ResourceServerInfo {
  serverId: string;
  serverSecret: string;
}

export class IntrospectionControllerImpl implements IntrospectionController {
  constructor(private authleteClient: AuthleteClient) {}

  async handleIntrospectionRequest(req: Request, res: Response): Promise<void> {
    const requestId = logger.generateRequestId();
    const childLogger = logger.createChildLogger({ requestId });

    try {
      // Validate resource server authentication
      const resourceServerInfo = this.extractResourceServerCredentials(req);
      
      if (!resourceServerInfo) {
        childLogger.logTokenIntrospection({
          message: 'Token introspection failed - resource server authentication required',
          tokenActive: false,
          outcome: 'error',
          errorCode: 'unauthorized',
          errorDescription: 'Resource server authentication required'
        });

        res.status(401).json({
          error: 'unauthorized',
          error_description: 'Resource server authentication required'
        });
        return;
      }

      // Update child logger with resource server context
      const serverLogger = logger.createChildLogger({ requestId, clientId: resourceServerInfo.serverId });

      // Parse introspection request parameters
      const { token, scope, subject } = req.body;

      // Validate required parameters
      if (!token) {
        serverLogger.logTokenIntrospection({
          message: 'Token introspection failed - missing token parameter',
          tokenActive: false,
          outcome: 'error',
          errorCode: 'invalid_request',
          errorDescription: 'Missing token parameter'
        });

        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing token parameter'
        });
        return;
      }

      // Prepare introspection request for Authlete
      const introspectionRequest: IntrospectionRequest = {
        token: token,
        ...(scope && { scopes: Array.isArray(scope) ? scope : [scope] }),
        ...(subject && { subject: subject })
      };

      // Log the introspection request being sent to Authlete
      serverLogger.logDebug(
        'Sending introspection request to Authlete',
        'IntrospectionController',
        {
          hasToken: !!token,
          tokenLength: token?.length,
          scopes: introspectionRequest.scopes,
          subject: introspectionRequest.subject,
          resourceServerId: resourceServerInfo.serverId
        }
      );

      // Call Authlete introspection API
      const introspectionResponse = await this.authleteClient.introspection(introspectionRequest);

      // Log the full Authlete response for debugging
      serverLogger.logDebug(
        'Full Authlete introspection response',
        'IntrospectionController',
        {
          action: introspectionResponse.action,
          active: introspectionResponse.active,
          clientId: introspectionResponse.clientId,
          subject: introspectionResponse.subject,
          scopes: introspectionResponse.scopes,
          expiresAt: introspectionResponse.expiresAt,
          hasResponseContent: !!introspectionResponse.responseContent,
          responseContentLength: introspectionResponse.responseContent?.length,
          activeFieldExists: 'active' in introspectionResponse,
          activeValue: introspectionResponse.active
        }
      );

      // Handle response based on action
      switch (introspectionResponse.action) {
        case 'OK':
          if (introspectionResponse.responseContent && !introspectionResponse.responseContent.startsWith('Bearer error=')) {
            // Log the raw response content for debugging
            serverLogger.logDebug(
              'Raw Authlete introspection response content',
              'IntrospectionController',
              {
                responseContent: introspectionResponse.responseContent,
                contentType: typeof introspectionResponse.responseContent,
                contentLength: introspectionResponse.responseContent.length
              }
            );

            try {
              // Return the JSON response from Authlete
              const responseData = JSON.parse(introspectionResponse.responseContent);
              
              // Log successful introspection
              serverLogger.logTokenIntrospection({
                message: 'Token introspection completed successfully',
                tokenActive: responseData.active || false,
                scopes: responseData.scope ? responseData.scope.split(' ') : [],
                outcome: 'success'
              });

              res.status(200).json(responseData);
            } catch (parseError) {
              // Log JSON parsing error with details
              serverLogger.logError({
                message: 'Failed to parse Authlete introspection response as JSON',
                component: 'IntrospectionController',
                error: {
                  name: parseError instanceof Error ? parseError.name : 'UnknownError',
                  message: parseError instanceof Error ? parseError.message : String(parseError),
                  ...(parseError instanceof Error && parseError.stack && { stack: parseError.stack })
                },
                context: {
                  responseContent: introspectionResponse.responseContent,
                  contentType: typeof introspectionResponse.responseContent,
                  contentLength: introspectionResponse.responseContent.length,
                  firstChars: introspectionResponse.responseContent.substring(0, 100)
                }
              });

              // Fall back to using the structured response data
              const now = Date.now();
              const isActive = !!(introspectionResponse.clientId && 
                                 introspectionResponse.expiresAt && 
                                 introspectionResponse.expiresAt > now);
              
              const response = {
                active: isActive,
                ...(isActive && {
                  client_id: introspectionResponse.clientId,
                  scope: introspectionResponse.scopes?.join(' '),
                  ...(introspectionResponse.subject && { sub: introspectionResponse.subject }),
                  ...(introspectionResponse.expiresAt && { exp: Math.floor(introspectionResponse.expiresAt / 1000) })
                })
              };

              serverLogger.logTokenIntrospection({
                message: 'Token introspection completed with fallback response',
                tokenActive: isActive,
                scopes: introspectionResponse.scopes || [],
                outcome: 'success'
              });

              res.status(200).json(response);
            }
          } else {
            // Use structured response data when responseContent is invalid or contains error
            // Determine if token is active based on available data
            const now = Date.now();
            const isActive = !!(introspectionResponse.clientId && 
                               introspectionResponse.expiresAt && 
                               introspectionResponse.expiresAt > now);
            
            const response = {
              active: isActive,
              ...(isActive && {
                client_id: introspectionResponse.clientId,
                scope: introspectionResponse.scopes?.join(' '),
                ...(introspectionResponse.subject && { sub: introspectionResponse.subject }),
                ...(introspectionResponse.expiresAt && { exp: Math.floor(introspectionResponse.expiresAt / 1000) })
              })
            };

            // Log successful introspection
            serverLogger.logTokenIntrospection({
              message: 'Token introspection completed successfully using structured data',
              tokenActive: isActive,
              scopes: introspectionResponse.scopes || [],
              outcome: 'success'
            });

            res.status(200).json(response);
          }
          break;

        case 'BAD_REQUEST':
          serverLogger.logTokenIntrospection({
            message: 'Token introspection failed - bad request',
            tokenActive: false,
            outcome: 'error',
            errorCode: 'invalid_request',
            errorDescription: 'The request is missing a required parameter or is otherwise malformed'
          });

          res.status(400).json({
            error: 'invalid_request',
            error_description: 'The request is missing a required parameter or is otherwise malformed'
          });
          break;

        case 'UNAUTHORIZED':
          serverLogger.logTokenIntrospection({
            message: 'Token introspection failed - unauthorized',
            tokenActive: false,
            outcome: 'error',
            errorCode: 'unauthorized',
            errorDescription: 'Resource server authentication failed'
          });

          res.status(401).json({
            error: 'unauthorized',
            error_description: 'Resource server authentication failed'
          });
          break;

        case 'FORBIDDEN':
          serverLogger.logTokenIntrospection({
            message: 'Token introspection failed - forbidden',
            tokenActive: false,
            outcome: 'error',
            errorCode: 'forbidden',
            errorDescription: 'The resource server is not authorized to perform token introspection'
          });

          res.status(403).json({
            error: 'forbidden',
            error_description: 'The resource server is not authorized to perform token introspection'
          });
          break;

        case 'INTERNAL_SERVER_ERROR':
        default:
          serverLogger.logTokenIntrospection({
            message: 'Token introspection failed - server error',
            tokenActive: false,
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
        message: 'Introspection request processing error',
        component: 'IntrospectionController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack }),
          code: (error as any)?.code || (error as any)?.status
        },
        context: {
          token: req.body?.token ? '[REDACTED]' : undefined,
          scope: req.body?.scope,
          subject: req.body?.subject
        }
      });

      // Log failed introspection
      childLogger.logTokenIntrospection({
        message: 'Token introspection failed due to server error',
        tokenActive: false,
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
   * Extract resource server credentials from request using both Basic auth and form parameters
   * Similar to client authentication but for resource servers
   */
  private extractResourceServerCredentials(req: Request): ResourceServerInfo | null {
    // Method 1: Form parameters - credentials in request body
    if (req.body.client_id && req.body.client_secret) {
      return {
        serverId: req.body.client_id,
        serverSecret: req.body.client_secret
      };
    }

    // Method 2: Basic authentication - credentials in Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Basic ')) {
      try {
        const base64Credentials = authHeader.substring(6);
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
        const [serverId, serverSecret] = credentials.split(':');
        
        if (serverId && serverSecret) {
          return {
            serverId: decodeURIComponent(serverId),
            serverSecret: decodeURIComponent(serverSecret)
          };
        }
      } catch (error) {
        logger.logError({
          message: 'Error parsing Basic authentication header',
          component: 'IntrospectionController',
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
}