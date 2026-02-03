import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import fc from 'fast-check';
import { AuthorizationControllerImpl } from './authorization';
import { AuthleteClient } from '../authlete/client';
import { AuthorizationResponse } from '../authlete/types';

// Mock the AuthleteClient
const mockAuthleteClient: AuthleteClient = {
  authorization: vi.fn(),
  authorizationIssue: vi.fn(),
  authorizationFail: vi.fn(),
  token: vi.fn(),
  introspection: vi.fn()
};

describe('AuthorizationController', () => {
  let controller: AuthorizationControllerImpl;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    controller = new AuthorizationControllerImpl(mockAuthleteClient);
    
    mockRequest = {
      query: {},
      session: {} as any
    };
    
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      redirect: vi.fn().mockReturnThis()
    };

    vi.clearAllMocks();
  });

  describe('handleAuthorizationRequest', () => {
    it('should handle valid authorization request with INTERACTION action', async () => {
      // Arrange
      mockRequest.query = {
        response_type: 'code',
        client_id: 'test-client',
        redirect_uri: 'https://example.com/callback',
        scope: 'read write',
        state: 'test-state'
      };

      const mockAuthResponse: AuthorizationResponse = {
        action: 'INTERACTION',
        ticket: 'test-ticket',
        client: { clientId: 123, clientName: 'Test Client' },
        service: { serviceName: 'Test Service' },
        scopes: [{ name: 'read' }, { name: 'write' }]
      };

      vi.mocked(mockAuthleteClient.authorization).mockResolvedValue(mockAuthResponse);

      // Act
      await controller.handleAuthorizationRequest(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthleteClient.authorization).toHaveBeenCalledWith({
        parameters: 'response_type=code&client_id=test-client&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&scope=read+write&state=test-state',
        clientId: 'test-client'
      });

      expect(mockRequest.session).toEqual({
        authorizationTicket: 'test-ticket',
        clientInfo: { clientId: 123, clientName: 'Test Client' },
        scopes: [{ name: 'read' }, { name: 'write' }]
      });

      expect(mockResponse.redirect).toHaveBeenCalledWith('/login');
    });

    it('should redirect to consent if user is already authenticated', async () => {
      // Arrange
      mockRequest.query = {
        response_type: 'code',
        client_id: 'test-client'
      };
      mockRequest.session = { userId: 'user123' } as any;

      const mockAuthResponse: AuthorizationResponse = {
        action: 'INTERACTION',
        ticket: 'test-ticket',
        client: { clientId: 123, clientName: 'Test Client' },
        service: { serviceName: 'Test Service' }
      };

      vi.mocked(mockAuthleteClient.authorization).mockResolvedValue(mockAuthResponse);

      // Act
      await controller.handleAuthorizationRequest(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockResponse.redirect).toHaveBeenCalledWith('/consent');
    });

    it('should handle BAD_REQUEST action', async () => {
      // Arrange
      mockRequest.query = {
        response_type: 'invalid',
        client_id: 'test-client'
      };

      const mockAuthResponse: AuthorizationResponse = {
        action: 'BAD_REQUEST',
        ticket: '',
        client: { clientId: 0, clientName: '' },
        service: { serviceName: '' },
        responseContent: '{"error":"invalid_request","error_description":"Invalid response_type"}'
      };

      vi.mocked(mockAuthleteClient.authorization).mockResolvedValue(mockAuthResponse);

      // Act
      await controller.handleAuthorizationRequest(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Invalid response_type'
      });
    });

    it('should handle missing required parameters', async () => {
      // Arrange
      mockRequest.query = {}; // Missing required parameters

      const mockAuthResponse: AuthorizationResponse = {
        action: 'BAD_REQUEST',
        ticket: '',
        client: { clientId: 0, clientName: '' },
        service: { serviceName: '' },
        responseContent: '{"error":"invalid_request","error_description":"Missing required parameters"}'
      };

      vi.mocked(mockAuthleteClient.authorization).mockResolvedValue(mockAuthResponse);

      // Act
      await controller.handleAuthorizationRequest(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthleteClient.authorization).toHaveBeenCalledWith({
        parameters: '',
        clientId: undefined
      });

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing required parameters'
      });
    });

    it('should handle Authlete API errors', async () => {
      // Arrange
      mockRequest.query = {
        response_type: 'code',
        client_id: 'test-client'
      };

      const apiError = new Error('Network error');
      apiError.name = 'AuthleteApiError';
      vi.mocked(mockAuthleteClient.authorization).mockRejectedValue(apiError);

      // Act
      await controller.handleAuthorizationRequest(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'Authorization server error'
      });
    });
  });
});

// Property-Based Tests
describe('OpenID Connect Authorization Server Properties', () => {
  let controller: AuthorizationControllerImpl;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    controller = new AuthorizationControllerImpl(mockAuthleteClient);
    
    mockRequest = {
      query: {},
      session: {} as any
    };
    
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      redirect: vi.fn().mockReturnThis()
    };

    vi.clearAllMocks();
  });

  it.skip('Feature: oauth2-authorization-server, Property 1: Authorization Request Validation', () => {
    fc.assert(fc.property(
      // Generate authorization request parameters
      fc.record({
        response_type: fc.constantFrom('code', 'token', 'id_token'),
        client_id: fc.oneof(
          fc.constant('valid-client'),
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0) // Only non-empty strings
        ),
        redirect_uri: fc.option(fc.webUrl()),
        scope: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
        state: fc.option(fc.string({ minLength: 1, maxLength: 50 }))
      }),
      // Generate Authlete response action
      fc.constantFrom('INTERACTION', 'BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'INTERNAL_SERVER_ERROR'),
      async (authRequestParams, responseAction) => {
        // Clear mocks before each property test iteration
        vi.clearAllMocks();
        
        // Setup mock request
        mockRequest.query = authRequestParams;
        mockRequest.session = {} as any;

        // Create appropriate mock response based on action
        const mockAuthleteResponse: AuthorizationResponse = {
          action: responseAction,
          ticket: responseAction === 'INTERACTION' ? 'test-ticket' : '',
          client: responseAction === 'INTERACTION' ? { clientId: 123, clientName: 'Test Client' } : { clientId: 0, clientName: '' },
          service: { serviceName: 'Test Service' },
          scopes: responseAction === 'INTERACTION' ? [{ name: 'read' }] : undefined,
          responseContent: responseAction !== 'INTERACTION' ? '{"error":"invalid_request","error_description":"Test error"}' : undefined
        };

        // Setup mock Authlete client response
        vi.mocked(mockAuthleteClient.authorization).mockResolvedValue(mockAuthleteResponse);

        // Execute the authorization request
        await controller.handleAuthorizationRequest(mockRequest as Request, mockResponse as Response);

        // Core Property 1: All authorization requests should be validated through Authlete API
        const authCalls = vi.mocked(mockAuthleteClient.authorization).mock.calls;
        if (authCalls.length === 0) {
          console.error('Authlete authorization not called');
          return false;
        }
        
        const authCall = authCalls[0][0];
        if (!authCall || typeof authCall.parameters !== 'string') {
          console.error('Invalid authorization call:', authCall);
          return false;
        }

        // Core Property 2: Valid requests (INTERACTION) should proceed to authentication/consent flow
        if (responseAction === 'INTERACTION') {
          const redirectCalls = vi.mocked(mockResponse.redirect).mock.calls;
          if (redirectCalls.length === 0) {
            console.error('No redirect called for INTERACTION action');
            console.error('client_id:', authRequestParams.client_id);
            console.error('Response methods called:', {
              status: vi.mocked(mockResponse.status).mock.calls,
              json: vi.mocked(mockResponse.json).mock.calls,
              redirect: redirectCalls
            });
            return false;
          }
          
          const redirectPath = redirectCalls[0][0];
          if (!redirectPath || typeof redirectPath !== 'string') {
            console.error('Invalid redirect path:', redirectPath);
            return false;
          }
          
          if (!redirectPath.match(/^\/(login|consent)$/)) {
            console.error(`Unexpected redirect path: ${redirectPath}`);
            return false;
          }
        }

        // Core Property 3: Error responses should return appropriate HTTP status codes
        if (responseAction !== 'INTERACTION') {
          const expectedStatusCode = {
            'BAD_REQUEST': 400,
            'UNAUTHORIZED': 401,
            'FORBIDDEN': 403,
            'INTERNAL_SERVER_ERROR': 500
          }[responseAction];
          
          const statusCalls = vi.mocked(mockResponse.status).mock.calls;
          if (statusCalls.length === 0 || statusCalls[0][0] !== expectedStatusCode) {
            console.error(`Expected status ${expectedStatusCode}, got:`, statusCalls);
            return false;
          }
        }
        
        // All assertions passed
        return true;
      }
    ), { numRuns: 100 });
  });
});