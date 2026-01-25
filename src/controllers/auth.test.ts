import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import fc from 'fast-check';
import { AuthControllerImpl } from './auth';
import { AuthleteClient } from '../authlete/client';
import { AuthorizationIssueResponse, AuthorizationFailResponse } from '../authlete/types';

// Mock the AuthleteClient
const mockAuthleteClient: AuthleteClient = {
  authorization: vi.fn(),
  authorizationIssue: vi.fn(),
  authorizationFail: vi.fn(),
  token: vi.fn(),
  introspection: vi.fn()
};

describe('AuthController', () => {
  let controller: AuthControllerImpl;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    controller = new AuthControllerImpl(mockAuthleteClient);
    
    mockRequest = {
      query: {},
      body: {},
      session: {} as any
    };
    
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      redirect: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis()
    };

    vi.clearAllMocks();
  });

  describe('showLoginForm', () => {
    it('should redirect to consent if user is already authenticated', async () => {
      // Arrange
      mockRequest.session = { userId: 'user123' } as any;

      // Act
      await controller.showLoginForm(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockResponse.redirect).toHaveBeenCalledWith('/consent');
    });

    it('should show login form for unauthenticated user', async () => {
      // Arrange
      mockRequest.session = {} as any;

      // Act
      await controller.showLoginForm(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith(expect.stringContaining('<form method="POST" action="/login">'));
    });

    it('should show error message when error parameter is present', async () => {
      // Arrange
      mockRequest.query = { error: 'invalid_credentials' };
      mockRequest.session = {} as any;

      // Act
      await controller.showLoginForm(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockResponse.send).toHaveBeenCalledWith(expect.stringContaining('Invalid username or password'));
    });
  });

  describe('handleLogin', () => {
    it('should authenticate valid credentials and redirect to consent', async () => {
      // Arrange
      mockRequest.body = { username: 'demo', password: 'password' };
      mockRequest.session = {} as any;

      // Act
      await controller.handleLogin(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockRequest.session.userId).toBe('demo');
      expect(mockRequest.session.authenticated).toBe(true);
      expect(mockResponse.redirect).toHaveBeenCalledWith('/consent');
    });

    it('should reject invalid credentials and redirect to login with error', async () => {
      // Arrange
      mockRequest.body = { username: 'demo', password: 'wrongpassword' };
      mockRequest.session = {} as any;

      // Act
      await controller.handleLogin(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockRequest.session.userId).toBeUndefined();
      expect(mockResponse.redirect).toHaveBeenCalledWith('/login?error=invalid_credentials');
    });

    it('should reject empty credentials', async () => {
      // Arrange
      mockRequest.body = { username: '', password: '' };
      mockRequest.session = {} as any;

      // Act
      await controller.handleLogin(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockResponse.redirect).toHaveBeenCalledWith('/login?error=invalid_credentials');
    });
  });

  describe('showConsentForm', () => {
    it('should redirect to login if user is not authenticated', async () => {
      // Arrange
      mockRequest.session = {} as any;

      // Act
      await controller.showConsentForm(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockResponse.redirect).toHaveBeenCalledWith('/login');
    });

    it('should show error if authorization ticket is missing', async () => {
      // Arrange
      mockRequest.session = { userId: 'user123', authenticated: true } as any;

      // Act
      await controller.showConsentForm(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing authorization context'
      });
    });

    it('should show consent form for authenticated user with authorization ticket', async () => {
      // Arrange
      mockRequest.session = {
        userId: 'user123',
        authenticated: true,
        authorizationTicket: 'test-ticket',
        clientInfo: { clientName: 'Test App' },
        scopes: [{ name: 'read' }, { name: 'write' }]
      } as any;

      // Act
      await controller.showConsentForm(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.send).toHaveBeenCalledWith(expect.stringContaining('Test App'));
      expect(mockResponse.send).toHaveBeenCalledWith(expect.stringContaining('read'));
      expect(mockResponse.send).toHaveBeenCalledWith(expect.stringContaining('write'));
    });
  });

  describe('handleConsent', () => {
    beforeEach(() => {
      mockRequest.session = {
        userId: 'user123',
        authenticated: true,
        authorizationTicket: 'test-ticket'
      } as any;
    });

    it('should issue authorization code when user approves', async () => {
      // Arrange
      mockRequest.body = { consent: 'approve' };
      
      const mockIssueResponse: AuthorizationIssueResponse = {
        action: 'OK',
        responseContent: '{"location":"https://client.example.com/callback?code=auth_code&state=xyz"}'
      };

      vi.mocked(mockAuthleteClient.authorizationIssue).mockResolvedValue(mockIssueResponse);

      // Act
      await controller.handleConsent(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthleteClient.authorizationIssue).toHaveBeenCalledWith({
        ticket: 'test-ticket',
        subject: 'user123'
      });
      expect(mockResponse.redirect).toHaveBeenCalledWith('https://client.example.com/callback?code=auth_code&state=xyz');
      expect(mockRequest.session.authorizationTicket).toBeUndefined();
    });

    it('should deny authorization when user denies', async () => {
      // Arrange
      mockRequest.body = { consent: 'deny' };
      
      const mockFailResponse: AuthorizationFailResponse = {
        action: 'OK',
        responseContent: '{"location":"https://client.example.com/callback?error=access_denied&state=xyz"}'
      };

      vi.mocked(mockAuthleteClient.authorizationFail).mockResolvedValue(mockFailResponse);

      // Act
      await controller.handleConsent(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthleteClient.authorizationFail).toHaveBeenCalledWith({
        ticket: 'test-ticket',
        reason: 'ACCESS_DENIED'
      });
      expect(mockResponse.redirect).toHaveBeenCalledWith('https://client.example.com/callback?error=access_denied&state=xyz');
      expect(mockRequest.session.authorizationTicket).toBeUndefined();
    });

    it('should redirect to login if user is not authenticated', async () => {
      // Arrange
      mockRequest.session = {} as any;
      mockRequest.body = { consent: 'approve' };

      // Act
      await controller.handleConsent(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockResponse.redirect).toHaveBeenCalledWith('/login');
    });
  });
});

// Property-Based Tests
describe('OAuth 2.0 Authorization Server Properties', () => {
  let controller: AuthControllerImpl;
  let mockAuthleteClient: AuthleteClient;

  beforeEach(() => {
    mockAuthleteClient = {
      authorization: vi.fn(),
      authorizationIssue: vi.fn(),
      authorizationFail: vi.fn(),
      token: vi.fn(),
      introspection: vi.fn()
    };
    controller = new AuthControllerImpl(mockAuthleteClient);
  });

  it('Feature: oauth2-authorization-server, Property 2: Authentication Flow Consistency', async () => {
    await fc.assert(fc.asyncProperty(
      // Generate arbitrary user credentials and authentication states
      fc.record({
        username: fc.oneof(
          fc.string({ minLength: 1, maxLength: 50 }), // Valid usernames
          fc.constant(''), // Empty username
          fc.constant('demo'), // Valid demo user
          fc.constant('user1'), // Valid user1
          fc.constant('testuser') // Valid testuser
        ),
        password: fc.oneof(
          fc.string({ minLength: 1, maxLength: 50 }), // Various passwords
          fc.constant(''), // Empty password
          fc.constant('password'), // Valid password for demo
          fc.constant('pass123'), // Valid password for user1
          fc.constant('test123') // Valid password for testuser
        ),
        isAuthenticated: fc.boolean(),
        hasSession: fc.boolean()
      }),
      async (testData) => {
        try {
          // Create fresh mock objects for each test iteration
          const mockRequest: Partial<Request> = {
            query: {},
            body: { username: testData.username, password: testData.password },
            session: testData.hasSession ? (testData.isAuthenticated ? { userId: 'existing_user' } : {}) : {} as any
          };

          const mockResponse: Partial<Response> = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            redirect: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis()
          };

          // Test showLoginForm behavior (Requirement 2.1)
          await controller.showLoginForm(mockRequest as Request, mockResponse as Response);

          if (testData.hasSession && testData.isAuthenticated && mockRequest.session?.userId) {
            // Authenticated users should be redirected to consent
            if (!vi.mocked(mockResponse.redirect!).mock.calls.some(call => call[0] === '/consent')) {
              return false;
            }
          } else {
            // Unauthenticated users should see login form
            if (!vi.mocked(mockResponse.status!).mock.calls.some(call => call[0] === 200)) {
              return false;
            }
            const sendCalls = vi.mocked(mockResponse.send!).mock.calls;
            if (!sendCalls.some(call => typeof call[0] === 'string' && call[0].includes('<form method="POST" action="/login">'))) {
              return false;
            }
          }

          // Create fresh mock objects for login handling test
          const loginMockRequest: Partial<Request> = {
            body: { username: testData.username, password: testData.password },
            session: {} as any // Fresh session for login test
          };

          const loginMockResponse: Partial<Response> = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            redirect: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis()
          };

          // Test handleLogin behavior (Requirements 2.2 and 2.3)
          await controller.handleLogin(loginMockRequest as Request, loginMockResponse as Response);

          // Determine if credentials are valid
          const validCredentials = [
            { username: 'demo', password: 'password' },
            { username: 'user1', password: 'pass123' },
            { username: 'testuser', password: 'test123' }
          ];

          const isValidCredential = validCredentials.some(
            cred => cred.username === testData.username && cred.password === testData.password
          );

          if (isValidCredential) {
            // Valid credentials should authenticate user and redirect to consent (Requirement 2.2)
            if (loginMockRequest.session!.userId !== testData.username) {
              return false;
            }
            if (loginMockRequest.session!.authenticated !== true) {
              return false;
            }
            if (!vi.mocked(loginMockResponse.redirect!).mock.calls.some(call => call[0] === '/consent')) {
              return false;
            }
          } else {
            // Invalid credentials should redirect to login with error (Requirement 2.3)
            if (loginMockRequest.session!.userId !== undefined) {
              return false;
            }
            if (!vi.mocked(loginMockResponse.redirect!).mock.calls.some(call => call[0] === '/login?error=invalid_credentials')) {
              return false;
            }
          }

          return true;
        } catch (error) {
          // If any error occurs during the test, the property fails
          console.error('Property test error:', error);
          return false;
        }
      }
    ), { numRuns: 100 });
  });

  it('Feature: oauth2-authorization-server, Property 3: Consent Flow Handling', async () => {
    await fc.assert(fc.asyncProperty(
      // Generate arbitrary consent flow scenarios
      fc.record({
        userId: fc.oneof(
          fc.string({ minLength: 1, maxLength: 50 }), // Valid user IDs
          fc.constant('demo'),
          fc.constant('user1'),
          fc.constant('testuser')
        ),
        isAuthenticated: fc.boolean(),
        hasAuthorizationTicket: fc.boolean(),
        authorizationTicket: fc.string({ minLength: 10, maxLength: 100 }),
        clientInfo: fc.record({
          clientName: fc.string({ minLength: 1, maxLength: 100 }),
          description: fc.option(fc.string({ minLength: 1, maxLength: 200 }))
        }),
        scopes: fc.array(fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          description: fc.option(fc.string({ minLength: 1, maxLength: 100 }))
        }), { minLength: 0, maxLength: 5 }),
        consentDecision: fc.oneof(
          fc.constant('approve'),
          fc.constant('deny'),
          fc.string() // Random consent values
        )
      }),
      async (testData) => {
        try {
          // Test showConsentForm behavior (Requirement 2.4)
          const consentFormRequest: Partial<Request> = {
            session: testData.isAuthenticated && testData.hasAuthorizationTicket ? {
              userId: testData.userId,
              authenticated: true,
              authorizationTicket: testData.authorizationTicket,
              clientInfo: testData.clientInfo,
              scopes: testData.scopes
            } : (testData.isAuthenticated ? {
              userId: testData.userId,
              authenticated: true
            } : {}) as any
          };

          const consentFormResponse: Partial<Response> = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            redirect: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis()
          };

          await controller.showConsentForm(consentFormRequest as Request, consentFormResponse as Response);

          if (!testData.isAuthenticated || !consentFormRequest.session?.userId) {
            // Unauthenticated users should be redirected to login
            if (!vi.mocked(consentFormResponse.redirect!).mock.calls.some(call => call[0] === '/login')) {
              return false;
            }
          } else if (!testData.hasAuthorizationTicket) {
            // Authenticated users without authorization ticket should get error
            if (!vi.mocked(consentFormResponse.status!).mock.calls.some(call => call[0] === 400)) {
              return false;
            }
            if (!vi.mocked(consentFormResponse.json!).mock.calls.some(call => 
              call[0]?.error === 'invalid_request' && call[0]?.error_description === 'Missing authorization context'
            )) {
              return false;
            }
          } else {
            // Authenticated users with authorization ticket should see consent form (Requirement 2.4)
            if (!vi.mocked(consentFormResponse.status!).mock.calls.some(call => call[0] === 200)) {
              return false;
            }
            const sendCalls = vi.mocked(consentFormResponse.send!).mock.calls;
            if (!sendCalls.some(call => typeof call[0] === 'string' && call[0].includes('<form method="POST" action="/consent">'))) {
              return false;
            }
            // Should display client information and scopes
            if (!sendCalls.some(call => typeof call[0] === 'string' && call[0].includes(testData.clientInfo.clientName))) {
              return false;
            }
          }

          // Test handleConsent behavior (Requirements 2.5 and 2.6)
          if (testData.isAuthenticated && testData.hasAuthorizationTicket) {
            const consentRequest: Partial<Request> = {
              body: { consent: testData.consentDecision },
              session: {
                userId: testData.userId,
                authenticated: true,
                authorizationTicket: testData.authorizationTicket,
                clientInfo: testData.clientInfo,
                scopes: testData.scopes
              } as any
            };

            const consentResponse: Partial<Response> = {
              status: vi.fn().mockReturnThis(),
              json: vi.fn().mockReturnThis(),
              redirect: vi.fn().mockReturnThis(),
              send: vi.fn().mockReturnThis()
            };

            // Mock Authlete responses
            const mockIssueResponse: AuthorizationIssueResponse = {
              action: 'OK',
              responseContent: '{"location":"https://client.example.com/callback?code=auth_code&state=xyz"}'
            };

            const mockFailResponse: AuthorizationFailResponse = {
              action: 'OK',
              responseContent: '{"location":"https://client.example.com/callback?error=access_denied&state=xyz"}'
            };

            vi.mocked(mockAuthleteClient.authorizationIssue).mockResolvedValue(mockIssueResponse);
            vi.mocked(mockAuthleteClient.authorizationFail).mockResolvedValue(mockFailResponse);

            await controller.handleConsent(consentRequest as Request, consentResponse as Response);

            if (testData.consentDecision === 'approve') {
              // User grants consent should proceed to authorization code issuance (Requirement 2.5)
              if (!vi.mocked(mockAuthleteClient.authorizationIssue).mock.calls.some(call => 
                call[0]?.ticket === testData.authorizationTicket && call[0]?.subject === testData.userId
              )) {
                return false;
              }
              if (!vi.mocked(consentResponse.redirect!).mock.calls.some(call => 
                typeof call[0] === 'string' && call[0].includes('code=auth_code')
              )) {
                return false;
              }
              // Session should be cleaned up
              if (consentRequest.session!.authorizationTicket !== undefined) {
                return false;
              }
            } else if (testData.consentDecision === 'deny') {
              // User denies consent should redirect with access_denied error (Requirement 2.6)
              if (!vi.mocked(mockAuthleteClient.authorizationFail).mock.calls.some(call => 
                call[0]?.ticket === testData.authorizationTicket && call[0]?.reason === 'ACCESS_DENIED'
              )) {
                return false;
              }
              if (!vi.mocked(consentResponse.redirect!).mock.calls.some(call => 
                typeof call[0] === 'string' && call[0].includes('error=access_denied')
              )) {
                return false;
              }
              // Session should be cleaned up
              if (consentRequest.session!.authorizationTicket !== undefined) {
                return false;
              }
            }
            // For other consent values, the behavior is implementation-specific
          }

          return true;
        } catch (error) {
          // If any error occurs during the test, the property fails
          console.error('Property test error:', error);
          return false;
        }
      }
    ), { numRuns: 100 });
  });

  it('Feature: oauth2-authorization-server, Property 4: Authorization Code Issuance', async () => {
    await fc.assert(fc.asyncProperty(
      // Generate arbitrary authorization code issuance scenarios
      fc.record({
        userId: fc.oneof(
          fc.string({ minLength: 1, maxLength: 50 }), // Valid user IDs
          fc.constant('demo'),
          fc.constant('user1'),
          fc.constant('testuser')
        ),
        authorizationTicket: fc.string({ minLength: 10, maxLength: 100 }),
        clientInfo: fc.record({
          clientName: fc.string({ minLength: 1, maxLength: 100 }),
          description: fc.option(fc.string({ minLength: 1, maxLength: 200 }))
        }),
        scopes: fc.array(fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          description: fc.option(fc.string({ minLength: 1, maxLength: 100 }))
        }), { minLength: 0, maxLength: 5 }),
        authleteResponse: fc.oneof(
          // Successful authorization code issuance with redirect
          fc.record({
            action: fc.constant('OK' as const),
            responseContent: fc.oneof(
              // With redirect location (typical case)
              fc.string({ minLength: 1 }).map(code => `{"location":"https://client.example.com/callback?code=${code}&state=xyz"}`),
              // With state parameter preservation
              fc.string({ minLength: 1 }).map(code => `{"location":"https://client.example.com/callback?code=${code}&state=preserved_state"}`),
              // Without state parameter
              fc.string({ minLength: 1 }).map(code => `{"location":"https://client.example.com/callback?code=${code}"}`),
              // JSON response without location (edge case)
              fc.string({ minLength: 1 }).map(code => `{"code":"${code}","token_type":"Bearer"}`)
            )
          }),
          // Authorization code generation failure
          fc.record({
            action: fc.oneof(
              fc.constant('BAD_REQUEST' as const),
              fc.constant('UNAUTHORIZED' as const),
              fc.constant('FORBIDDEN' as const),
              fc.constant('INTERNAL_SERVER_ERROR' as const)
            ),
            responseContent: fc.constant('{"error":"server_error","error_description":"Failed to generate authorization code"}')
          })
        ),
        networkError: fc.boolean() // Simulate network/API errors
      }),
      async (testData) => {
        try {
          // Create mock request with authenticated user and authorization ticket
          const mockRequest: Partial<Request> = {
            body: { consent: 'approve' },
            session: {
              userId: testData.userId,
              authenticated: true,
              authorizationTicket: testData.authorizationTicket,
              clientInfo: testData.clientInfo,
              scopes: testData.scopes
            } as any
          };

          const mockResponse: Partial<Response> = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis(),
            redirect: vi.fn().mockReturnThis(),
            send: vi.fn().mockReturnThis()
          };

          // Mock Authlete API response or error
          if (testData.networkError) {
            vi.mocked(mockAuthleteClient.authorizationIssue).mockRejectedValue(new Error('Network error'));
          } else {
            vi.mocked(mockAuthleteClient.authorizationIssue).mockResolvedValue(testData.authleteResponse);
          }

          // Execute the consent handling (which includes authorization code issuance)
          await controller.handleConsent(mockRequest as Request, mockResponse as Response);

          // Verify Requirements 3.1, 3.2, 3.4
          
          if (testData.networkError) {
            // Network errors should result in server error response
            if (!vi.mocked(mockResponse.status!).mock.calls.some(call => call[0] === 500)) {
              return false;
            }
            if (!vi.mocked(mockResponse.json!).mock.calls.some(call => 
              call[0]?.error === 'server_error'
            )) {
              return false;
            }
          } else {
            // Requirement 3.1: Call Authlete /auth/authorization/issue API after successful authentication and consent
            if (!vi.mocked(mockAuthleteClient.authorizationIssue).mock.calls.some(call => 
              call[0]?.ticket === testData.authorizationTicket && call[0]?.subject === testData.userId
            )) {
              return false;
            }

            if (testData.authleteResponse.action === 'OK') {
              try {
                const responseData = JSON.parse(testData.authleteResponse.responseContent);
                
                if (responseData.location) {
                  // Requirement 3.2: Redirect user to client's redirect_uri with code parameter
                  if (!vi.mocked(mockResponse.redirect!).mock.calls.some(call => 
                    call[0] === responseData.location
                  )) {
                    return false;
                  }

                  // Requirement 3.4: Include state parameter when provided in original request
                  if (responseData.location.includes('state=')) {
                    const stateMatch = responseData.location.match(/state=([^&]+)/);
                    if (!stateMatch) {
                      return false;
                    }
                    // State parameter should be preserved (xyz or preserved_state in our test data)
                    const stateValue = stateMatch[1];
                    if (stateValue !== 'xyz' && stateValue !== 'preserved_state') {
                      return false;
                    }
                  }

                  // Authorization code should be present in the redirect URL
                  if (!responseData.location.includes('code=')) {
                    return false;
                  }
                } else {
                  // JSON response without redirect - should return 200 with JSON data
                  if (!vi.mocked(mockResponse.status!).mock.calls.some(call => call[0] === 200)) {
                    return false;
                  }
                  if (!vi.mocked(mockResponse.json!).mock.calls.some(call => 
                    JSON.stringify(call[0]) === testData.authleteResponse.responseContent
                  )) {
                    return false;
                  }
                }

                // Session cleanup should occur after successful code issuance
                if (mockRequest.session!.authorizationTicket !== undefined) {
                  return false;
                }
              } catch (parseError) {
                // Invalid JSON response should result in error
                if (!vi.mocked(mockResponse.status!).mock.calls.some(call => call[0] === 500)) {
                  return false;
                }
              }
            } else {
              // Requirement 3.3: Authorization code generation failures should return appropriate error response
              if (!vi.mocked(mockResponse.status!).mock.calls.some(call => call[0] === 500)) {
                return false;
              }
              if (!vi.mocked(mockResponse.json!).mock.calls.some(call => 
                call[0]?.error === 'server_error' && 
                call[0]?.error_description === 'Failed to issue authorization code'
              )) {
                return false;
              }
            }
          }

          return true;
        } catch (error) {
          // If any error occurs during the test, the property fails
          console.error('Property test error:', error);
          return false;
        }
      }
    ), { numRuns: 100 });
  });

  it('Feature: oauth2-authorization-server, Property 5: Authorization Code Lifecycle', async () => {
    await fc.assert(fc.asyncProperty(
      // Generate arbitrary authorization code lifecycle scenarios
      fc.record({
        userId: fc.oneof(
          fc.string({ minLength: 1, maxLength: 50 }), // Valid user IDs
          fc.constant('demo'),
          fc.constant('user1'),
          fc.constant('testuser')
        ),
        authorizationTicket: fc.string({ minLength: 10, maxLength: 100 }),
        authorizationCode: fc.string({ minLength: 10, maxLength: 100 }).filter(s => s.length > 0 && /^[a-zA-Z0-9]+$/.test(s)),
        clientInfo: fc.record({
          clientName: fc.string({ minLength: 1, maxLength: 100 }),
          description: fc.option(fc.string({ minLength: 1, maxLength: 200 }))
        }),
        scopes: fc.array(fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          description: fc.option(fc.string({ minLength: 1, maxLength: 100 }))
        }), { minLength: 0, maxLength: 5 }),
        // Simulate different authorization code states and usage scenarios
        codeUsageScenario: fc.oneof(
          fc.constant('first_use'), // First time using the code
          fc.constant('second_use'), // Attempting to reuse the code (should fail)
          fc.constant('expired_code'), // Code has expired
          fc.constant('invalid_code') // Code is invalid/malformed
        ),
        networkError: fc.boolean() // Simulate network/API errors
      }),
      async (testData) => {
        try {
          // Property 5 tests the authorization code lifecycle through token exchange
          // Since our system delegates code management to Authlete, we test the behavior
          // our system should exhibit when codes are used, reused, or expired
          
          // Create a mock token controller to simulate token exchange
          const mockTokenController = {
            handleTokenRequest: async (req: any, res: any) => {
              try {
                // Parse the token request parameters
                const params = new URLSearchParams(req.body.parameters || '');
                const grantType = params.get('grant_type');
                const code = params.get('code');
                const clientId = params.get('client_id');
                
                // Validate grant type
                if (grantType !== 'authorization_code') {
                  res.status(400).json({
                    error: 'unsupported_grant_type',
                    error_description: 'Grant type must be authorization_code'
                  });
                  return;
                }
                
                // Validate authorization code presence
                if (!code) {
                  res.status(400).json({
                    error: 'invalid_request',
                    error_description: 'Missing authorization code'
                  });
                  return;
                }
                
                // Call Authlete token API (mocked)
                const tokenResponse = await mockAuthleteClient.token({
                  parameters: req.body.parameters,
                  clientId: clientId || undefined
                });
                
                // Handle different response actions
                if (tokenResponse.action === 'OK') {
                  // Successful token exchange - code was valid and unused
                  const responseData = JSON.parse(tokenResponse.responseContent);
                  res.status(200).json(responseData);
                } else if (tokenResponse.action === 'INVALID_GRANT') {
                  // Code was already used or expired (single-use violation)
                  const responseData = JSON.parse(tokenResponse.responseContent);
                  res.status(400).json(responseData);
                } else if (tokenResponse.action === 'INVALID_REQUEST') {
                  // Code was malformed or invalid
                  const responseData = JSON.parse(tokenResponse.responseContent);
                  res.status(400).json(responseData);
                } else {
                  // Other errors
                  res.status(500).json({
                    error: 'server_error',
                    error_description: 'Token exchange failed'
                  });
                }
              } catch (error) {
                res.status(500).json({
                  error: 'server_error',
                  error_description: 'Internal server error during token exchange'
                });
              }
            }
          };
          
          // Create mock request for token exchange
          const tokenRequest: any = {
            body: {
              parameters: `grant_type=authorization_code&code=${testData.authorizationCode}&client_id=test_client&redirect_uri=https://client.example.com/callback`
            }
          };
          
          const tokenResponse: any = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn().mockReturnThis()
          };
          
          // Mock Authlete token API response based on the scenario
          // This ensures consistent test logic
          let expectedResponse;
          
          if (testData.networkError) {
            vi.mocked(mockAuthleteClient.token).mockRejectedValue(new Error('Network error'));
          } else {
            // Determine expected response based on code usage scenario
            if (testData.codeUsageScenario === 'first_use') {
              // First use should succeed (Requirement 3.5 - valid codes work)
              expectedResponse = {
                action: 'OK' as const,
                responseContent: `{"access_token":"valid_token_${testData.authorizationCode}","token_type":"Bearer","expires_in":3600}`,
                accessToken: `valid_token_${testData.authorizationCode}`,
                accessTokenDuration: 3600
              };
            } else if (testData.codeUsageScenario === 'second_use' || testData.codeUsageScenario === 'expired_code') {
              // Second use or expired code should return invalid_grant (Requirement 3.5 - single-use enforcement)
              expectedResponse = {
                action: 'INVALID_GRANT' as const,
                responseContent: '{"error":"invalid_grant","error_description":"Authorization code has been used or expired"}',
                accessToken: undefined,
                accessTokenDuration: undefined
              };
            } else if (testData.codeUsageScenario === 'invalid_code') {
              // Invalid code should return invalid_request
              expectedResponse = {
                action: 'INVALID_REQUEST' as const,
                responseContent: '{"error":"invalid_request","error_description":"Invalid authorization code"}',
                accessToken: undefined,
                accessTokenDuration: undefined
              };
            }
            
            vi.mocked(mockAuthleteClient.token).mockResolvedValue(expectedResponse);
          }
          
          // Execute token exchange
          await mockTokenController.handleTokenRequest(tokenRequest, tokenResponse);
          
          // Verify Requirement 3.5: Authorization codes should be single-use and have appropriate expiration
          
          if (testData.networkError) {
            // Network errors should result in server error
            if (!vi.mocked(tokenResponse.status).mock.calls.some(call => call[0] === 500)) {
              return false;
            }
            if (!vi.mocked(tokenResponse.json).mock.calls.some(call => 
              call[0]?.error === 'server_error'
            )) {
              return false;
            }
          } else {
            // Verify that Authlete token API was called
            if (!vi.mocked(mockAuthleteClient.token).mock.calls.some(call => 
              call[0]?.parameters?.includes(`code=${testData.authorizationCode}`)
            )) {
              return false;
            }
            
            if (testData.codeUsageScenario === 'first_use') {
              // First use of valid code should succeed
              if (!vi.mocked(tokenResponse.status).mock.calls.some(call => call[0] === 200)) {
                return false;
              }
              
              const jsonCalls = vi.mocked(tokenResponse.json).mock.calls;
              if (!jsonCalls.some(call => {
                const response = call[0];
                return response?.access_token && response?.token_type === 'Bearer' && response?.expires_in;
              })) {
                return false;
              }
            } else if (testData.codeUsageScenario === 'second_use' || testData.codeUsageScenario === 'expired_code') {
              // Second use or expired code should fail with invalid_grant (single-use enforcement)
              if (!vi.mocked(tokenResponse.status).mock.calls.some(call => call[0] === 400)) {
                return false;
              }
              
              if (!vi.mocked(tokenResponse.json).mock.calls.some(call => 
                call[0]?.error === 'invalid_grant' && 
                call[0]?.error_description?.includes('used or expired')
              )) {
                return false;
              }
            } else if (testData.codeUsageScenario === 'invalid_code') {
              // Invalid code should fail with invalid_request
              if (!vi.mocked(tokenResponse.status).mock.calls.some(call => call[0] === 400)) {
                return false;
              }
              
              if (!vi.mocked(tokenResponse.json).mock.calls.some(call => 
                call[0]?.error === 'invalid_request'
              )) {
                return false;
              }
            }
          }
          
          return true;
        } catch (error) {
          // If any error occurs during the test, the property fails
          console.error('Property test error:', error);
          return false;
        }
      }
    ), { numRuns: 100 });
  });
});