import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from './app';
import { AuthorizationResponse, AuthorizationIssueResponse, AuthorizationFailResponse } from './authlete/types';

// Create mock functions that we can control
const mockAuthleteClient = {
  authorization: vi.fn(),
  authorizationIssue: vi.fn(),
  authorizationFail: vi.fn(),
  token: vi.fn(),
  introspection: vi.fn()
};

// Mock the entire Authlete client module
vi.mock('./authlete/client', () => {
  return {
    AuthleteClientImpl: vi.fn(() => mockAuthleteClient),
    AuthleteApiError: class AuthleteApiError extends Error {
      constructor(public statusCode: number, public authleteResponse: any, message: string) {
        super(message);
        this.name = 'AuthleteApiError';
      }
    }
  };
});

describe('OAuth 2.0 Authorization Flow End-to-End', () => {
  let app: any;

  beforeEach(() => {
    // Create fresh app instance for each test
    app = createApp();
    
    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Complete Authorization Code Flow - Happy Path', () => {
    it('should complete full authorization flow with user authentication and consent', async () => {
      // Step 1: Client initiates authorization request
      const authorizationResponse: AuthorizationResponse = {
        action: 'INTERACTION',
        ticket: 'test-authorization-ticket-123',
        client: {
          clientId: 12345,
          clientName: 'Test OAuth Client',
          description: 'A test client application'
        },
        service: {
          serviceName: 'Test OAuth Service'
        },
        scopes: [
          { name: 'read', description: 'Read access to user data' },
          { name: 'write', description: 'Write access to user data' }
        ]
      };

      mockAuthleteClient.authorization.mockResolvedValue(authorizationResponse);

      // Make authorization request
      const authResponse = await request(app)
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: 'test-client-123',
          redirect_uri: 'https://client.example.com/callback',
          scope: 'read write',
          state: 'random-state-value'
        })
        .expect(302);

      // Should redirect to login page
      expect(authResponse.headers.location).toBe('/login');

      // Verify Authlete authorization API was called correctly
      expect(mockAuthleteClient.authorization).toHaveBeenCalledWith({
        parameters: 'response_type=code&client_id=test-client-123&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&scope=read+write&state=random-state-value',
        clientId: 'test-client-123'
      });

      // Step 2: User accesses login page
      const loginPageResponse = await request(app)
        .get('/login')
        .expect(200);

      // Should show login form
      expect(loginPageResponse.text).toContain('<form method="POST" action="/login">');
      expect(loginPageResponse.text).toContain('Username: demo, Password: password');

      // Step 3: User submits valid credentials
      const loginResponse = await request(app)
        .post('/login')
        .send({
          username: 'demo',
          password: 'password'
        })
        .expect(302);

      // Should redirect to consent page
      expect(loginResponse.headers.location).toBe('/consent');

      // Step 4: User accesses consent page (need to maintain session)
      const agent = request.agent(app); // Use agent to maintain session
      
      // Re-do the flow with agent to maintain session
      await agent
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: 'test-client-123',
          redirect_uri: 'https://client.example.com/callback',
          scope: 'read write',
          state: 'random-state-value'
        })
        .expect(302);

      // Login with agent
      const loginResponseAgent = await agent
        .post('/login')
        .send({
          username: 'demo',
          password: 'password'
        })
        .expect(302);

      expect(loginResponseAgent.headers.location).toBe('/consent');

      // Access consent page with agent
      const consentPageResponse = await agent
        .get('/consent')
        .expect(200);

      // Should show consent form with client info and scopes
      expect(consentPageResponse.text).toContain('Test OAuth Client');
      expect(consentPageResponse.text).toContain('read');
      expect(consentPageResponse.text).toContain('write');
      expect(consentPageResponse.text).toContain('<form method="POST" action="/consent">');

      // Step 5: User grants consent
      const issueResponse: AuthorizationIssueResponse = {
        action: 'OK',
        responseContent: JSON.stringify({
          location: 'https://client.example.com/callback?code=generated-auth-code-123&state=random-state-value'
        })
      };

      mockAuthleteClient.authorizationIssue.mockResolvedValue(issueResponse);

      const consentResponse = await agent
        .post('/consent')
        .send({
          consent: 'approve'
        })
        .expect(302);

      // Should redirect to client callback with authorization code
      expect(consentResponse.headers.location).toBe('https://client.example.com/callback?code=generated-auth-code-123&state=random-state-value');

      // Verify Authlete authorization issue API was called correctly
      expect(mockAuthleteClient.authorizationIssue).toHaveBeenCalledWith({
        ticket: 'test-authorization-ticket-123',
        subject: 'demo'
      });
    });

    it('should handle user denial of consent', async () => {
      // Use agent to maintain session
      const agent = request.agent(app);
      
      // Setup authorization request
      const authorizationResponse: AuthorizationResponse = {
        action: 'INTERACTION',
        ticket: 'test-authorization-ticket-456',
        client: {
          clientId: 12345,
          clientName: 'Test OAuth Client'
        },
        service: {
          serviceName: 'Test OAuth Service'
        },
        scopes: [
          { name: 'read', description: 'Read access to user data' }
        ]
      };

      mockAuthleteClient.authorization.mockResolvedValue(authorizationResponse);

      // Make authorization request
      await agent
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: 'test-client-123',
          redirect_uri: 'https://client.example.com/callback',
          scope: 'read',
          state: 'test-state'
        })
        .expect(302);

      // Login user
      await agent
        .post('/login')
        .send({
          username: 'demo',
          password: 'password'
        })
        .expect(302);

      // Setup authorization fail response
      const failResponse: AuthorizationFailResponse = {
        action: 'OK',
        responseContent: JSON.stringify({
          location: 'https://client.example.com/callback?error=access_denied&state=test-state'
        })
      };

      mockAuthleteClient.authorizationFail.mockResolvedValue(failResponse);

      // User denies consent
      const consentResponse = await agent
        .post('/consent')
        .send({
          consent: 'deny'
        })
        .expect(302);

      // Should redirect to client callback with access_denied error
      expect(consentResponse.headers.location).toBe('https://client.example.com/callback?error=access_denied&state=test-state');

      // Verify Authlete authorization fail API was called correctly
      expect(mockAuthleteClient.authorizationFail).toHaveBeenCalledWith({
        ticket: 'test-authorization-ticket-456',
        reason: 'ACCESS_DENIED'
      });
    });
  });

  describe('Authorization Request Validation', () => {
    it('should handle invalid client_id', async () => {
      const authorizationResponse: AuthorizationResponse = {
        action: 'BAD_REQUEST',
        ticket: '',
        client: { clientId: 0, clientName: '' },
        service: { serviceName: '' },
        responseContent: JSON.stringify({
          error: 'invalid_client',
          error_description: 'Client not found'
        })
      };

      mockAuthleteClient.authorization.mockResolvedValue(authorizationResponse);

      const response = await request(app)
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: 'invalid-client',
          redirect_uri: 'https://client.example.com/callback'
        })
        .expect(400);

      expect(response.body).toEqual({
        error: 'invalid_client',
        error_description: 'Client not found'
      });
    });

    it('should handle invalid redirect_uri', async () => {
      const authorizationResponse: AuthorizationResponse = {
        action: 'BAD_REQUEST',
        ticket: '',
        client: { clientId: 0, clientName: '' },
        service: { serviceName: '' },
        responseContent: JSON.stringify({
          error: 'invalid_request',
          error_description: 'Invalid redirect_uri'
        })
      };

      mockAuthleteClient.authorization.mockResolvedValue(authorizationResponse);

      const response = await request(app)
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: 'test-client',
          redirect_uri: 'invalid-uri'
        })
        .expect(400);

      expect(response.body).toEqual({
        error: 'invalid_request',
        error_description: 'Invalid redirect_uri'
      });
    });

    it('should handle missing required parameters', async () => {
      const authorizationResponse: AuthorizationResponse = {
        action: 'BAD_REQUEST',
        ticket: '',
        client: { clientId: 0, clientName: '' },
        service: { serviceName: '' },
        responseContent: JSON.stringify({
          error: 'invalid_request',
          error_description: 'Missing required parameters'
        })
      };

      mockAuthleteClient.authorization.mockResolvedValue(authorizationResponse);

      const response = await request(app)
        .get('/authorize')
        .query({
          // Missing response_type and client_id
          redirect_uri: 'https://client.example.com/callback'
        })
        .expect(400);

      expect(response.body).toEqual({
        error: 'invalid_request',
        error_description: 'Missing required parameters'
      });
    });
  });

  describe('Authentication Flow', () => {
    it('should handle invalid credentials', async () => {
      // Setup valid authorization request first
      const authorizationResponse: AuthorizationResponse = {
        action: 'INTERACTION',
        ticket: 'test-ticket',
        client: { clientId: 123, clientName: 'Test Client' },
        service: { serviceName: 'Test Service' }
      };

      mockAuthleteClient.authorization.mockResolvedValue(authorizationResponse);

      await request(app)
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: 'test-client'
        })
        .expect(302);

      // Try to login with invalid credentials
      const loginResponse = await request(app)
        .post('/login')
        .send({
          username: 'demo',
          password: 'wrongpassword'
        })
        .expect(302);

      // Should redirect back to login with error
      expect(loginResponse.headers.location).toBe('/login?error=invalid_credentials');

      // Check login page shows error message
      const loginPageResponse = await request(app)
        .get('/login?error=invalid_credentials')
        .expect(200);

      expect(loginPageResponse.text).toContain('Invalid username or password');
    });

    it('should handle empty credentials', async () => {
      const loginResponse = await request(app)
        .post('/login')
        .send({
          username: '',
          password: ''
        })
        .expect(302);

      expect(loginResponse.headers.location).toBe('/login?error=invalid_credentials');
    });
  });

  describe('Session Management', () => {
    it('should redirect authenticated user directly to consent', async () => {
      // Use agent to maintain session
      const agent = request.agent(app);
      
      // Setup authorization request
      const authorizationResponse: AuthorizationResponse = {
        action: 'INTERACTION',
        ticket: 'test-ticket',
        client: { clientId: 123, clientName: 'Test Client' },
        service: { serviceName: 'Test Service' }
      };

      mockAuthleteClient.authorization.mockResolvedValue(authorizationResponse);

      // First, authenticate user
      await agent
        .post('/login')
        .send({
          username: 'demo',
          password: 'password'
        })
        .expect(302);

      // Now make authorization request with authenticated session
      const authResponse = await agent
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: 'test-client'
        })
        .expect(302);

      // Should redirect directly to consent (skip login)
      expect(authResponse.headers.location).toBe('/consent');
    });

    it('should require authentication for consent page', async () => {
      const consentResponse = await request(app)
        .get('/consent')
        .expect(302);

      // Should redirect to login
      expect(consentResponse.headers.location).toBe('/login');
    });

    it('should require authorization ticket for consent', async () => {
      // Use agent to maintain session
      const agent = request.agent(app);
      
      // Login user first
      await agent
        .post('/login')
        .send({
          username: 'demo',
          password: 'password'
        })
        .expect(302);

      // Try to access consent without authorization ticket
      const consentResponse = await agent
        .get('/consent')
        .expect(400);

      expect(consentResponse.body).toEqual({
        error: 'invalid_request',
        error_description: 'Missing authorization context'
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle Authlete API errors gracefully', async () => {
      // Mock Authlete API error
      const apiError = new Error('Network error');
      apiError.name = 'AuthleteApiError';
      mockAuthleteClient.authorization.mockRejectedValue(apiError);

      const response = await request(app)
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: 'test-client'
        })
        .expect(400);

      expect(response.body).toEqual({
        error: 'server_error',
        error_description: 'Authorization server error'
      });
    });

    it('should handle authorization issue failures', async () => {
      // Use agent to maintain session
      const agent = request.agent(app);
      
      // Setup successful authorization request
      const authorizationResponse: AuthorizationResponse = {
        action: 'INTERACTION',
        ticket: 'test-ticket',
        client: { clientId: 123, clientName: 'Test Client' },
        service: { serviceName: 'Test Service' }
      };

      mockAuthleteClient.authorization.mockResolvedValue(authorizationResponse);

      await agent
        .get('/authorize')
        .query({
          response_type: 'code',
          client_id: 'test-client'
        })
        .expect(302);

      // Login user
      await agent
        .post('/login')
        .send({
          username: 'demo',
          password: 'password'
        })
        .expect(302);

      // Mock authorization issue failure
      const issueResponse: AuthorizationIssueResponse = {
        action: 'INTERNAL_SERVER_ERROR',
        responseContent: JSON.stringify({
          error: 'server_error',
          error_description: 'Failed to generate authorization code'
        })
      };

      mockAuthleteClient.authorizationIssue.mockResolvedValue(issueResponse);

      // Try to approve consent
      const consentResponse = await agent
        .post('/consent')
        .send({
          consent: 'approve'
        })
        .expect(500);

      expect(consentResponse.body).toEqual({
        error: 'server_error',
        error_description: 'Failed to issue authorization code'
      });
    });
  });
});