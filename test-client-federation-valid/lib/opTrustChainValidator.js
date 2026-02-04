/**
 * OP Trust Chain Validator Service for RP
 * 
 * Validates that OpenID Providers (OPs) are registered in the Trust Anchor
 * before initiating authentication flows.
 * 
 * This service reuses the existing TypeScript trust chain validation components:
 * - TrustChainResolver: Fetches entity configurations and resolves trust chains
 * - TrustAnchorValidator: Validates trust chain termination
 * 
 * Note: We use TrustChainResolver directly instead of IntegratedTrustChainValidator
 * because IntegratedTrustChainValidator is designed for RP validation and tries to
 * extract client metadata, which is not applicable for OP validation.
 * 
 * Implements Requirements: 1.1, 1.2, 9.1, 9.4
 */

import { TrustChainResolver } from '../../dist/federation/trustChainResolver.js';
import { TrustAnchorValidator } from '../../dist/federation/trustAnchorValidator.js';

/**
 * Error codes for OP trust chain validation
 * Implements Requirements: 3.4, 6.1, 6.2, 6.3, 6.4, 6.5
 */
const ERROR_CODES = {
  OP_UNREACHABLE: 'op_unreachable',
  INVALID_SIGNATURE: 'invalid_signature',
  MISSING_AUTHORITY_HINTS: 'missing_authority_hints',
  TRUST_CHAIN_INVALID: 'trust_chain_invalid',
  VALIDATION_ERROR: 'validation_error',
  NETWORK_ERROR: 'network_error',
  TIMEOUT: 'timeout'
};

/**
 * Create a standardized error response structure
 * Implements Requirements: 3.4, 6.5
 * 
 * @param {string} opEntityId - OP's entity ID
 * @param {Array} errors - Array of validation errors
 * @returns {Object} Standardized error response
 */
function createErrorResponse(opEntityId, errors) {
  return {
    isValid: false,
    trustAnchor: undefined, // Include trustAnchor for consistency with cached responses
    opEntityId,
    errors: errors || [],
    cached: false,
    timestamp: Date.now()
  };
}

/**
 * Create a validation error object
 * 
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {Object} details - Additional error details
 * @returns {Object} Validation error object
 */
function createValidationError(code, message, details = {}) {
  return {
    code,
    message,
    details: {
      ...details,
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * OPTrustChainValidator class
 * 
 * Validates OP trust chains before authentication flows
 */
class OPTrustChainValidator {
  /**
   * Create a new OP Trust Chain Validator
   * 
   * @param {Object} config - Configuration options
   * @param {string} config.trustAnchorUrl - Trust Anchor URL
   * @param {number} [config.cacheExpirationMs=3600000] - Cache expiration time in milliseconds (default: 1 hour)
   */
  constructor(config) {
    if (!config || !config.trustAnchorUrl) {
      throw new Error('Trust Anchor URL is required');
    }

    // Validate Trust Anchor URL format (must be HTTPS)
    if (!config.trustAnchorUrl.startsWith('https://') && !config.trustAnchorUrl.startsWith('http://localhost')) {
      throw new Error('Trust Anchor URL must use HTTPS protocol (or http://localhost for development)');
    }

    this.trustAnchorUrl = config.trustAnchorUrl;
    this.cacheExpirationMs = config.cacheExpirationMs || 3600000; // Default: 1 hour

    // Initialize cache storage (Map)
    this.cache = new Map();

    // Initialize the trust chain resolver and validator from TypeScript codebase
    this.resolver = new TrustChainResolver([this.trustAnchorUrl]);
    this.trustAnchorValidator = new TrustAnchorValidator([this.trustAnchorUrl]);

    // Start periodic cleanup to remove expired entries (every 10 minutes)
    this.cleanupIntervalMs = 10 * 60 * 1000; // 10 minutes
    this.cleanupInterval = setInterval(() => {
      this._cleanupExpiredEntries();
    }, this.cleanupIntervalMs);

    // Ensure cleanup interval doesn't prevent process from exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }

    console.log('OPTrustChainValidator initialized', {
      trustAnchorUrl: this.trustAnchorUrl,
      cacheExpirationMs: this.cacheExpirationMs,
      cleanupIntervalMs: this.cleanupIntervalMs
    });
  }

  /**
   * Validate OP trust chain
   * 
   * Implements Requirements: 1.1, 1.3, 1.4, 1.5, 2.4, 6.1, 6.2, 6.3, 6.4, 6.5
   * 
   * @param {string} opEntityId - OP's entity ID
   * @param {Object} requestContext - Optional request context for logging (sessionId, userAgent, etc.)
   * @returns {Promise<ValidationResult>} Validation result
   */
  async validateOP(opEntityId, requestContext = {}) {
    const logContext = {
      opEntityId,
      timestamp: new Date().toISOString(),
      ...requestContext
    };

    console.log('Starting OP trust chain validation', logContext);

    try {
      // Check cache first
      const cacheEntry = this.cache.get(opEntityId);
      if (cacheEntry) {
        const now = Date.now();
        if (now < cacheEntry.expiresAt) {
          console.log('Cache hit: Using cached validation result', { 
            ...logContext,
            isValid: cacheEntry.isValid,
            cached: true,
            expiresAt: new Date(cacheEntry.expiresAt).toISOString()
          });
          
          return {
            isValid: cacheEntry.isValid,
            trustAnchor: cacheEntry.trustAnchor,
            errors: cacheEntry.errors, // Return cached errors as-is
            opEntityId,
            cached: true,
            timestamp: cacheEntry.timestamp
          };
        } else {
          // Remove expired entry
          this.cache.delete(opEntityId);
          console.log('Cache miss: Cache entry expired, performing fresh validation', logContext);
        }
      } else {
        console.log('Cache miss: No cached entry found', logContext);
      }

      // Perform fresh validation using the trust chain resolver
      console.log('Resolving trust chain for OP', logContext);
      
      // Set timeout for validation (10 seconds)
      // Implements Requirement 6.1
      const validationPromise = this.resolver.resolveTrustChain(opEntityId);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Validation timeout: OP entity configuration fetch exceeded 10 seconds'));
        }, 10000);
      });

      let resolvedChain;
      try {
        resolvedChain = await Promise.race([validationPromise, timeoutPromise]);
      } catch (error) {
        // Handle timeout or network error (Requirement 6.1)
        // Log validation failure with error details (Requirement 2.4, 6.5)
        
        // Determine if this is a timeout or network error
        const isTimeout = error.message.includes('Validation timeout');
        const errorCode = isTimeout ? ERROR_CODES.TIMEOUT : ERROR_CODES.NETWORK_ERROR;
        const errorMessage = isTimeout 
          ? 'OP entity configuration fetch timed out after 10 seconds'
          : `OP entity configuration could not be fetched: ${error.message}`;
        
        console.error('OP entity configuration fetch failed', {
          ...logContext,
          error: error.message,
          errorType: isTimeout ? 'timeout' : 'network'
        });

        const errors = [
          createValidationError(
            errorCode,
            errorMessage,
            { opEntityId, timeout: isTimeout ? '10s' : undefined }
          )
        ];

        // Cache the failed validation result
        const now = Date.now();
        const failedCacheEntry = {
          isValid: false,
          errors: errors,
          timestamp: now,
          expiresAt: now + this.cacheExpirationMs
        };
        this.cache.set(opEntityId, failedCacheEntry);

        return createErrorResponse(opEntityId, errors);
      }

      // Validate that the trust chain terminates at the configured Trust Anchor
      const validationResult = await this.trustAnchorValidator.validateTrustChainTermination(resolvedChain);
      const isValid = validationResult.isValid;
      const trustAnchor = isValid ? this.trustAnchorUrl : undefined;

      console.log('Trust chain validation completed', {
        ...logContext,
        isValid,
        trustAnchor,
        errorCount: isValid ? 0 : 1
      });

      // Handle validation failures with specific error codes
      // Implements Requirements 6.2, 6.3, 6.4
      if (!isValid) {
        const errors = [
          createValidationError(
            ERROR_CODES.TRUST_CHAIN_INVALID,
            validationResult.errors?.[0]?.message || 'Trust chain does not terminate at configured Trust Anchor',
            { opEntityId, trustAnchor: this.trustAnchorUrl }
          )
        ];
        
        // Log validation failure with error details (Requirement 2.4, 6.5)
        console.error('OP trust chain validation failed', {
          ...logContext,
          errorCount: errors.length,
          errors: errors
        });

        // Cache the failed validation result
        const now = Date.now();
        const failedCacheEntry = {
          isValid: false,
          errors: errors,
          timestamp: now,
          expiresAt: now + this.cacheExpirationMs
        };
        this.cache.set(opEntityId, failedCacheEntry);

        console.log('Failed validation result cached', {
          ...logContext,
          expiresAt: new Date(failedCacheEntry.expiresAt).toISOString()
        });

        // Return errors in the response
        return createErrorResponse(opEntityId, errors);
      }

      // Store validation result in cache
      const now = Date.now();
      const newCacheEntry = {
        isValid: true,
        trustAnchor: trustAnchor,
        errors: [],
        timestamp: now,
        expiresAt: now + this.cacheExpirationMs
      };
      this.cache.set(opEntityId, newCacheEntry);

      console.log('Validation result cached', {
        ...logContext,
        expiresAt: new Date(newCacheEntry.expiresAt).toISOString()
      });

      return {
        isValid: true,
        trustAnchor: trustAnchor,
        errors: [],
        opEntityId,
        cached: false,
        timestamp: now
      };

    } catch (error) {
      // Handle network errors and other exceptions
      // Implements Requirement 6.1
      // Log validation failure with error details (Requirement 2.4, 6.5)
      console.error('OP trust chain validation failed with exception', {
        ...logContext,
        error: error.message,
        errorName: error.name,
        stack: error.stack
      });

      // Categorize the error
      let errorCode = ERROR_CODES.VALIDATION_ERROR;
      let errorMessage = `Trust chain validation failed: ${error.message}`;

      // Check for network-related errors
      if (error.message.includes('fetch') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('ENOTFOUND') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('unreachable') ||
          error.message.includes('Failed to fetch entity configuration')) {
        errorCode = ERROR_CODES.NETWORK_ERROR;
        errorMessage = `OP entity configuration could not be fetched: ${error.message}`;
      }

      const errors = [
        createValidationError(errorCode, errorMessage, {
          opEntityId,
          error: error.message,
          errorType: error.name
        })
      ];

      // Cache the failed validation result
      const now = Date.now();
      const failedCacheEntry = {
        isValid: false,
        errors: errors,
        timestamp: now,
        expiresAt: now + this.cacheExpirationMs
      };
      this.cache.set(opEntityId, failedCacheEntry);

      // Return validation failure with error details
      return createErrorResponse(opEntityId, errors);
    }
  }

  /**
   * Check if OP is validated (from cache)
   * 
   * @param {string} opEntityId - OP's entity ID
   * @returns {boolean} True if OP is in cache and not expired
   */
  isOPValidated(opEntityId) {
    const cacheEntry = this.cache.get(opEntityId);
    
    if (!cacheEntry) {
      return false;
    }

    // Check if cache entry is expired
    const now = Date.now();
    if (now >= cacheEntry.expiresAt) {
      // Remove expired entry
      this.cache.delete(opEntityId);
      return false;
    }

    return cacheEntry.isValid;
  }

  /**
   * Clear validation cache
   */
  clearCache() {
    this.cache.clear();
    console.log('Validation cache cleared');
  }

  /**
   * Clean up expired cache entries
   * 
   * This method is called periodically to remove expired entries from the cache.
   * It can also be called manually if needed.
   * 
   * @private
   */
  _cleanupExpiredEntries() {
    const now = Date.now();
    let removedCount = 0;

    for (const [opEntityId, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(opEntityId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log('Cleaned up expired cache entries', {
        removedCount,
        remainingEntries: this.cache.size
      });
    }
  }

  /**
   * Stop periodic cleanup
   * 
   * This method should be called when shutting down the validator
   * to prevent the cleanup interval from keeping the process alive.
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('OPTrustChainValidator destroyed, cleanup interval stopped');
    }
  }

  /**
   * Get cache statistics
   * 
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const [, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries
    };
  }
}

export { OPTrustChainValidator, ERROR_CODES };
