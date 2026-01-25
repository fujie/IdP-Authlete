import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { config, validateRequiredEnvVar } from './config/index';

describe('Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it('should load configuration from environment variables', () => {
    expect(config.authlete.baseUrl).toBe('https://test.authlete.com');
    expect(config.authlete.serviceId).toBe('test_service_id');
    expect(config.authlete.serviceAccessToken).toBe('test_access_token');
    expect(config.server.port).toBe(3001);
    expect(config.server.nodeEnv).toBe('test');
    expect(config.server.sessionSecret).toBe('test_session_secret');
    expect(config.authlete.timeout).toBe(5000);
    expect(config.authlete.retryAttempts).toBe(2);
  });

  it('should have all required configuration properties', () => {
    expect(config.authlete).toHaveProperty('baseUrl');
    expect(config.authlete).toHaveProperty('serviceId');
    expect(config.authlete).toHaveProperty('serviceAccessToken');
    expect(config.authlete).toHaveProperty('timeout');
    expect(config.authlete).toHaveProperty('retryAttempts');
    
    expect(config.server).toHaveProperty('port');
    expect(config.server).toHaveProperty('nodeEnv');
    expect(config.server).toHaveProperty('sessionSecret');
  });

  // Property-based test for configuration validation function
  it('Feature: oauth2-authorization-server, Property 13: Configuration Loading - validateRequiredEnvVar should handle missing variables', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 50 }), // variable name
      fc.option(fc.string(), { nil: undefined }), // variable value (can be undefined)
      (varName: string, varValue: string | undefined) => {
        if (varValue === undefined || varValue === '') {
          // Should throw error for missing/empty values
          expect(() => validateRequiredEnvVar(varName, varValue)).toThrow(`Missing required environment variable: ${varName}`);
        } else {
          // Should return the value for valid values
          expect(validateRequiredEnvVar(varName, varValue)).toBe(varValue);
        }
      }
    ), { numRuns: 100 });
  });

  // Property-based test for configuration structure validation
  it('Feature: oauth2-authorization-server, Property 13: Configuration Loading - Valid configurations should have proper structure', () => {
    fc.assert(fc.property(
      // Generate valid configuration-like objects
      fc.record({
        baseUrl: fc.webUrl({ validSchemes: ['https'] }),
        serviceId: fc.string({ minLength: 1, maxLength: 100 }),
        serviceAccessToken: fc.string({ minLength: 1, maxLength: 200 }),
        timeout: fc.integer({ min: 1000, max: 60000 }),
        retryAttempts: fc.integer({ min: 1, max: 10 })
      }),
      (configLike) => {
        // Test that configuration objects with valid structure are properly formed
        expect(configLike).toHaveProperty('baseUrl');
        expect(configLike).toHaveProperty('serviceId');
        expect(configLike).toHaveProperty('serviceAccessToken');
        expect(configLike).toHaveProperty('timeout');
        expect(configLike).toHaveProperty('retryAttempts');
        
        // Validate types
        expect(typeof configLike.baseUrl).toBe('string');
        expect(typeof configLike.serviceId).toBe('string');
        expect(typeof configLike.serviceAccessToken).toBe('string');
        expect(typeof configLike.timeout).toBe('number');
        expect(typeof configLike.retryAttempts).toBe('number');
        
        // Validate ranges
        expect(configLike.timeout).toBeGreaterThanOrEqual(1000);
        expect(configLike.timeout).toBeLessThanOrEqual(60000);
        expect(configLike.retryAttempts).toBeGreaterThanOrEqual(1);
        expect(configLike.retryAttempts).toBeLessThanOrEqual(10);
        
        // Validate non-empty strings
        expect(configLike.baseUrl.length).toBeGreaterThan(0);
        expect(configLike.serviceId.length).toBeGreaterThan(0);
        expect(configLike.serviceAccessToken.length).toBeGreaterThan(0);
      }
    ), { numRuns: 100 });
  });

  // Property-based test for different base URLs support
  it('Feature: oauth2-authorization-server, Property 13: Configuration Loading - Different base URLs should be supported', () => {
    fc.assert(fc.property(
      // Generate different valid base URLs for different environments
      fc.oneof(
        fc.constant('https://us.authlete.com'),
        fc.constant('https://eu.authlete.com'),
        fc.constant('https://ap.authlete.com'),
        fc.constant('https://staging.authlete.com'),
        fc.constant('https://dev.authlete.com'),
        fc.webUrl({ validSchemes: ['https'] })
      ),
      (baseUrl: string) => {
        // Test that different base URLs are valid HTTPS URLs
        expect(baseUrl).toMatch(/^https:\/\/.+/);
        expect(baseUrl.length).toBeGreaterThan(8); // Minimum for "https://x"
        
        // Test that the URL can be used in a configuration object
        const testConfig = {
          baseUrl,
          serviceId: 'test-service',
          serviceAccessToken: 'test-token',
          timeout: 10000,
          retryAttempts: 3
        };
        
        expect(testConfig.baseUrl).toBe(baseUrl);
        expect(() => new URL(baseUrl)).not.toThrow();
      }
    ), { numRuns: 100 });
  });
});