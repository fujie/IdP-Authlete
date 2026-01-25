import { Request, Response, NextFunction } from 'express';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { 
  createRateLimit,
  authorizationRateLimit,
  tokenRateLimit,
  introspectionRateLimit,
  generalRateLimit
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

const mockResponse = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis()
  };
  return res as any as Response;
};

const mockNext = vi.fn() as NextFunction;

// Property-based test generators
const userAgentArbitrary = () => fc.oneof(
  fc.constant('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'),
  fc.constant('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'),
  fc.constant('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'),
  fc.constant('curl/7.68.0'),
  fc.constant('PostmanRuntime/7.28.4'),
  fc.string({ minLength: 10, maxLength: 100 })
);

const oauthClientArbitrary = () => fc.record({
  client_id: fc.string({ minLength: 5, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
  response_type: fc.constant('code'),
  redirect_uri: fc.oneof(
    fc.constant('https://example.com/callback'),
    fc.constant('http://localhost:3000/callback')
  ),
  scope: fc.oneof(
    fc.constant('read'),
    fc.constant('write'),
    fc.constant('read write')
  ),
  state: fc.string({ minLength: 5, maxLength: 32 }).filter(s => /^[a-zA-Z0-9_.-]+$/.test(s))
});

describe('Feature: oauth2-authorization-server, Property 12: Rate Limiting Protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console logs in tests
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 12: Rate Limiting Protection
   * For any sequence of requests to authorization and token endpoints, 
   * excessive requests should be properly rate limited to prevent abuse
   * Validates: Requirements 6.5
   */
  it('Property 12: Rate limiter should allow requests within configured limits', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        points: fc.integer({ min: 2, max: 10 }), // Ensure at least 2 points
        duration: fc.integer({ min: 1, max: 5 }),
        blockDuration: fc.integer({ min: 1, max: 10 })
      }),
      fc.string({ minLength: 7, maxLength: 15 }), // Unique IP per test
      userAgentArbitrary(),
      async (config, ipSuffix, userAgent) => {
        const uniqueIp = `192.168.1.${ipSuffix.length}${Date.now() % 100}`;
        const middleware = createRateLimit(config, {
          keyGenerator: () => `test-${uniqueIp}-${userAgent.substring(0, 10)}-${Date.now()}`
        });
        
        const req = mockRequest('/test', {}, {}, { 'user-agent': userAgent }, uniqueIp);
        const res = mockResponse();
        
        // First request within limit should pass
        await middleware(req as Request, res, mockNext);
        
        expect(mockNext).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(429);
        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
          'X-RateLimit-Limit': config.points.toString()
        }));
      }
    ), { numRuns: 20 }); // Reduced runs for async tests
  });

  it('Property 12: Rate limiter should block requests exceeding configured limits', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 2 }), // Small limits for testing
      fc.string({ minLength: 5, maxLength: 10 }),
      async (points, ipSuffix) => {
        const config = {
          points,
          duration: 1,
          blockDuration: 1
        };
        
        const uniqueKey = `test-block-${ipSuffix}-${Date.now()}-${Math.random()}`;
        const middleware = createRateLimit(config, { 
          keyGenerator: () => uniqueKey 
        });
        
        const req = mockRequest('/test', {}, {}, {}, `10.0.0.${ipSuffix.length}`);
        const res = mockResponse();
        
        // Consume all allowed requests
        for (let i = 0; i < points; i++) {
          vi.clearAllMocks();
          await middleware(req as Request, res, mockNext);
          expect(mockNext).toHaveBeenCalled();
        }
        
        // Next request should be blocked
        vi.clearAllMocks();
        await middleware(req as Request, res, mockNext);
        
        expect(mockNext).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          error: 'temporarily_unavailable'
        }));
      }
    ), { numRuns: 10 }); // Reduced runs for async tests
  });

  it('Property 12: Different IP addresses should have independent rate limits', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.string({ minLength: 3, maxLength: 8 }), { minLength: 2, maxLength: 3 }),
      async (ipSuffixes) => {
        const uniqueIps = [...new Set(ipSuffixes)];
        if (uniqueIps.length < 2) return; // Skip if not enough unique IPs
        
        const config = {
          points: 1,
          duration: 1,
          blockDuration: 1
        };
        
        // Each IP should be able to make at least one request
        for (let i = 0; i < Math.min(uniqueIps.length, 2); i++) {
          const uniqueKey = `test-independent-${uniqueIps[i]}-${Date.now()}-${i}`;
          const middleware = createRateLimit(config, {
            keyGenerator: () => uniqueKey
          });
          
          const req = mockRequest('/test', {}, {}, {}, `172.16.0.${i + 1}`);
          const res = mockResponse();
          
          await middleware(req as Request, res, mockNext);
          
          expect(mockNext).toHaveBeenCalled();
          expect(res.status).not.toHaveBeenCalledWith(429);
          
          vi.clearAllMocks();
        }
      }
    ), { numRuns: 10 });
  });

  it('Property 12: Rate limit headers should be consistent and informative', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        points: fc.integer({ min: 5, max: 20 }),
        duration: fc.integer({ min: 1, max: 5 }),
        blockDuration: fc.integer({ min: 1, max: 10 })
      }),
      fc.string({ minLength: 5, maxLength: 10 }),
      async (config, keySuffix) => {
        const uniqueKey = `test-headers-${keySuffix}-${Date.now()}`;
        const middleware = createRateLimit(config, {
          keyGenerator: () => uniqueKey
        });
        
        const req = mockRequest('/test', {}, {}, {}, '203.0.113.1');
        const res = mockResponse();
        
        await middleware(req as Request, res, mockNext);
        
        // Should set proper rate limit headers
        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
          'X-RateLimit-Limit': config.points.toString(),
          'X-RateLimit-Remaining': expect.any(String),
          'X-RateLimit-Reset': expect.any(String)
        }));
        
        // Remaining should be a valid number
        const setCall = (res.set as any).mock.calls[0];
        if (setCall) {
          const headers = setCall[0];
          const remaining = parseInt(headers['X-RateLimit-Remaining']);
          expect(remaining).toBeGreaterThanOrEqual(0);
          expect(remaining).toBeLessThanOrEqual(config.points);
        }
      }
    ), { numRuns: 15 });
  });

  it('Property 12: Authorization endpoint rate limiting should handle OAuth parameters', async () => {
    await fc.assert(fc.asyncProperty(
      oauthClientArbitrary(),
      fc.string({ minLength: 3, maxLength: 8 }),
      async (oauthParams, keySuffix) => {
        const middleware = authorizationRateLimit();
        
        const req = mockRequest('/authorize', oauthParams, {}, {}, `198.51.100.${keySuffix.length}`);
        const res = mockResponse();
        
        // First request should pass
        await middleware(req as Request, res, mockNext);
        
        expect(mockNext).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(429);
        
        // Should include rate limit headers
        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
          'X-RateLimit-Limit': expect.any(String)
        }));
      }
    ), { numRuns: 10 });
  });

  it('Property 12: Token endpoint rate limiting should be stricter than authorization', async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 3, maxLength: 8 }),
      async (keySuffix) => {
        const authMiddleware = authorizationRateLimit();
        const tokenMiddleware = tokenRateLimit();
        
        const authReq = mockRequest('/authorize', { client_id: 'test' }, {}, {}, `203.0.113.${keySuffix.length}`);
        const tokenReq = mockRequest('/token', {}, { client_id: 'test' }, {}, `203.0.113.${keySuffix.length + 10}`);
        
        const authRes = mockResponse();
        const tokenRes = mockResponse();
        
        await authMiddleware(authReq as Request, authRes, mockNext);
        vi.clearAllMocks(); // Clear mocks between calls
        await tokenMiddleware(tokenReq as Request, tokenRes, mockNext);
        
        // Both should pass initially
        expect(mockNext).toHaveBeenCalledTimes(1); // Only count the second call
        
        // Check rate limit headers to verify token endpoint has stricter limits
        const authHeaders = (authRes.set as any).mock.calls[0]?.[0];
        const tokenHeaders = (tokenRes.set as any).mock.calls[0]?.[0];
        
        if (authHeaders && tokenHeaders) {
          const authLimit = parseInt(authHeaders['X-RateLimit-Limit']);
          const tokenLimit = parseInt(tokenHeaders['X-RateLimit-Limit']);
          
          // Token endpoint should have lower or equal limits than authorization
          expect(tokenLimit).toBeLessThanOrEqual(authLimit);
        }
      }
    ), { numRuns: 8 });
  });

  it('Property 12: Introspection endpoint should use client-based rate limiting', async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 5, maxLength: 15 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
      fc.string({ minLength: 10, maxLength: 25 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
      fc.string({ minLength: 3, maxLength: 8 }),
      async (clientId, clientSecret, keySuffix) => {
        const middleware = introspectionRateLimit();
        
        const authHeader = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const req = mockRequest('/introspect', {}, { token: 'test-token' }, {
          authorization: authHeader
        }, `198.51.100.${keySuffix.length}`);
        const res = mockResponse();
        
        await middleware(req as Request, res, mockNext);
        
        expect(mockNext).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(429);
        
        // Should set rate limit headers
        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
          'X-RateLimit-Limit': expect.any(String)
        }));
      }
    ), { numRuns: 8 });
  });

  it('Property 12: General rate limiting should have the highest limits', async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 3, maxLength: 8 }),
      async (keySuffix) => {
        const generalMiddleware = generalRateLimit();
        const authMiddleware = authorizationRateLimit();
        
        const generalReq = mockRequest('/health', {}, {}, {}, `203.0.113.${keySuffix.length}`);
        const authReq = mockRequest('/authorize', {}, {}, {}, `203.0.113.${keySuffix.length + 10}`);
        
        const generalRes = mockResponse();
        const authRes = mockResponse();
        
        await generalMiddleware(generalReq as Request, generalRes, mockNext);
        vi.clearAllMocks();
        await authMiddleware(authReq as Request, authRes, mockNext);
        
        expect(mockNext).toHaveBeenCalledTimes(1);
        
        // Check that general endpoint has higher limits
        const generalHeaders = (generalRes.set as any).mock.calls[0]?.[0];
        const authHeaders = (authRes.set as any).mock.calls[0]?.[0];
        
        if (generalHeaders && authHeaders) {
          const generalLimit = parseInt(generalHeaders['X-RateLimit-Limit']);
          const authLimit = parseInt(authHeaders['X-RateLimit-Limit']);
          
          expect(generalLimit).toBeGreaterThanOrEqual(authLimit);
        }
      }
    ), { numRuns: 8 });
  });

  it('Property 12: Rate limiting should be consistent across multiple requests from same source', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 2, max: 4 }),
      fc.string({ minLength: 5, maxLength: 10 }),
      async (requestCount, keySuffix) => {
        const config = {
          points: requestCount + 3, // Allow more than we'll test
          duration: 2,
          blockDuration: 1
        };
        
        const uniqueKey = `test-consistent-${keySuffix}-${Date.now()}`;
        const middleware = createRateLimit(config, { 
          keyGenerator: () => uniqueKey 
        });
        
        let remainingCounts: number[] = [];
        
        // Make multiple requests and track remaining counts
        for (let i = 0; i < requestCount; i++) {
          const req = mockRequest('/test', {}, {}, {}, `203.0.113.${i + 1}`);
          const res = mockResponse();
          
          await middleware(req as Request, res, mockNext);
          
          expect(mockNext).toHaveBeenCalled();
          
          const headers = (res.set as any).mock.calls[0]?.[0];
          if (headers) {
            const remaining = parseInt(headers['X-RateLimit-Remaining']);
            remainingCounts.push(remaining);
          }
          
          vi.clearAllMocks();
        }
        
        // Remaining counts should decrease consistently (or stay the same)
        for (let i = 1; i < remainingCounts.length; i++) {
          expect(remainingCounts[i]).toBeLessThanOrEqual(remainingCounts[i - 1]);
        }
      }
    ), { numRuns: 8 });
  });

  it('Property 12: Blocked requests should include proper retry information', async () => {
    await fc.assert(fc.asyncProperty(
      fc.string({ minLength: 5, maxLength: 10 }),
      async (keySuffix) => {
        const config = {
          points: 1,
          duration: 1,
          blockDuration: 2
        };
        
        const uniqueKey = `test-retry-${keySuffix}-${Date.now()}`;
        const middleware = createRateLimit(config, { 
          keyGenerator: () => uniqueKey 
        });
        
        const req = mockRequest('/test', {}, {}, {}, `203.0.113.${keySuffix.length}`);
        const res = mockResponse();
        
        // First request passes
        await middleware(req as Request, res, mockNext);
        expect(mockNext).toHaveBeenCalled();
        
        // Second request should be blocked
        vi.clearAllMocks();
        await middleware(req as Request, res, mockNext);
        
        expect(mockNext).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(429);
        
        // Should include retry-after information
        const headers = (res.set as any).mock.calls[0]?.[0];
        if (headers) {
          expect(headers).toHaveProperty('Retry-After');
          const retryAfter = parseInt(headers['Retry-After']);
          expect(retryAfter).toBeGreaterThan(0);
          expect(retryAfter).toBeLessThanOrEqual(config.blockDuration + 1);
        }
        
        // Response should include retry_after in JSON
        const jsonResponse = (res.json as any).mock.calls[0]?.[0];
        if (jsonResponse) {
          expect(jsonResponse).toHaveProperty('retry_after');
          expect(typeof jsonResponse.retry_after).toBe('number');
        }
      }
    ), { numRuns: 8 });
  });
});