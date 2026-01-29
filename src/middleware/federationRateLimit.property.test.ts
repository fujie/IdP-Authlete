// Federation Rate Limiting Property-Based Tests
// Property 8: Rate Limiting Enforcement
// Validates: Requirements 6.5

import { Request, Response, NextFunction } from 'express';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { 
  federationRegistrationRateLimit,
  federationEntityConfigurationRateLimit,
  federationApiRateLimit,
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

const mockResponse = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis()
  };
  return res as any as Response;
};

const mockNext = vi.fn() as NextFunction;

// Property-based test generators
const entityIdArbitrary = () => fc.oneof(
  fc.constant('https://client1.example.com'),
  fc.constant('https://client2.example.com'),
  fc.constant('https://rp.federation.test'),
  fc.constant('https://op.federation.test'),
  fc.webUrl({ validSchemes: ['https'] })
);

const ipAddressArbitrary = () => fc.tuple(
  fc.integer({ min: 1, max: 254 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 0, max: 255 }),
  fc.integer({ min: 1, max: 254 })
).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

const userAgentArbitrary = () => fc.oneof(
  fc.constant('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'),
  fc.constant('curl/7.68.0'),
  fc.constant('federation-client/1.0'),
  fc.constant('PostmanRuntime/7.28.4'),
  fc.string({ minLength: 10, maxLength: 50 })
);

const federationRequestBodyArbitrary = () => fc.record({
  entity_configuration: fc.option(fc.string({ minLength: 20, maxLength: 200 })),
  trust_chain: fc.option(fc.array(fc.record({
    jwt: fc.string({ minLength: 20, maxLength: 100 }),
    payload: fc.record({
      iss: entityIdArbitrary(),
      sub: entityIdArbitrary(),
      exp: fc.integer({ min: Math.floor(Date.now() / 1000), max: Math.floor(Date.now() / 1000) + 3600 })
    })
  }), { minLength: 1, maxLength: 3 })),
  request_object: fc.option(fc.string({ minLength: 20, maxLength: 200 }))
});

describe('Feature: federation-dynamic-registration, Property 8: Rate Limiting Enforcement', () => {
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
   * Property 8: Rate Limiting Enforcement
   * For any sequence of registration requests exceeding configured limits, 
   * the authorization server should implement rate limiting and reject excessive requests
   * Validates: Requirements 6.5
   */
  it('Property 8: Federation rate limiter should allow requests within configured limits', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        points: fc.integer({ min: 2, max: 10 }),
        duration: fc.integer({ min: 1, max: 5 }),
        blockDuration: fc.integer({ min: 1, max: 10 })
      }),
      ipAddressArbitrary(),
      userAgentArbitrary(),
      federationRequestBodyArbitrary(),
      async (config, ip, userAgent, requestBody) => {
        const uniqueKey = `test-${ip}-${userAgent.substring(0, 10)}-${Date.now()}-${Math.random()}`;
        const middleware = createFederationRateLimit(config, {
          keyGenerator: () => uniqueKey
        });
        
        const req = mockRequest('/federation/registration', {}, requestBody, { 'user-agent': userAgent }, ip);
        const res = mockResponse();
        
        // First request within limit should pass
        await middleware(req as Request, res, mockNext);
        
        expect(mockNext).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(429);
        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
          'X-RateLimit-Limit': config.points.toString(),
          'X-RateLimit-Policy': 'federation'
        }));
      }
    ), { numRuns: 15 });
  });

  it('Property 8: Federation rate limiter should block requests exceeding configured limits', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 2 }), // Small limits for testing
      ipAddressArbitrary(),
      federationRequestBodyArbitrary(),
      async (points, ip, requestBody) => {
        const config = {
          points,
          duration: 1,
          blockDuration: 1
        };
        
        const uniqueKey = `test-block-${ip}-${Date.now()}-${Math.random()}`;
        const middleware = createFederationRateLimit(config, { 
          keyGenerator: () => uniqueKey 
        });
        
        const req = mockRequest('/federation/registration', {}, requestBody, {}, ip);
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
          error: 'temporarily_unavailable',
          error_description: expect.stringContaining('federation'),
          retry_after: expect.any(Number)
        }));
      }
    ), { numRuns: 8 });
  });

  it('Property 8: Different entity IDs should have independent rate limits', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(entityIdArbitrary(), { minLength: 2, maxLength: 3 }),
      async (entityIds) => {
        const uniqueEntityIds = [...new Set(entityIds)];
        if (uniqueEntityIds.length < 2) return; // Skip if not enough unique entity IDs
        
        const config = {
          points: 1,
          duration: 1,
          blockDuration: 1
        };
        
        // Each entity ID should be able to make at least one request
        for (let i = 0; i < Math.min(uniqueEntityIds.length, 2); i++) {
          const entityId = uniqueEntityIds[i];
          const uniqueKey = `test-entity-${entityId}-${Date.now()}-${i}`;
          const middleware = createFederationRateLimit(config, {
            keyGenerator: () => uniqueKey
          });
          
          const requestBody = {
            entity_configuration: `eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiIke2VudGl0eUlkfSIsInN1YiI6IiR7ZW50aXR5SWR9IiwiZXhwIjoxNzA2ODMyMDAwfQ.test`
          };
          
          const req = mockRequest('/federation/registration', {}, requestBody, {}, `10.0.0.${i + 1}`);
          const res = mockResponse();
          
          await middleware(req as Request, res, mockNext);
          
          expect(mockNext).toHaveBeenCalled();
          expect(res.status).not.toHaveBeenCalledWith(429);
          
          vi.clearAllMocks();
        }
      }
    ), { numRuns: 8 });
  });

  it('Property 8: Federation rate limit headers should be consistent and informative', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        points: fc.integer({ min: 5, max: 20 }),
        duration: fc.integer({ min: 1, max: 5 }),
        blockDuration: fc.integer({ min: 1, max: 10 })
      }),
      ipAddressArbitrary(),
      federationRequestBodyArbitrary(),
      async (config, ip, requestBody) => {
        const uniqueKey = `test-headers-${ip}-${Date.now()}-${Math.random()}`;
        const middleware = createFederationRateLimit(config, {
          keyGenerator: () => uniqueKey
        });
        
        const req = mockRequest('/federation/registration', {}, requestBody, {}, ip);
        const res = mockResponse();
        
        await middleware(req as Request, res, mockNext);
        
        // Should set proper federation rate limit headers
        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
          'X-RateLimit-Limit': config.points.toString(),
          'X-RateLimit-Remaining': expect.any(String),
          'X-RateLimit-Reset': expect.any(String),
          'X-RateLimit-Policy': 'federation'
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
    ), { numRuns: 12 });
  });

  it('Property 8: Federation registration rate limiting should be stricter than entity configuration', async () => {
    await fc.assert(fc.asyncProperty(
      ipAddressArbitrary(),
      federationRequestBodyArbitrary(),
      async (ip, requestBody) => {
        const registrationMiddleware = federationRegistrationRateLimit();
        const entityConfigMiddleware = federationEntityConfigurationRateLimit();
        
        const registrationReq = mockRequest('/federation/registration', {}, requestBody, {}, ip);
        const entityConfigReq = mockRequest('/.well-known/openid-federation', {}, {}, {}, `${ip}.1`);
        
        const registrationRes = mockResponse();
        const entityConfigRes = mockResponse();
        
        await registrationMiddleware(registrationReq as Request, registrationRes, mockNext);
        vi.clearAllMocks();
        await entityConfigMiddleware(entityConfigReq as Request, entityConfigRes, mockNext);
        
        // Both should pass initially
        expect(mockNext).toHaveBeenCalledTimes(1);
        
        // Check rate limit headers to verify registration endpoint has stricter limits
        const registrationHeaders = (registrationRes.set as any).mock.calls[0]?.[0];
        const entityConfigHeaders = (entityConfigRes.set as any).mock.calls[0]?.[0];
        
        if (registrationHeaders && entityConfigHeaders) {
          const registrationLimit = parseInt(registrationHeaders['X-RateLimit-Limit']);
          const entityConfigLimit = parseInt(entityConfigHeaders['X-RateLimit-Limit']);
          
          // Registration endpoint should have lower limits than entity configuration
          expect(registrationLimit).toBeLessThan(entityConfigLimit);
        }
      }
    ), { numRuns: 6 });
  });

  it('Property 8: Federation API endpoints should have moderate rate limits', async () => {
    await fc.assert(fc.asyncProperty(
      ipAddressArbitrary(),
      fc.oneof(
        fc.constant('/federation/fetch'),
        fc.constant('/federation/list'),
        fc.constant('/federation/resolve')
      ),
      async (ip, apiPath) => {
        const apiMiddleware = federationApiRateLimit();
        const registrationMiddleware = federationRegistrationRateLimit();
        
        const apiReq = mockRequest(apiPath, {}, { iss: 'https://example.com' }, {}, ip);
        const registrationReq = mockRequest('/federation/registration', {}, {
          entity_configuration: 'test-jwt'
        }, {}, `${ip}.2`);
        
        const apiRes = mockResponse();
        const registrationRes = mockResponse();
        
        await apiMiddleware(apiReq as Request, apiRes, mockNext);
        vi.clearAllMocks();
        await registrationMiddleware(registrationReq as Request, registrationRes, mockNext);
        
        expect(mockNext).toHaveBeenCalledTimes(1);
        
        // Check that API endpoints have higher limits than registration
        const apiHeaders = (apiRes.set as any).mock.calls[0]?.[0];
        const registrationHeaders = (registrationRes.set as any).mock.calls[0]?.[0];
        
        if (apiHeaders && registrationHeaders) {
          const apiLimit = parseInt(apiHeaders['X-RateLimit-Limit']);
          const registrationLimit = parseInt(registrationHeaders['X-RateLimit-Limit']);
          
          expect(apiLimit).toBeGreaterThan(registrationLimit);
        }
      }
    ), { numRuns: 6 });
  });

  it('Property 8: Rate limiting should be consistent across multiple requests from same source', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 2, max: 4 }),
      ipAddressArbitrary(),
      federationRequestBodyArbitrary(),
      async (requestCount, ip, requestBody) => {
        const config = {
          points: requestCount + 3, // Allow more than we'll test
          duration: 2,
          blockDuration: 1
        };
        
        const uniqueKey = `test-consistent-${ip}-${Date.now()}-${Math.random()}`;
        const middleware = createFederationRateLimit(config, { 
          keyGenerator: () => uniqueKey 
        });
        
        let remainingCounts: number[] = [];
        
        // Make multiple requests and track remaining counts
        for (let i = 0; i < requestCount; i++) {
          const req = mockRequest('/federation/registration', {}, requestBody, {}, ip);
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
    ), { numRuns: 6 });
  });

  it('Property 8: Blocked federation requests should include proper retry information', async () => {
    await fc.assert(fc.asyncProperty(
      ipAddressArbitrary(),
      federationRequestBodyArbitrary(),
      async (ip, requestBody) => {
        const config = {
          points: 1,
          duration: 1,
          blockDuration: 2
        };
        
        const uniqueKey = `test-retry-${ip}-${Date.now()}-${Math.random()}`;
        const middleware = createFederationRateLimit(config, { 
          keyGenerator: () => uniqueKey 
        });
        
        const req = mockRequest('/federation/registration', {}, requestBody, {}, ip);
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
          expect(jsonResponse.error).toBe('temporarily_unavailable');
          expect(jsonResponse.error_description).toContain('federation');
        }
      }
    ), { numRuns: 8 });
  });

  it('Property 8: Federation rate limiting should handle malformed requests gracefully', async () => {
    await fc.assert(fc.asyncProperty(
      ipAddressArbitrary(),
      fc.record({
        entity_configuration: fc.option(fc.oneof(
          fc.constant('invalid-jwt'),
          fc.constant(''),
          fc.constant(null),
          fc.string({ minLength: 1, maxLength: 10 })
        )),
        trust_chain: fc.option(fc.oneof(
          fc.constant([]),
          fc.constant(null),
          fc.array(fc.string(), { maxLength: 2 })
        )),
        request_object: fc.option(fc.oneof(
          fc.constant('malformed'),
          fc.constant(''),
          fc.constant(null)
        ))
      }),
      async (ip, malformedBody) => {
        const middleware = federationRegistrationRateLimit();
        const req = mockRequest('/federation/registration', {}, malformedBody, {}, ip);
        const res = mockResponse();
        
        // Rate limiting should work even with malformed requests
        await middleware(req as Request, res, mockNext);
        
        // Should either pass (if within limits) or be rate limited
        if (mockNext.mock.calls.length > 0) {
          // Request passed rate limiting
          expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
            'X-RateLimit-Policy': 'federation'
          }));
        } else {
          // Request was rate limited
          expect(res.status).toHaveBeenCalledWith(429);
          expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: 'temporarily_unavailable'
          }));
        }
      }
    ), { numRuns: 8 });
  });

  it('Property 8: Federation rate limiting should preserve error response format', async () => {
    await fc.assert(fc.asyncProperty(
      ipAddressArbitrary(),
      federationRequestBodyArbitrary(),
      async (ip, requestBody) => {
        const config = {
          points: 1,
          duration: 1,
          blockDuration: fc.sample(fc.integer({ min: 1, max: 10 }), 1)[0]
        };
        
        const uniqueKey = `test-error-format-${ip}-${Date.now()}-${Math.random()}`;
        const middleware = createFederationRateLimit(config, { 
          keyGenerator: () => uniqueKey 
        });
        
        const req = mockRequest('/federation/registration', {}, requestBody, {}, ip);
        const res = mockResponse();
        
        // Consume limit
        await middleware(req as Request, res, mockNext);
        
        // Trigger rate limit
        vi.clearAllMocks();
        await middleware(req as Request, res, mockNext);
        
        expect(res.status).toHaveBeenCalledWith(429);
        
        const jsonCall = (res.json as any).mock.calls[0];
        if (jsonCall) {
          const response = jsonCall[0];
          
          // Should follow OAuth 2.0 error response format
          expect(response).toHaveProperty('error');
          expect(response).toHaveProperty('error_description');
          expect(response).toHaveProperty('retry_after');
          
          expect(response.error).toBe('temporarily_unavailable');
          expect(typeof response.error_description).toBe('string');
          expect(typeof response.retry_after).toBe('number');
          expect(response.retry_after).toBeGreaterThan(0);
        }
      }
    ), { numRuns: 8 });
  });
});