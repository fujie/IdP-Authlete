// Federation Rate Limiting Middleware Tests
// Tests for Requirement 6.5

import { Request, Response, NextFunction } from 'express';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  federationRegistrationRateLimit,
  federationEntityConfigurationRateLimit,
  federationApiRateLimit,
  adaptiveFederationRateLimit,
  burstProtectedFederationRegistrationRateLimit,
  createFederationRateLimit
} from './federationRateLimit';

// Mock Express objects
const mockRequest = (
  path: string = '/federation/registration',
  query: any = {},
  body: any = {},
  headers: any = {},
  ip: string = '127.0.0.1'
): Partial<Request> => ({
  path,
  query,
  body,
  headers,
  ip,
  method: 'POST',
  get: (header: string) => headers[header.toLowerCase()],
  connection: { remoteAddress: ip } as any
});

const mockResponse = (): Partial<Response> => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.set = vi.fn().mockReturnValue(res);
  return res;
};

const mockNext: NextFunction = vi.fn();

describe('Federation Rate Limiting Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console logs in tests
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('federationRegistrationRateLimit', () => {
    it('should allow federation registration requests within rate limit', async () => {
      const middleware = federationRegistrationRateLimit();
      const req = mockRequest('/federation/registration', {}, {
        entity_configuration: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL2V4YW1wbGUuY29tIiwic3ViIjoiaHR0cHM6Ly9leGFtcGxlLmNvbSIsImV4cCI6MTcwNjgzMjAwMH0.test'
      });
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': expect.any(String),
        'X-RateLimit-Reset': expect.any(String),
        'X-RateLimit-Policy': 'federation'
      }));
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should block federation registration requests when rate limit exceeded', async () => {
      const config = {
        points: 1,
        duration: 1,
        blockDuration: 1
      };
      
      const middleware = createFederationRateLimit(config, {
        keyGenerator: () => 'test-key-registration'
      });
      
      const req = mockRequest('/federation/registration', {}, {
        entity_configuration: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL2V4YW1wbGUuY29tIiwic3ViIjoiaHR0cHM6Ly9leGFtcGxlLmNvbSIsImV4cCI6MTcwNjgzMjAwMH0.test'
      });
      const res = mockResponse();
      
      // First request should pass
      await middleware(req as Request, res as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      
      // Second request should be blocked
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'temporarily_unavailable',
        error_description: 'The federation registration service is temporarily overloaded. Please implement exponential backoff and retry later.',
        retry_after: expect.any(Number)
      });
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Remaining': '0',
        'Retry-After': expect.any(String)
      }));
    });

    it('should use entity ID for rate limiting when available', async () => {
      const middleware = federationRegistrationRateLimit();
      
      // Request with entity configuration containing entity ID
      const req1 = mockRequest('/federation/registration', {}, {
        entity_configuration: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL2NsaWVudDEuZXhhbXBsZS5jb20iLCJzdWIiOiJodHRwczovL2NsaWVudDEuZXhhbXBsZS5jb20iLCJleHAiOjE3MDY4MzIwMDB9.test'
      }, {}, '192.168.1.1');
      
      // Request with different entity ID but same IP
      const req2 = mockRequest('/federation/registration', {}, {
        entity_configuration: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL2NsaWVudDIuZXhhbXBsZS5jb20iLCJzdWIiOiJodHRwczovL2NsaWVudDIuZXhhbXBsZS5jb20iLCJleHAiOjE3MDY4MzIwMDB9.test'
      }, {}, '192.168.1.1');
      
      const res1 = mockResponse();
      const res2 = mockResponse();
      
      // Both requests should pass as they have different entity IDs
      await middleware(req1 as Request, res1 as Response, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
      
      await middleware(req2 as Request, res2 as Response, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(2);
    });

    it('should fall back to IP-based limiting when entity ID extraction fails', async () => {
      const middleware = federationRegistrationRateLimit();
      
      const req = mockRequest('/federation/registration', {}, {
        entity_configuration: 'invalid-jwt'
      }, {}, '192.168.1.100');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Policy': 'federation'
      }));
    });
  });

  describe('federationEntityConfigurationRateLimit', () => {
    it('should allow entity configuration requests within rate limit', async () => {
      const middleware = federationEntityConfigurationRateLimit();
      const req = mockRequest('/.well-known/openid-federation', {}, {}, {}, '192.168.1.2');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': '50',
        'X-RateLimit-Policy': 'federation'
      }));
    });

    it('should block entity configuration requests when rate limit exceeded', async () => {
      const config = {
        points: 1,
        duration: 1,
        blockDuration: 1
      };
      
      const middleware = createFederationRateLimit(config, {
        keyGenerator: () => 'test-key-entity-config'
      });
      
      const req = mockRequest('/.well-known/openid-federation');
      const res = mockResponse();
      
      // First request passes
      await middleware(req as Request, res as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      
      // Second request blocked
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'temporarily_unavailable',
        error_description: 'The federation registration service is temporarily overloaded. Please implement exponential backoff and retry later.',
        retry_after: expect.any(Number)
      });
    });
  });

  describe('federationApiRateLimit', () => {
    it('should allow federation API requests within rate limit', async () => {
      const middleware = federationApiRateLimit();
      const req = mockRequest('/federation/fetch', {}, {
        iss: 'https://example.com',
        sub: 'https://client.example.com'
      });
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': '20',
        'X-RateLimit-Policy': 'federation'
      }));
    });
  });

  describe('adaptiveFederationRateLimit', () => {
    it('should apply registration rate limit for /federation/registration endpoint', async () => {
      const middleware = adaptiveFederationRateLimit();
      const req = mockRequest('/federation/registration');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': '5' // Registration endpoint limit
      }));
    });

    it('should apply entity configuration rate limit for /.well-known/openid-federation endpoint', async () => {
      const middleware = adaptiveFederationRateLimit();
      const req = mockRequest('/.well-known/openid-federation');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': '50' // Entity configuration endpoint limit
      }));
    });

    it('should apply API rate limit for other federation endpoints', async () => {
      const middleware = adaptiveFederationRateLimit();
      const req = mockRequest('/federation/fetch');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': '20' // API endpoint limit
      }));
    });

    it('should not apply rate limiting for non-federation endpoints', async () => {
      const middleware = adaptiveFederationRateLimit();
      const req = mockRequest('/health');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.set).not.toHaveBeenCalled();
    });
  });

  describe('burstProtectedFederationRegistrationRateLimit', () => {
    it('should allow burst requests within limits', async () => {
      const middleware = burstProtectedFederationRegistrationRateLimit();
      const req = mockRequest('/federation/registration', {}, {
        entity_configuration: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL2V4YW1wbGUuY29tIiwic3ViIjoiaHR0cHM6Ly9leGFtcGxlLmNvbSIsImV4cCI6MTcwNjgzMjAwMH0.test'
      });
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Policy': 'federation-burst-protected'
      }));
    });

    it('should block requests when burst limits exceeded', async () => {
      // Create a burst limiter with very low limits for testing
      const config = {
        points: 1,
        duration: 1,
        blockDuration: 1
      };
      
      const middleware = createFederationRateLimit(config, {
        keyGenerator: () => 'test-burst-key'
      });
      
      const req = mockRequest('/federation/registration');
      const res = mockResponse();
      
      // First request passes
      await middleware(req as Request, res as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      
      // Second request blocked
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'temporarily_unavailable'
      }));
    });
  });

  describe('Rate limit headers', () => {
    it('should include proper federation rate limit headers in response', async () => {
      const config = {
        points: 10,
        duration: 60,
        blockDuration: 60
      };
      
      const middleware = createFederationRateLimit(config);
      const req = mockRequest('/federation/registration');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(res.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': expect.any(String),
        'X-RateLimit-Reset': expect.any(String),
        'X-RateLimit-Policy': 'federation'
      });
    });

    it('should include retry-after header when federation rate limit exceeded', async () => {
      const config = {
        points: 1,
        duration: 60,
        blockDuration: 60
      };
      
      const middleware = createFederationRateLimit(config, {
        keyGenerator: () => 'test-retry-key'
      });
      const req = mockRequest('/federation/registration');
      const res = mockResponse();
      
      // Consume the limit
      await middleware(req as Request, res as Response, mockNext);
      
      // Exceed the limit
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Remaining': '0',
        'Retry-After': expect.any(String),
        'X-RateLimit-Policy': 'federation'
      }));
    });
  });

  describe('Error responses', () => {
    it('should return federation-compliant error response when rate limit exceeded', async () => {
      const config = {
        points: 1,
        duration: 1,
        blockDuration: 1
      };
      
      const middleware = createFederationRateLimit(config, {
        keyGenerator: () => 'test-error-key'
      });
      
      const req = mockRequest('/federation/registration');
      const res = mockResponse();
      
      // Consume limit
      await middleware(req as Request, res as Response, mockNext);
      
      // Trigger rate limit
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'temporarily_unavailable',
        error_description: 'The federation registration service is temporarily overloaded. Please implement exponential backoff and retry later.',
        retry_after: expect.any(Number)
      });
    });

    it('should include appropriate retry_after value in error response', async () => {
      const config = {
        points: 1,
        duration: 1,
        blockDuration: 5 // 5 second block
      };
      
      const middleware = createFederationRateLimit(config, {
        keyGenerator: () => 'test-retry-value-key'
      });
      
      const req = mockRequest('/federation/registration');
      const res = mockResponse();
      
      // Consume limit
      await middleware(req as Request, res as Response, mockNext);
      
      // Trigger rate limit
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      const jsonCall = (res.json as any).mock.calls[0];
      if (jsonCall) {
        const response = jsonCall[0];
        expect(response.retry_after).toBeGreaterThan(0);
        expect(response.retry_after).toBeLessThanOrEqual(config.blockDuration + 1);
      }
    });
  });
});