/**
 * Unit tests for OPTrustChainValidator
 * 
 * Tests the basic functionality of the OP Trust Chain Validator
 */

const { OPTrustChainValidator } = require('./opTrustChainValidator');

describe('OPTrustChainValidator', () => {
  describe('Constructor', () => {
    test('should create validator with valid config', () => {
      const validator = new OPTrustChainValidator({
        trustAnchorUrl: 'https://trust-anchor.example.com'
      });

      expect(validator).toBeDefined();
      expect(validator.trustAnchorUrl).toBe('https://trust-anchor.example.com');
      expect(validator.cacheExpirationMs).toBe(3600000); // Default 1 hour
    });

    test('should create validator with custom cache expiration', () => {
      const validator = new OPTrustChainValidator({
        trustAnchorUrl: 'https://trust-anchor.example.com',
        cacheExpirationMs: 7200000 // 2 hours
      });

      expect(validator.cacheExpirationMs).toBe(7200000);
    });

    test('should accept localhost URLs for development', () => {
      const validator = new OPTrustChainValidator({
        trustAnchorUrl: 'http://localhost:3000'
      });

      expect(validator.trustAnchorUrl).toBe('http://localhost:3000');
    });

    test('should throw error if trust anchor URL is missing', () => {
      expect(() => {
        new OPTrustChainValidator({});
      }).toThrow('Trust Anchor URL is required');
    });

    test('should throw error if trust anchor URL is not HTTPS', () => {
      expect(() => {
        new OPTrustChainValidator({
          trustAnchorUrl: 'http://trust-anchor.example.com'
        });
      }).toThrow('Trust Anchor URL must use HTTPS protocol');
    });

    test('should throw error if config is null', () => {
      expect(() => {
        new OPTrustChainValidator(null);
      }).toThrow('Trust Anchor URL is required');
    });
  });

  describe('Cache Management', () => {
    let validator;

    beforeEach(() => {
      validator = new OPTrustChainValidator({
        trustAnchorUrl: 'https://trust-anchor.example.com',
        cacheExpirationMs: 1000 // 1 second for testing
      });
    });

    test('should return false for non-existent OP', () => {
      expect(validator.isOPValidated('https://op.example.com')).toBe(false);
    });

    test('should store and retrieve cached validation', () => {
      const opEntityId = 'https://op.example.com';
      const now = Date.now();
      
      validator.cache.set(opEntityId, {
        isValid: true,
        trustAnchor: 'https://trust-anchor.example.com',
        timestamp: now,
        expiresAt: now + 10000 // 10 seconds
      });

      expect(validator.isOPValidated(opEntityId)).toBe(true);
    });

    test('should remove expired cache entries', async () => {
      const opEntityId = 'https://op.example.com';
      const now = Date.now();
      
      validator.cache.set(opEntityId, {
        isValid: true,
        trustAnchor: 'https://trust-anchor.example.com',
        timestamp: now,
        expiresAt: now + 100 // 100ms
      });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(validator.isOPValidated(opEntityId)).toBe(false);
      expect(validator.cache.has(opEntityId)).toBe(false);
    });

    test('should clear all cache entries', () => {
      validator.cache.set('https://op1.example.com', {
        isValid: true,
        trustAnchor: 'https://trust-anchor.example.com',
        timestamp: Date.now(),
        expiresAt: Date.now() + 10000
      });
      validator.cache.set('https://op2.example.com', {
        isValid: true,
        trustAnchor: 'https://trust-anchor.example.com',
        timestamp: Date.now(),
        expiresAt: Date.now() + 10000
      });

      expect(validator.cache.size).toBe(2);

      validator.clearCache();

      expect(validator.cache.size).toBe(0);
    });

    test('should return cache statistics', () => {
      const now = Date.now();
      
      // Add valid entry
      validator.cache.set('https://op1.example.com', {
        isValid: true,
        trustAnchor: 'https://trust-anchor.example.com',
        timestamp: now,
        expiresAt: now + 10000
      });

      // Add expired entry
      validator.cache.set('https://op2.example.com', {
        isValid: true,
        trustAnchor: 'https://trust-anchor.example.com',
        timestamp: now - 2000,
        expiresAt: now - 1000
      });

      const stats = validator.getCacheStats();

      expect(stats.totalEntries).toBe(2);
      expect(stats.validEntries).toBe(1);
      expect(stats.expiredEntries).toBe(1);
    });

    test('should perform periodic cleanup of expired entries', async () => {
      // Create validator with short cleanup interval for testing
      const testValidator = new OPTrustChainValidator({
        trustAnchorUrl: 'https://trust-anchor.example.com',
        cacheExpirationMs: 100 // 100ms
      });

      // Override cleanup interval to 200ms for testing
      clearInterval(testValidator.cleanupInterval);
      testValidator.cleanupIntervalMs = 200;
      testValidator.cleanupInterval = setInterval(() => {
        testValidator._cleanupExpiredEntries();
      }, testValidator.cleanupIntervalMs);

      const now = Date.now();
      
      // Add entries that will expire
      testValidator.cache.set('https://op1.example.com', {
        isValid: true,
        trustAnchor: 'https://trust-anchor.example.com',
        timestamp: now,
        expiresAt: now + 50 // Expires in 50ms
      });

      testValidator.cache.set('https://op2.example.com', {
        isValid: true,
        trustAnchor: 'https://trust-anchor.example.com',
        timestamp: now,
        expiresAt: now + 50 // Expires in 50ms
      });

      // Add entry that won't expire
      testValidator.cache.set('https://op3.example.com', {
        isValid: true,
        trustAnchor: 'https://trust-anchor.example.com',
        timestamp: now,
        expiresAt: now + 10000 // Expires in 10 seconds
      });

      expect(testValidator.cache.size).toBe(3);

      // Wait for entries to expire and cleanup to run
      await new Promise(resolve => setTimeout(resolve, 300));

      // Only the non-expired entry should remain
      expect(testValidator.cache.size).toBe(1);
      expect(testValidator.cache.has('https://op3.example.com')).toBe(true);

      // Clean up
      testValidator.destroy();
    });

    test('should stop periodic cleanup when destroyed', () => {
      const testValidator = new OPTrustChainValidator({
        trustAnchorUrl: 'https://trust-anchor.example.com'
      });

      expect(testValidator.cleanupInterval).toBeDefined();

      testValidator.destroy();

      expect(testValidator.cleanupInterval).toBeNull();
    });
  });

  describe('validateOP', () => {
    let validator;

    beforeEach(() => {
      validator = new OPTrustChainValidator({
        trustAnchorUrl: 'https://trust-anchor.example.com',
        cacheExpirationMs: 3600000
      });
    });

    test('should return validation error for unreachable OP', async () => {
      const result = await validator.validateOP('https://nonexistent-op.example.com');

      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.cached).toBe(false);
    });

    test('should use cached result on second validation', async () => {
      const opEntityId = 'https://op.example.com';
      const now = Date.now();
      
      // Pre-populate cache
      validator.cache.set(opEntityId, {
        isValid: true,
        trustAnchor: 'https://trust-anchor.example.com',
        timestamp: now,
        expiresAt: now + 10000
      });

      const result = await validator.validateOP(opEntityId);

      expect(result.isValid).toBe(true);
      expect(result.cached).toBe(true);
      expect(result.trustAnchor).toBe('https://trust-anchor.example.com');
    });

    test('should perform fresh validation when cache is expired', async () => {
      const opEntityId = 'https://op.example.com';
      const now = Date.now();
      
      // Pre-populate cache with expired entry
      validator.cache.set(opEntityId, {
        isValid: true,
        trustAnchor: 'https://trust-anchor.example.com',
        timestamp: now - 2000,
        expiresAt: now - 1000 // Already expired
      });

      const result = await validator.validateOP(opEntityId);

      // Should perform fresh validation (which will fail for non-existent OP)
      expect(result.cached).toBe(false);
      expect(validator.cache.has(opEntityId)).toBe(true); // New entry should be cached
    });
  });

  // Task 7.4: Unit tests for network error handling
  // Requirements: 6.1
  describe('Network Error Handling (Task 7.4)', () => {
    let validator;

    beforeEach(() => {
      validator = new OPTrustChainValidator({
        trustAnchorUrl: 'https://trust-anchor.example.com',
        cacheExpirationMs: 3600000
      });
    });

    afterEach(() => {
      if (validator) {
        validator.destroy();
      }
    });

    describe('Unreachable OP', () => {
      test('should return op_unreachable error for non-existent domain', async () => {
        const opEntityId = 'https://nonexistent-op-12345.example.com';

        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.cached).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Check for network-related error code
        const hasNetworkError = result.errors.some(err => 
          err.code === 'op_unreachable' || 
          err.code === 'network_error' ||
          err.code === 'trust_chain_invalid'
        );
        expect(hasNetworkError).toBe(true);
        
        // Verify error includes OP entity ID
        expect(result.opEntityId).toBe(opEntityId);
      });

      test('should return error for unreachable localhost OP', async () => {
        // Use a port that is unlikely to be in use
        const opEntityId = 'http://localhost:59999';

        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.cached).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.opEntityId).toBe(opEntityId);
      });

      test('should include error details in response', async () => {
        const opEntityId = 'https://unreachable-op.example.com';

        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error structure
        const error = result.errors[0];
        expect(error).toHaveProperty('code');
        expect(error).toHaveProperty('message');
        expect(error).toHaveProperty('details');
        expect(error.details).toHaveProperty('opEntityId', opEntityId);
      });

      test('should cache failed validation for unreachable OP', async () => {
        const opEntityId = 'https://unreachable-op.example.com';

        // First validation - should fail
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(false);
        expect(result1.cached).toBe(false);

        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(false);
        expect(result2.cached).toBe(true);
        
        // Errors should be consistent
        expect(result2.errors).toEqual(result1.errors);
      });
    });

    describe('Timeout Scenarios', () => {
      test('should timeout after 10 seconds for slow OP', async () => {
        // This test validates the timeout mechanism exists
        // In a real scenario, we would mock a slow response
        const opEntityId = 'https://very-slow-op.example.com';

        const startTime = Date.now();
        const result = await validator.validateOP(opEntityId);
        const duration = Date.now() - startTime;

        expect(result.isValid).toBe(false);
        
        // Should complete within reasonable time (not hang indefinitely)
        // Allow some buffer for network operations
        expect(duration).toBeLessThan(15000); // 15 seconds max
      }, 20000); // Test timeout of 20 seconds

      test('should return timeout error code when validation times out', async () => {
        // Create a validator with mocked validator that simulates timeout
        const slowValidator = new OPTrustChainValidator({
          trustAnchorUrl: 'https://trust-anchor.example.com',
          cacheExpirationMs: 3600000
        });

        // Mock the validator to simulate a slow response
        const originalValidate = slowValidator.validator.validateTrustChain;
        slowValidator.validator.validateTrustChain = async () => {
          // Simulate a very slow operation (longer than 10s timeout)
          await new Promise(resolve => setTimeout(resolve, 11000));
          return { isValid: true, trustAnchor: 'https://trust-anchor.example.com' };
        };

        const opEntityId = 'https://slow-op.example.com';
        const result = await slowValidator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Should have timeout error
        const hasTimeoutError = result.errors.some(err => 
          err.code === 'timeout' || err.message.includes('timeout')
        );
        expect(hasTimeoutError).toBe(true);

        // Restore original method
        slowValidator.validator.validateTrustChain = originalValidate;
        slowValidator.destroy();
      }, 15000); // Test timeout of 15 seconds

      test('should include timeout details in error response', async () => {
        const slowValidator = new OPTrustChainValidator({
          trustAnchorUrl: 'https://trust-anchor.example.com',
          cacheExpirationMs: 3600000
        });

        // Mock timeout scenario
        slowValidator.validator.validateTrustChain = async () => {
          await new Promise(resolve => setTimeout(resolve, 11000));
          return { isValid: true, trustAnchor: 'https://trust-anchor.example.com' };
        };

        const opEntityId = 'https://timeout-op.example.com';
        const result = await slowValidator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors[0]).toHaveProperty('details');
        expect(result.errors[0].details).toHaveProperty('timeout');

        slowValidator.destroy();
      }, 15000);
    });

    describe('HTTP Error Responses', () => {
      test('should handle validation errors from trust chain validator', async () => {
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl: 'https://trust-anchor.example.com',
          cacheExpirationMs: 3600000
        });

        // Mock validator to return validation failure
        testValidator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'federation_fetch_failed',
                message: 'HTTP 404: Entity configuration not found'
              }
            ]
          };
        };

        const opEntityId = 'https://op-with-404.example.com';
        const result = await testValidator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Should categorize as unreachable
        expect(result.errors[0].code).toBe('op_unreachable');

        testValidator.destroy();
      });

      test('should handle HTTP 500 errors', async () => {
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl: 'https://trust-anchor.example.com',
          cacheExpirationMs: 3600000
        });

        // Mock validator to return server error
        testValidator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'federation_fetch_failed',
                message: 'HTTP 500: Internal Server Error'
              }
            ]
          };
        };

        const opEntityId = 'https://op-with-500.example.com';
        const result = await testValidator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);

        testValidator.destroy();
      });

      test('should handle HTTP 403 Forbidden errors', async () => {
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl: 'https://trust-anchor.example.com',
          cacheExpirationMs: 3600000
        });

        // Mock validator to return forbidden error
        testValidator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'federation_fetch_failed',
                message: 'HTTP 403: Forbidden'
              }
            ]
          };
        };

        const opEntityId = 'https://op-with-403.example.com';
        const result = await testValidator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);

        testValidator.destroy();
      });

      test('should preserve error details from HTTP errors', async () => {
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl: 'https://trust-anchor.example.com',
          cacheExpirationMs: 3600000
        });

        const originalError = {
          code: 'federation_fetch_failed',
          message: 'HTTP 503: Service Unavailable',
          details: { statusCode: 503, retryAfter: 60 }
        };

        testValidator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [originalError]
          };
        };

        const opEntityId = 'https://op-with-503.example.com';
        const result = await testValidator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].details).toHaveProperty('originalError');
        expect(result.errors[0].details).toHaveProperty('originalMessage');

        testValidator.destroy();
      });
    });

    describe('Error Response Structure', () => {
      test('should include opEntityId in all error responses', async () => {
        const opEntityId = 'https://error-op.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result).toHaveProperty('opEntityId', opEntityId);
      });

      test('should include timestamp in error responses', async () => {
        const opEntityId = 'https://error-op.example.com';
        const beforeTime = Date.now();
        const result = await validator.validateOP(opEntityId);
        const afterTime = Date.now();

        expect(result).toHaveProperty('timestamp');
        expect(result.timestamp).toBeGreaterThanOrEqual(beforeTime);
        expect(result.timestamp).toBeLessThanOrEqual(afterTime);
      });

      test('should include error array in failed validations', async () => {
        const opEntityId = 'https://error-op.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result).toHaveProperty('errors');
        expect(Array.isArray(result.errors)).toBe(true);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      test('should include error code and message in each error', async () => {
        const opEntityId = 'https://error-op.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.errors.length).toBeGreaterThan(0);
        
        result.errors.forEach(error => {
          expect(error).toHaveProperty('code');
          expect(error).toHaveProperty('message');
          expect(typeof error.code).toBe('string');
          expect(typeof error.message).toBe('string');
        });
      });

      test('should set cached flag to false for fresh validations', async () => {
        const opEntityId = 'https://error-op.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result).toHaveProperty('cached', false);
      });
    });

    describe('Request Context Logging', () => {
      test('should accept request context for logging', async () => {
        const opEntityId = 'https://error-op.example.com';
        const requestContext = {
          sessionId: 'test-session-123',
          userAgent: 'Test User Agent',
          ipAddress: '192.168.1.1'
        };

        // Should not throw error with request context
        const result = await validator.validateOP(opEntityId, requestContext);

        expect(result).toBeDefined();
        expect(result.isValid).toBe(false);
      });

      test('should work without request context', async () => {
        const opEntityId = 'https://error-op.example.com';

        // Should work without request context
        const result = await validator.validateOP(opEntityId);

        expect(result).toBeDefined();
        expect(result.isValid).toBe(false);
      });
    });
  });

  // Task 5.9: Unit tests for cache operations
  // Requirements: 7.1, 7.2, 7.3, 7.5
  describe('Cache Operations (Task 5.9)', () => {
    let validator;

    beforeEach(() => {
      validator = new OPTrustChainValidator({
        trustAnchorUrl: 'https://trust-anchor.example.com',
        cacheExpirationMs: 1000 // 1 second for testing
      });
    });

    afterEach(() => {
      if (validator) {
        validator.destroy();
      }
    });

    describe('Cache Hit Scenario', () => {
      test('should return cached result when valid entry exists', async () => {
        const opEntityId = 'https://op.example.com';
        const now = Date.now();
        
        // Pre-populate cache with valid entry
        validator.cache.set(opEntityId, {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          errors: [],
          timestamp: now,
          expiresAt: now + 5000 // Expires in 5 seconds
        });

        // Validate OP - should use cache
        const result = await validator.validateOP(opEntityId);

        // Verify cache hit
        expect(result.cached).toBe(true);
        expect(result.isValid).toBe(true);
        expect(result.trustAnchor).toBe('https://trust-anchor.example.com');
        expect(result.timestamp).toBe(now);
        
        // Verify cache entry still exists
        expect(validator.cache.has(opEntityId)).toBe(true);
      });

      test('should return cached failure result', async () => {
        const opEntityId = 'https://invalid-op.example.com';
        const now = Date.now();
        const errors = [{ code: 'invalid_signature', message: 'Signature verification failed' }];
        
        // Pre-populate cache with failed validation
        validator.cache.set(opEntityId, {
          isValid: false,
          errors: errors,
          timestamp: now,
          expiresAt: now + 5000
        });

        // Validate OP - should use cache
        const result = await validator.validateOP(opEntityId);

        // Verify cache hit with failure
        expect(result.cached).toBe(true);
        expect(result.isValid).toBe(false);
        expect(result.errors).toEqual(errors);
      });

      test('should not make network request on cache hit', async () => {
        const opEntityId = 'https://op.example.com';
        const now = Date.now();
        
        // Pre-populate cache
        validator.cache.set(opEntityId, {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now,
          expiresAt: now + 5000
        });

        const initialCacheSize = validator.cache.size;

        // Validate OP multiple times
        await validator.validateOP(opEntityId);
        await validator.validateOP(opEntityId);
        await validator.validateOP(opEntityId);

        // Cache size should remain the same (no new entries)
        expect(validator.cache.size).toBe(initialCacheSize);
      });
    });

    describe('Cache Miss Scenario', () => {
      test('should perform validation when no cache entry exists', async () => {
        const opEntityId = 'https://new-op.example.com';

        // Verify cache is empty
        expect(validator.cache.has(opEntityId)).toBe(false);

        // Validate OP - should perform fresh validation
        const result = await validator.validateOP(opEntityId);

        // Verify cache miss
        expect(result.cached).toBe(false);
        
        // Verify new cache entry was created
        expect(validator.cache.has(opEntityId)).toBe(true);
      });

      test('should cache validation result after cache miss', async () => {
        const opEntityId = 'https://new-op.example.com';

        // First validation - cache miss
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);

        // Second validation - cache hit
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.cached).toBe(true);
        
        // Results should be consistent
        expect(result2.isValid).toBe(result1.isValid);
      });

      test('should handle multiple different OPs in cache', async () => {
        const op1 = 'https://op1.example.com';
        const op2 = 'https://op2.example.com';
        const op3 = 'https://op3.example.com';

        // Validate multiple OPs
        await validator.validateOP(op1);
        await validator.validateOP(op2);
        await validator.validateOP(op3);

        // All should be cached
        expect(validator.cache.has(op1)).toBe(true);
        expect(validator.cache.has(op2)).toBe(true);
        expect(validator.cache.has(op3)).toBe(true);
        expect(validator.cache.size).toBe(3);
      });
    });

    describe('Expired Entry Removal', () => {
      test('should remove expired entry on access', async () => {
        const opEntityId = 'https://op.example.com';
        const now = Date.now();
        
        // Add entry that is already expired
        validator.cache.set(opEntityId, {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now - 2000,
          expiresAt: now - 1000 // Expired 1 second ago
        });

        expect(validator.cache.has(opEntityId)).toBe(true);

        // Access via validateOP - should remove expired entry
        const result = await validator.validateOP(opEntityId);

        // Should perform fresh validation
        expect(result.cached).toBe(false);
        
        // Old expired entry should be removed and new entry added
        const cacheEntry = validator.cache.get(opEntityId);
        expect(cacheEntry).toBeDefined();
        expect(cacheEntry.timestamp).toBeGreaterThan(now);
      });

      test('should remove expired entry via isOPValidated', () => {
        const opEntityId = 'https://op.example.com';
        const now = Date.now();
        
        // Add expired entry
        validator.cache.set(opEntityId, {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now - 2000,
          expiresAt: now - 1000
        });

        expect(validator.cache.has(opEntityId)).toBe(true);

        // Check validation status - should remove expired entry
        const isValid = validator.isOPValidated(opEntityId);

        expect(isValid).toBe(false);
        expect(validator.cache.has(opEntityId)).toBe(false);
      });

      test('should handle multiple expired entries', async () => {
        const now = Date.now();
        
        // Add multiple expired entries
        validator.cache.set('https://op1.example.com', {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now - 2000,
          expiresAt: now - 1000
        });
        
        validator.cache.set('https://op2.example.com', {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now - 2000,
          expiresAt: now - 1000
        });
        
        // Add valid entry
        validator.cache.set('https://op3.example.com', {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now,
          expiresAt: now + 5000
        });

        expect(validator.cache.size).toBe(3);

        // Trigger cleanup
        validator._cleanupExpiredEntries();

        // Only valid entry should remain
        expect(validator.cache.size).toBe(1);
        expect(validator.cache.has('https://op3.example.com')).toBe(true);
      });

      test('should automatically clean up expired entries periodically', async () => {
        // Create validator with short expiration for testing
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl: 'https://trust-anchor.example.com',
          cacheExpirationMs: 50 // 50ms
        });

        // Override cleanup interval to 100ms for testing
        clearInterval(testValidator.cleanupInterval);
        testValidator.cleanupIntervalMs = 100;
        testValidator.cleanupInterval = setInterval(() => {
          testValidator._cleanupExpiredEntries();
        }, testValidator.cleanupIntervalMs);

        const now = Date.now();
        
        // Add entries that will expire quickly
        testValidator.cache.set('https://op1.example.com', {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now,
          expiresAt: now + 30 // Expires in 30ms
        });

        testValidator.cache.set('https://op2.example.com', {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now,
          expiresAt: now + 30
        });

        expect(testValidator.cache.size).toBe(2);

        // Wait for expiration and cleanup
        await new Promise(resolve => setTimeout(resolve, 150));

        // Entries should be cleaned up
        expect(testValidator.cache.size).toBe(0);

        testValidator.destroy();
      });
    });

    describe('Cache Clearing', () => {
      test('should clear all cache entries', () => {
        const now = Date.now();
        
        // Add multiple entries
        validator.cache.set('https://op1.example.com', {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now,
          expiresAt: now + 5000
        });
        
        validator.cache.set('https://op2.example.com', {
          isValid: false,
          errors: [{ code: 'error', message: 'Failed' }],
          timestamp: now,
          expiresAt: now + 5000
        });
        
        validator.cache.set('https://op3.example.com', {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now,
          expiresAt: now + 5000
        });

        expect(validator.cache.size).toBe(3);

        // Clear cache
        validator.clearCache();

        // All entries should be removed
        expect(validator.cache.size).toBe(0);
        expect(validator.cache.has('https://op1.example.com')).toBe(false);
        expect(validator.cache.has('https://op2.example.com')).toBe(false);
        expect(validator.cache.has('https://op3.example.com')).toBe(false);
      });

      test('should clear cache with both valid and expired entries', () => {
        const now = Date.now();
        
        // Add valid entry
        validator.cache.set('https://op1.example.com', {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now,
          expiresAt: now + 5000
        });
        
        // Add expired entry
        validator.cache.set('https://op2.example.com', {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now - 2000,
          expiresAt: now - 1000
        });

        expect(validator.cache.size).toBe(2);

        validator.clearCache();

        expect(validator.cache.size).toBe(0);
      });

      test('should allow new entries after cache clear', async () => {
        const now = Date.now();
        
        // Add entry
        validator.cache.set('https://op1.example.com', {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now,
          expiresAt: now + 5000
        });

        // Clear cache
        validator.clearCache();
        expect(validator.cache.size).toBe(0);

        // Add new entry via validation
        await validator.validateOP('https://op2.example.com');

        // New entry should be cached
        expect(validator.cache.size).toBe(1);
        expect(validator.cache.has('https://op2.example.com')).toBe(true);
      });

      test('should clear cache on RP restart (simulated)', () => {
        const now = Date.now();
        
        // Add entries
        validator.cache.set('https://op1.example.com', {
          isValid: true,
          trustAnchor: 'https://trust-anchor.example.com',
          timestamp: now,
          expiresAt: now + 5000
        });

        expect(validator.cache.size).toBe(1);

        // Simulate restart by creating new validator instance
        const newValidator = new OPTrustChainValidator({
          trustAnchorUrl: 'https://trust-anchor.example.com',
          cacheExpirationMs: 1000
        });

        // New validator should have empty cache
        expect(newValidator.cache.size).toBe(0);
        expect(newValidator.cache.has('https://op1.example.com')).toBe(false);

        newValidator.destroy();
      });

      test('should handle clearing empty cache', () => {
        expect(validator.cache.size).toBe(0);

        // Should not throw error
        expect(() => {
          validator.clearCache();
        }).not.toThrow();

        expect(validator.cache.size).toBe(0);
      });
    });
  });

  // Task 7.6: Unit tests for validation error handling
  // Requirements: 6.2, 6.3, 6.4
  describe('Validation Error Handling (Task 7.6)', () => {
    let validator;

    beforeEach(() => {
      validator = new OPTrustChainValidator({
        trustAnchorUrl: 'https://trust-anchor.example.com',
        cacheExpirationMs: 3600000
      });
    });

    afterEach(() => {
      if (validator) {
        validator.destroy();
      }
    });

    describe('Invalid Signature (Requirement 6.2)', () => {
      test('should handle invalid JWT signature error', async () => {
        // Mock validator to return invalid signature error
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'invalid_signature',
                message: 'JWT signature verification failed'
              }
            ]
          };
        };

        const opEntityId = 'https://op-invalid-sig.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error is categorized as invalid_signature
        expect(result.errors[0].code).toBe('invalid_signature');
        expect(result.errors[0].message).toContain('Invalid JWT signature');
      });

      test('should include OP entity ID in invalid signature error', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'invalid_signature',
                message: 'Signature verification failed for entity statement'
              }
            ]
          };
        };

        const opEntityId = 'https://op-bad-signature.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.opEntityId).toBe(opEntityId);
        expect(result.errors[0].details).toHaveProperty('opEntityId', opEntityId);
      });

      test('should handle signature error with message containing "signature"', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'trust_chain_validation_failed',
                message: 'Entity statement signature is invalid'
              }
            ]
          };
        };

        const opEntityId = 'https://op-sig-error.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('invalid_signature');
        expect(result.errors[0].message).toContain('Invalid JWT signature');
      });

      test('should preserve original error details for invalid signature', async () => {
        const originalError = {
          code: 'invalid_signature',
          message: 'RS256 signature verification failed',
          details: { algorithm: 'RS256', keyId: 'key-123' }
        };

        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [originalError]
          };
        };

        const opEntityId = 'https://op-sig-details.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].details).toHaveProperty('originalError', 'invalid_signature');
        expect(result.errors[0].details).toHaveProperty('originalMessage', originalError.message);
        expect(result.errors[0].details).toHaveProperty('originalDetails');
      });

      test('should cache invalid signature validation failure', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'invalid_signature',
                message: 'Signature verification failed'
              }
            ]
          };
        };

        const opEntityId = 'https://op-cache-sig-error.example.com';
        
        // First validation - should perform validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(false);
        expect(result1.cached).toBe(false);
        expect(result1.errors[0].code).toBe('invalid_signature');

        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(false);
        expect(result2.cached).toBe(true);
        expect(result2.errors[0].code).toBe('invalid_signature');
      });
    });

    describe('Missing Authority Hints (Requirement 6.3)', () => {
      test('should handle missing authority_hints error', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'entity_not_found',
                message: 'No authority_hints found in entity configuration'
              }
            ]
          };
        };

        const opEntityId = 'https://op-no-hints.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error is categorized as missing_authority_hints
        expect(result.errors[0].code).toBe('missing_authority_hints');
        expect(result.errors[0].message).toContain('not part of a federation');
      });

      test('should handle error message containing "authority_hints"', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'validation_error',
                message: 'Entity configuration missing authority_hints field'
              }
            ]
          };
        };

        const opEntityId = 'https://op-missing-hints.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('missing_authority_hints');
        expect(result.errors[0].message).toContain('not part of a federation');
      });

      test('should handle "No trust chain" error as missing authority hints', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'trust_chain_error',
                message: 'No trust chain could be established'
              }
            ]
          };
        };

        const opEntityId = 'https://op-no-chain.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('missing_authority_hints');
      });

      test('should include OP entity ID in missing authority hints error', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'entity_not_found',
                message: 'No authority_hints in entity configuration'
              }
            ]
          };
        };

        const opEntityId = 'https://op-hints-error.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.opEntityId).toBe(opEntityId);
        expect(result.errors[0].details).toHaveProperty('opEntityId', opEntityId);
      });

      test('should cache missing authority hints validation failure', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'entity_not_found',
                message: 'No authority_hints found'
              }
            ]
          };
        };

        const opEntityId = 'https://op-cache-hints-error.example.com';
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(false);
        expect(result1.cached).toBe(false);
        expect(result1.errors[0].code).toBe('missing_authority_hints');

        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(false);
        expect(result2.cached).toBe(true);
        expect(result2.errors[0].code).toBe('missing_authority_hints');
      });
    });

    describe('Incomplete Trust Chain (Requirement 6.4)', () => {
      test('should handle trust chain not reaching Trust Anchor', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'invalid_trust_anchor',
                message: 'Trust chain does not terminate at configured trust anchor'
              }
            ]
          };
        };

        const opEntityId = 'https://op-incomplete-chain.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error is categorized as trust_chain_invalid
        expect(result.errors[0].code).toBe('trust_chain_invalid');
        expect(result.errors[0].message).toContain('does not terminate at configured Trust Anchor');
      });

      test('should handle error message containing "trust anchor"', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'validation_error',
                message: 'Trust anchor mismatch: expected https://trust-anchor.example.com'
              }
            ]
          };
        };

        const opEntityId = 'https://op-wrong-anchor.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('trust_chain_invalid');
        expect(result.errors[0].message).toContain('does not terminate at configured Trust Anchor');
      });

      test('should handle error message containing "Trust anchor" (capitalized)', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'chain_error',
                message: 'Trust anchor validation failed'
              }
            ]
          };
        };

        const opEntityId = 'https://op-anchor-fail.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].code).toBe('trust_chain_invalid');
      });

      test('should include OP entity ID in incomplete trust chain error', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'invalid_trust_anchor',
                message: 'Chain does not reach trust anchor'
              }
            ]
          };
        };

        const opEntityId = 'https://op-chain-error.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.opEntityId).toBe(opEntityId);
        expect(result.errors[0].details).toHaveProperty('opEntityId', opEntityId);
      });

      test('should preserve original error details for incomplete trust chain', async () => {
        const originalError = {
          code: 'invalid_trust_anchor',
          message: 'Trust chain terminates at wrong anchor',
          details: {
            expectedAnchor: 'https://trust-anchor.example.com',
            actualAnchor: 'https://other-anchor.example.com'
          }
        };

        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [originalError]
          };
        };

        const opEntityId = 'https://op-chain-details.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors[0].details).toHaveProperty('originalError', 'invalid_trust_anchor');
        expect(result.errors[0].details).toHaveProperty('originalMessage', originalError.message);
        expect(result.errors[0].details).toHaveProperty('originalDetails');
      });

      test('should cache incomplete trust chain validation failure', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'invalid_trust_anchor',
                message: 'Trust chain incomplete'
              }
            ]
          };
        };

        const opEntityId = 'https://op-cache-chain-error.example.com';
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(false);
        expect(result1.cached).toBe(false);
        expect(result1.errors[0].code).toBe('trust_chain_invalid');

        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(false);
        expect(result2.cached).toBe(true);
        expect(result2.errors[0].code).toBe('trust_chain_invalid');
      });
    });

    describe('Multiple Validation Errors', () => {
      test('should handle multiple validation errors', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'invalid_signature',
                message: 'Signature verification failed'
              },
              {
                code: 'invalid_trust_anchor',
                message: 'Trust anchor mismatch'
              }
            ]
          };
        };

        const opEntityId = 'https://op-multiple-errors.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBe(2);
        
        // Verify both errors are categorized correctly
        expect(result.errors[0].code).toBe('invalid_signature');
        expect(result.errors[1].code).toBe('trust_chain_invalid');
      });

      test('should include all error details in response', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'invalid_signature',
                message: 'Error 1'
              },
              {
                code: 'entity_not_found',
                message: 'Error 2'
              },
              {
                code: 'invalid_trust_anchor',
                message: 'Error 3'
              }
            ]
          };
        };

        const opEntityId = 'https://op-all-errors.example.com';
        const result = await validator.validateOP(opEntityId);

        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBe(3);
        
        // All errors should have required fields
        result.errors.forEach(error => {
          expect(error).toHaveProperty('code');
          expect(error).toHaveProperty('message');
          expect(error).toHaveProperty('details');
          expect(error.details).toHaveProperty('opEntityId', opEntityId);
        });
      });
    });

    describe('Error Response Consistency', () => {
      test('should return consistent error structure for all validation failures', async () => {
        const errorTypes = [
          { code: 'invalid_signature', message: 'Signature failed' },
          { code: 'entity_not_found', message: 'No authority hints' },
          { code: 'invalid_trust_anchor', message: 'Wrong anchor' }
        ];

        for (const errorType of errorTypes) {
          validator.validator.validateTrustChain = async () => {
            return {
              isValid: false,
              errors: [errorType]
            };
          };

          const opEntityId = `https://op-${errorType.code}.example.com`;
          const result = await validator.validateOP(opEntityId);

          // Verify consistent structure
          expect(result).toHaveProperty('isValid', false);
          expect(result).toHaveProperty('opEntityId', opEntityId);
          expect(result).toHaveProperty('errors');
          expect(result).toHaveProperty('cached', false);
          expect(result).toHaveProperty('timestamp');
          expect(Array.isArray(result.errors)).toBe(true);
          expect(result.errors.length).toBeGreaterThan(0);
        }
      });

      test('should include timestamp in all validation error responses', async () => {
        validator.validator.validateTrustChain = async () => {
          return {
            isValid: false,
            errors: [
              {
                code: 'invalid_signature',
                message: 'Validation failed'
              }
            ]
          };
        };

        const opEntityId = 'https://op-timestamp.example.com';
        const beforeTime = Date.now();
        const result = await validator.validateOP(opEntityId);
        const afterTime = Date.now();

        expect(result).toHaveProperty('timestamp');
        expect(result.timestamp).toBeGreaterThanOrEqual(beforeTime);
        expect(result.timestamp).toBeLessThanOrEqual(afterTime);
        
        // Error details should also have timestamp
        expect(result.errors[0].details).toHaveProperty('timestamp');
      });
    });
  });
});
