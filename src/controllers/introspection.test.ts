import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import fc from 'fast-check';
import { IntrospectionControllerImpl } from './introspection';
import { AuthleteClient } from '../authlete/client';
import { IntrospectionRequest, IntrospectionResponse } from '../authlete/types';

// Mock AuthleteClient
const mockAuthleteClient: AuthleteClient = {
  authorization: vi.fn(),
  authorizationIssue: vi.fn(),
  authorizationFail: vi.fn(),
  token: vi.fn(),
  introspection: vi.fn()
};

// Mock Express Request and Response
const mockRequest = (body: any = {}, headers: any = {}): Partial<Request> => ({
  body,
  headers
});

const mockResponse = (): Partial<Response> => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('IntrospectionController', () => {
  let controller: IntrospectionControllerImpl;

  beforeEach(() => {
    controller = new IntrospectionControllerImpl(mockAuthleteClient);
    vi.clearAllMocks();
  });

  describe('handleIntrospectionRequest', () => {
    it('should return 401 when no resource server authentication is provided', async () => {
      const req = mockRequest({ token: 'test-token' });
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        error_description: 'Resource server authentication required'
      });
    });

    it('should return 400 when token parameter is missing', async () => {
      const req = mockRequest(
        { client_id: 'resource-server', client_secret: 'secret' },
        {}
      );
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing token parameter'
      });
    });

    it('should handle valid introspection request with form-based authentication', async () => {
      const mockIntrospectionResponse: IntrospectionResponse = {
        action: 'OK',
        responseContent: JSON.stringify({
          active: true,
          client_id: 123,
          scope: 'read write',
          sub: 'user123',
          exp: 1234567890
        }),
        active: true,
        clientId: 123,
        scopes: ['read', 'write'],
        subject: 'user123',
        expiresAt: 1234567890000
      };

      vi.mocked(mockAuthleteClient.introspection).mockResolvedValue(mockIntrospectionResponse);

      const req = mockRequest({
        token: 'valid-access-token',
        client_id: 'resource-server',
        client_secret: 'secret'
      });
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(mockAuthleteClient.introspection).toHaveBeenCalledWith({
        token: 'valid-access-token'
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        active: true,
        client_id: 123,
        scope: 'read write',
        sub: 'user123',
        exp: 1234567890
      });
    });

    it('should handle valid introspection request with Basic authentication', async () => {
      const mockIntrospectionResponse: IntrospectionResponse = {
        action: 'OK',
        responseContent: JSON.stringify({
          active: true,
          client_id: 123,
          scope: 'read',
          exp: 1234567890
        }),
        active: true,
        clientId: 123,
        scopes: ['read'],
        expiresAt: 1234567890000
      };

      vi.mocked(mockAuthleteClient.introspection).mockResolvedValue(mockIntrospectionResponse);

      // Create Basic auth header: base64('resource-server:secret')
      const credentials = Buffer.from('resource-server:secret').toString('base64');
      const req = mockRequest(
        { token: 'valid-access-token' },
        { authorization: `Basic ${credentials}` }
      );
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(mockAuthleteClient.introspection).toHaveBeenCalledWith({
        token: 'valid-access-token'
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        active: true,
        client_id: 123,
        scope: 'read',
        exp: 1234567890
      });
    });

    it('should handle introspection request with optional scope and subject parameters', async () => {
      const mockIntrospectionResponse: IntrospectionResponse = {
        action: 'OK',
        responseContent: JSON.stringify({
          active: true,
          client_id: 123,
          scope: 'read write',
          sub: 'user123'
        }),
        active: true,
        clientId: 123,
        scopes: ['read', 'write'],
        subject: 'user123'
      };

      vi.mocked(mockAuthleteClient.introspection).mockResolvedValue(mockIntrospectionResponse);

      const req = mockRequest({
        token: 'valid-access-token',
        scope: 'read write',
        subject: 'user123',
        client_id: 'resource-server',
        client_secret: 'secret'
      });
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(mockAuthleteClient.introspection).toHaveBeenCalledWith({
        token: 'valid-access-token',
        scopes: ['read write'],
        subject: 'user123'
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should return active: false for invalid tokens', async () => {
      const mockIntrospectionResponse: IntrospectionResponse = {
        action: 'OK',
        responseContent: JSON.stringify({
          active: false
        }),
        active: false
      };

      vi.mocked(mockAuthleteClient.introspection).mockResolvedValue(mockIntrospectionResponse);

      const req = mockRequest({
        token: 'invalid-token',
        client_id: 'resource-server',
        client_secret: 'secret'
      });
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        active: false
      });
    });

    it('should handle BAD_REQUEST response from Authlete', async () => {
      const mockIntrospectionResponse: IntrospectionResponse = {
        action: 'BAD_REQUEST',
        active: false
      };

      vi.mocked(mockAuthleteClient.introspection).mockResolvedValue(mockIntrospectionResponse);

      const req = mockRequest({
        token: 'malformed-token',
        client_id: 'resource-server',
        client_secret: 'secret'
      });
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'The request is missing a required parameter or is otherwise malformed'
      });
    });

    it('should handle UNAUTHORIZED response from Authlete', async () => {
      const mockIntrospectionResponse: IntrospectionResponse = {
        action: 'UNAUTHORIZED',
        active: false
      };

      vi.mocked(mockAuthleteClient.introspection).mockResolvedValue(mockIntrospectionResponse);

      const req = mockRequest({
        token: 'test-token',
        client_id: 'invalid-server',
        client_secret: 'wrong-secret'
      });
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unauthorized',
        error_description: 'Resource server authentication failed'
      });
    });

    it('should handle FORBIDDEN response from Authlete', async () => {
      const mockIntrospectionResponse: IntrospectionResponse = {
        action: 'FORBIDDEN',
        active: false
      };

      vi.mocked(mockAuthleteClient.introspection).mockResolvedValue(mockIntrospectionResponse);

      const req = mockRequest({
        token: 'test-token',
        client_id: 'unauthorized-server',
        client_secret: 'secret'
      });
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'forbidden',
        error_description: 'The resource server is not authorized to perform token introspection'
      });
    });

    it('should handle INTERNAL_SERVER_ERROR response from Authlete', async () => {
      const mockIntrospectionResponse: IntrospectionResponse = {
        action: 'INTERNAL_SERVER_ERROR',
        active: false
      };

      vi.mocked(mockAuthleteClient.introspection).mockResolvedValue(mockIntrospectionResponse);

      const req = mockRequest({
        token: 'test-token',
        client_id: 'resource-server',
        client_secret: 'secret'
      });
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'The authorization server encountered an unexpected condition'
      });
    });

    it('should handle exceptions and return 500 error', async () => {
      vi.mocked(mockAuthleteClient.introspection).mockRejectedValue(new Error('Network error'));

      const req = mockRequest({
        token: 'test-token',
        client_id: 'resource-server',
        client_secret: 'secret'
      });
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'Internal server error'
      });
    });

    it('should handle fallback response when responseContent is missing', async () => {
      const futureTimestamp = Date.now() + 3600000; // 1 hour from now
      const mockIntrospectionResponse: IntrospectionResponse = {
        action: 'OK',
        active: true,
        clientId: 123,
        scopes: ['read', 'write'],
        subject: 'user123',
        expiresAt: futureTimestamp
      };

      vi.mocked(mockAuthleteClient.introspection).mockResolvedValue(mockIntrospectionResponse);

      const req = mockRequest({
        token: 'valid-access-token',
        client_id: 'resource-server',
        client_secret: 'secret'
      });
      const res = mockResponse();

      await controller.handleIntrospectionRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        active: true,
        client_id: 123,
        scope: 'read write',
        sub: 'user123',
        exp: Math.floor(futureTimestamp / 1000)
      });
    });
  });

  // Property-based test for token introspection consistency
  it('Feature: oauth2-authorization-server, Property 8: Token Introspection Consistency', async () => {
    await fc.assert(fc.asyncProperty(
      
      // Generate arbitrary introspection request scenarios
      fc.record({
        // Token parameter - required for all requests
        token: fc.oneof(
          fc.string({ minLength: 10, maxLength: 100 }).filter(s => /^[a-zA-Z0-9_.-]+$/.test(s)), // Valid token format
          fc.string({ minLength: 1, maxLength: 5 }), // Short invalid token
          fc.constant(''), // Empty token
          fc.constant(undefined) // Missing token
        ),
        
        // Optional scope parameter
        scope: fc.option(
          fc.oneof(
            fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_ ]+$/.test(s)), // Single scope
            fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)), { minLength: 1, maxLength: 5 }) // Multiple scopes
          ),
          { nil: undefined }
        ),
        
        // Optional subject parameter
        subject: fc.option(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
          { nil: undefined }
        ),
        
        // Resource server authentication - can be missing, form-based, or Basic auth
        resourceServerAuth: fc.oneof(
          fc.constant(null), // No authentication
          fc.record({
            method: fc.constant('form'),
            clientId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            clientSecret: fc.string({ minLength: 1, maxLength: 100 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
          }),
          fc.record({
            method: fc.constant('basic'),
            clientId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            clientSecret: fc.string({ minLength: 1, maxLength: 100 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
          })
        ),
        
        // Authlete response scenario
        authleteAction: fc.oneof(
          fc.constant('OK'),
          fc.constant('BAD_REQUEST'),
          fc.constant('UNAUTHORIZED'),
          fc.constant('FORBIDDEN'),
          fc.constant('INTERNAL_SERVER_ERROR')
        ),
        
        // Token validity for OK responses
        tokenActive: fc.boolean(),
        
        // Token metadata for active tokens
        tokenMetadata: fc.record({
          clientId: fc.integer({ min: 1, max: 999999 }),
          scopes: fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)), { minLength: 0, maxLength: 5 }),
          subject: fc.option(fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)), { nil: undefined }),
          expiresAt: fc.option(fc.integer({ min: Date.now(), max: Date.now() + 86400000 }), { nil: undefined }) // Future timestamp
        })
      }),
      
      async (scenario) => {
        // Setup mock request based on scenario
        const requestBody: any = {};
        const requestHeaders: any = {};
        
        // Add token to request body
        if (scenario.token !== undefined) {
          requestBody.token = scenario.token;
        }
        
        // Add optional parameters
        if (scenario.scope !== undefined) {
          requestBody.scope = scenario.scope;
        }
        if (scenario.subject !== undefined) {
          requestBody.subject = scenario.subject;
        }
        
        // Setup resource server authentication
        if (scenario.resourceServerAuth) {
          if (scenario.resourceServerAuth.method === 'form') {
            requestBody.client_id = scenario.resourceServerAuth.clientId;
            requestBody.client_secret = scenario.resourceServerAuth.clientSecret;
          } else if (scenario.resourceServerAuth.method === 'basic') {
            const credentials = Buffer.from(`${scenario.resourceServerAuth.clientId}:${scenario.resourceServerAuth.clientSecret}`).toString('base64');
            requestHeaders.authorization = `Basic ${credentials}`;
          }
        }
        
        const req = mockRequest(requestBody, requestHeaders);
        const res = mockResponse();
        
        // Setup Authlete mock response
        let mockIntrospectionResponse: IntrospectionResponse;
        
        if (scenario.authleteAction === 'OK') {
          const responseContent = scenario.tokenActive ? {
            active: true,
            client_id: scenario.tokenMetadata.clientId,
            scope: scenario.tokenMetadata.scopes.join(' '),
            ...(scenario.tokenMetadata.subject && { sub: scenario.tokenMetadata.subject }),
            ...(scenario.tokenMetadata.expiresAt && { exp: Math.floor(scenario.tokenMetadata.expiresAt / 1000) })
          } : {
            active: false
          };
          
          mockIntrospectionResponse = {
            action: 'OK',
            responseContent: JSON.stringify(responseContent),
            active: scenario.tokenActive,
            ...(scenario.tokenActive && {
              clientId: scenario.tokenMetadata.clientId,
              scopes: scenario.tokenMetadata.scopes,
              subject: scenario.tokenMetadata.subject,
              expiresAt: scenario.tokenMetadata.expiresAt
            })
          };
        } else {
          mockIntrospectionResponse = {
            action: scenario.authleteAction,
            active: false
          };
        }
        
        vi.mocked(mockAuthleteClient.introspection).mockResolvedValue(mockIntrospectionResponse);
        
        // Execute the introspection request
        await controller.handleIntrospectionRequest(req as Request, res as Response);
        
        // Verify the response follows the expected patterns
        
        // Property: Unauthenticated requests return HTTP 401 (Requirement 5.4)
        if (!scenario.resourceServerAuth) {
          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith({
            error: 'unauthorized',
            error_description: 'Resource server authentication required'
          });
          return; // Early return for unauthenticated requests
        }
        
        // Property: Missing token parameter returns HTTP 400 (Requirement 5.1)
        if (!scenario.token) {
          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_request',
            error_description: 'Missing token parameter'
          });
          return; // Early return for missing token
        }
        
        // Property: Authlete API should be called with proper parameters (Requirement 5.1)
        const expectedIntrospectionRequest: IntrospectionRequest = {
          token: scenario.token,
          ...(scenario.scope && { 
            scopes: Array.isArray(scenario.scope) ? scenario.scope : [scenario.scope] 
          }),
          ...(scenario.subject && { subject: scenario.subject })
        };
        expect(mockAuthleteClient.introspection).toHaveBeenCalledWith(expectedIntrospectionRequest);
        
        // Property: Response status codes match Authlete actions
        switch (scenario.authleteAction) {
          case 'OK':
            expect(res.status).toHaveBeenCalledWith(200);
            
            // Property: Valid active tokens return metadata (Requirement 5.2)
            if (scenario.tokenActive) {
              const responseCall = vi.mocked(res.json).mock.calls[0][0];
              expect(responseCall.active).toBe(true);
              expect(responseCall.client_id).toBe(scenario.tokenMetadata.clientId);
              expect(responseCall.scope).toBe(scenario.tokenMetadata.scopes.join(' '));
              if (scenario.tokenMetadata.subject) {
                expect(responseCall.sub).toBe(scenario.tokenMetadata.subject);
              }
              if (scenario.tokenMetadata.expiresAt) {
                expect(responseCall.exp).toBe(Math.floor(scenario.tokenMetadata.expiresAt / 1000));
              }
            } else {
              // Property: Invalid tokens return active: false (Requirement 5.3)
              const responseCall = vi.mocked(res.json).mock.calls[0][0];
              expect(responseCall.active).toBe(false);
            }
            break;
            
          case 'BAD_REQUEST':
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
              error: 'invalid_request',
              error_description: 'The request is missing a required parameter or is otherwise malformed'
            });
            break;
            
          case 'UNAUTHORIZED':
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({
              error: 'unauthorized',
              error_description: 'Resource server authentication failed'
            });
            break;
            
          case 'FORBIDDEN':
            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({
              error: 'forbidden',
              error_description: 'The resource server is not authorized to perform token introspection'
            });
            break;
            
          case 'INTERNAL_SERVER_ERROR':
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
              error: 'server_error',
              error_description: 'The authorization server encountered an unexpected condition'
            });
            break;
        }
      }
    ), { numRuns: 100 });
  });

  // Property-based test for resource server authorization
  it('Feature: oauth2-authorization-server, Property 9: Resource Server Authorization', async () => {
    await fc.assert(fc.asyncProperty(
      
      // Generate arbitrary resource server authentication scenarios
      fc.record({
        // Token parameter - always valid for this test since we're focusing on authorization
        token: fc.string({ minLength: 10, maxLength: 100 }).filter(s => /^[a-zA-Z0-9_.-]+$/.test(s)),
        
        // Resource server authentication scenarios
        authScenario: fc.oneof(
          // No authentication provided
          fc.constant({ type: 'none' }),
          
          // Valid form-based authentication
          fc.record({
            type: fc.constant('form_valid'),
            clientId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            clientSecret: fc.string({ minLength: 1, maxLength: 100 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
          }),
          
          // Valid Basic authentication
          fc.record({
            type: fc.constant('basic_valid'),
            clientId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            clientSecret: fc.string({ minLength: 1, maxLength: 100 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
          }),
          
          // Invalid form-based authentication (missing secret)
          fc.record({
            type: fc.constant('form_invalid_missing_secret'),
            clientId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
          }),
          
          // Invalid form-based authentication (missing client_id)
          fc.record({
            type: fc.constant('form_invalid_missing_id'),
            clientSecret: fc.string({ minLength: 1, maxLength: 100 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s))
          }),
          
          // Invalid Basic authentication (malformed header)
          fc.record({
            type: fc.constant('basic_invalid_malformed'),
            header: fc.oneof(
              fc.constant('Basic'), // Missing credentials
              fc.constant('Basic '), // Empty credentials
              fc.constant('Basic invalid-base64'), // Invalid base64
              fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.startsWith('Basic ')) // Wrong auth type
            )
          }),
          
          // Invalid Basic authentication (malformed credentials)
          fc.record({
            type: fc.constant('basic_invalid_credentials'),
            credentials: fc.oneof(
              fc.constant('no-colon'), // Missing colon separator
              fc.constant(':'), // Empty client_id and secret
              fc.constant('client:'), // Empty secret
              fc.constant(':secret') // Empty client_id
            )
          })
        ),
        
        // Authlete response for authorized requests
        authleteResponse: fc.oneof(
          fc.constant('OK'),
          fc.constant('UNAUTHORIZED'), // Resource server not authorized
          fc.constant('FORBIDDEN') // Resource server forbidden
        )
      }),
      
      async (scenario) => {
        // Clear all mocks at the start of each iteration
        vi.clearAllMocks();
        
        // Setup mock request based on authentication scenario
        const requestBody: any = { token: scenario.token };
        const requestHeaders: any = {};
        
        switch (scenario.authScenario.type) {
          case 'none':
            // No authentication provided
            break;
            
          case 'form_valid':
            requestBody.client_id = scenario.authScenario.clientId;
            requestBody.client_secret = scenario.authScenario.clientSecret;
            break;
            
          case 'basic_valid':
            const validCredentials = Buffer.from(`${scenario.authScenario.clientId}:${scenario.authScenario.clientSecret}`).toString('base64');
            requestHeaders.authorization = `Basic ${validCredentials}`;
            break;
            
          case 'form_invalid_missing_secret':
            requestBody.client_id = scenario.authScenario.clientId;
            // client_secret intentionally missing
            break;
            
          case 'form_invalid_missing_id':
            requestBody.client_secret = scenario.authScenario.clientSecret;
            // client_id intentionally missing
            break;
            
          case 'basic_invalid_malformed':
            requestHeaders.authorization = scenario.authScenario.header;
            break;
            
          case 'basic_invalid_credentials':
            const invalidCredentials = Buffer.from(scenario.authScenario.credentials).toString('base64');
            requestHeaders.authorization = `Basic ${invalidCredentials}`;
            break;
        }
        
        const req = mockRequest(requestBody, requestHeaders);
        const res = mockResponse();
        
        // Setup Authlete mock response for valid authentication scenarios
        if (scenario.authScenario.type === 'form_valid' || scenario.authScenario.type === 'basic_valid') {
          let mockIntrospectionResponse: IntrospectionResponse;
          
          switch (scenario.authleteResponse) {
            case 'OK':
              mockIntrospectionResponse = {
                action: 'OK',
                responseContent: JSON.stringify({ active: true, client_id: 123 }),
                active: true,
                clientId: 123
              };
              break;
              
            case 'UNAUTHORIZED':
              mockIntrospectionResponse = {
                action: 'UNAUTHORIZED',
                active: false
              };
              break;
              
            case 'FORBIDDEN':
              mockIntrospectionResponse = {
                action: 'FORBIDDEN',
                active: false
              };
              break;
          }
          
          vi.mocked(mockAuthleteClient.introspection).mockResolvedValue(mockIntrospectionResponse);
        }
        
        // Execute the introspection request
        await controller.handleIntrospectionRequest(req as Request, res as Response);
        
        // Verify the authorization behavior
        
        // Property: Requests without authentication are rejected with 401 (Requirement 5.5)
        if (scenario.authScenario.type === 'none' || 
            scenario.authScenario.type === 'form_invalid_missing_secret' ||
            scenario.authScenario.type === 'form_invalid_missing_id' ||
            scenario.authScenario.type === 'basic_invalid_malformed' ||
            scenario.authScenario.type === 'basic_invalid_credentials') {
          
          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith({
            error: 'unauthorized',
            error_description: 'Resource server authentication required'
          });
          
          // Property: Authlete API should not be called for unauthenticated requests
          expect(mockAuthleteClient.introspection).not.toHaveBeenCalled();
          return;
        }
        
        // Property: Valid authentication allows the request to proceed to Authlete
        if (scenario.authScenario.type === 'form_valid' || scenario.authScenario.type === 'basic_valid') {
          expect(mockAuthleteClient.introspection).toHaveBeenCalledWith({
            token: scenario.token
          });
          
          // Property: Authlete authorization responses are properly handled
          switch (scenario.authleteResponse) {
            case 'OK':
              expect(res.status).toHaveBeenCalledWith(200);
              const responseCall = vi.mocked(res.json).mock.calls[0]?.[0];
              expect(responseCall?.active).toBe(true);
              break;
              
            case 'UNAUTHORIZED':
              expect(res.status).toHaveBeenCalledWith(401);
              expect(res.json).toHaveBeenCalledWith({
                error: 'unauthorized',
                error_description: 'Resource server authentication failed'
              });
              break;
              
            case 'FORBIDDEN':
              expect(res.status).toHaveBeenCalledWith(403);
              expect(res.json).toHaveBeenCalledWith({
                error: 'forbidden',
                error_description: 'The resource server is not authorized to perform token introspection'
              });
              break;
          }
        }
      }
    ), { numRuns: 100 });
  });
});