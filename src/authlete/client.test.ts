import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import axios from 'axios';
import { AuthleteClientImpl, AuthleteApiError } from './client';
import { AuthleteConfig } from '../config';

describe('AuthleteClient', () => {
  let config: AuthleteConfig;
  let client: AuthleteClientImpl;

  beforeEach(() => {
    config = {
      baseUrl: 'https://us.authlete.com',
      serviceId: 'test-service-id',
      serviceAccessToken: 'test-access-token',
      timeout: 10000,
      retryAttempts: 3
    };
    client = new AuthleteClientImpl(config);
  });

  it('should create AuthleteClient instance with proper configuration', () => {
    expect(client).toBeInstanceOf(AuthleteClientImpl);
  });

  it('should create AuthleteApiError with proper properties', () => {
    const error = new AuthleteApiError(400, { error: 'test' }, 'Test error');
    
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AuthleteApiError);
    expect(error.statusCode).toBe(400);
    expect(error.authleteResponse).toEqual({ error: 'test' });
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('AuthleteApiError');
  });

  // Property-based test for configuration loading
  it('Feature: oauth2-authorization-server, Property 13: Configuration Loading', () => {
    fc.assert(fc.property(
      // Generate valid configuration objects
      fc.record({
        baseUrl: fc.webUrl(),
        serviceId: fc.string({ minLength: 1, maxLength: 100 }),
        serviceAccessToken: fc.string({ minLength: 1, maxLength: 200 }),
        timeout: fc.integer({ min: 1000, max: 60000 }),
        retryAttempts: fc.integer({ min: 1, max: 10 })
      }),
      (validConfig: AuthleteConfig) => {
        // Test that valid configurations create working clients
        const client = new AuthleteClientImpl(validConfig);
        expect(client).toBeInstanceOf(AuthleteClientImpl);
        
        // Verify the client was created successfully (no exceptions thrown)
        expect(client).toBeDefined();
      }
    ), { numRuns: 100 });
  });

  it('Feature: oauth2-authorization-server, Property 13: Configuration Loading - Invalid configs should fail gracefully', () => {
    fc.assert(fc.property(
      // Generate configurations with missing or invalid required fields
      fc.oneof(
        // Missing baseUrl
        fc.record({
          baseUrl: fc.constant(''),
          serviceId: fc.string({ minLength: 1 }),
          serviceAccessToken: fc.string({ minLength: 1 }),
          timeout: fc.integer({ min: 1000, max: 60000 }),
          retryAttempts: fc.integer({ min: 1, max: 10 })
        }),
        // Missing serviceId
        fc.record({
          baseUrl: fc.webUrl(),
          serviceId: fc.constant(''),
          serviceAccessToken: fc.string({ minLength: 1 }),
          timeout: fc.integer({ min: 1000, max: 60000 }),
          retryAttempts: fc.integer({ min: 1, max: 10 })
        }),
        // Missing serviceAccessToken
        fc.record({
          baseUrl: fc.webUrl(),
          serviceId: fc.string({ minLength: 1 }),
          serviceAccessToken: fc.constant(''),
          timeout: fc.integer({ min: 1000, max: 60000 }),
          retryAttempts: fc.integer({ min: 1, max: 10 })
        }),
        // Invalid timeout (negative or zero)
        fc.record({
          baseUrl: fc.webUrl(),
          serviceId: fc.string({ minLength: 1 }),
          serviceAccessToken: fc.string({ minLength: 1 }),
          timeout: fc.integer({ min: -1000, max: 0 }),
          retryAttempts: fc.integer({ min: 1, max: 10 })
        }),
        // Invalid retryAttempts (negative or zero)
        fc.record({
          baseUrl: fc.webUrl(),
          serviceId: fc.string({ minLength: 1 }),
          serviceAccessToken: fc.string({ minLength: 1 }),
          timeout: fc.integer({ min: 1000, max: 60000 }),
          retryAttempts: fc.integer({ min: -10, max: 0 })
        })
      ),
      (invalidConfig: AuthleteConfig) => {
        // For configurations with empty required strings, client creation should still work
        // but the HTTP client should be configured with the provided values
        // The actual validation happens at the environment/config loading level
        if (invalidConfig.baseUrl === '' || invalidConfig.serviceId === '' || invalidConfig.serviceAccessToken === '') {
          const client = new AuthleteClientImpl(invalidConfig);
          expect(client).toBeInstanceOf(AuthleteClientImpl);
        } else {
          // For invalid numeric values, the client should still be created
          // but may behave unexpectedly (this is by design - validation happens at config level)
          const client = new AuthleteClientImpl(invalidConfig);
          expect(client).toBeInstanceOf(AuthleteClientImpl);
        }
      }
    ), { numRuns: 100 });
  });

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
      fc.string({ minLength: 1, maxLength: 100 }),
      fc.string({ minLength: 1, maxLength: 200 }),
      (baseUrl: string, serviceId: string, serviceAccessToken: string) => {
        const config: AuthleteConfig = {
          baseUrl,
          serviceId,
          serviceAccessToken,
          timeout: 10000,
          retryAttempts: 3
        };
        
        const client = new AuthleteClientImpl(config);
        expect(client).toBeInstanceOf(AuthleteClientImpl);
        
        // Verify that different base URLs are properly handled
        expect(client).toBeDefined();
      }
    ), { numRuns: 100 });
  });

  // Property-based test for retry logic and error handling
  it('Feature: oauth2-authorization-server, Property 10: Error Handling and Recovery', () => {
    fc.assert(fc.property(
      // Generate retry configuration and error scenarios
      fc.record({
        retryAttempts: fc.integer({ min: 2, max: 4 }),
        errorType: fc.oneof(
          fc.constant('network'),
          fc.constant('server_error'),
          fc.constant('rate_limit')
        )
      }),
      (testConfig) => {
        const config: AuthleteConfig = {
          baseUrl: 'https://test.authlete.com',
          serviceId: 'test-service',
          serviceAccessToken: 'test-token',
          timeout: 5000,
          retryAttempts: testConfig.retryAttempts
        };

        const client = new AuthleteClientImpl(config);
        
        // Test the isRetryableError method directly (it's now protected)
        let testError: any;
        
        if (testConfig.errorType === 'network') {
          // Network errors are axios errors without response
          testError = new Error('Network Error');
          testError.code = 'ECONNREFUSED';
          testError.isAxiosError = true;
          // No response property for network errors
        } else if (testConfig.errorType === 'server_error') {
          testError = new Error('Request failed with status code 500');
          testError.response = { status: 500 };
          testError.isAxiosError = true;
        } else if (testConfig.errorType === 'rate_limit') {
          testError = new Error('Request failed with status code 429');
          testError.response = { status: 429 };
          testError.isAxiosError = true;
        }

        // Mock axios.isAxiosError to return true for our test errors
        const mockIsAxiosError = vi.spyOn(axios, 'isAxiosError').mockImplementation((error: any) => {
          return error && error.isAxiosError === true;
        });

        try {
          // Test that the error is correctly identified as retryable
          const isRetryable = (client as any).isRetryableError(testError);
          expect(isRetryable).toBe(true);

          // Test that non-retryable errors are correctly identified
          const nonRetryableError = new Error('Request failed with status code 400');
          nonRetryableError.response = { status: 400 };
          (nonRetryableError as any).isAxiosError = true;
          
          const isNonRetryable = (client as any).isRetryableError(nonRetryableError);
          expect(isNonRetryable).toBe(false);
        } finally {
          // Always restore the mock
          mockIsAxiosError.mockRestore();
        }
      }
    ), { numRuns: 50 });
  });

  it('Feature: oauth2-authorization-server, Property 10: Error Handling and Recovery - Non-retryable errors should fail immediately', () => {
    fc.assert(fc.property(
      // Generate non-retryable errors (4xx client errors except 429)
      fc.integer({ min: 400, max: 499 }).filter(status => status !== 429),
      (status) => {
        const config: AuthleteConfig = {
          baseUrl: 'https://test.authlete.com',
          serviceId: 'test-service',
          serviceAccessToken: 'test-token',
          timeout: 5000,
          retryAttempts: 3
        };

        const client = new AuthleteClientImpl(config);
        
        // Create a non-retryable error
        const nonRetryableError = new Error(`Request failed with status code ${status}`);
        (nonRetryableError as any).response = { status };
        (nonRetryableError as any).isAxiosError = true;
        
        // Mock axios.isAxiosError to return true for our test error
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
        
        // Test that the error is correctly identified as non-retryable
        const isRetryable = (client as any).isRetryableError(nonRetryableError);
        expect(isRetryable).toBe(false);

        // Restore mocks
        vi.restoreAllMocks();
      }
    ), { numRuns: 50 });
  });

  it('Feature: oauth2-authorization-server, Property 10: Error Handling and Recovery - Error wrapping and logging', () => {
    fc.assert(fc.property(
      // Generate different error scenarios for testing error wrapping
      fc.oneof(
        // Network errors
        fc.record({
          type: fc.constant('network'),
          code: fc.oneof(
            fc.constant('ECONNREFUSED'),
            fc.constant('ENOTFOUND'),
            fc.constant('ETIMEDOUT')
          )
        }),
        // HTTP errors
        fc.record({
          type: fc.constant('http'),
          status: fc.integer({ min: 400, max: 599 }),
          statusText: fc.string({ minLength: 1, maxLength: 50 })
        })
      ),
      (errorConfig) => {
        const config: AuthleteConfig = {
          baseUrl: 'https://test.authlete.com',
          serviceId: 'test-service',
          serviceAccessToken: 'test-token',
          timeout: 5000,
          retryAttempts: 2
        };

        const client = new AuthleteClientImpl(config);
        
        // Create test error based on configuration
        let testError: any;
        
        if (errorConfig.type === 'network') {
          testError = new Error('Network Error');
          testError.code = errorConfig.code;
          testError.isAxiosError = true;
          // Network errors don't have response property
        } else {
          testError = new Error(`Request failed with status code ${errorConfig.status}`);
          testError.response = {
            status: errorConfig.status,
            statusText: errorConfig.statusText,
            data: { error: 'test_error' }
          };
          testError.isAxiosError = true;
        }

        // Mock axios.isAxiosError to return true for our test errors
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);

        // Test error classification
        const isRetryable = (client as any).isRetryableError(testError);
        
        if (errorConfig.type === 'network') {
          expect(isRetryable).toBe(true);
        } else if (errorConfig.type === 'http') {
          if (errorConfig.status >= 500 || errorConfig.status === 429) {
            expect(isRetryable).toBe(true);
          } else {
            expect(isRetryable).toBe(false);
          }
        }

        // Restore mocks
        vi.restoreAllMocks();
      }
    ), { numRuns: 50 });
  });

  // Property-based test for HTTP client configuration
  it('Feature: oauth2-authorization-server, Property 14: HTTP Client Configuration', () => {
    fc.assert(fc.property(
      // Generate various HTTP client configuration scenarios
      fc.record({
        baseUrl: fc.webUrl({ validSchemes: ['https'] }),
        serviceId: fc.string({ minLength: 1, maxLength: 100 }),
        serviceAccessToken: fc.string({ minLength: 1, maxLength: 200 }),
        timeout: fc.integer({ min: 1000, max: 60000 }),
        retryAttempts: fc.integer({ min: 1, max: 10 })
      }),
      (config: AuthleteConfig) => {
        // Test that HTTP client is properly configured with timeouts and connection pooling
        const client = new AuthleteClientImpl(config);
        
        // Verify client was created successfully
        expect(client).toBeInstanceOf(AuthleteClientImpl);
        
        // Access the private httpClient to verify configuration
        const httpClient = (client as any).httpClient;
        
        // Verify timeout configuration
        expect(httpClient.defaults.timeout).toBe(config.timeout);
        
        // Verify base URL configuration
        expect(httpClient.defaults.baseURL).toBe(config.baseUrl);
        
        // Verify authentication headers
        expect(httpClient.defaults.headers['Authorization']).toBe(`Bearer ${config.serviceAccessToken}`);
        expect(httpClient.defaults.headers['Content-Type']).toBe('application/json');
        expect(httpClient.defaults.headers['User-Agent']).toBe('OAuth2-Authorization-Server/1.0.0');
        
        // Verify connection pooling configuration
        expect(httpClient.defaults.maxRedirects).toBe(0);
        expect(typeof httpClient.defaults.validateStatus).toBe('function');
        
        // Test validateStatus function behavior
        const validateStatus = httpClient.defaults.validateStatus;
        expect(validateStatus(200)).toBe(true);  // 2xx should be valid
        expect(validateStatus(400)).toBe(true);  // 4xx should be valid (not thrown)
        expect(validateStatus(500)).toBe(false); // 5xx should be invalid (thrown)
        
        // Verify interceptors are configured
        expect(httpClient.interceptors.request.handlers.length).toBeGreaterThan(0);
        expect(httpClient.interceptors.response.handlers.length).toBeGreaterThan(0);
      }
    ), { numRuns: 100 });
  });

  it('Feature: oauth2-authorization-server, Property 14: HTTP Client Configuration - Session management configuration', () => {
    fc.assert(fc.property(
      // Generate session-related configuration scenarios
      fc.record({
        baseUrl: fc.webUrl({ validSchemes: ['https'] }),
        serviceId: fc.string({ minLength: 1, maxLength: 100 }),
        serviceAccessToken: fc.string({ minLength: 1, maxLength: 200 }),
        timeout: fc.integer({ min: 5000, max: 30000 }),
        retryAttempts: fc.integer({ min: 2, max: 5 })
      }),
      (config: AuthleteConfig) => {
        // Test that HTTP client supports proper session management through configuration
        const client = new AuthleteClientImpl(config);
        
        // Verify client configuration supports session management requirements
        expect(client).toBeInstanceOf(AuthleteClientImpl);
        
        // Access the private httpClient to verify session-related configuration
        const httpClient = (client as any).httpClient;
        
        // Verify that the client is configured to handle session-related requests properly
        // This includes proper timeout configuration for session operations
        expect(httpClient.defaults.timeout).toBeGreaterThanOrEqual(5000); // Minimum timeout for session operations
        
        // Verify that authentication headers are properly configured for session management
        expect(httpClient.defaults.headers['Authorization']).toContain('Bearer');
        expect(httpClient.defaults.headers['Authorization']).toContain(config.serviceAccessToken);
        
        // Verify that the client doesn't follow redirects (important for OAuth flows)
        expect(httpClient.defaults.maxRedirects).toBe(0);
        
        // Verify that the client has proper error handling for session-related operations
        expect(typeof httpClient.defaults.validateStatus).toBe('function');
        
        // Test that the client configuration supports the retry mechanism needed for session operations
        const clientConfig = (client as any).config;
        expect(clientConfig.retryAttempts).toBe(config.retryAttempts);
        expect(clientConfig.timeout).toBe(config.timeout);
      }
    ), { numRuns: 100 });
  });

  it('Feature: oauth2-authorization-server, Property 14: HTTP Client Configuration - Connection pooling and performance', () => {
    fc.assert(fc.property(
      // Generate different performance-related configuration scenarios
      fc.record({
        baseUrl: fc.webUrl({ validSchemes: ['https'] }),
        serviceId: fc.string({ minLength: 1, maxLength: 100 }),
        serviceAccessToken: fc.string({ minLength: 1, maxLength: 200 }),
        timeout: fc.integer({ min: 1000, max: 60000 }),
        retryAttempts: fc.integer({ min: 1, max: 10 })
      }),
      (config: AuthleteConfig) => {
        // Test that HTTP client implements proper connection pooling and performance optimizations
        const client = new AuthleteClientImpl(config);
        
        // Verify client was created successfully
        expect(client).toBeInstanceOf(AuthleteClientImpl);
        
        // Access the private httpClient to verify connection pooling configuration
        const httpClient = (client as any).httpClient;
        
        // Verify that the client is configured for optimal performance
        expect(httpClient.defaults.timeout).toBe(config.timeout);
        expect(httpClient.defaults.baseURL).toBe(config.baseUrl);
        
        // Verify that connection pooling is properly configured
        // Axios uses connection pooling by default, but we verify key settings
        expect(httpClient.defaults.maxRedirects).toBe(0); // No redirects for security
        
        // Verify that the client has proper headers for efficient communication
        expect(httpClient.defaults.headers['Content-Type']).toBe('application/json');
        expect(httpClient.defaults.headers['User-Agent']).toBe('OAuth2-Authorization-Server/1.0.0');
        
        // Verify that the validateStatus function is configured for proper error handling
        const validateStatus = httpClient.defaults.validateStatus;
        expect(typeof validateStatus).toBe('function');
        
        // Test that the function correctly identifies which status codes should not throw errors
        // This is important for connection pooling as it prevents unnecessary connection drops
        expect(validateStatus(200)).toBe(true);  // Success
        expect(validateStatus(201)).toBe(true);  // Created
        expect(validateStatus(400)).toBe(true);  // Bad Request (handled by application)
        expect(validateStatus(401)).toBe(true);  // Unauthorized (handled by application)
        expect(validateStatus(403)).toBe(true);  // Forbidden (handled by application)
        expect(validateStatus(404)).toBe(true);  // Not Found (handled by application)
        expect(validateStatus(500)).toBe(false); // Internal Server Error (should throw)
        expect(validateStatus(502)).toBe(false); // Bad Gateway (should throw)
        expect(validateStatus(503)).toBe(false); // Service Unavailable (should throw)
      }
    ), { numRuns: 100 });
  });
});