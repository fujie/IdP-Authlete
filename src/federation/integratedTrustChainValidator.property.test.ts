// Property-Based Test for Trust Chain Validation Completeness
// **Property 1: Trust Chain Validation Completeness**
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { IntegratedTrustChainValidator } from './integratedTrustChainValidator';
import { EntityStatement, JWKSet, JWK, ClientMetadata } from './types';
import { FEDERATION_CONSTANTS } from './constants';

describe('Feature: federation-dynamic-registration, Property 1: Trust Chain Validation Completeness', () => {
  let validator: IntegratedTrustChainValidator;
  const mockTrustAnchors = ['https://trust-anchor.example.com', 'https://another-anchor.example.com'];

  beforeEach(() => {
    // Mock fetch for entity configuration requests
    global.fetch = vi.fn();
    validator = new IntegratedTrustChainValidator(mockTrustAnchors);
  });

  // Generator for valid JWK
  const validJWKArb = fc.record({
    kty: fc.constant('RSA'),
    use: fc.constant('sig'),
    kid: fc.string({ minLength: 1, maxLength: 20 }),
    alg: fc.constantFrom(...FEDERATION_CONSTANTS.SUPPORTED_SIGNING_ALGORITHMS),
    n: fc.string({ minLength: 10, maxLength: 50 }),
    e: fc.constant('AQAB')
  }) as fc.Arbitrary<JWK>;

  // Generator for valid JWK Set
  const validJWKSetArb = fc.record({
    keys: fc.array(validJWKArb, { minLength: 1, maxLength: 3 })
  }) as fc.Arbitrary<JWKSet>;

  // Generator for valid client metadata
  const validClientMetadataArb = fc.record({
    redirect_uris: fc.array(
      fc.webUrl({ validSchemes: ['https'] }),
      { minLength: 1, maxLength: 3 }
    ),
    response_types: fc.array(
      fc.constantFrom('code', 'token', 'id_token'),
      { minLength: 1, maxLength: 2 }
    ),
    grant_types: fc.array(
      fc.constantFrom('authorization_code', 'refresh_token', 'client_credentials'),
      { minLength: 1, maxLength: 2 }
    ),
    application_type: fc.constantFrom('web', 'native'),
    client_name: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
    token_endpoint_auth_method: fc.constantFrom(
      'client_secret_basic',
      'client_secret_post',
      'private_key_jwt'
    ),
    jwks: fc.option(validJWKSetArb)
  }) as fc.Arbitrary<ClientMetadata>;

  // Generator for valid entity statement payload
  const validEntityStatementPayloadArb = fc.record({
    iss: fc.webUrl({ validSchemes: ['https'] }),
    sub: fc.webUrl({ validSchemes: ['https'] }),
    iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
    exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 86400 }),
    jwks: fc.option(validJWKSetArb),
    metadata: fc.option(fc.record({
      openid_relying_party: fc.option(validClientMetadataArb)
    })),
    authorityHints: fc.option(fc.array(
      fc.webUrl({ validSchemes: ['https'] }),
      { minLength: 0, maxLength: 2 }
    ))
  });

  // Generator for valid entity statement
  const validEntityStatementArb = fc.record({
    jwt: fc.string({ minLength: 10, maxLength: 200 }),
    payload: validEntityStatementPayloadArb
  }) as fc.Arbitrary<EntityStatement>;

  // Generator for expired entity statement
  const expiredEntityStatementArb = fc.record({
    jwt: fc.string({ minLength: 10, maxLength: 200 }),
    payload: fc.record({
      iss: fc.webUrl({ validSchemes: ['https'] }),
      sub: fc.webUrl({ validSchemes: ['https'] }),
      iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 7200, max: Math.floor(Date.now() / 1000) - 3600 }),
      exp: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) - 60 }),
      jwks: fc.option(validJWKSetArb),
      metadata: fc.option(fc.record({
        openid_relying_party: fc.option(validClientMetadataArb)
      })),
      authorityHints: fc.option(fc.array(
        fc.webUrl({ validSchemes: ['https'] }),
        { minLength: 0, maxLength: 2 }
      ))
    })
  }) as fc.Arbitrary<EntityStatement>;

  // Generator for malformed entity statement (missing required fields)
  const malformedEntityStatementArb = fc.record({
    jwt: fc.string({ minLength: 10, maxLength: 200 }),
    payload: fc.record({
      iss: fc.option(fc.webUrl({ validSchemes: ['https'] }), { nil: undefined }),
      sub: fc.option(fc.webUrl({ validSchemes: ['https'] }), { nil: undefined }),
      exp: fc.option(fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 86400 }), { nil: undefined }),
      jwks: fc.option(validJWKSetArb),
      metadata: fc.option(fc.record({
        openid_relying_party: fc.option(validClientMetadataArb)
      }))
    })
  }) as fc.Arbitrary<EntityStatement>;

  // Generator for trust chain that terminates at trust anchor
  const validTrustChainArb = fc.array(validEntityStatementArb, { minLength: 1, maxLength: 5 })
    .map(chain => {
      // Ensure the last entity is a trust anchor
      const trustAnchorStatement = { ...chain[chain.length - 1] };
      trustAnchorStatement.payload = {
        ...trustAnchorStatement.payload,
        iss: mockTrustAnchors[0],
        sub: mockTrustAnchors[0],
        authorityHints: undefined // Trust anchors don't have authority hints
      };
      
      // Ensure chain continuity - each entity should reference the next as authority
      for (let i = 0; i < chain.length - 1; i++) {
        chain[i].payload.authorityHints = [chain[i + 1].payload.iss];
      }
      
      chain[chain.length - 1] = trustAnchorStatement;
      return chain;
    });

  // Generator for trust chain that does NOT terminate at trust anchor
  const invalidTrustChainArb = fc.array(validEntityStatementArb, { minLength: 1, maxLength: 5 })
    .map(chain => {
      // Ensure the last entity is NOT a trust anchor
      const lastStatement = { ...chain[chain.length - 1] };
      lastStatement.payload = {
        ...lastStatement.payload,
        iss: 'https://unknown-entity.example.com',
        sub: 'https://unknown-entity.example.com'
      };
      chain[chain.length - 1] = lastStatement;
      return chain;
    });

  it('Property 1: Trust Chain Validation Completeness - Valid trust chains should pass all validation steps', async () => {
    await fc.assert(fc.asyncProperty(
      fc.webUrl({ validSchemes: ['https'] }),
      validTrustChainArb,
      
      async (entityId: string, trustChain: EntityStatement[]) => {
        // Mock successful JWT signature verification
        vi.spyOn(validator as any, 'validateEntityStatement').mockResolvedValue(true);
        
        // Mock successful signature verifier
        const mockSignatureVerifier = {
          verifyTrustChain: vi.fn().mockResolvedValue({
            isValid: true,
            verificationResults: trustChain.map(() => ({ isValid: true }))
          })
        };
        (validator as any).signatureVerifier = mockSignatureVerifier;

        // Mock successful trust anchor validator
        const mockTrustAnchorValidator = {
          validateTrustChainTermination: vi.fn().mockResolvedValue({
            isValid: true,
            trustAnchorId: mockTrustAnchors[0]
          }),
          extractClientMetadata: vi.fn().mockReturnValue({
            redirect_uris: ['https://client.example.com/callback'],
            response_types: ['code'],
            grant_types: ['authorization_code'],
            application_type: 'web',
            token_endpoint_auth_method: 'client_secret_basic'
          })
        };
        (validator as any).trustAnchorValidator = mockTrustAnchorValidator;

        const result = await validator.validateTrustChain(entityId, trustChain);

        // For valid trust chains, validation should succeed
        expect(result.isValid).toBe(true);
        expect(result.trustAnchor).toBe(mockTrustAnchors[0]);
        expect(result.clientMetadata).toBeDefined();
        expect(result.clientMetadata?.redirect_uris).toBeDefined();
        expect(result.errors).toBeUndefined();

        // Verify all validation steps were called
        expect(mockSignatureVerifier.verifyTrustChain).toHaveBeenCalledWith(trustChain);
        expect(mockTrustAnchorValidator.validateTrustChainTermination).toHaveBeenCalledWith(trustChain);
        expect(mockTrustAnchorValidator.extractClientMetadata).toHaveBeenCalledWith(trustChain);
      }
    ), { numRuns: 50 });
  });

  it('Property 1: Trust Chain Validation Completeness - Invalid trust chains should fail with appropriate errors', async () => {
    await fc.assert(fc.asyncProperty(
      fc.webUrl({ validSchemes: ['https'] }),
      invalidTrustChainArb,
      
      async (entityId: string, trustChain: EntityStatement[]) => {
        // Mock successful JWT signature verification
        const mockSignatureVerifier = {
          verifyTrustChain: vi.fn().mockResolvedValue({
            isValid: true,
            verificationResults: trustChain.map(() => ({ isValid: true }))
          })
        };
        (validator as any).signatureVerifier = mockSignatureVerifier;

        // Mock failed trust anchor validation (chain doesn't terminate at trust anchor)
        const mockTrustAnchorValidator = {
          validateTrustChainTermination: vi.fn().mockResolvedValue({
            isValid: false,
            errors: [{
              code: FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR,
              message: `Entity ${trustChain[trustChain.length - 1].payload.iss} is not a configured trust anchor`
            }]
          })
        };
        (validator as any).trustAnchorValidator = mockTrustAnchorValidator;

        const result = await validator.validateTrustChain(entityId, trustChain);

        // For invalid trust chains, validation should fail
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
        expect(result.errors![0].code).toBe(FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR);
        expect(result.trustAnchor).toBeUndefined();
        expect(result.clientMetadata).toBeUndefined();
      }
    ), { numRuns: 50 });
  });

  it('Property 1: Trust Chain Validation Completeness - Expired entity statements should be rejected', async () => {
    await fc.assert(fc.asyncProperty(
      fc.webUrl({ validSchemes: ['https'] }),
      fc.array(expiredEntityStatementArb, { minLength: 1, maxLength: 3 }),
      
      async (entityId: string, trustChain: EntityStatement[]) => {
        // Mock failed JWT signature verification due to expiration
        const mockSignatureVerifier = {
          verifyTrustChain: vi.fn().mockResolvedValue({
            isValid: false,
            errors: [{
              code: FEDERATION_CONSTANTS.ERRORS.ENTITY_STATEMENT_EXPIRED,
              message: 'JWT has expired'
            }]
          })
        };
        (validator as any).signatureVerifier = mockSignatureVerifier;

        const result = await validator.validateTrustChain(entityId, trustChain);

        // Expired statements should cause validation to fail
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some(e => e.code === FEDERATION_CONSTANTS.ERRORS.ENTITY_STATEMENT_EXPIRED)).toBe(true);
      }
    ), { numRuns: 30 });
  });

  it('Property 1: Trust Chain Validation Completeness - Malformed entity statements should be rejected', async () => {
    await fc.assert(fc.asyncProperty(
      fc.webUrl({ validSchemes: ['https'] }),
      fc.array(malformedEntityStatementArb, { minLength: 1, maxLength: 3 }),
      
      async (entityId: string, trustChain: EntityStatement[]) => {
        // Mock failed JWT signature verification due to malformed structure
        const mockSignatureVerifier = {
          verifyTrustChain: vi.fn().mockResolvedValue({
            isValid: false,
            errors: [{
              code: FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
              message: 'Entity statement missing required claims'
            }]
          })
        };
        (validator as any).signatureVerifier = mockSignatureVerifier;

        const result = await validator.validateTrustChain(entityId, trustChain);

        // Malformed statements should cause validation to fail
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
      }
    ), { numRuns: 30 });
  });

  it('Property 1: Trust Chain Validation Completeness - Empty trust chains should be rejected', async () => {
    await fc.assert(fc.asyncProperty(
      fc.webUrl({ validSchemes: ['https'] }),
      
      async (entityId: string) => {
        const emptyTrustChain: EntityStatement[] = [];

        const result = await validator.validateTrustChain(entityId, emptyTrustChain);

        // Empty trust chains should be rejected
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some(e => e.code === FEDERATION_CONSTANTS.ERRORS.ENTITY_NOT_FOUND)).toBe(true);
      }
    ), { numRuns: 20 });
  });

  it('Property 1: Trust Chain Validation Completeness - Trust chain length limits should be enforced', async () => {
    await fc.assert(fc.asyncProperty(
      fc.webUrl({ validSchemes: ['https'] }),
      
      async (entityId: string) => {
        // Create a trust chain that exceeds maximum length
        const oversizedTrustChain: EntityStatement[] = [];
        for (let i = 0; i <= FEDERATION_CONSTANTS.MAX_TRUST_CHAIN_LENGTH; i++) {
          oversizedTrustChain.push({
            jwt: `jwt-token-${i}`,
            payload: {
              iss: `https://entity-${i}.example.com`,
              sub: `https://entity-${i}.example.com`,
              exp: Math.floor(Date.now() / 1000) + 3600,
              jwks: { keys: [] },
              authorityHints: i < FEDERATION_CONSTANTS.MAX_TRUST_CHAIN_LENGTH ? [`https://entity-${i + 1}.example.com`] : undefined
            }
          });
        }

        // Mock the resolver to return the oversized chain
        const mockResolver = {
          resolveTrustChain: vi.fn().mockResolvedValue(oversizedTrustChain)
        };
        (validator as any).resolver = mockResolver;

        const result = await validator.validateTrustChain(entityId);

        // Oversized trust chains should be rejected
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some(e => e.code === FEDERATION_CONSTANTS.ERRORS.TRUST_CHAIN_VALIDATION_FAILED)).toBe(true);
      }
    ), { numRuns: 10 });
  });

  it('Property 1: Trust Chain Validation Completeness - Client metadata extraction should succeed for valid chains', async () => {
    await fc.assert(fc.asyncProperty(
      fc.webUrl({ validSchemes: ['https'] }),
      validTrustChainArb,
      validClientMetadataArb,
      
      async (entityId: string, trustChain: EntityStatement[], expectedMetadata: ClientMetadata) => {
        // Mock successful validation steps
        const mockSignatureVerifier = {
          verifyTrustChain: vi.fn().mockResolvedValue({
            isValid: true,
            verificationResults: trustChain.map(() => ({ isValid: true }))
          })
        };
        (validator as any).signatureVerifier = mockSignatureVerifier;

        const mockTrustAnchorValidator = {
          validateTrustChainTermination: vi.fn().mockResolvedValue({
            isValid: true,
            trustAnchorId: mockTrustAnchors[0]
          }),
          extractClientMetadata: vi.fn().mockReturnValue(expectedMetadata)
        };
        (validator as any).trustAnchorValidator = mockTrustAnchorValidator;

        const result = await validator.validateTrustChain(entityId, trustChain);

        // Successful validation should extract client metadata
        expect(result.isValid).toBe(true);
        expect(result.clientMetadata).toEqual(expectedMetadata);
        expect(result.clientMetadata?.redirect_uris).toBeDefined();
        expect(result.clientMetadata?.redirect_uris.length).toBeGreaterThan(0);
      }
    ), { numRuns: 30 });
  });

  it('Property 1: Trust Chain Validation Completeness - Invalid entity IDs should be rejected', async () => {
    await fc.assert(fc.asyncProperty(
      fc.oneof(
        fc.constant(''),
        fc.constant('not-a-url'),
        fc.constant('http://insecure.example.com'), // HTTP not allowed
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('://'))
      ),
      
      async (invalidEntityId: string) => {
        const result = await validator.validateTrustChain(invalidEntityId);

        // Invalid entity IDs should be rejected
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some(e => e.code === FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST)).toBe(true);
      }
    ), { numRuns: 20 });
  });
});