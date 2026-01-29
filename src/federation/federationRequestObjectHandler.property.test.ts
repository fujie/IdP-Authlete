// Property-Based Tests for Federation Request Object Handler
// Feature: federation-dynamic-registration, Property 4: Federation Request Object Processing
// **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { FederationRequestObjectHandler } from './federationRequestObjectHandler';
import { JWKSet } from './types';

describe('Feature: federation-dynamic-registration, Property 4: Federation Request Object Processing', () => {
  let handler: FederationRequestObjectHandler;

  beforeEach(() => {
    handler = new FederationRequestObjectHandler();
  });

  /**
   * Property 4: Federation Request Object Processing
   * 
   * For any federation request object, the endpoint should validate the signature 
   * using the client's public key from the entity statement, extract registration 
   * parameters on success, and reject with invalid_request error on failure
   * 
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
   */
  it('Property 4: Federation Request Object Processing - Valid request objects should be processed correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate valid request object data
        fc.record({
          iss: fc.webUrl({ validSchemes: ['https'] }),
          aud: fc.webUrl({ validSchemes: ['https'] }),
          exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 7200 }),
          iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 300, max: Math.floor(Date.now() / 1000) }),
          client_metadata: fc.record({
            redirect_uris: fc.array(fc.webUrl({ validSchemes: ['https'] }), { minLength: 1, maxLength: 3 }),
            client_name: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
            client_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
            contacts: fc.option(fc.array(fc.emailAddress(), { maxLength: 3 })),
            response_types: fc.option(fc.array(fc.constantFrom('code', 'token', 'id_token'), { maxLength: 3 })),
            grant_types: fc.option(fc.array(fc.constantFrom('authorization_code', 'refresh_token', 'client_credentials'), { maxLength: 3 }))
          })
        }),
        async (payload) => {
          // Create unsigned request object (alg: none)
          const header = { alg: 'none', typ: 'JWT' };
          const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
          const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
          const requestObject = `${headerB64}.${payloadB64}.`;

          // Test validation without signature (unsigned)
          const validationResult = await handler.validateRequestObjectWithOptionalSignature(requestObject);
          
          // Should be valid for well-formed unsigned request objects
          expect(validationResult.isValid).toBe(true);
          expect(validationResult.payload).toBeDefined();
          expect(validationResult.payload?.iss).toBe(payload.iss);
          expect(validationResult.payload?.aud).toBe(payload.aud);

          // Test parameter extraction
          const extractedParams = handler.extractRegistrationParameters(requestObject);
          
          // Should extract redirect URIs correctly
          expect(extractedParams.redirect_uris).toEqual(payload.client_metadata.redirect_uris);
          
          // Should preserve optional parameters if present
          if (payload.client_metadata.client_name) {
            expect(extractedParams.client_name).toBe(payload.client_metadata.client_name);
          }
          
          if (payload.client_metadata.client_uri) {
            expect(extractedParams.client_uri).toBe(payload.client_metadata.client_uri);
          }
          
          if (payload.client_metadata.contacts) {
            expect(extractedParams.contacts).toEqual(payload.client_metadata.contacts);
          }
        }
      ),
      { numRuns: 50, verbose: true }
    );
  });

  it('Property 4: Federation Request Object Processing - Invalid request objects should be rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate invalid request object scenarios - ensure each is truly invalid
        fc.oneof(
          // Missing iss claim - create object without iss
          fc.record({
            aud: fc.webUrl({ validSchemes: ['https'] }),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 7200 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 300, max: Math.floor(Date.now() / 1000) })
          }),
          
          // Missing aud claim - create object without aud
          fc.record({
            iss: fc.webUrl({ validSchemes: ['https'] }),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 7200 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 300, max: Math.floor(Date.now() / 1000) })
          }),
          
          // Missing exp claim - create object without exp
          fc.record({
            iss: fc.webUrl({ validSchemes: ['https'] }),
            aud: fc.webUrl({ validSchemes: ['https'] }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 300, max: Math.floor(Date.now() / 1000) })
          }),
          
          // Missing iat claim - create object without iat
          fc.record({
            iss: fc.webUrl({ validSchemes: ['https'] }),
            aud: fc.webUrl({ validSchemes: ['https'] }),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 7200 })
          }),
          
          // Expired token (exp in the past)
          fc.record({
            iss: fc.webUrl({ validSchemes: ['https'] }),
            aud: fc.webUrl({ validSchemes: ['https'] }),
            exp: fc.integer({ min: 1000000000, max: Math.floor(Date.now() / 1000) - 60 }), // Definitely in the past
            iat: fc.integer({ min: 1000000000, max: Math.floor(Date.now() / 1000) - 3600 }) // Also in the past
          }),
          
          // Invalid claim types (non-string iss/aud, non-number exp/iat)
          fc.record({
            iss: fc.integer(), // Should be string
            aud: fc.webUrl({ validSchemes: ['https'] }),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 7200 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 300, max: Math.floor(Date.now() / 1000) })
          }),
          
          fc.record({
            iss: fc.webUrl({ validSchemes: ['https'] }),
            aud: fc.boolean(), // Should be string
            exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 7200 }),
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 300, max: Math.floor(Date.now() / 1000) })
          }),
          
          fc.record({
            iss: fc.webUrl({ validSchemes: ['https'] }),
            aud: fc.webUrl({ validSchemes: ['https'] }),
            exp: fc.string(), // Should be number
            iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 300, max: Math.floor(Date.now() / 1000) })
          }),
          
          fc.record({
            iss: fc.webUrl({ validSchemes: ['https'] }),
            aud: fc.webUrl({ validSchemes: ['https'] }),
            exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 7200 }),
            iat: fc.string() // Should be number
          })
        ),
        async (invalidPayload) => {
          // Create unsigned request object with invalid payload
          const header = { alg: 'none', typ: 'JWT' };
          const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
          const payloadB64 = Buffer.from(JSON.stringify(invalidPayload)).toString('base64url');
          const requestObject = `${headerB64}.${payloadB64}.`;

          // Test validation - should fail
          const validationResult = await handler.validateRequestObjectWithOptionalSignature(requestObject);
          
          // Should be invalid - add debug info to help with failures
          if (validationResult.isValid) {
            console.log('Unexpected valid result for payload:', JSON.stringify(invalidPayload));
            console.log('Validation result:', validationResult);
          }
          
          expect(validationResult.isValid).toBe(false);
          expect(validationResult.errors).toBeDefined();
          expect(validationResult.errors!.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 30, verbose: true }
    );
  });

  it('Property 4: Federation Request Object Processing - Malformed JWT structure should be rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate malformed JWT strings
        fc.oneof(
          fc.string({ minLength: 1, maxLength: 50 }), // Random string
          fc.constant('invalid.jwt'), // Two parts only
          fc.constant(''), // Empty string
          fc.constant('a.b.c.d'), // Too many parts
          fc.constant('not-base64.not-base64.not-base64') // Invalid base64
        ),
        async (malformedJWT) => {
          // Test validation - should fail
          const validationResult = await handler.validateRequestObjectWithOptionalSignature(malformedJWT);
          
          // Should be invalid
          expect(validationResult.isValid).toBe(false);
          expect(validationResult.errors).toBeDefined();
          expect(validationResult.errors!.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 20, verbose: true }
    );
  });

  it('Property 4: Federation Request Object Processing - Parameter extraction should handle edge cases', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate edge case client metadata
        fc.record({
          iss: fc.webUrl({ validSchemes: ['https'] }),
          aud: fc.webUrl({ validSchemes: ['https'] }),
          exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 7200 }),
          iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 300, max: Math.floor(Date.now() / 1000) }),
          client_metadata: fc.oneof(
            // Empty client metadata
            fc.record({}),
            // Null/undefined values
            fc.record({
              redirect_uris: fc.constant(null),
              client_name: fc.constant(undefined),
              client_uri: fc.constant('')
            }),
            // Valid but minimal metadata
            fc.record({
              redirect_uris: fc.array(fc.webUrl({ validSchemes: ['https'] }), { minLength: 1, maxLength: 1 })
            })
          )
        }),
        async (payload) => {
          // Create unsigned request object
          const header = { alg: 'none', typ: 'JWT' };
          const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
          const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
          const requestObject = `${headerB64}.${payloadB64}.`;

          // Test parameter extraction - should not throw
          const extractedParams = handler.extractRegistrationParameters(requestObject);
          
          // Should always return an object with redirect_uris array
          expect(extractedParams).toBeDefined();
          expect(Array.isArray(extractedParams.redirect_uris)).toBe(true);
          
          // If original had valid redirect_uris, they should be preserved
          if (payload.client_metadata && 'redirect_uris' in payload.client_metadata && 
              payload.client_metadata.redirect_uris && 
              Array.isArray(payload.client_metadata.redirect_uris)) {
            expect(extractedParams.redirect_uris).toEqual(payload.client_metadata.redirect_uris);
          }
        }
      ),
      { numRuns: 30, verbose: true }
    );
  });

  it('Property 4: Federation Request Object Processing - Signature validation with empty JWKs should handle unsigned requests', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate valid request object data
        fc.record({
          iss: fc.webUrl({ validSchemes: ['https'] }),
          aud: fc.webUrl({ validSchemes: ['https'] }),
          exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 7200 }),
          iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 300, max: Math.floor(Date.now() / 1000) }),
          client_metadata: fc.record({
            redirect_uris: fc.array(fc.webUrl({ validSchemes: ['https'] }), { minLength: 1, maxLength: 2 })
          })
        }),
        async (payload) => {
          // Create unsigned request object (alg: none)
          const header = { alg: 'none', typ: 'JWT' };
          const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
          const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
          const requestObject = `${headerB64}.${payloadB64}.`;

          // Test with empty JWKs (should treat as unsigned)
          const emptyJWKs: JWKSet = { keys: [] };
          const validationResult = await handler.validateRequestObjectWithOptionalSignature(requestObject, emptyJWKs);
          
          // Should be valid for unsigned request objects
          expect(validationResult.isValid).toBe(true);
          expect(validationResult.payload).toBeDefined();

          // Test with undefined JWKs (should treat as unsigned)
          const validationResult2 = await handler.validateRequestObjectWithOptionalSignature(requestObject);
          
          // Should be valid for unsigned request objects
          expect(validationResult2.isValid).toBe(true);
          expect(validationResult2.payload).toBeDefined();
        }
      ),
      { numRuns: 25, verbose: true }
    );
  });
});