/**
 * Unit tests for Trust Anchor URL configuration validation
 * 
 * Tests Requirements: 9.1, 9.2, 9.3
 * - Test missing Trust Anchor URL
 * - Test invalid URL format
 * - Test valid HTTPS URL
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Validate Trust Anchor URL configuration
 * This is extracted from server.js for testing purposes
 * 
 * @param {string} url - Trust Anchor URL to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function validateTrustAnchorUrl(url) {
  if (!url) {
    console.error('FATAL: TRUST_ANCHOR_URL is not configured');
    console.error('Configuration Error Details:');
    console.error('  - Environment variable TRUST_ANCHOR_URL is missing or empty');
    console.error('  - This variable is required for OP trust chain validation');
    console.error('  - Please set TRUST_ANCHOR_URL to a valid HTTPS URL');
    console.error('  - Example: TRUST_ANCHOR_URL=https://trust-anchor.example.com');
    return false;
  }

  // Validate URL format (must be HTTPS)
  try {
    const parsedUrl = new URL(url);
    
    if (parsedUrl.protocol !== 'https:') {
      console.error('FATAL: TRUST_ANCHOR_URL must use HTTPS protocol');
      console.error('Configuration Error Details:');
      console.error(`  - Provided URL: ${url}`);
      console.error(`  - Protocol: ${parsedUrl.protocol}`);
      console.error('  - Required protocol: https:');
      console.error('  - Security requirement: Trust Anchor URLs must use HTTPS for secure communication');
      console.error('  - Please update TRUST_ANCHOR_URL to use HTTPS');
      return false;
    }

    console.log('✓ Trust Anchor URL validation passed');
    console.log(`  - URL: ${url}`);
    console.log(`  - Protocol: ${parsedUrl.protocol}`);
    console.log(`  - Host: ${parsedUrl.host}`);
    
    return true;
  } catch (error) {
    console.error('FATAL: TRUST_ANCHOR_URL has invalid URL format');
    console.error('Configuration Error Details:');
    console.error(`  - Provided value: ${url}`);
    console.error(`  - Parse error: ${error.message}`);
    console.error('  - A valid URL must include protocol, host, and optionally port and path');
    console.error('  - Example: TRUST_ANCHOR_URL=https://trust-anchor.example.com');
    return false;
  }
}

describe('Trust Anchor URL Configuration Validation', () => {
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    // Spy on console methods to verify error logging
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore console methods
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  describe('Missing Trust Anchor URL (Requirement 9.1, 9.2)', () => {
    it('should return false when URL is undefined', () => {
      const result = validateTrustAnchorUrl(undefined);
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('FATAL: TRUST_ANCHOR_URL is not configured');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Environment variable TRUST_ANCHOR_URL is missing or empty')
      );
    });

    it('should return false when URL is null', () => {
      const result = validateTrustAnchorUrl(null);
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('FATAL: TRUST_ANCHOR_URL is not configured');
    });

    it('should return false when URL is empty string', () => {
      const result = validateTrustAnchorUrl('');
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('FATAL: TRUST_ANCHOR_URL is not configured');
    });

    it('should log configuration error details when URL is missing', () => {
      validateTrustAnchorUrl(undefined);
      
      expect(consoleErrorSpy).toHaveBeenCalledWith('Configuration Error Details:');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('This variable is required for OP trust chain validation')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Please set TRUST_ANCHOR_URL to a valid HTTPS URL')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Example: TRUST_ANCHOR_URL=https://trust-anchor.example.com')
      );
    });
  });

  describe('Invalid URL Format (Requirement 9.2, 9.3)', () => {
    it('should return false when URL uses HTTP protocol', () => {
      const result = validateTrustAnchorUrl('http://trust-anchor.example.com');
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('FATAL: TRUST_ANCHOR_URL must use HTTPS protocol');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Provided URL: http://trust-anchor.example.com')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Protocol: http:')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Required protocol: https:')
      );
    });

    it('should return false when URL has invalid format', () => {
      const result = validateTrustAnchorUrl('not-a-valid-url');
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('FATAL: TRUST_ANCHOR_URL has invalid URL format');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Provided value: not-a-valid-url')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Parse error:')
      );
    });

    it('should return false when URL is malformed', () => {
      const result = validateTrustAnchorUrl('://invalid');
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('FATAL: TRUST_ANCHOR_URL has invalid URL format');
    });

    it('should return false when URL uses FTP protocol', () => {
      const result = validateTrustAnchorUrl('ftp://trust-anchor.example.com');
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('FATAL: TRUST_ANCHOR_URL must use HTTPS protocol');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Protocol: ftp:')
      );
    });

    it('should log security requirement details when protocol is not HTTPS', () => {
      validateTrustAnchorUrl('http://trust-anchor.example.com');
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Security requirement: Trust Anchor URLs must use HTTPS for secure communication')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Please update TRUST_ANCHOR_URL to use HTTPS')
      );
    });

    it('should log helpful error message for invalid URL format', () => {
      validateTrustAnchorUrl('invalid-url');
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('A valid URL must include protocol, host, and optionally port and path')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Example: TRUST_ANCHOR_URL=https://trust-anchor.example.com')
      );
    });
  });

  describe('Valid HTTPS URL (Requirement 9.3)', () => {
    it('should return true for valid HTTPS URL', () => {
      const result = validateTrustAnchorUrl('https://trust-anchor.example.com');
      
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Trust Anchor URL validation passed');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('URL: https://trust-anchor.example.com')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Protocol: https:')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Host: trust-anchor.example.com')
      );
    });

    it('should return true for HTTPS URL with port', () => {
      const result = validateTrustAnchorUrl('https://trust-anchor.example.com:8443');
      
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Trust Anchor URL validation passed');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Host: trust-anchor.example.com:8443')
      );
    });

    it('should return true for HTTPS URL with path', () => {
      const result = validateTrustAnchorUrl('https://trust-anchor.example.com/federation');
      
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Trust Anchor URL validation passed');
    });

    it('should return true for HTTPS URL with port and path', () => {
      const result = validateTrustAnchorUrl('https://trust-anchor.example.com:8443/federation/v1');
      
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Trust Anchor URL validation passed');
    });

    it('should return true for HTTPS URL with subdomain', () => {
      const result = validateTrustAnchorUrl('https://federation.trust-anchor.example.com');
      
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Trust Anchor URL validation passed');
    });

    it('should return true for localhost HTTPS URL', () => {
      const result = validateTrustAnchorUrl('https://localhost:3005');
      
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Trust Anchor URL validation passed');
    });

    it('should not log any errors for valid HTTPS URL', () => {
      validateTrustAnchorUrl('https://trust-anchor.example.com');
      
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should return false for whitespace-only string', () => {
      const result = validateTrustAnchorUrl('   ');
      
      expect(result).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('FATAL: TRUST_ANCHOR_URL has invalid URL format');
    });

    it('should return true for HTTPS URL with query parameters', () => {
      const result = validateTrustAnchorUrl('https://trust-anchor.example.com?param=value');
      
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Trust Anchor URL validation passed');
    });

    it('should return true for HTTPS URL with fragment', () => {
      const result = validateTrustAnchorUrl('https://trust-anchor.example.com#section');
      
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Trust Anchor URL validation passed');
    });

    it('should return true for HTTPS URL with IP address', () => {
      const result = validateTrustAnchorUrl('https://192.168.1.1:8443');
      
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith('✓ Trust Anchor URL validation passed');
    });
  });
});
