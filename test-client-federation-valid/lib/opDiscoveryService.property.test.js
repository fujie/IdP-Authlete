import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { OPDiscoveryService } from './opDiscoveryService.js';

describe('OPDiscoveryService - Property-Based Tests', () => {
  let service;

  beforeEach(() => {
    service = new OPDiscoveryService();
  });

  /**
   * Property 1: Discovery endpoint construction
   * Feature: rp-multi-op-selection
   * Validates: Requirements 2.1
   * 
   * For any valid OP entity_id, the discovery service should construct 
   * the discovery URL as {entity_id}/.well-known/openid-configuration
   */
  describe('Property 1: Discovery endpoint construction', () => {
    it('should construct discovery URL correctly for any valid entity_id', () => {
      fc.assert(
        fc.property(
          // Generate valid HTTPS URLs
          fc.record({
            protocol: fc.constant('https'),
            domain: fc.domain(),
            port: fc.option(fc.integer({ min: 1, max: 65535 }), { nil: null }),
            path: fc.option(fc.constantFrom('', '/path', '/path/to/resource'), { nil: null })
          }),
          ({ protocol, domain, port, path }) => {
            // Construct entity_id
            const portPart = port ? `:${port}` : '';
            const pathPart = path || '';
            const entityId = `${protocol}://${domain}${portPart}${pathPart}`;

            // Construct expected discovery URL
            const baseUrl = entityId.endsWith('/') ? entityId.slice(0, -1) : entityId;
            const expectedUrl = `${baseUrl}/.well-known/openid-configuration`;

            // Test the private method through public interface
            const actualUrl = service._constructDiscoveryUrl(entityId);

            // Verify the URL is constructed correctly
            expect(actualUrl).toBe(expectedUrl);
            expect(actualUrl).toContain('/.well-known/openid-configuration');
            expect(actualUrl).not.toContain('//.');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle entity_ids with trailing slashes', () => {
      fc.assert(
        fc.property(
          fc.webUrl({ withFragments: false, withQueryParameters: false }),
          (url) => {
            const entityIdWithSlash = url.endsWith('/') ? url : `${url}/`;
            const entityIdWithoutSlash = url.endsWith('/') ? url.slice(0, -1) : url;

            const urlWithSlash = service._constructDiscoveryUrl(entityIdWithSlash);
            const urlWithoutSlash = service._constructDiscoveryUrl(entityIdWithoutSlash);

            // Both should produce the same result
            expect(urlWithSlash).toBe(urlWithoutSlash);
            expect(urlWithSlash).not.toContain('//.');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 2: Required metadata field extraction
   * Feature: rp-multi-op-selection
   * Validates: Requirements 2.2, 2.3, 2.4
   * 
   * For any valid OIDC discovery response, the discovery service should extract 
   * all required fields (authorization_endpoint, token_endpoint, jwks_uri) and 
   * return them in the metadata object
   */
  describe('Property 2: Required metadata field extraction', () => {
    it('should extract all required fields from any valid discovery response', () => {
      fc.assert(
        fc.property(
          // Generate valid discovery responses
          fc.record({
            issuer: fc.webUrl({ withFragments: false, withQueryParameters: false }),
            authorization_endpoint: fc.webUrl({ withFragments: false }),
            token_endpoint: fc.webUrl({ withFragments: false }),
            jwks_uri: fc.webUrl({ withFragments: false }),
            // Optional fields
            registration_endpoint: fc.option(fc.webUrl({ withFragments: false })),
            userinfo_endpoint: fc.option(fc.webUrl({ withFragments: false })),
            scopes_supported: fc.option(fc.array(fc.constantFrom('openid', 'profile', 'email'))),
            response_types_supported: fc.option(fc.array(fc.constantFrom('code', 'token', 'id_token')))
          }),
          (metadata) => {
            // Validate the metadata (should not throw)
            expect(() => {
              service._validateMetadata(metadata, 'https://test-op.example.com');
            }).not.toThrow();

            // Verify all required fields are present
            expect(metadata.issuer).toBeDefined();
            expect(metadata.authorization_endpoint).toBeDefined();
            expect(metadata.token_endpoint).toBeDefined();
            expect(metadata.jwks_uri).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve all fields from discovery response', () => {
      fc.assert(
        fc.property(
          fc.record({
            issuer: fc.webUrl(),
            authorization_endpoint: fc.webUrl(),
            token_endpoint: fc.webUrl(),
            jwks_uri: fc.webUrl(),
            registration_endpoint: fc.webUrl(),
            scopes_supported: fc.array(fc.string(), { minLength: 1 }),
            custom_field: fc.string()
          }),
          (metadata) => {
            // Validation should not remove any fields
            service._validateMetadata(metadata, 'https://test-op.example.com');

            // All fields should still be present
            expect(metadata.issuer).toBeDefined();
            expect(metadata.authorization_endpoint).toBeDefined();
            expect(metadata.token_endpoint).toBeDefined();
            expect(metadata.jwks_uri).toBeDefined();
            expect(metadata.registration_endpoint).toBeDefined();
            expect(metadata.scopes_supported).toBeDefined();
            expect(metadata.custom_field).toBeDefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 3: Missing field validation
   * Feature: rp-multi-op-selection
   * Validates: Requirements 2.6
   * 
   * For any discovery response missing required fields, the discovery service 
   * should return an error indicating which specific fields are missing
   */
  describe('Property 3: Missing field validation', () => {
    it('should throw error with missing field names for any incomplete discovery response', () => {
      const requiredFields = ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'];

      fc.assert(
        fc.property(
          // Generate a subset of required fields (at least one missing)
          fc.subarray(requiredFields, { minLength: 0, maxLength: requiredFields.length - 1 }),
          fc.webUrl(),
          (presentFields, baseUrl) => {
            // Create metadata with only the present fields
            const metadata = {};
            presentFields.forEach(field => {
              metadata[field] = `${baseUrl}/${field}`;
            });

            // Determine which fields are missing
            const missingFields = requiredFields.filter(field => !presentFields.includes(field));

            // Validation should throw an error
            expect(() => {
              service._validateMetadata(metadata, 'https://test-op.example.com');
            }).toThrow();

            // Error should mention the missing fields
            try {
              service._validateMetadata(metadata, 'https://test-op.example.com');
            } catch (error) {
              expect(error.message).toContain('INVALID_DISCOVERY_RESPONSE');
              expect(error.message).toContain('missing required fields');
              
              // Error should mention all missing fields
              missingFields.forEach(field => {
                expect(error.message).toContain(field);
              });

              // Error object should have missingFields property
              expect(error.missingFields).toEqual(missingFields);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should identify exactly which fields are missing', () => {
      fc.assert(
        fc.property(
          fc.record({
            includeIssuer: fc.boolean(),
            includeAuthEndpoint: fc.boolean(),
            includeTokenEndpoint: fc.boolean(),
            includeJwksUri: fc.boolean()
          }),
          fc.webUrl(),
          (includes, baseUrl) => {
            // Skip if all fields are included (valid case)
            if (includes.includeIssuer && includes.includeAuthEndpoint && 
                includes.includeTokenEndpoint && includes.includeJwksUri) {
              return true;
            }

            const metadata = {};
            if (includes.includeIssuer) metadata.issuer = baseUrl;
            if (includes.includeAuthEndpoint) metadata.authorization_endpoint = `${baseUrl}/authorize`;
            if (includes.includeTokenEndpoint) metadata.token_endpoint = `${baseUrl}/token`;
            if (includes.includeJwksUri) metadata.jwks_uri = `${baseUrl}/jwks`;

            const expectedMissing = [];
            if (!includes.includeIssuer) expectedMissing.push('issuer');
            if (!includes.includeAuthEndpoint) expectedMissing.push('authorization_endpoint');
            if (!includes.includeTokenEndpoint) expectedMissing.push('token_endpoint');
            if (!includes.includeJwksUri) expectedMissing.push('jwks_uri');

            try {
              service._validateMetadata(metadata, 'https://test-op.example.com');
              // Should not reach here
              expect(true).toBe(false);
            } catch (error) {
              expect(error.missingFields).toEqual(expectedMissing);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
