import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import fc from 'fast-check';
import { TokenControllerImpl } from './token';
import { AuthleteClient } from '../authlete/client';
import { TokenRequest, TokenResponse } from '../authlete/types';

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

describe('TokenController', () => {
  let tokenController: TokenControllerImpl;

  beforeEach(() => {
    tokenController = new TokenControllerImpl(mockAuthleteClient);
    vi.clearAllMocks();
  });

  describe('handleTokenRequest', () => {
    it('should handle valid token request with client_secret_post authentication', async () => {
      const req = mockRequest({
        grant_type: 'authorization_code',
        code: 'test_code',
        redirect_uri: 'https://client.example.com/callback',
        client_id: 'test_client',
        client_secret: 'test_secret'
      });
      const res = mockResponse();

      const mockTokenResponse: TokenResponse = {
        action: 'OK',
        responseContent: JSON.stringify({
          access_token: 'test_access_token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      };

      vi.mocked(mockAuthleteClient.token).mockResolvedValue(mockTokenResponse);

      await tokenController.handleTokenRequest(req as Request, res as Response);

      expect(mockAuthleteClient.token).toHaveBeenCalledWith({
        parameters: 'grant_type=authorization_code&code=test_code&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&client_id=test_client&client_secret=test_secret',
        clientId: 'test_client',
        clientSecret: 'test_secret'
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        access_token: 'test_access_token',
        token_type: 'Bearer',
        expires_in: 3600
      });
    });

    it('should handle valid token request with client_secret_basic authentication', async () => {
      const credentials = Buffer.from('test_client:test_secret').toString('base64');
      const req = mockRequest({
        grant_type: 'authorization_code',
        code: 'test_code',
        redirect_uri: 'https://client.example.com/callback'
      }, {
        authorization: `Basic ${credentials}`
      });
      const res = mockResponse();

      const mockTokenResponse: TokenResponse = {
        action: 'OK',
        responseContent: JSON.stringify({
          access_token: 'test_access_token',
          token_type: 'Bearer',
          expires_in: 3600
        })
      };

      vi.mocked(mockAuthleteClient.token).mockResolvedValue(mockTokenResponse);

      await tokenController.handleTokenRequest(req as Request, res as Response);

      expect(mockAuthleteClient.token).toHaveBeenCalledWith({
        parameters: 'grant_type=authorization_code&code=test_code&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback',
        clientId: 'test_client',
        clientSecret: 'test_secret'
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        access_token: 'test_access_token',
        token_type: 'Bearer',
        expires_in: 3600
      });
    });

    it('should return error for missing grant_type', async () => {
      const req = mockRequest({
        code: 'test_code',
        client_id: 'test_client',
        client_secret: 'test_secret'
      });
      const res = mockResponse();

      await tokenController.handleTokenRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing grant_type parameter'
      });
    });

    it('should return error for unsupported grant_type', async () => {
      const req = mockRequest({
        grant_type: 'client_credentials',
        client_id: 'test_client',
        client_secret: 'test_secret'
      });
      const res = mockResponse();

      await tokenController.handleTokenRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code grant type is supported'
      });
    });

    it('should return error for missing code', async () => {
      const req = mockRequest({
        grant_type: 'authorization_code',
        client_id: 'test_client',
        client_secret: 'test_secret'
      });
      const res = mockResponse();

      await tokenController.handleTokenRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing code parameter'
      });
    });

    it('should return error for missing client authentication', async () => {
      const req = mockRequest({
        grant_type: 'authorization_code',
        code: 'test_code'
      });
      const res = mockResponse();

      await tokenController.handleTokenRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_client',
        error_description: 'Client authentication failed'
      });
    });

    it('should handle INVALID_CLIENT response from Authlete', async () => {
      const req = mockRequest({
        grant_type: 'authorization_code',
        code: 'test_code',
        client_id: 'test_client',
        client_secret: 'wrong_secret'
      });
      const res = mockResponse();

      const mockTokenResponse: TokenResponse = {
        action: 'INVALID_CLIENT',
        responseContent: ''
      };

      vi.mocked(mockAuthleteClient.token).mockResolvedValue(mockTokenResponse);

      await tokenController.handleTokenRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_client',
        error_description: 'Client authentication failed'
      });
    });

    it('should handle INVALID_GRANT response from Authlete', async () => {
      const req = mockRequest({
        grant_type: 'authorization_code',
        code: 'expired_code',
        client_id: 'test_client',
        client_secret: 'test_secret'
      });
      const res = mockResponse();

      const mockTokenResponse: TokenResponse = {
        action: 'INVALID_GRANT',
        responseContent: ''
      };

      vi.mocked(mockAuthleteClient.token).mockResolvedValue(mockTokenResponse);

      await tokenController.handleTokenRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'The provided authorization grant is invalid, expired, or revoked'
      });
    });

    it('should handle server errors gracefully', async () => {
      const req = mockRequest({
        grant_type: 'authorization_code',
        code: 'test_code',
        client_id: 'test_client',
        client_secret: 'test_secret'
      });
      const res = mockResponse();

      vi.mocked(mockAuthleteClient.token).mockRejectedValue(new Error('Network error'));

      await tokenController.handleTokenRequest(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'Internal server error'
      });
    });
  });

  // Property-based test for token request processing
  it('Feature: oauth2-authorization-server, Property 6: Token Request Processing', async () => {
    await fc.assert(fc.asyncProperty(
      // Generate arbitrary token request scenarios
      fc.record({
        // Request parameters - use realistic values
        grantType: fc.oneof(
          fc.constant('authorization_code'),
          fc.constant('client_credentials'), // Invalid grant type
          fc.constant('refresh_token'),      // Invalid grant type
          fc.constant(''), // Empty grant type
          fc.constant(undefined) // Missing grant type
        ),
        code: fc.option(
          fc.string({ minLength: 10, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
          { nil: undefined }
        ),
        redirectUri: fc.option(fc.webUrl({ validSchemes: ['https'] }), { nil: undefined }),
        
        // Client credentials - use alphanumeric strings to avoid encoding issues
        clientId: fc.option(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
          { nil: undefined }
        ),
        clientSecret: fc.option(
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
          { nil: undefined }
        ),
        
        // Authentication method
        authMethod: fc.oneof(
          fc.constant('client_secret_post'),
          fc.constant('client_secret_basic'),
          fc.constant('none') // No authentication
        ),
        
        // Authlete response scenario
        authleteAction: fc.oneof(
          fc.constant('OK'),
          fc.constant('INVALID_CLIENT'),
          fc.constant('INVALID_REQUEST'),
          fc.constant('INVALID_GRANT'),
          fc.constant('INTERNAL_SERVER_ERROR')
        )
      }),
      
      async (testData) => {
        // Clear mocks for each iteration
        vi.clearAllMocks();
        
        // Setup mock request based on authentication method and parameters
        let req: Partial<Request>;
        const body: any = {};
        
        // Add parameters to body if they exist
        if (testData.grantType !== undefined) body.grant_type = testData.grantType;
        if (testData.code !== undefined) body.code = testData.code;
        if (testData.redirectUri !== undefined) body.redirect_uri = testData.redirectUri;
        
        if (testData.authMethod === 'client_secret_post' && testData.clientId && testData.clientSecret) {
          // Method 1: Credentials in request body
          body.client_id = testData.clientId;
          body.client_secret = testData.clientSecret;
          req = mockRequest(body);
        } else if (testData.authMethod === 'client_secret_basic' && testData.clientId && testData.clientSecret) {
          // Method 2: Credentials in Authorization header (Basic auth)
          const credentials = Buffer.from(`${testData.clientId}:${testData.clientSecret}`).toString('base64');
          req = mockRequest(body, {
            authorization: `Basic ${credentials}`
          });
        } else {
          // No authentication or incomplete credentials
          req = mockRequest(body);
        }
        
        const res = mockResponse();
        
        // Setup mock Authlete response
        const mockTokenResponse: TokenResponse = {
          action: testData.authleteAction,
          responseContent: testData.authleteAction === 'OK' 
            ? JSON.stringify({
                access_token: 'test_access_token_' + Math.random().toString(36).substring(7),
                token_type: 'Bearer',
                expires_in: 3600
              })
            : ''
        };
        
        // Only mock Authlete call if we expect it to be called
        const shouldCallAuthlete = testData.grantType === 'authorization_code' && 
                                   testData.code && 
                                   ((testData.authMethod === 'client_secret_post' && testData.clientId && testData.clientSecret) ||
                                    (testData.authMethod === 'client_secret_basic' && testData.clientId && testData.clientSecret));
        
        if (shouldCallAuthlete) {
          vi.mocked(mockAuthleteClient.token).mockResolvedValue(mockTokenResponse);
        }
        
        // Execute the token request
        await tokenController.handleTokenRequest(req as Request, res as Response);
        
        // Verify the response based on the request validity
        
        // Check for missing grant_type
        if (!testData.grantType) {
          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_request',
            error_description: 'Missing grant_type parameter'
          });
          return; // Early return for this error case
        }
        
        // Check for unsupported grant_type
        if (testData.grantType !== 'authorization_code') {
          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            error: 'unsupported_grant_type',
            error_description: 'Only authorization_code grant type is supported'
          });
          return; // Early return for this error case
        }
        
        // Check for missing code
        if (!testData.code) {
          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_request',
            error_description: 'Missing code parameter'
          });
          return; // Early return for this error case
        }
        
        // Check for missing client authentication
        const hasValidAuth = (testData.authMethod === 'client_secret_post' && testData.clientId && testData.clientSecret) ||
                            (testData.authMethod === 'client_secret_basic' && testData.clientId && testData.clientSecret);
        
        if (!hasValidAuth) {
          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_client',
            error_description: 'Client authentication failed'
          });
          return; // Early return for this error case
        }
        
        // If we reach here, the request should be valid and Authlete should be called
        expect(mockAuthleteClient.token).toHaveBeenCalled();
        
        // Verify response based on Authlete action
        if (testData.authleteAction === 'OK') {
          // For successful responses, verify proper token response format
          expect(res.status).toHaveBeenCalledWith(200);
          const responseCall = vi.mocked(res.json).mock.calls[0][0];
          
          // Verify token response contains required fields
          expect(responseCall).toHaveProperty('access_token');
          expect(responseCall).toHaveProperty('token_type', 'Bearer');
          expect(responseCall).toHaveProperty('expires_in', 3600);
          expect(typeof responseCall.access_token).toBe('string');
          expect(responseCall.access_token.length).toBeGreaterThan(0);
          
        } else if (testData.authleteAction === 'INVALID_CLIENT') {
          // For invalid client, verify proper OAuth 2.0 error response
          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_client',
            error_description: 'Client authentication failed'
          });
          
        } else if (testData.authleteAction === 'INVALID_REQUEST') {
          // For invalid request, verify proper OAuth 2.0 error response
          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_request',
            error_description: 'The request is missing a required parameter or is otherwise malformed'
          });
          
        } else if (testData.authleteAction === 'INVALID_GRANT') {
          // For invalid grant (expired/invalid authorization code), verify proper OAuth 2.0 error response
          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_grant',
            error_description: 'The provided authorization grant is invalid, expired, or revoked'
          });
          
        } else if (testData.authleteAction === 'INTERNAL_SERVER_ERROR') {
          // For server errors, verify proper OAuth 2.0 error response
          expect(res.status).toHaveBeenCalledWith(500);
          expect(res.json).toHaveBeenCalledWith({
            error: 'server_error',
            error_description: 'The authorization server encountered an unexpected condition'
          });
        }
      }
    ), { numRuns: 100 });
  });

  // Property-based test for client authentication methods
  it('Feature: oauth2-authorization-server, Property 7: Client Authentication Methods', async () => {
    await fc.assert(fc.asyncProperty(
      // Generate arbitrary client authentication scenarios
      fc.record({
        // Client credentials - use alphanumeric strings to avoid encoding issues
        clientId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
        clientSecret: fc.string({ minLength: 1, maxLength: 100 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
        
        // Authentication method
        authMethod: fc.oneof(
          fc.constant('client_secret_post'),
          fc.constant('client_secret_basic')
        ),
        
        // Token request parameters - use realistic values
        grantType: fc.constant('authorization_code'),
        code: fc.string({ minLength: 10, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
        redirectUri: fc.webUrl({ validSchemes: ['https'] }),
        
        // Authlete response scenario
        authleteAction: fc.oneof(
          fc.constant('OK'),
          fc.constant('INVALID_CLIENT'),
          fc.constant('INVALID_REQUEST'),
          fc.constant('INVALID_GRANT')
        )
      }),
      
      async (testData) => {
        // Clear mocks for each iteration
        vi.clearAllMocks();
        
        // Setup mock request based on authentication method
        let req: Partial<Request>;
        
        if (testData.authMethod === 'client_secret_post') {
          // Method 1: Credentials in request body
          req = mockRequest({
            grant_type: testData.grantType,
            code: testData.code,
            redirect_uri: testData.redirectUri,
            client_id: testData.clientId,
            client_secret: testData.clientSecret
          });
        } else {
          // Method 2: Credentials in Authorization header (Basic auth)
          const credentials = Buffer.from(`${testData.clientId}:${testData.clientSecret}`).toString('base64');
          req = mockRequest({
            grant_type: testData.grantType,
            code: testData.code,
            redirect_uri: testData.redirectUri
          }, {
            authorization: `Basic ${credentials}`
          });
        }
        
        const res = mockResponse();
        
        // Setup mock Authlete response
        const mockTokenResponse: TokenResponse = {
          action: testData.authleteAction,
          responseContent: testData.authleteAction === 'OK' 
            ? JSON.stringify({
                access_token: 'test_access_token',
                token_type: 'Bearer',
                expires_in: 3600
              })
            : ''
        };
        
        vi.mocked(mockAuthleteClient.token).mockResolvedValue(mockTokenResponse);
        
        // Execute the token request
        await tokenController.handleTokenRequest(req as Request, res as Response);
        
        // Verify that both authentication methods work correctly
        // The key property is that both methods should extract client credentials correctly
        // and pass them to Authlete API
        
        if (testData.authleteAction === 'OK') {
          // For successful responses, verify proper token response
          expect(res.status).toHaveBeenCalledWith(200);
          expect(res.json).toHaveBeenCalledWith({
            access_token: 'test_access_token',
            token_type: 'Bearer',
            expires_in: 3600
          });
        } else if (testData.authleteAction === 'INVALID_CLIENT') {
          // For invalid client, verify proper error response
          expect(res.status).toHaveBeenCalledWith(401);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_client',
            error_description: 'Client authentication failed'
          });
        } else if (testData.authleteAction === 'INVALID_REQUEST') {
          // For invalid request, verify proper error response
          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_request',
            error_description: 'The request is missing a required parameter or is otherwise malformed'
          });
        } else if (testData.authleteAction === 'INVALID_GRANT') {
          // For invalid grant, verify proper error response
          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_grant',
            error_description: 'The provided authorization grant is invalid, expired, or revoked'
          });
        }
        
        // Verify that Authlete API was called with correct client credentials
        // regardless of authentication method used
        expect(mockAuthleteClient.token).toHaveBeenCalledWith(
          expect.objectContaining({
            clientId: testData.clientId,
            clientSecret: testData.clientSecret
          })
        );
        
        // Verify that the parameters string contains the expected values
        const tokenCall = vi.mocked(mockAuthleteClient.token).mock.calls[0][0];
        const params = new URLSearchParams(tokenCall.parameters);
        
        expect(params.get('grant_type')).toBe(testData.grantType);
        expect(params.get('code')).toBe(testData.code);
        expect(params.get('redirect_uri')).toBe(testData.redirectUri);
        
        // For client_secret_post, credentials should be in parameters
        // For client_secret_basic, credentials should NOT be in parameters
        if (testData.authMethod === 'client_secret_post') {
          expect(params.get('client_id')).toBe(testData.clientId);
          expect(params.get('client_secret')).toBe(testData.clientSecret);
        } else {
          // For Basic auth, credentials should not be in the parameters string
          expect(params.get('client_id')).toBeNull();
          expect(params.get('client_secret')).toBeNull();
        }
      }
    ), { numRuns: 100 });
  });
});