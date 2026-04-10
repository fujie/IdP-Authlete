import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios from 'axios';
import { OPDiscoveryService } from './opDiscoveryService.js';

// Mock axios
vi.mock('axios');

describe('OPDiscoveryService - Unit Tests', () => {
  let service;

  beforeEach(() => {
    service = new OPDiscoveryService({ timeout: 5000, cacheTTL: 60000 });
    vi.clearAllMocks();
  });

  describe('Discovery endpoint construction', () => {
    it('should construct discovery URL correctly', () => {
      const url = service._constructDiscoveryUrl('https://op.example.com');
      expect(url).toBe('https://op.example.com/.well-known/openid-configuration');
    });

    it('should handle trailing slash in entity_id', () => {
      const url = service._constructDiscoveryUrl('https://op.example.com/');
      expect(url).toBe('https://op.example.com/.well-known/openid-configuration');
    });

    it('should handle entity_id with path', () => {
      const url = service._constructDiscoveryUrl('https://op.example.com/path');
      expect(url).toBe('https://op.example.com/path/.well-known/openid-configuration');
    });

    it('should handle entity_id with port', () => {
      const url = service._constructDiscoveryUrl('https://op.example.com:8443');
      expect(url).toBe('https://op.example.com:8443/.well-known/openid-configuration');
    });
  });

  describe('Metadata validation', () => {
    it('should validate metadata with all required fields', () => {
      const metadata = {
        issuer: 'https://op.example.com',
        authorization_endpoint: 'https://op.example.com/authorize',
        token_endpoint: 'https://op.example.com/token',
        jwks_uri: 'https://op.example.com/jwks'
      };

      expect(() => {
        service._validateMetadata(metadata, 'https://op.example.com');
      }).not.toThrow();
    });

    it('should throw error when issuer is missing', () => {
      const metadata = {
        authorization_endpoint: 'https://op.example.com/authorize',
        token_endpoint: 'https://op.example.com/token',
        jwks_uri: 'https://op.example.com/jwks'
      };

      expect(() => {
        service._validateMetadata(metadata, 'https://op.example.com');
      }).toThrow('missing required fields: issuer');
    });

    it('should throw error when authorization_endpoint is missing', () => {
      const metadata = {
        issuer: 'https://op.example.com',
        token_endpoint: 'https://op.example.com/token',
        jwks_uri: 'https://op.example.com/jwks'
      };

      expect(() => {
        service._validateMetadata(metadata, 'https://op.example.com');
      }).toThrow('missing required fields: authorization_endpoint');
    });

    it('should throw error when multiple fields are missing', () => {
      const metadata = {
        issuer: 'https://op.example.com'
      };

      try {
        service._validateMetadata(metadata, 'https://op.example.com');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error.message).toContain('missing required fields');
        expect(error.missingFields).toContain('authorization_endpoint');
        expect(error.missingFields).toContain('token_endpoint');
        expect(error.missingFields).toContain('jwks_uri');
      }
    });
  });

  describe('Caching', () => {
    it('should cache metadata after successful discovery', async () => {
      const metadata = {
        issuer: 'https://op.example.com',
        authorization_endpoint: 'https://op.example.com/authorize',
        token_endpoint: 'https://op.example.com/token',
        jwks_uri: 'https://op.example.com/jwks'
      };

      axios.get.mockResolvedValue({ data: metadata });

      await service.discoverOP('https://op.example.com');

      const cached = service.getCachedMetadata('https://op.example.com');
      expect(cached).toBeDefined();
      expect(cached.issuer).toBe(metadata.issuer);
    });

    it('should return cached metadata on second call', async () => {
      const metadata = {
        issuer: 'https://op.example.com',
        authorization_endpoint: 'https://op.example.com/authorize',
        token_endpoint: 'https://op.example.com/token',
        jwks_uri: 'https://op.example.com/jwks'
      };

      axios.get.mockResolvedValue({ data: metadata });

      // First call
      const result1 = await service.discoverOP('https://op.example.com');
      expect(result1.cached).toBe(false);

      // Second call should use cache
      const result2 = await service.discoverOP('https://op.example.com');
      expect(result2.cached).toBe(true);

      // axios.get should only be called once
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('should clear cache for specific OP', async () => {
      const metadata = {
        issuer: 'https://op.example.com',
        authorization_endpoint: 'https://op.example.com/authorize',
        token_endpoint: 'https://op.example.com/token',
        jwks_uri: 'https://op.example.com/jwks'
      };

      axios.get.mockResolvedValue({ data: metadata });

      await service.discoverOP('https://op.example.com');
      expect(service.getCachedMetadata('https://op.example.com')).toBeDefined();

      service.clearCache('https://op.example.com');
      expect(service.getCachedMetadata('https://op.example.com')).toBeNull();
    });

    it('should clear all cache when no entity_id provided', async () => {
      const metadata = {
        issuer: 'https://op.example.com',
        authorization_endpoint: 'https://op.example.com/authorize',
        token_endpoint: 'https://op.example.com/token',
        jwks_uri: 'https://op.example.com/jwks'
      };

      axios.get.mockResolvedValue({ data: metadata });

      await service.discoverOP('https://op1.example.com');
      await service.discoverOP('https://op2.example.com');

      service.clearCache();

      expect(service.getCachedMetadata('https://op1.example.com')).toBeNull();
      expect(service.getCachedMetadata('https://op2.example.com')).toBeNull();
    });

    it('should expire cache after TTL', async () => {
      const shortTTLService = new OPDiscoveryService({ cacheTTL: 100 }); // 100ms TTL

      const metadata = {
        issuer: 'https://op.example.com',
        authorization_endpoint: 'https://op.example.com/authorize',
        token_endpoint: 'https://op.example.com/token',
        jwks_uri: 'https://op.example.com/jwks'
      };

      axios.get.mockResolvedValue({ data: metadata });

      await shortTTLService.discoverOP('https://op.example.com');
      expect(shortTTLService.getCachedMetadata('https://op.example.com')).toBeDefined();

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(shortTTLService.getCachedMetadata('https://op.example.com')).toBeNull();
    });
  });

  describe('Error handling - Unreachable OP', () => {
    it('should throw OP_UNREACHABLE error when connection is refused', async () => {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      axios.get.mockRejectedValue(error);

      await expect(service.discoverOP('https://op.example.com')).rejects.toThrow('OP_UNREACHABLE');
      await expect(service.discoverOP('https://op.example.com')).rejects.toThrow('Could not connect to OP');
    });

    it('should throw OP_UNREACHABLE error when host is not found', async () => {
      const error = new Error('getaddrinfo ENOTFOUND');
      error.code = 'ENOTFOUND';
      axios.get.mockRejectedValue(error);

      await expect(service.discoverOP('https://nonexistent.example.com')).rejects.toThrow('OP_UNREACHABLE');
    });
  });

  describe('Error handling - Timeout', () => {
    it('should throw DISCOVERY_TIMEOUT error when request times out', async () => {
      const error = new Error('timeout of 5000ms exceeded');
      error.code = 'ECONNABORTED';
      axios.get.mockRejectedValue(error);

      await expect(service.discoverOP('https://slow-op.example.com')).rejects.toThrow('DISCOVERY_TIMEOUT');
      await expect(service.discoverOP('https://slow-op.example.com')).rejects.toThrow('timed out');
    });
  });

  describe('Error handling - Invalid response', () => {
    it('should throw INVALID_DISCOVERY_RESPONSE error for 404', async () => {
      const error = new Error('Request failed with status code 404');
      error.response = { status: 404, statusText: 'Not Found' };
      axios.get.mockRejectedValue(error);

      await expect(service.discoverOP('https://op.example.com')).rejects.toThrow('INVALID_DISCOVERY_RESPONSE');
      await expect(service.discoverOP('https://op.example.com')).rejects.toThrow('404 Not Found');
    });

    it('should throw INVALID_DISCOVERY_RESPONSE error for 500', async () => {
      const error = new Error('Request failed with status code 500');
      error.response = { status: 500, statusText: 'Internal Server Error' };
      axios.get.mockRejectedValue(error);

      await expect(service.discoverOP('https://op.example.com')).rejects.toThrow('INVALID_DISCOVERY_RESPONSE');
      await expect(service.discoverOP('https://op.example.com')).rejects.toThrow('500 Internal Server Error');
    });

    it('should throw error when response is missing required fields', async () => {
      const incompleteMetadata = {
        issuer: 'https://op.example.com'
        // Missing other required fields
      };

      axios.get.mockResolvedValue({ data: incompleteMetadata });

      await expect(service.discoverOP('https://op.example.com')).rejects.toThrow('INVALID_DISCOVERY_RESPONSE');
      await expect(service.discoverOP('https://op.example.com')).rejects.toThrow('missing required fields');
    });
  });

  describe('Cache statistics', () => {
    it('should return cache statistics', async () => {
      const metadata = {
        issuer: 'https://op.example.com',
        authorization_endpoint: 'https://op.example.com/authorize',
        token_endpoint: 'https://op.example.com/token',
        jwks_uri: 'https://op.example.com/jwks'
      };

      axios.get.mockResolvedValue({ data: metadata });

      await service.discoverOP('https://op1.example.com');
      await service.discoverOP('https://op2.example.com');

      const stats = service.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.entries).toContain('https://op1.example.com');
      expect(stats.entries).toContain('https://op2.example.com');
    });
  });
});
