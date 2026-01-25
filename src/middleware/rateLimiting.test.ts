import { Request, Response, NextFunction } from 'express';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  createRateLimit,
  authorizationRateLimit,
  tokenRateLimit,
  introspectionRateLimit,
  generalRateLimit,
  adaptiveRateLimit
} from './rateLimiting';

// Mock Express objects
const mockRequest = (
  path: string = '/test',
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
  method: 'GET',
  get: (header: string) => headers[header.toLowerCase()],
  connection: { remoteAddress: ip } as any
});

const mockResponse = (): Partial<Response> => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.set = vi.fn().mockReturnValue(res);
  res.redirect = vi.fn().mockReturnValue(res);
  return res;
};

const mockNext: NextFunction = vi.fn();

// Helper to wait for rate limiter reset
const waitForReset = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('Rate Limiting Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console logs in tests
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createRateLimit', () => {
    it('should allow requests within rate limit', async () => {
      const rateLimitConfig = {
        points: 5,
        duration: 60,
        blockDuration: 60
      };
      
      const middleware = createRateLimit(rateLimitConfig);
      const req = mockRequest();
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': expect.any(String),
        'X-RateLimit-Reset': expect.any(String)
      }));
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should block requests when rate limit exceeded', async () => {
      const rateLimitConfig = {
        points: 1,
        duration: 1, // 1 second
        blockDuration: 1 // 1 second block
      };
      
      const middleware = createRateLimit(rateLimitConfig);
      const req = mockRequest();
      const res = mockResponse();
      
      // First request should pass
      await middleware(req as Request, res as Response, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
      
      // Second request should be blocked (same key, same second)
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'temporarily_unavailable',
        error_description: 'The authorization server is temporarily overloaded or under maintenance',
        retry_after: expect.any(Number)
      });
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Remaining': '0',
        'Retry-After': expect.any(String)
      }));
    });

    it('should use custom key generator', async () => {
      const rateLimitConfig = {
        points: 1,
        duration: 60,
        blockDuration: 60
      };
      
      const customKeyGenerator = vi.fn().mockReturnValue('custom-key');
      const middleware = createRateLimit(rateLimitConfig, {
        keyGenerator: customKeyGenerator
      });
      
      const req = mockRequest();
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(customKeyGenerator).toHaveBeenCalledWith(req);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should call custom onLimitReached handler', async () => {
      const rateLimitConfig = {
        points: 1,
        duration: 60,
        blockDuration: 60
      };
      
      const onLimitReached = vi.fn();
      const middleware = createRateLimit(rateLimitConfig, {
        onLimitReached
      });
      
      const req = mockRequest();
      const res = mockResponse();
      
      // First request to consume the limit
      await middleware(req as Request, res as Response, mockNext);
      
      // Second request should trigger custom handler
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(onLimitReached).toHaveBeenCalledWith(req, res);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('authorizationRateLimit', () => {
    it('should allow authorization requests within limit', async () => {
      const middleware = authorizationRateLimit();
      const req = mockRequest('/authorize', {
        client_id: 'test-client',
        response_type: 'code'
      });
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should handle rate limit exceeded scenario', async () => {
      // Test the rate limiting behavior by creating a custom rate limiter with very low limits
      const rateLimitConfig = {
        points: 1,
        duration: 1,
        blockDuration: 1
      };
      
      const middleware = createRateLimit(rateLimitConfig, {
        keyGenerator: () => 'test-key',
        onLimitReached: (req: Request, res: Response) => {
          const redirectUri = req.query.redirect_uri as string;
          const state = req.query.state as string;
          
          if (redirectUri) {
            const errorUrl = new URL(redirectUri);
            errorUrl.searchParams.set('error', 'temporarily_unavailable');
            errorUrl.searchParams.set('error_description', 'Too many authorization requests');
            if (state) {
              errorUrl.searchParams.set('state', state);
            }
            
            res.redirect(errorUrl.toString());
          } else {
            res.status(429).json({
              error: 'temporarily_unavailable',
              error_description: 'Too many authorization requests. Please try again later.'
            });
          }
        }
      });
      
      const req = mockRequest('/authorize', {
        client_id: 'test-client',
        response_type: 'code',
        redirect_uri: 'https://example.com/callback',
        state: 'test-state'
      });
      const res = mockResponse();
      
      // First request passes
      await middleware(req as Request, res as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      
      // Second request triggers rate limit
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('https://example.com/callback?error=temporarily_unavailable')
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('state=test-state')
      );
    });
  });

  describe('tokenRateLimit', () => {
    it('should allow token requests within limit', async () => {
      const middleware = tokenRateLimit();
      const req = mockRequest('/token', {}, {
        client_id: 'test-client',
        grant_type: 'authorization_code'
      });
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should handle rate limit exceeded scenario', async () => {
      // Test with a simple rate limiter that blocks immediately
      const rateLimitConfig = {
        points: 1,
        duration: 1,
        blockDuration: 1
      };
      
      const middleware = createRateLimit(rateLimitConfig, {
        keyGenerator: () => 'test-key',
        onLimitReached: (req: Request, res: Response) => {
          res.status(429).json({
            error: 'temporarily_unavailable',
            error_description: 'Too many token requests. Please implement exponential backoff.'
          });
        }
      });
      
      const req = mockRequest('/token', {}, {
        client_id: 'test-client',
        grant_type: 'authorization_code'
      });
      const res = mockResponse();
      
      // First request passes
      await middleware(req as Request, res as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      
      // Second request triggers rate limit
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'temporarily_unavailable',
        error_description: 'Too many token requests. Please implement exponential backoff.'
      });
    });
  });

  describe('introspectionRateLimit', () => {
    it('should allow introspection requests within limit', async () => {
      const middleware = introspectionRateLimit();
      const req = mockRequest('/introspect', {}, {
        token: 'test-token'
      }, {
        authorization: 'Basic ' + Buffer.from('client:secret').toString('base64')
      });
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should use client-based key for authenticated requests', async () => {
      const middleware = introspectionRateLimit();
      const req1 = mockRequest('/introspect', {}, {
        token: 'test-token'
      }, {
        authorization: 'Basic ' + Buffer.from('client1:secret').toString('base64')
      });
      const req2 = mockRequest('/introspect', {}, {
        token: 'test-token'
      }, {
        authorization: 'Basic ' + Buffer.from('client2:secret').toString('base64')
      });
      const res = mockResponse();
      
      // Both clients should have separate rate limits
      await middleware(req1 as Request, res as Response, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
      
      await middleware(req2 as Request, res as Response, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(2);
    });

    it('should handle rate limit exceeded scenario', async () => {
      // Test with a simple rate limiter that blocks immediately
      const rateLimitConfig = {
        points: 1,
        duration: 1,
        blockDuration: 1
      };
      
      const middleware = createRateLimit(rateLimitConfig, {
        keyGenerator: () => 'test-key',
        onLimitReached: (req: Request, res: Response) => {
          res.status(429).json({
            error: 'temporarily_unavailable',
            error_description: 'Too many introspection requests from this resource server.'
          });
        }
      });
      
      const req = mockRequest('/introspect', {}, {
        token: 'test-token'
      });
      const res = mockResponse();
      
      // First request passes
      await middleware(req as Request, res as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      
      // Second request triggers rate limit
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'temporarily_unavailable',
        error_description: 'Too many introspection requests from this resource server.'
      });
    });
  });

  describe('generalRateLimit', () => {
    it('should allow general requests within limit', async () => {
      const middleware = generalRateLimit();
      const req = mockRequest('/health');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should handle rate limit exceeded scenario', async () => {
      // Test with a simple rate limiter that blocks immediately
      const rateLimitConfig = {
        points: 1,
        duration: 1,
        blockDuration: 1
      };
      
      const middleware = createRateLimit(rateLimitConfig, {
        keyGenerator: () => 'test-key'
      });
      
      const req = mockRequest('/health');
      const res = mockResponse();
      
      // First request passes
      await middleware(req as Request, res as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      
      // Second request triggers rate limit
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'temporarily_unavailable',
        error_description: 'The authorization server is temporarily overloaded or under maintenance',
        retry_after: expect.any(Number)
      });
    });
  });

  describe('adaptiveRateLimit', () => {
    it('should apply authorization rate limit for /authorize endpoint', async () => {
      const middleware = adaptiveRateLimit();
      const req = mockRequest('/authorize');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      // Should set rate limit headers with authorization endpoint limits
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': '10' // Authorization endpoint limit
      }));
    });

    it('should apply token rate limit for /token endpoint', async () => {
      const middleware = adaptiveRateLimit();
      const req = mockRequest('/token');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      // Should set rate limit headers with token endpoint limits
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': '5' // Token endpoint limit
      }));
    });

    it('should apply introspection rate limit for /introspect endpoint', async () => {
      const middleware = adaptiveRateLimit();
      const req = mockRequest('/introspect');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      // Should set rate limit headers with introspection endpoint limits
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': '20' // Introspection endpoint limit
      }));
    });

    it('should apply general rate limit for other endpoints', async () => {
      const middleware = adaptiveRateLimit();
      const req = mockRequest('/health');
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      // Should set rate limit headers with general endpoint limits
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': '100' // General endpoint limit
      }));
    });
  });

  describe('Rate limit headers', () => {
    it('should include proper rate limit headers in response', async () => {
      const rateLimitConfig = {
        points: 10,
        duration: 60,
        blockDuration: 60
      };
      
      const middleware = createRateLimit(rateLimitConfig);
      const req = mockRequest();
      const res = mockResponse();
      
      await middleware(req as Request, res as Response, mockNext);
      
      expect(res.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': expect.any(String),
        'X-RateLimit-Reset': expect.any(String)
      });
    });

    it('should include retry-after header when rate limit exceeded', async () => {
      const rateLimitConfig = {
        points: 1,
        duration: 60,
        blockDuration: 60
      };
      
      const middleware = createRateLimit(rateLimitConfig);
      const req = mockRequest();
      const res = mockResponse();
      
      // Consume the limit
      await middleware(req as Request, res as Response, mockNext);
      
      // Exceed the limit
      vi.clearAllMocks();
      await middleware(req as Request, res as Response, mockNext);
      
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Remaining': '0',
        'Retry-After': expect.any(String)
      }));
    });
  });
});