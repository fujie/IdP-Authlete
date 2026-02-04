import axios from 'axios';

/**
 * OP Discovery Service
 * 
 * Fetches and parses OpenID Connect Discovery metadata from OPs.
 * Implements caching to avoid repeated network calls.
 */
class OPDiscoveryService {
  constructor(options = {}) {
    this.timeout = options.timeout || 10000; // 10 seconds default
    this.cacheTTL = options.cacheTTL || 3600000; // 1 hour default
    this.cache = new Map();
    
    console.log('OPDiscoveryService initialized', {
      timeout: this.timeout,
      cacheTTL: this.cacheTTL
    });
  }

  /**
   * Discover OP metadata from .well-known/openid-configuration
   * @param {string} opEntityId - OP's entity ID (base URL)
   * @returns {Promise<Object>} Discovered OP metadata
   * @throws {Error} If discovery fails or metadata is invalid
   */
  async discoverOP(opEntityId) {
    console.log('Discovering OP metadata', { opEntityId });

    // Check cache first
    const cached = this.getCachedMetadata(opEntityId);
    if (cached) {
      console.log('Using cached OP metadata', { opEntityId });
      return { ...cached, cached: true };
    }

    // Construct discovery URL
    const discoveryUrl = this._constructDiscoveryUrl(opEntityId);
    console.log('Fetching discovery document', { discoveryUrl });

    try {
      // Fetch discovery document
      const response = await axios.get(discoveryUrl, {
        timeout: this.timeout,
        headers: {
          'Accept': 'application/json'
        }
      });

      const metadata = response.data;
      console.log('Discovery document fetched successfully', {
        opEntityId,
        issuer: metadata.issuer
      });

      // Validate required fields
      this._validateMetadata(metadata, opEntityId);

      // Add metadata
      const enrichedMetadata = {
        ...metadata,
        discoveredAt: Date.now(),
        cached: false
      };

      // Cache the metadata
      this._cacheMetadata(opEntityId, enrichedMetadata);

      return enrichedMetadata;

    } catch (error) {
      console.error('OP discovery failed', {
        opEntityId,
        discoveryUrl,
        error: error.message
      });

      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        throw new Error(`OP_UNREACHABLE: Could not connect to OP at ${opEntityId}. Please check the URL and try again.`);
      }

      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        throw new Error(`DISCOVERY_TIMEOUT: Discovery request to ${opEntityId} timed out after ${this.timeout}ms.`);
      }

      if (error.response) {
        throw new Error(`INVALID_DISCOVERY_RESPONSE: OP returned ${error.response.status} ${error.response.statusText}`);
      }

      throw new Error(`DISCOVERY_FAILED: ${error.message}`);
    }
  }

  /**
   * Construct discovery URL from entity ID
   * @param {string} opEntityId - OP's entity ID
   * @returns {string} Discovery URL
   * @private
   */
  _constructDiscoveryUrl(opEntityId) {
    // Remove all trailing slashes
    let baseUrl = opEntityId;
    while (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    return `${baseUrl}/.well-known/openid-configuration`;
  }

  /**
   * Validate that metadata contains required fields
   * @param {Object} metadata - Discovery metadata
   * @param {string} opEntityId - OP's entity ID (for error messages)
   * @throws {Error} If required fields are missing
   * @private
   */
  _validateMetadata(metadata, opEntityId) {
    const requiredFields = [
      'issuer',
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri'
    ];

    const missingFields = requiredFields.filter(field => !metadata[field]);

    if (missingFields.length > 0) {
      const error = new Error(
        `INVALID_DISCOVERY_RESPONSE: Discovery response from ${opEntityId} is missing required fields: ${missingFields.join(', ')}`
      );
      error.missingFields = missingFields;
      throw error;
    }

    console.log('OP metadata validation passed', {
      opEntityId,
      issuer: metadata.issuer,
      authorization_endpoint: metadata.authorization_endpoint,
      token_endpoint: metadata.token_endpoint,
      jwks_uri: metadata.jwks_uri
    });
  }

  /**
   * Cache metadata with TTL
   * @param {string} opEntityId - OP's entity ID
   * @param {Object} metadata - Metadata to cache
   * @private
   */
  _cacheMetadata(opEntityId, metadata) {
    const cacheEntry = {
      metadata,
      expiresAt: Date.now() + this.cacheTTL
    };

    this.cache.set(opEntityId, cacheEntry);
    console.log('OP metadata cached', {
      opEntityId,
      expiresAt: new Date(cacheEntry.expiresAt).toISOString()
    });
  }

  /**
   * Get cached OP metadata if available and not expired
   * @param {string} opEntityId - OP's entity ID
   * @returns {Object|null} Cached metadata or null
   */
  getCachedMetadata(opEntityId) {
    const cacheEntry = this.cache.get(opEntityId);

    if (!cacheEntry) {
      return null;
    }

    // Check if cache entry has expired
    if (Date.now() > cacheEntry.expiresAt) {
      console.log('Cached OP metadata expired', { opEntityId });
      this.cache.delete(opEntityId);
      return null;
    }

    return cacheEntry.metadata;
  }

  /**
   * Clear cached metadata for an OP
   * @param {string} opEntityId - OP's entity ID
   */
  clearCache(opEntityId) {
    if (opEntityId) {
      this.cache.delete(opEntityId);
      console.log('Cleared cache for OP', { opEntityId });
    } else {
      this.cache.clear();
      console.log('Cleared all OP metadata cache');
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

export { OPDiscoveryService };
