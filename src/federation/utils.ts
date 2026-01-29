// Federation Utility Functions

import { FEDERATION_CONSTANTS } from './constants';
import { ValidationError, JWKSet } from './types';

/**
 * JWT Utility Functions
 */
export class JWTUtils {
  /**
   * Decode JWT without verification (for inspection)
   */
  static decodeJWT(jwt: string): { header: any; payload: any; signature: string } {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    return {
      header: JSON.parse(this.base64UrlDecode(parts[0])),
      payload: JSON.parse(this.base64UrlDecode(parts[1])),
      signature: parts[2]
    };
  }

  /**
   * Base64URL decode
   */
  static base64UrlDecode(str: string): string {
    // Add padding if needed
    const padding = '='.repeat((4 - (str.length % 4)) % 4);
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;
    
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  /**
   * Base64URL encode
   */
  static base64UrlEncode(str: string): string {
    return Buffer.from(str, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Check if JWT is expired
   */
  static isJWTExpired(jwt: string, clockSkew: number = FEDERATION_CONSTANTS.REQUEST_OBJECT_CLOCK_SKEW): boolean {
    try {
      const { payload } = this.decodeJWT(jwt);
      if (!payload.exp) {
        return false; // No expiration claim
      }

      const now = Math.floor(Date.now() / 1000);
      return payload.exp + clockSkew < now;
    } catch {
      return true; // Invalid JWT is considered expired
    }
  }

  /**
   * Check if JWT is not yet valid
   */
  static isJWTNotYetValid(jwt: string, clockSkew: number = FEDERATION_CONSTANTS.REQUEST_OBJECT_CLOCK_SKEW): boolean {
    try {
      const { payload } = this.decodeJWT(jwt);
      if (!payload.nbf) {
        return false; // No not-before claim
      }

      const now = Math.floor(Date.now() / 1000);
      return payload.nbf - clockSkew > now;
    } catch {
      return true; // Invalid JWT is considered not valid
    }
  }

  /**
   * Extract issuer from JWT
   */
  static getIssuer(jwt: string): string | null {
    try {
      const { payload } = this.decodeJWT(jwt);
      return payload.iss || null;
    } catch {
      return null;
    }
  }

  /**
   * Extract subject from JWT
   */
  static getSubject(jwt: string): string | null {
    try {
      const { payload } = this.decodeJWT(jwt);
      return payload.sub || null;
    } catch {
      return null;
    }
  }

  /**
   * Extract audience from JWT
   */
  static getAudience(jwt: string): string | string[] | null {
    try {
      const { payload } = this.decodeJWT(jwt);
      return payload.aud || null;
    } catch {
      return null;
    }
  }
}

/**
 * URL Utility Functions
 */
export class URLUtils {
  /**
   * Check if URL is HTTPS (required for federation entities)
   */
  static isHTTPS(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Check if URL is localhost (allowed for development)
   */
  static isLocalhost(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }

  /**
   * Validate entity ID format
   */
  static isValidEntityId(entityId: string): boolean {
    try {
      new URL(entityId); // Just validate URL format
      // Must be HTTPS or localhost
      return this.isHTTPS(entityId) || this.isLocalhost(entityId);
    } catch {
      return false;
    }
  }

  /**
   * Build entity configuration URL
   */
  static buildEntityConfigurationURL(entityId: string): string {
    const url = new URL(entityId);
    url.pathname = FEDERATION_CONSTANTS.ENTITY_CONFIGURATION_PATH;
    return url.toString();
  }

  /**
   * Normalize URL (remove trailing slash, fragments, etc.)
   */
  static normalizeURL(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove fragment and trailing slash
      parsed.hash = '';
      if (parsed.pathname.endsWith('/') && parsed.pathname.length > 1) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }
}

/**
 * Validation Utility Functions
 */
export class ValidationUtils {
  /**
   * Decode JWT without verification (for inspection)
   */
  static decodeJWT(jwt: string): { header: any; payload: any; signature: string } {
    return JWTUtils.decodeJWT(jwt);
  }

  /**
   * Check if entity ID is valid
   */
  static isValidEntityId(entityId: string): boolean {
    return URLUtils.isValidEntityId(entityId);
  }

  /**
   * Create validation error
   */
  static createValidationError(code: string, message: string, details?: any): ValidationError {
    return {
      code,
      message,
      ...(details && { details })
    };
  }

  /**
   * Validate redirect URI
   */
  static validateRedirectURI(uri: string): ValidationError | null {
    try {
      const url = new URL(uri);
      
      // Must be HTTP or HTTPS
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return this.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          `Invalid redirect URI protocol: ${url.protocol}`,
          { uri }
        );
      }

      // Cannot contain fragment
      if (url.hash) {
        return this.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          'Redirect URI cannot contain fragment',
          { uri }
        );
      }

      return null;
    } catch (error) {
      return this.createValidationError(
        FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
        `Invalid redirect URI format: ${uri}`,
        { uri, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Validate JWK Set
   */
  static validateJWKSet(jwks: JWKSet): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!jwks || !jwks.keys || !Array.isArray(jwks.keys)) {
      errors.push(this.createValidationError(
        FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
        'JWK Set must contain keys array'
      ));
      return errors;
    }

    if (jwks.keys.length === 0) {
      errors.push(this.createValidationError(
        FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
        'JWK Set cannot be empty'
      ));
      return errors;
    }

    // Validate each key
    jwks.keys.forEach((key, index) => {
      if (!key.kty) {
        errors.push(this.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          `JWK at index ${index} missing required 'kty' parameter`
        ));
      }

      if (key.use && !['sig', 'enc'].includes(key.use)) {
        errors.push(this.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          `JWK at index ${index} has invalid 'use' parameter: ${key.use}`
        ));
      }

      if (key.alg && !(FEDERATION_CONSTANTS.SUPPORTED_SIGNING_ALGORITHMS as readonly string[]).includes(key.alg)) {
        errors.push(this.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          `JWK at index ${index} has unsupported algorithm: ${key.alg}`
        ));
      }
    });

    return errors;
  }

  /**
   * Validate client metadata
   */
  static validateClientMetadata(metadata: any): ValidationError[] {
    const errors: ValidationError[] = [];

    // Validate redirect URIs
    if (!metadata.redirect_uris || !Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length === 0) {
      errors.push(this.createValidationError(
        FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
        'redirect_uris is required and must be a non-empty array'
      ));
    } else {
      metadata.redirect_uris.forEach((uri: string, index: number) => {
        const uriError = this.validateRedirectURI(uri);
        if (uriError) {
          errors.push(this.createValidationError(
            uriError.code,
            `redirect_uris[${index}]: ${uriError.message}`,
            uriError.details
          ));
        }
      });
    }

    // Validate JWK Set if present
    if (metadata.jwks) {
      const jwksErrors = this.validateJWKSet(metadata.jwks);
      errors.push(...jwksErrors);
    }

    // Validate response types
    if (metadata.response_types) {
      if (!Array.isArray(metadata.response_types)) {
        errors.push(this.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          'response_types must be an array'
        ));
      } else {
        const validResponseTypes = Object.values(FEDERATION_CONSTANTS.FEDERATION_RESPONSE_TYPES);
        metadata.response_types.forEach((type: string) => {
          if (!validResponseTypes.includes(type as any)) {
            errors.push(this.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.UNSUPPORTED_RESPONSE_TYPE,
              `Unsupported response type: ${type}`
            ));
          }
        });
      }
    }

    // Validate grant types
    if (metadata.grant_types) {
      if (!Array.isArray(metadata.grant_types)) {
        errors.push(this.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          'grant_types must be an array'
        ));
      } else {
        const validGrantTypes = Object.values(FEDERATION_CONSTANTS.FEDERATION_GRANT_TYPES);
        metadata.grant_types.forEach((type: string) => {
          if (!validGrantTypes.includes(type as any)) {
            errors.push(this.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
              `Unsupported grant type: ${type}`
            ));
          }
        });
      }
    }

    return errors;
  }
}

/**
 * Time Utility Functions
 */
export class TimeUtils {
  /**
   * Get current Unix timestamp
   */
  static now(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Check if timestamp is expired
   */
  static isExpired(exp: number, clockSkew: number = FEDERATION_CONSTANTS.REQUEST_OBJECT_CLOCK_SKEW): boolean {
    return exp + clockSkew < this.now();
  }

  /**
   * Check if timestamp is not yet valid
   */
  static isNotYetValid(nbf: number, clockSkew: number = FEDERATION_CONSTANTS.REQUEST_OBJECT_CLOCK_SKEW): boolean {
    return nbf - clockSkew > this.now();
  }

  /**
   * Add seconds to current time
   */
  static addSeconds(seconds: number): number {
    return this.now() + seconds;
  }

  /**
   * Format timestamp for logging
   */
  static formatTimestamp(timestamp: number): string {
    return new Date(timestamp * 1000).toISOString();
  }
}

/**
 * Cache Key Utility Functions
 */
export class CacheKeyUtils {
  /**
   * Generate trust chain cache key
   */
  static trustChainKey(entityId: string): string {
    return `trust_chain:${entityId}`;
  }

  /**
   * Generate entity configuration cache key
   */
  static entityConfigurationKey(entityId: string): string {
    return `entity_config:${entityId}`;
  }

  /**
   * Generate rate limit cache key
   */
  static rateLimitKey(entityId: string): string {
    return `rate_limit:${entityId}`;
  }

  /**
   * Generate client registration cache key
   */
  static clientRegistrationKey(clientId: string): string {
    return `client_reg:${clientId}`;
  }
}