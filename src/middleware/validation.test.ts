import { Request, Response, NextFunction } from 'express';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  validateInput, 
  validateAuthorizationRequest, 
  validateTokenRequest,
  validateIntrospectionRequest 
} from './validation';

// Mock Express objects
const mockRequest = (query: any = {}, body: any = {}, headers: any = {}): Partial<Request> => ({
  query,
  body,
  headers,
  get: (header: string) => headers[header.toLowerCase()],
  ip: '127.0.0.1',
  path: '/test',
  method: 'GET',
  connection: { remoteAddress: '127.0.0.1' } as any
});

const mockResponse = (): Partial<Response> => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const mockNext: NextFunction = vi.fn();

describe('Input Validation Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.warn for security events in tests
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateInput', () => {
    it('should pass valid OAuth parameters', () => {
      const req = mockRequest({
        response_type: 'code',
        client_id: 'test-client',
        redirect_uri: 'https://example.com/callback',
        scope: 'read write',
        state: 'random-state-123'
      });
      const res = mockResponse();
      
      validateInput()(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should sanitize string inputs', () => {
      const req = mockRequest({
        state: '  test-state  \n\r\t  '
      });
      const res = mockResponse();
      
      validateInput()(req as Request, res as Response, mockNext);
      
      expect(req.query.state).toBe('test-state');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should detect and reject SQL injection attempts', () => {
      const req = mockRequest({
        client_id: "'; DROP TABLE users; --"
      });
      const res = mockResponse();
      
      validateInput()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Request contains invalid characters'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should detect and reject XSS attempts', () => {
      const req = mockRequest({
        state: '<script>alert("xss")</script>'
      });
      const res = mockResponse();
      
      validateInput()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Request contains invalid characters'
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should detect and reject command injection attempts', () => {
      const req = mockRequest({
        redirect_uri: 'https://example.com/callback; rm -rf /'
      });
      const res = mockResponse();
      
      validateInput()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should validate OAuth parameter formats', () => {
      const req = mockRequest({
        response_type: 'invalid_type',
        client_id: 'valid-client'
      });
      const res = mockResponse();
      
      validateInput()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Request parameters are invalid',
        validation_errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'response_type',
            message: 'Invalid response_type. Must be code, token, or id_token'
          })
        ])
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should validate redirect_uri format', () => {
      const req = mockRequest({
        redirect_uri: 'invalid-uri'
      });
      const res = mockResponse();
      
      validateInput()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Request parameters are invalid',
        validation_errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'redirect_uri',
            message: 'Invalid redirect_uri format'
          })
        ])
      });
    });

    it('should validate scope format', () => {
      const req = mockRequest({
        scope: 'valid-scope invalid@scope'
      });
      const res = mockResponse();
      
      validateInput()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Request parameters are invalid',
        validation_errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'scope',
            message: 'Invalid scope format: invalid@scope'
          })
        ])
      });
    });
  });

  describe('validateAuthorizationRequest', () => {
    it('should pass valid authorization request', () => {
      const req = mockRequest({
        response_type: 'code',
        client_id: 'test-client'
      });
      const res = mockResponse();
      
      validateAuthorizationRequest()(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject request missing required parameters', () => {
      const req = mockRequest({
        client_id: 'test-client'
        // Missing response_type
      });
      const res = mockResponse();
      
      validateAuthorizationRequest()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Authorization request is invalid',
        validation_errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'response_type',
            message: 'Missing required parameter: response_type'
          })
        ])
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject unsupported response_type', () => {
      const req = mockRequest({
        response_type: 'token',
        client_id: 'test-client'
      });
      const res = mockResponse();
      
      validateAuthorizationRequest()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Authorization request is invalid',
        validation_errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'response_type',
            message: 'Only authorization code flow (response_type=code) is supported'
          })
        ])
      });
    });
  });

  describe('validateTokenRequest', () => {
    it('should pass valid token request', () => {
      const req = mockRequest({}, {
        grant_type: 'authorization_code',
        code: 'test-code'
      }, {
        'content-type': 'application/x-www-form-urlencoded'
      });
      const res = mockResponse();
      
      validateTokenRequest()(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject request with wrong content type', () => {
      const req = mockRequest({}, {
        grant_type: 'authorization_code',
        code: 'test-code'
      }, {
        'content-type': 'application/json'
      });
      const res = mockResponse();
      
      validateTokenRequest()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Token request is invalid',
        validation_errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'content-type',
            message: 'Content-Type must be application/x-www-form-urlencoded'
          })
        ])
      });
    });

    it('should reject request missing grant_type', () => {
      const req = mockRequest({}, {
        code: 'test-code'
      }, {
        'content-type': 'application/x-www-form-urlencoded'
      });
      const res = mockResponse();
      
      validateTokenRequest()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Token request is invalid',
        validation_errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'grant_type',
            message: 'Missing required parameter: grant_type'
          })
        ])
      });
    });

    it('should reject authorization_code grant without code', () => {
      const req = mockRequest({}, {
        grant_type: 'authorization_code'
      }, {
        'content-type': 'application/x-www-form-urlencoded'
      });
      const res = mockResponse();
      
      validateTokenRequest()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Token request is invalid',
        validation_errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'code',
            message: 'Missing required parameter: code for authorization_code grant'
          })
        ])
      });
    });
  });

  describe('validateIntrospectionRequest', () => {
    it('should pass valid introspection request', () => {
      const req = mockRequest({}, {
        token: 'valid-token-123'
      });
      const res = mockResponse();
      
      validateIntrospectionRequest()(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject request missing token', () => {
      const req = mockRequest({}, {});
      const res = mockResponse();
      
      validateIntrospectionRequest()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Introspection request is invalid',
        validation_errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'token',
            message: 'Missing required parameter: token'
          })
        ])
      });
    });

    it('should reject request with invalid token format', () => {
      const req = mockRequest({}, {
        token: 'invalid@token#format'
      });
      const res = mockResponse();
      
      validateIntrospectionRequest()(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Introspection request is invalid',
        validation_errors: expect.arrayContaining([
          expect.objectContaining({
            field: 'token',
            message: 'Invalid token format'
          })
        ])
      });
    });
  });
});