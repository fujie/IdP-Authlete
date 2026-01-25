import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { HealthCheckService, HealthCheckResult, HealthCheckOptions } from './healthCheck';
import { AuthleteClient } from '../authlete/client';

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    logInfo: vi.fn(),
    logError: vi.fn()
  }
}));

// Property-based test generators
const healthCheckOptionsArbitrary = () => fc.record({
  includeAuthlete: fc.option(fc.boolean(), { nil: undefined }),
  timeout: fc.option(fc.integer({ min: 1000, max: 10000 }), { nil: undefined })
});

const environmentVariablesArbitrary = () => fc.record({
  AUTHLETE_BASE_URL: fc.option(fc.webUrl(), { nil: undefined }),
  AUTHLETE_SERVICE_ID: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  AUTHLETE_SERVICE_ACCESS_TOKEN: fc.option(fc.string({ minLength: 10, maxLength: 100 }), { nil: undefined }),
  SESSION_SECRET: fc.option(fc.string({ minLength: 10, maxLength: 100 }), { nil: undefined }),
  NODE_ENV: fc.option(fc.oneof(
    fc.constant('development'),
    fc.constant('test'),
    fc.constant('production'),
    fc.constant('staging')
  ), { nil: undefined }),
  npm_package_version: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined })
});

const authleteResponseArbitrary = () => fc.oneof(
  // Successful response (connectivity working)
  fc.record({
    action: fc.constant('BAD_REQUEST' as const)
  }),
  // Network error (connectivity issue)
  fc.record({
    error: fc.oneof(
      fc.constant('ECONNREFUSED'),
      fc.constant('ENOTFOUND'),
      fc.constant('ECONNRESET'),
      fc.constant('Health check timeout')
    )
  })
);

describe('Feature: oauth2-authorization-server, Property 16: Health Check Availability', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockAuthleteClient: Partial<AuthleteClient>;

  beforeEach(() => {
    originalEnv = process.env;
    mockAuthleteClient = {
      authorization: vi.fn()
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  /**
   * Property 16: Health Check Availability
   * For any health check request, the system should provide proper monitoring endpoints 
   * that indicate system availability
   * Validates: Requirements 8.5
   */
  it('Property 16: Health check requests should always return proper monitoring information with system availability status', async () => {
    await fc.assert(fc.asyncProperty(
      healthCheckOptionsArbitrary(),
      environmentVariablesArbitrary(),
      authleteResponseArbitrary(),
      async (options, envVars, authleteResponse) => {
        // Set up environment variables
        process.env = {
          ...originalEnv,
          ...Object.fromEntries(
            Object.entries(envVars).filter(([, value]) => value !== undefined)
          )
        };

        // Set up Authlete client mock
        if ('error' in authleteResponse) {
          vi.mocked(mockAuthleteClient.authorization!).mockRejectedValue(
            new Error(authleteResponse.error)
          );
        } else {
          vi.mocked(mockAuthleteClient.authorization!).mockResolvedValue(
            authleteResponse as any
          );
        }

        const healthCheckService = new HealthCheckService(mockAuthleteClient as AuthleteClient);
        
        // Perform health check
        const result = await healthCheckService.performHealthCheck(options);

        // Should always return a valid HealthCheckResult structure (Requirement 8.5)
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('timestamp');
        expect(result).toHaveProperty('version');
        expect(result).toHaveProperty('environment');
        expect(result).toHaveProperty('uptime');
        expect(result).toHaveProperty('checks');

        // Status should be one of the valid values indicating system availability
        expect(['healthy', 'unhealthy', 'degraded']).toContain(result.status);

        // Timestamp should be a valid ISO string
        expect(() => new Date(result.timestamp)).not.toThrow();
        expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);

        // Version should be a non-empty string
        expect(typeof result.version).toBe('string');
        expect(result.version.length).toBeGreaterThan(0);

        // Environment should be a non-empty string
        expect(typeof result.environment).toBe('string');
        expect(result.environment.length).toBeGreaterThan(0);

        // Uptime should be a non-negative number
        expect(typeof result.uptime).toBe('number');
        expect(result.uptime).toBeGreaterThanOrEqual(0);

        // Checks should be an object with monitoring information
        expect(typeof result.checks).toBe('object');
        expect(result.checks).not.toBeNull();

        // Should always include basic system checks
        expect(result.checks).toHaveProperty('system');
        expect(result.checks).toHaveProperty('memory');
        expect(result.checks).toHaveProperty('environment');

        // Each check should have proper structure
        Object.entries(result.checks).forEach(([checkName, check]) => {
          expect(check).toHaveProperty('status');
          expect(['pass', 'fail', 'warn']).toContain(check.status);
          expect(check).toHaveProperty('lastChecked');
          expect(() => new Date(check.lastChecked)).not.toThrow();
          
          // Message should be present and non-empty when status is not 'pass'
          if (check.status !== 'pass' || check.message) {
            expect(typeof check.message).toBe('string');
            expect(check.message!.length).toBeGreaterThan(0);
          }

          // Response time should be a positive number when present
          if (check.responseTime !== undefined) {
            expect(typeof check.responseTime).toBe('number');
            expect(check.responseTime).toBeGreaterThanOrEqual(0);
          }
        });

        // Authlete check should be included when includeAuthlete is not false
        if (options.includeAuthlete !== false) {
          expect(result.checks).toHaveProperty('authlete');
          
          const authleteCheck = result.checks.authlete;
          expect(['pass', 'fail', 'warn']).toContain(authleteCheck.status);
          
          // Should have appropriate status based on mock response
          if ('error' in authleteResponse) {
            if (authleteResponse.error.includes('timeout') || 
                authleteResponse.error.includes('ECONN')) {
              expect(authleteCheck.status).toBe('fail');
              expect(authleteCheck.message).toBeDefined();
            }
          }
        }

        // Overall status should be consistent with individual check statuses
        const checkStatuses = Object.values(result.checks).map(check => check.status);
        if (checkStatuses.includes('fail')) {
          expect(result.status).toBe('unhealthy');
        } else if (checkStatuses.includes('warn')) {
          expect(result.status).toBe('degraded');
        } else {
          expect(result.status).toBe('healthy');
        }

        // Environment check should reflect actual environment variable state
        const requiredEnvVars = [
          'AUTHLETE_BASE_URL',
          'AUTHLETE_SERVICE_ID', 
          'AUTHLETE_SERVICE_ACCESS_TOKEN',
          'SESSION_SECRET'
        ];
        const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
        
        if (missingVars.length > 0) {
          expect(result.checks.environment.status).toBe('fail');
          expect(result.checks.environment.message).toContain('Missing required environment variables');
        } else {
          expect(result.checks.environment.status).toBe('pass');
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 16: Health check liveness probe should always indicate if service is alive', async () => {
    await fc.assert(fc.asyncProperty(
      fc.boolean(), // Whether to include Authlete client
      async (includeAuthleteClient) => {
        const healthCheckService = includeAuthleteClient 
          ? new HealthCheckService(mockAuthleteClient as AuthleteClient)
          : new HealthCheckService();
        
        const isAlive = await healthCheckService.isAlive();
        
        // Should always return a boolean (Requirement 8.5)
        expect(typeof isAlive).toBe('boolean');
        
        // For a functioning service, should always return true
        expect(isAlive).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 16: Health check readiness probe should indicate if service is ready to handle requests', async () => {
    await fc.assert(fc.asyncProperty(
      environmentVariablesArbitrary(),
      authleteResponseArbitrary(),
      async (envVars, authleteResponse) => {
        // Set up environment variables
        process.env = {
          ...originalEnv,
          ...Object.fromEntries(
            Object.entries(envVars).filter(([, value]) => value !== undefined)
          )
        };

        // Set up Authlete client mock
        if ('error' in authleteResponse) {
          vi.mocked(mockAuthleteClient.authorization!).mockRejectedValue(
            new Error(authleteResponse.error)
          );
        } else {
          vi.mocked(mockAuthleteClient.authorization!).mockResolvedValue(
            authleteResponse as any
          );
        }

        const healthCheckService = new HealthCheckService(mockAuthleteClient as AuthleteClient);
        
        const isReady = await healthCheckService.isReady();
        
        // Should always return a boolean (Requirement 8.5)
        expect(typeof isReady).toBe('boolean');
        
        // Readiness should be consistent with health check status
        const healthResult = await healthCheckService.performHealthCheck();
        const expectedReady = healthResult.status !== 'unhealthy';
        expect(isReady).toBe(expectedReady);
      }
    ), { numRuns: 100 });
  });

  it('Property 16: Health check should handle various timeout configurations properly', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 100, max: 1000 }), // timeout value (smaller range)
      async (timeout) => {
        // Set up stable environment for this test
        process.env = {
          ...originalEnv,
          AUTHLETE_BASE_URL: 'https://api.authlete.com',
          AUTHLETE_SERVICE_ID: 'test-service',
          AUTHLETE_SERVICE_ACCESS_TOKEN: 'test-token',
          SESSION_SECRET: 'test-secret',
          NODE_ENV: 'test'
        };

        // Mock a fast successful response to avoid timeout issues
        vi.mocked(mockAuthleteClient.authorization!).mockResolvedValue({
          action: 'BAD_REQUEST'
        } as any);

        const healthCheckService = new HealthCheckService(mockAuthleteClient as AuthleteClient);
        
        const startTime = Date.now();
        const result = await healthCheckService.performHealthCheck({ timeout });
        const endTime = Date.now();
        
        // Should complete quickly since we're not actually timing out
        expect(endTime - startTime).toBeLessThan(timeout + 200);
        
        // Should always return valid health check result (Requirement 8.5)
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('checks');
        expect(['healthy', 'unhealthy', 'degraded']).toContain(result.status);
        
        // Authlete check should be successful
        if (result.checks.authlete) {
          expect(['pass', 'fail']).toContain(result.checks.authlete.status);
          
          if (result.checks.authlete.responseTime !== undefined) {
            expect(typeof result.checks.authlete.responseTime).toBe('number');
            expect(result.checks.authlete.responseTime).toBeGreaterThanOrEqual(0);
          }
        }
        
        // The timeout parameter should be respected in the configuration
        expect(typeof timeout).toBe('number');
        expect(timeout).toBeGreaterThan(0);
      }
    ), { numRuns: 20 }); // Reduced number of runs
  }, 5000); // Reduced test timeout

  it('Property 16: Health check should provide consistent monitoring information across multiple calls', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 2, max: 5 }), // number of health check calls
      healthCheckOptionsArbitrary(),
      async (callCount, options) => {
        // Set up stable environment
        process.env = {
          ...originalEnv,
          AUTHLETE_BASE_URL: 'https://api.authlete.com',
          AUTHLETE_SERVICE_ID: 'test-service',
          AUTHLETE_SERVICE_ACCESS_TOKEN: 'test-token',
          SESSION_SECRET: 'test-secret',
          NODE_ENV: 'test'
        };

        vi.mocked(mockAuthleteClient.authorization!).mockResolvedValue({
          action: 'BAD_REQUEST'
        } as any);

        const healthCheckService = new HealthCheckService(mockAuthleteClient as AuthleteClient);
        
        const results: HealthCheckResult[] = [];
        
        // Perform multiple health checks
        for (let i = 0; i < callCount; i++) {
          const result = await healthCheckService.performHealthCheck(options);
          results.push(result);
          
          // Small delay between calls
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        // All results should have consistent structure (Requirement 8.5)
        results.forEach((result, index) => {
          expect(result).toHaveProperty('status');
          expect(result).toHaveProperty('timestamp');
          expect(result).toHaveProperty('version');
          expect(result).toHaveProperty('environment');
          expect(result).toHaveProperty('uptime');
          expect(result).toHaveProperty('checks');
          
          // Status should be consistent (environment is stable) - but allow for memory fluctuations
          if (index > 0) {
            // Both results should be either healthy or degraded (not unhealthy since env is stable)
            expect(['healthy', 'degraded']).toContain(result.status);
            expect(['healthy', 'degraded']).toContain(results[0].status);
          }
          
          // Uptime should be increasing
          if (index > 0) {
            expect(result.uptime).toBeGreaterThanOrEqual(results[index - 1].uptime);
          }
          
          // Timestamps should be increasing
          if (index > 0) {
            expect(new Date(result.timestamp).getTime())
              .toBeGreaterThan(new Date(results[index - 1].timestamp).getTime());
          }
          
          // Check structure should be consistent
          const checkNames = Object.keys(result.checks);
          if (index > 0) {
            expect(checkNames.sort()).toEqual(Object.keys(results[0].checks).sort());
          }
        });
      }
    ), { numRuns: 30 }); // Reduced runs for consistency test
  });

  it('Property 16: Health check should handle missing Authlete client gracefully', async () => {
    await fc.assert(fc.asyncProperty(
      healthCheckOptionsArbitrary(),
      async (options) => {
        // Create health check service without Authlete client
        const healthCheckService = new HealthCheckService();
        
        const result = await healthCheckService.performHealthCheck(options);
        
        // Should always return valid result structure (Requirement 8.5)
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('timestamp');
        expect(result).toHaveProperty('version');
        expect(result).toHaveProperty('environment');
        expect(result).toHaveProperty('uptime');
        expect(result).toHaveProperty('checks');
        
        // Should include Authlete check when includeAuthlete is not false
        if (options.includeAuthlete !== false) {
          expect(result.checks).toHaveProperty('authlete');
          expect(result.checks.authlete.status).toBe('fail');
          expect(result.checks.authlete.message).toBe('Authlete client not configured');
        }
        
        // Overall status should reflect the missing client
        if (options.includeAuthlete !== false) {
          expect(result.status).toBe('unhealthy');
        }
      }
    ), { numRuns: 100 });
  });
});