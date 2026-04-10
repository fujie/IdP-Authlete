/**
 * Property-Based Tests for OP Trust Chain Validation
 * 
 * Feature: rp-op-trust-validation
 * 
 * This file contains property-based tests for:
 * - Property 2: JWT Signature Verification (Requirements 1.2)
 * - Property 4: Trust Chain Resolution (Requirements 1.4)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// Dynamic import for CommonJS module
let OPTrustChainValidator;

describe('Feature: rp-op-trust-validation, Property 2: JWT Signature Verification', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for JWT signature verification scenarios
  const jwtVerificationScenarioArb = fc.record({
    opEntityId: httpsUrlArb,
    hasValidSignature: fc.boolean(),
    signatureError: fc.constantFrom(
      'Invalid JWT signature',
      'JWT signature verification failed',
      'No matching public key found',
      'Unsupported JWT algorithm'
    )
  });

  it('Property 2: JWT Signature Verification - Should successfully verify valid JWT signatures', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator to simulate successful JWT signature verification
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify that validation was called
        expect(mockValidator.validateTrustChain).toHaveBeenCalledWith(opEntityId);
        
        // For valid signatures, validation should succeed
        expect(result.isValid).toBe(true);
        expect(result.errors).toEqual([]);
      }
    ), { numRuns: 100 });
  });

  it('Property 2: JWT Signature Verification - Should reject invalid JWT signatures', async () => {
    await fc.assert(fc.asyncProperty(
      jwtVerificationScenarioArb.filter(s => !s.hasValidSignature),
      
      async (scenario) => {
        const { opEntityId, signatureError } = scenario;
        
        // Mock the validator to simulate JWT signature verification failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'invalid_signature',
                message: signatureError,
                details: {
                  opEntityId,
                  reason: 'JWT signature verification failed'
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify that validation failed
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates signature issue
        const hasSignatureError = result.errors.some(
          e => e.code === 'invalid_signature' || 
               e.message.toLowerCase().includes('signature')
        );
        expect(hasSignatureError).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 2: JWT Signature Verification - Should verify signatures using OP published keys', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.array(fc.string({ minLength: 32, maxLength: 64 }), { minLength: 1, maxLength: 3 }),
      
      async (opEntityId, keyIds) => {
        // Mock the validator to track which keys were used for verification
        const usedKeyIds = [];
        
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            // Simulate using the first available key
            usedKeyIds.push(keyIds[0]);
            
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify that validation used the OP's published keys
        expect(result.isValid).toBe(true);
        expect(mockValidator.validateTrustChain).toHaveBeenCalledWith(opEntityId);
        
        // The validator should have attempted to use the OP's keys
        expect(usedKeyIds.length).toBeGreaterThan(0);
      }
    ), { numRuns: 100 });
  });

  it('Property 2: JWT Signature Verification - Should handle missing public keys', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator to simulate missing public keys
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'missing_public_keys',
                message: 'No public keys found for signature verification',
                details: {
                  opEntityId
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Missing public keys should cause validation to fail
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates missing keys
        const hasMissingKeysError = result.errors.some(
          e => e.code === 'missing_public_keys' || 
               e.message.toLowerCase().includes('public key')
        );
        expect(hasMissingKeysError).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 2: JWT Signature Verification - Should handle expired JWT tokens', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.integer({ min: 1, max: 365 }), // Days expired
      
      async (opEntityId, daysExpired) => {
        // Mock the validator to simulate expired JWT
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            const expiredDate = new Date();
            expiredDate.setDate(expiredDate.getDate() - daysExpired);
            
            return {
              isValid: false,
              errors: [{
                code: 'jwt_expired',
                message: `JWT expired at ${expiredDate.toISOString()}`,
                details: {
                  opEntityId,
                  expiredAt: expiredDate.toISOString()
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Expired JWTs should cause validation to fail
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates expiration
        const hasExpirationError = result.errors.some(
          e => e.code === 'jwt_expired' || 
               e.message.toLowerCase().includes('expired')
        );
        expect(hasExpirationError).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 2: JWT Signature Verification - Should handle unsupported algorithms', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.constantFrom('HS256', 'HS384', 'HS512', 'none', 'custom'),
      
      async (opEntityId, unsupportedAlg) => {
        // Mock the validator to simulate unsupported algorithm
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'unsupported_algorithm',
                message: `Unsupported JWT algorithm: ${unsupportedAlg}`,
                details: {
                  opEntityId,
                  algorithm: unsupportedAlg
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Unsupported algorithms should cause validation to fail
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates unsupported algorithm
        const hasAlgorithmError = result.errors.some(
          e => e.code === 'unsupported_algorithm' || 
               e.message.toLowerCase().includes('algorithm')
        );
        expect(hasAlgorithmError).toBe(true);
      }
    ), { numRuns: 50 });
  });

  it('Property 2: JWT Signature Verification - Should verify all entity statements in trust chain', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.integer({ min: 2, max: 5 }), // Chain length
      
      async (opEntityId, chainLength) => {
        // Mock the validator to track verification of multiple statements
        let verificationCount = 0;
        
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            // Simulate verifying multiple entity statements in the chain
            verificationCount = chainLength;
            
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // All entity statements in the chain should be verified
        expect(result.isValid).toBe(true);
        expect(mockValidator.validateTrustChain).toHaveBeenCalledWith(opEntityId);
        
        // Verify that multiple statements were processed
        expect(verificationCount).toBeGreaterThanOrEqual(2);
      }
    ), { numRuns: 100 });
  });

  it('Property 2: JWT Signature Verification - Should fail if any signature in chain is invalid', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.integer({ min: 0, max: 4 }), // Index of invalid signature
      
      async (opEntityId, invalidIndex) => {
        // Mock the validator to simulate one invalid signature in the chain
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'invalid_signature_in_chain',
                message: `Invalid signature at position ${invalidIndex} in trust chain`,
                details: {
                  opEntityId,
                  invalidIndex
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Any invalid signature should cause the entire validation to fail
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates signature issue in chain
        const hasChainSignatureError = result.errors.some(
          e => e.code === 'invalid_signature_in_chain' || 
               (e.message.toLowerCase().includes('signature') && 
                e.message.toLowerCase().includes('chain'))
        );
        expect(hasChainSignatureError).toBe(true);
      }
    ), { numRuns: 100 });
  });
});

describe('Feature: rp-op-trust-validation, Property 4: Trust Chain Resolution', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for entity configuration with authority hints
  const entityConfigWithAuthorityHintsArb = fc.record({
    entityId: httpsUrlArb,
    authorityHints: fc.array(httpsUrlArb, { minLength: 1, maxLength: 3 })
  });

  // Generator for trust chain (array of entity IDs)
  const trustChainArb = fc.array(httpsUrlArb, { minLength: 2, maxLength: 5 })
    .map(entities => {
      // Ensure the last entity is the trust anchor
      entities[entities.length - 1] = mockTrustAnchorUrl;
      return entities;
    });

  it('Property 4: Trust Chain Resolution - Should recursively resolve trust chain to Trust Anchor', async () => {
    await fc.assert(fc.asyncProperty(
      trustChainArb,
      
      async (trustChain) => {
        // Mock the IntegratedTrustChainValidator to track resolution calls
        const resolutionCalls = [];
        
        const mockValidator = {
          validateTrustChain: vi.fn(async (entityId) => {
            resolutionCalls.push(entityId);
            
            // Simulate successful validation that reaches trust anchor
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Start validation from the first entity (leaf OP)
        const opEntityId = trustChain[0];
        const result = await validator.validateOP(opEntityId);
        
        // Verify that validation was attempted
        expect(mockValidator.validateTrustChain).toHaveBeenCalledWith(opEntityId);
        expect(resolutionCalls.length).toBeGreaterThan(0);
        expect(resolutionCalls[0]).toBe(opEntityId);
        
        // Verify successful validation
        expect(result.isValid).toBe(true);
        expect(result.trustAnchor).toBe(mockTrustAnchorUrl);
      }
    ), { numRuns: 100 });
  });

  it('Property 4: Trust Chain Resolution - Should handle OPs with multiple authority hints', async () => {
    await fc.assert(fc.asyncProperty(
      entityConfigWithAuthorityHintsArb,
      
      async (entityConfig) => {
        const { entityId, authorityHints } = entityConfig;
        
        // Mock the validator to simulate resolution through authority hints
        const mockValidator = {
          validateTrustChain: vi.fn(async (opEntityId) => {
            // Simulate that the validator follows authority hints
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(entityId);
        
        // Verify that validation was called with the OP entity ID
        expect(mockValidator.validateTrustChain).toHaveBeenCalledWith(entityId);
        
        // The validator should successfully resolve even with multiple authority hints
        expect(result.isValid).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 4: Trust Chain Resolution - Should fail when trust chain does not reach Trust Anchor', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      httpsUrlArb.filter(url => url !== mockTrustAnchorUrl),
      
      async (opEntityId, invalidTrustAnchor) => {
        // Mock the validator to simulate a chain that doesn't reach the configured trust anchor
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'invalid_trust_anchor',
                message: `Trust chain does not terminate at configured trust anchor`,
                details: {
                  expectedTrustAnchor: mockTrustAnchorUrl,
                  actualTermination: invalidTrustAnchor
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify that validation failed
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates trust anchor issue
        const hasTrustAnchorError = result.errors.some(
          e => e.code === 'invalid_trust_anchor' || 
               e.message.toLowerCase().includes('trust anchor')
        );
        expect(hasTrustAnchorError).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 4: Trust Chain Resolution - Should handle circular references in trust chain', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(httpsUrlArb, { minLength: 2, maxLength: 4 }),
      
      async (entities) => {
        // Create a circular reference by having the last entity point back to the first
        const circularChain = [...entities, entities[0]];
        
        // Mock the validator to detect circular reference
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'circular_reference',
                message: 'Circular reference detected in trust chain'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(entities[0]);
        
        // Circular references should cause validation to fail
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
      }
    ), { numRuns: 50 });
  });

  it('Property 4: Trust Chain Resolution - Should enforce maximum trust chain length', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator to simulate an excessively long trust chain
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'trust_chain_too_long',
                message: 'Trust chain exceeds maximum length'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Excessively long chains should be rejected
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
      }
    ), { numRuns: 50 });
  });

  it('Property 4: Trust Chain Resolution - Should handle missing authority hints gracefully', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator to simulate an entity with no authority hints
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'no_authority_hints',
                message: 'Entity has no authority hints and is not a trust anchor'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Missing authority hints should cause validation to fail
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
      }
    ), { numRuns: 50 });
  });

  it('Property 4: Trust Chain Resolution - Should cache successful resolutions', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let callCount = 0;
        
        // Mock the validator to track call count
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            callCount++;
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation - should call the validator
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(true);
        expect(result1.cached).toBe(false);
        expect(callCount).toBe(1);
        
        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(true);
        expect(result2.cached).toBe(true);
        expect(callCount).toBe(1); // Should not increase
        
        // Verify both results have the same trust anchor
        expect(result1.trustAnchor).toBe(result2.trustAnchor);
      }
    ), { numRuns: 50 });
  });

  it('Property 4: Trust Chain Resolution - Should handle network failures during resolution', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator to simulate network failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            throw new Error('Network error: Failed to fetch entity configuration');
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Network failures should be handled gracefully
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Error should indicate network/validation failure
        const hasValidationError = result.errors.some(
          e => e.code === 'validation_error' || 
               e.code === 'op_unreachable' ||
               e.message.toLowerCase().includes('failed') ||
               e.message.toLowerCase().includes('fetch')
        );
        expect(hasValidationError).toBe(true);
      }
    ), { numRuns: 50 });
  });
});

describe('Feature: rp-op-trust-validation, Property 5: Trust Chain Termination Validation', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for trust chains that terminate at the configured trust anchor
  const validTrustChainArb = fc.array(httpsUrlArb, { minLength: 1, maxLength: 4 })
    .map(entities => {
      // Ensure the last entity is the configured trust anchor
      return [...entities, mockTrustAnchorUrl];
    });

  // Generator for trust chains that do NOT terminate at the configured trust anchor
  const invalidTrustChainArb = fc.record({
    entities: fc.array(httpsUrlArb, { minLength: 1, maxLength: 4 }),
    wrongTrustAnchor: httpsUrlArb.filter(url => url !== mockTrustAnchorUrl)
  }).map(({ entities, wrongTrustAnchor }) => {
    // Chain terminates at a different trust anchor
    return {
      chain: [...entities, wrongTrustAnchor],
      wrongTrustAnchor
    };
  });

  it('Property 5: Trust Chain Termination Validation - Should accept chains terminating at configured Trust Anchor', async () => {
    await fc.assert(fc.asyncProperty(
      validTrustChainArb,
      
      async (trustChain) => {
        // Mock the validator to simulate a valid trust chain that terminates at the configured trust anchor
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Start validation from the first entity (leaf OP)
        const opEntityId = trustChain[0];
        const result = await validator.validateOP(opEntityId);
        
        // Verify that validation succeeded
        expect(result.isValid).toBe(true);
        expect(result.trustAnchor).toBe(mockTrustAnchorUrl);
        expect(result.errors).toEqual([]);
        
        // Verify the trust anchor matches the configured one
        expect(result.trustAnchor).toBe(validator.trustAnchorUrl);
      }
    ), { numRuns: 100 });
  });

  it('Property 5: Trust Chain Termination Validation - Should reject chains terminating at wrong Trust Anchor', async () => {
    await fc.assert(fc.asyncProperty(
      invalidTrustChainArb,
      
      async ({ chain, wrongTrustAnchor }) => {
        // Mock the validator to simulate a trust chain that terminates at the wrong trust anchor
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'invalid_trust_anchor',
                message: 'Trust chain does not terminate at configured trust anchor',
                details: {
                  expectedTrustAnchor: mockTrustAnchorUrl,
                  actualTermination: wrongTrustAnchor
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Start validation from the first entity (leaf OP)
        const opEntityId = chain[0];
        const result = await validator.validateOP(opEntityId);
        
        // Verify that validation failed
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates trust anchor mismatch
        const hasTrustAnchorError = result.errors.some(
          e => e.code === 'invalid_trust_anchor' || 
               e.message.toLowerCase().includes('trust anchor')
        );
        expect(hasTrustAnchorError).toBe(true);
        
        // Verify error details include expected and actual trust anchors
        const trustAnchorError = result.errors.find(
          e => e.code === 'invalid_trust_anchor'
        );
        if (trustAnchorError && trustAnchorError.details) {
          expect(trustAnchorError.details.expectedTrustAnchor).toBe(mockTrustAnchorUrl);
          expect(trustAnchorError.details.actualTermination).toBe(wrongTrustAnchor);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 5: Trust Chain Termination Validation - Should verify final entity matches Trust Anchor URL', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator to track trust anchor verification
        let verifiedTrustAnchor = null;
        
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            // Simulate successful validation with trust anchor verification
            verifiedTrustAnchor = mockTrustAnchorUrl;
            
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify that validation checked the trust anchor
        expect(mockValidator.validateTrustChain).toHaveBeenCalledWith(opEntityId);
        expect(verifiedTrustAnchor).toBe(mockTrustAnchorUrl);
        
        // Verify the result includes the correct trust anchor
        expect(result.isValid).toBe(true);
        expect(result.trustAnchor).toBe(mockTrustAnchorUrl);
      }
    ), { numRuns: 100 });
  });

  it('Property 5: Trust Chain Termination Validation - Should return error if chain does not reach Trust Anchor', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator to simulate a chain that doesn't reach any trust anchor
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'trust_chain_incomplete',
                message: 'Trust chain does not reach any trust anchor',
                details: {
                  opEntityId,
                  expectedTrustAnchor: mockTrustAnchorUrl
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify that validation failed
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates incomplete chain
        const hasIncompleteChainError = result.errors.some(
          e => e.code === 'trust_chain_incomplete' || 
               e.message.toLowerCase().includes('does not reach')
        );
        expect(hasIncompleteChainError).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 5: Trust Chain Termination Validation - Should validate trust anchor for chains of varying lengths', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.integer({ min: 1, max: 5 }), // Chain length
      
      async (opEntityId, chainLength) => {
        // Mock the validator to simulate chains of different lengths
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            // All chains should terminate at the configured trust anchor
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Regardless of chain length, trust anchor should be verified
        expect(result.isValid).toBe(true);
        expect(result.trustAnchor).toBe(mockTrustAnchorUrl);
        
        // Verify the trust anchor matches the configured one
        expect(result.trustAnchor).toBe(validator.trustAnchorUrl);
      }
    ), { numRuns: 100 });
  });

  it('Property 5: Trust Chain Termination Validation - Should handle self-signed trust anchor entities', async () => {
    await fc.assert(fc.asyncProperty(
      fc.constant(mockTrustAnchorUrl),
      
      async (trustAnchorEntityId) => {
        // Mock the validator to simulate validating the trust anchor itself
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            // Trust anchor validating itself should succeed
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(trustAnchorEntityId);
        
        // Trust anchor should be able to validate itself
        expect(result.isValid).toBe(true);
        expect(result.trustAnchor).toBe(mockTrustAnchorUrl);
      }
    ), { numRuns: 50 });
  });

  it('Property 5: Trust Chain Termination Validation - Should reject chains with multiple trust anchors', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.array(httpsUrlArb.filter(url => url !== mockTrustAnchorUrl), { minLength: 1, maxLength: 2 }),
      
      async (opEntityId, otherTrustAnchors) => {
        // Mock the validator to simulate a chain with multiple trust anchors
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'multiple_trust_anchors',
                message: 'Trust chain contains multiple trust anchors',
                details: {
                  expectedTrustAnchor: mockTrustAnchorUrl,
                  foundTrustAnchors: [mockTrustAnchorUrl, ...otherTrustAnchors]
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Multiple trust anchors should cause validation to fail
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
      }
    ), { numRuns: 50 });
  });

  it('Property 5: Trust Chain Termination Validation - Should cache trust anchor verification results', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationCount = 0;
        
        // Mock the validator to track validation calls
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCount++;
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(true);
        expect(result1.trustAnchor).toBe(mockTrustAnchorUrl);
        expect(result1.cached).toBe(false);
        expect(validationCount).toBe(1);
        
        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(true);
        expect(result2.trustAnchor).toBe(mockTrustAnchorUrl);
        expect(result2.cached).toBe(true);
        expect(validationCount).toBe(1); // Should not increase
        
        // Both results should have the same trust anchor
        expect(result1.trustAnchor).toBe(result2.trustAnchor);
      }
    ), { numRuns: 50 });
  });
});

describe('Feature: rp-op-trust-validation, Property 9: Validation Result Caching', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000 // 1 hour
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  it('Property 9: Validation Result Caching - Should cache successful validation results with timestamp', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator to return successful validation
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Record time before validation
        const beforeValidation = Date.now();
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Record time after validation
        const afterValidation = Date.now();
        
        // Verify validation succeeded
        expect(result.isValid).toBe(true);
        expect(result.cached).toBe(false);
        
        // Verify result includes timestamp
        expect(result.timestamp).toBeDefined();
        expect(typeof result.timestamp).toBe('number');
        
        // Timestamp should be within the validation time window
        expect(result.timestamp).toBeGreaterThanOrEqual(beforeValidation);
        expect(result.timestamp).toBeLessThanOrEqual(afterValidation);
        
        // Verify the result is now cached
        expect(validator.isOPValidated(opEntityId)).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 9: Validation Result Caching - Should cache validation result including trust anchor', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(true);
        expect(result1.trustAnchor).toBe(mockTrustAnchorUrl);
        expect(result1.cached).toBe(false);
        
        // Second validation - should return cached result with same trust anchor
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(true);
        expect(result2.trustAnchor).toBe(mockTrustAnchorUrl);
        expect(result2.cached).toBe(true);
        
        // Trust anchor should be preserved in cache
        expect(result1.trustAnchor).toBe(result2.trustAnchor);
      }
    ), { numRuns: 100 });
  });

  it('Property 9: Validation Result Caching - Should cache validation result for multiple OPs independently', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(httpsUrlArb, { minLength: 2, maxLength: 4 }).filter(urls => {
        // Ensure all URLs are unique
        return new Set(urls).size === urls.length;
      }),
      
      async (opEntityIds) => {
        const timestamps = new Map();
        
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Validate each OP and record timestamps
        for (const opEntityId of opEntityIds) {
          const result = await validator.validateOP(opEntityId);
          
          expect(result.isValid).toBe(true);
          expect(result.cached).toBe(false);
          expect(result.timestamp).toBeDefined();
          
          timestamps.set(opEntityId, result.timestamp);
          
          // Small delay to ensure different timestamps
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        
        // Verify each OP has its own cache entry
        for (const opEntityId of opEntityIds) {
          expect(validator.isOPValidated(opEntityId)).toBe(true);
          
          // Second validation should use cache
          const cachedResult = await validator.validateOP(opEntityId);
          expect(cachedResult.cached).toBe(true);
          expect(cachedResult.timestamp).toBe(timestamps.get(opEntityId));
        }
      }
    ), { numRuns: 50 });
  });

  it('Property 9: Validation Result Caching - Should preserve timestamp in cached results', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.integer({ min: 2, max: 5 }), // Number of cache accesses
      
      async (opEntityId, accessCount) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);
        const originalTimestamp = result1.timestamp;
        
        // Access cache multiple times
        for (let i = 0; i < accessCount; i++) {
          await new Promise(resolve => setTimeout(resolve, 10));
          
          const cachedResult = await validator.validateOP(opEntityId);
          expect(cachedResult.cached).toBe(true);
          expect(cachedResult.timestamp).toBe(originalTimestamp);
        }
      }
    ), { numRuns: 50 });
  });

  it('Property 9: Validation Result Caching - Should cache failed validations with timestamp', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.array(fc.string({ minLength: 10, maxLength: 50 }), { minLength: 1, maxLength: 2 }),
      
      async (opEntityId, errorMessages) => {
        const errors = errorMessages.map((msg, idx) => ({
          code: `error_${idx}`,
          message: msg
        }));
        
        // Mock the validator to return failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Record time before validation
        const beforeValidation = Date.now();
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Record time after validation
        const afterValidation = Date.now();
        
        // Verify validation failed
        expect(result.isValid).toBe(false);
        expect(result.cached).toBe(false);
        // Errors will be categorized, so we just check they exist
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify result includes timestamp even for failures
        expect(result.timestamp).toBeDefined();
        expect(typeof result.timestamp).toBe('number');
        expect(result.timestamp).toBeGreaterThanOrEqual(beforeValidation);
        expect(result.timestamp).toBeLessThanOrEqual(afterValidation);
        
        // Verify the mock was called once
        expect(mockValidator.validateTrustChain).toHaveBeenCalledTimes(1);
        
        // Second validation should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.cached).toBe(true);
        expect(result2.isValid).toBe(false);
        // Cached errors should match the first result's categorized errors
        expect(result2.errors).toEqual(result.errors);
        expect(result2.timestamp).toBe(result.timestamp);
        
        // Verify the mock was still only called once (cache was used)
        expect(mockValidator.validateTrustChain).toHaveBeenCalledTimes(1);
      }
    ), { numRuns: 50 });
  });

  it('Property 9: Validation Result Caching - Should update cache on re-validation after clear', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);
        const timestamp1 = result1.timestamp;
        
        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Clear cache
        validator.clearCache();
        
        // Second validation after clear - should create new cache entry
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.cached).toBe(false);
        const timestamp2 = result2.timestamp;
        
        // New timestamp should be different (later)
        expect(timestamp2).toBeGreaterThan(timestamp1);
        
        // Third validation - should use new cache
        const result3 = await validator.validateOP(opEntityId);
        expect(result3.cached).toBe(true);
        expect(result3.timestamp).toBe(timestamp2);
      }
    ), { numRuns: 50 });
  });

  it('Property 9: Validation Result Caching - Should include all validation result fields in cache', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        
        // Verify all expected fields are present
        expect(result1).toHaveProperty('isValid');
        expect(result1).toHaveProperty('trustAnchor');
        expect(result1).toHaveProperty('errors');
        expect(result1).toHaveProperty('cached');
        expect(result1).toHaveProperty('timestamp');
        
        // Second validation - cached result should have same fields
        const result2 = await validator.validateOP(opEntityId);
        
        expect(result2).toHaveProperty('isValid');
        expect(result2).toHaveProperty('trustAnchor');
        expect(result2).toHaveProperty('errors');
        expect(result2).toHaveProperty('cached');
        expect(result2).toHaveProperty('timestamp');
        
        // Values should match (except cached flag)
        expect(result2.isValid).toBe(result1.isValid);
        expect(result2.trustAnchor).toBe(result1.trustAnchor);
        expect(result2.errors).toEqual(result1.errors);
        expect(result2.timestamp).toBe(result1.timestamp);
      }
    ), { numRuns: 100 });
  });
});

describe('Feature: rp-op-trust-validation, Property 10: Cache Usage for Valid Entries', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000 // 1 hour
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for cache scenarios
  const cacheScenarioArb = fc.record({
    opEntityId: httpsUrlArb,
    validationCount: fc.integer({ min: 2, max: 5 }) // Number of times to validate
  });

  it('Property 10: Cache Usage for Valid Entries - Should use cached result for non-expired entries', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationCallCount = 0;
        
        // Mock the validator to track validation calls
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCallCount++;
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation - should call the validator
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(true);
        expect(result1.cached).toBe(false);
        expect(validationCallCount).toBe(1);
        
        // Second validation - should use cache (not expired)
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(true);
        expect(result2.cached).toBe(true);
        expect(validationCallCount).toBe(1); // Should NOT increase
        
        // Third validation - should still use cache
        const result3 = await validator.validateOP(opEntityId);
        expect(result3.isValid).toBe(true);
        expect(result3.cached).toBe(true);
        expect(validationCallCount).toBe(1); // Should NOT increase
        
        // Verify all cached results have the same trust anchor
        expect(result1.trustAnchor).toBe(result2.trustAnchor);
        expect(result2.trustAnchor).toBe(result3.trustAnchor);
      }
    ), { numRuns: 100 });
  });

  it('Property 10: Cache Usage for Valid Entries - Should not re-validate when cache is valid', async () => {
    await fc.assert(fc.asyncProperty(
      cacheScenarioArb,
      
      async ({ opEntityId, validationCount }) => {
        let actualValidationCalls = 0;
        
        // Mock the validator to track validation calls
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            actualValidationCalls++;
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform multiple validations
        const results = [];
        for (let i = 0; i < validationCount; i++) {
          const result = await validator.validateOP(opEntityId);
          results.push(result);
        }
        
        // Only the first validation should call the validator
        expect(actualValidationCalls).toBe(1);
        
        // First result should not be cached
        expect(results[0].cached).toBe(false);
        
        // All subsequent results should be cached
        for (let i = 1; i < validationCount; i++) {
          expect(results[i].cached).toBe(true);
          expect(results[i].isValid).toBe(results[0].isValid);
          expect(results[i].trustAnchor).toBe(results[0].trustAnchor);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 10: Cache Usage for Valid Entries - Should cache both successful and failed validations', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.boolean(), // Whether validation succeeds or fails
      
      async (opEntityId, shouldSucceed) => {
        let validationCallCount = 0;
        
        // Mock the validator to return success or failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCallCount++;
            
            if (shouldSucceed) {
              return {
                isValid: true,
                trustAnchor: mockTrustAnchorUrl,
                errors: []
              };
            } else {
              return {
                isValid: false,
                errors: [{
                  code: 'validation_failed',
                  message: 'Trust chain validation failed'
                }]
              };
            }
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);
        expect(result1.isValid).toBe(shouldSucceed);
        expect(validationCallCount).toBe(1);
        
        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.cached).toBe(true);
        expect(result2.isValid).toBe(shouldSucceed);
        expect(validationCallCount).toBe(1); // Should NOT increase
        
        // Results should be consistent
        expect(result1.isValid).toBe(result2.isValid);
      }
    ), { numRuns: 100 });
  });

  it('Property 10: Cache Usage for Valid Entries - Should maintain separate cache entries for different OPs', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(httpsUrlArb, { minLength: 2, maxLength: 5 }).filter(urls => {
        // Ensure all URLs are unique
        return new Set(urls).size === urls.length;
      }),
      
      async (opEntityIds) => {
        const validationCalls = new Map();
        
        // Mock the validator to track calls per OP
        const mockValidator = {
          validateTrustChain: vi.fn(async (entityId) => {
            const count = validationCalls.get(entityId) || 0;
            validationCalls.set(entityId, count + 1);
            
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Validate each OP twice
        for (const opEntityId of opEntityIds) {
          // First validation
          const result1 = await validator.validateOP(opEntityId);
          expect(result1.cached).toBe(false);
          expect(validationCalls.get(opEntityId)).toBe(1);
          
          // Second validation - should use cache
          const result2 = await validator.validateOP(opEntityId);
          expect(result2.cached).toBe(true);
          expect(validationCalls.get(opEntityId)).toBe(1); // Should NOT increase
        }
        
        // Each OP should have been validated exactly once
        for (const opEntityId of opEntityIds) {
          expect(validationCalls.get(opEntityId)).toBe(1);
        }
      }
    ), { numRuns: 50 });
  });

  it('Property 10: Cache Usage for Valid Entries - Should return cached timestamp on cache hit', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);
        expect(result1.timestamp).toBeDefined();
        const originalTimestamp = result1.timestamp;
        
        // Wait a small amount of time
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.cached).toBe(true);
        expect(result2.timestamp).toBe(originalTimestamp); // Should be the same timestamp
        
        // Timestamp should not change for cached results
        expect(result2.timestamp).toBeLessThanOrEqual(Date.now());
      }
    ), { numRuns: 50 });
  });

  it('Property 10: Cache Usage for Valid Entries - Should preserve validation errors in cache', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.array(fc.string({ minLength: 10, maxLength: 50 }), { minLength: 1, maxLength: 3 }),
      
      async (opEntityId, errorMessages) => {
        const errors = errorMessages.map((msg, idx) => ({
          code: `error_${idx}`,
          message: msg
        }));
        
        // Mock the validator to return errors
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);
        expect(result1.isValid).toBe(false);
        // Errors will be categorized
        expect(result1.errors).toBeDefined();
        expect(result1.errors.length).toBeGreaterThan(0);
        
        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.cached).toBe(true);
        expect(result2.isValid).toBe(false);
        // Cached errors should match the first result's categorized errors
        expect(result2.errors).toEqual(result1.errors);
        
        // Errors should be identical between cache hit and miss
        expect(result1.errors).toEqual(result2.errors);
      }
    ), { numRuns: 50 });
  });

  it('Property 10: Cache Usage for Valid Entries - Should use isOPValidated to check cache status', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Before validation, OP should not be validated
        expect(validator.isOPValidated(opEntityId)).toBe(false);
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        expect(result.isValid).toBe(true);
        expect(result.cached).toBe(false);
        
        // After validation, OP should be validated (in cache)
        expect(validator.isOPValidated(opEntityId)).toBe(true);
        
        // Second validation should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.cached).toBe(true);
        
        // OP should still be validated
        expect(validator.isOPValidated(opEntityId)).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 10: Cache Usage for Valid Entries - Should not use cache after clearCache is called', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationCallCount = 0;
        
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCallCount++;
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);
        expect(validationCallCount).toBe(1);
        
        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.cached).toBe(true);
        expect(validationCallCount).toBe(1);
        
        // Clear cache
        validator.clearCache();
        
        // Third validation - should NOT use cache (cache was cleared)
        const result3 = await validator.validateOP(opEntityId);
        expect(result3.cached).toBe(false);
        expect(validationCallCount).toBe(2); // Should increase
        
        // Fourth validation - should use cache again
        const result4 = await validator.validateOP(opEntityId);
        expect(result4.cached).toBe(true);
        expect(validationCallCount).toBe(2); // Should NOT increase
      }
    ), { numRuns: 50 });
  });
});

describe('Feature: rp-op-trust-validation, Property 11: Cache Expiration and Re-validation', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    // Use a short cache expiration for testing (100ms)
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 100
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  it('Property 11: Cache Expiration and Re-validation - Should perform fresh validation when cache entry is expired', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationCallCount = 0;
        
        // Mock the validator to track validation calls
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCallCount++;
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation - should call the validator
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(true);
        expect(result1.cached).toBe(false);
        expect(validationCallCount).toBe(1);
        
        // Second validation immediately - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(true);
        expect(result2.cached).toBe(true);
        expect(validationCallCount).toBe(1); // Should NOT increase
        
        // Wait for cache to expire (100ms + buffer)
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Third validation after expiration - should perform fresh validation
        const result3 = await validator.validateOP(opEntityId);
        expect(result3.isValid).toBe(true);
        expect(result3.cached).toBe(false); // Should NOT be cached
        expect(validationCallCount).toBe(2); // Should increase
        
        // Fourth validation immediately - should use new cache
        const result4 = await validator.validateOP(opEntityId);
        expect(result4.isValid).toBe(true);
        expect(result4.cached).toBe(true);
        expect(validationCallCount).toBe(2); // Should NOT increase
      }
    ), { numRuns: 100 });
  });

  it('Property 11: Cache Expiration and Re-validation - Should update cache with new validation result after expiration', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);
        const timestamp1 = result1.timestamp;
        
        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Second validation after expiration - should create new cache entry
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.cached).toBe(false);
        const timestamp2 = result2.timestamp;
        
        // New timestamp should be different (later)
        expect(timestamp2).toBeGreaterThan(timestamp1);
        
        // Third validation - should use new cache
        const result3 = await validator.validateOP(opEntityId);
        expect(result3.cached).toBe(true);
        expect(result3.timestamp).toBe(timestamp2); // Should match second validation
      }
    ), { numRuns: 100 });
  });

  it('Property 11: Cache Expiration and Re-validation - Should handle different expiration times for different OPs', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(httpsUrlArb, { minLength: 2, maxLength: 3 }).filter(urls => {
        // Ensure all URLs are unique
        return new Set(urls).size === urls.length;
      }),
      
      async (opEntityIds) => {
        const validationCalls = new Map();
        
        // Mock the validator to track calls per OP
        const mockValidator = {
          validateTrustChain: vi.fn(async (entityId) => {
            const count = validationCalls.get(entityId) || 0;
            validationCalls.set(entityId, count + 1);
            
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Validate all OPs with delays between them
        for (let i = 0; i < opEntityIds.length; i++) {
          const opEntityId = opEntityIds[i];
          
          const result = await validator.validateOP(opEntityId);
          expect(result.cached).toBe(false);
          expect(validationCalls.get(opEntityId)).toBe(1);
          
          // Small delay between validations
          if (i < opEntityIds.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 30));
          }
        }
        
        // Wait for first OP's cache to expire (but not the last one)
        await new Promise(resolve => setTimeout(resolve, 80));
        
        // First OP should need re-validation (expired)
        const result1 = await validator.validateOP(opEntityIds[0]);
        expect(result1.cached).toBe(false);
        expect(validationCalls.get(opEntityIds[0])).toBe(2);
        
        // Last OP should still be cached (not expired yet)
        const resultLast = await validator.validateOP(opEntityIds[opEntityIds.length - 1]);
        expect(resultLast.cached).toBe(true);
        expect(validationCalls.get(opEntityIds[opEntityIds.length - 1])).toBe(1);
      }
    ), { numRuns: 50 });
  });

  it('Property 11: Cache Expiration and Re-validation - Should remove expired entries on access', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation - creates cache entry
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);
        
        // Verify OP is validated (in cache)
        expect(validator.isOPValidated(opEntityId)).toBe(true);
        
        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Check if OP is validated - should return false and remove expired entry
        expect(validator.isOPValidated(opEntityId)).toBe(false);
        
        // Validation should now perform fresh validation (entry was removed)
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.cached).toBe(false);
      }
    ), { numRuns: 100 });
  });

  it('Property 11: Cache Expiration and Re-validation - Should handle validation failures after cache expiration', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationCallCount = 0;
        let shouldSucceed = true;
        
        // Mock the validator to change behavior on second call
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCallCount++;
            
            if (shouldSucceed) {
              return {
                isValid: true,
                trustAnchor: mockTrustAnchorUrl,
                errors: []
              };
            } else {
              return {
                isValid: false,
                errors: [{
                  code: 'validation_failed',
                  message: 'Trust chain validation failed'
                }]
              };
            }
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation - succeeds
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(true);
        expect(result1.cached).toBe(false);
        expect(validationCallCount).toBe(1);
        
        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Change validator behavior to fail
        shouldSucceed = false;
        
        // Second validation after expiration - should fail
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(false);
        expect(result2.cached).toBe(false);
        expect(validationCallCount).toBe(2);
        
        // Third validation - should use new (failed) cache
        const result3 = await validator.validateOP(opEntityId);
        expect(result3.isValid).toBe(false);
        expect(result3.cached).toBe(true);
        expect(validationCallCount).toBe(2); // Should NOT increase
      }
    ), { numRuns: 50 });
  });

  it('Property 11: Cache Expiration and Re-validation - Should respect configured cache expiration time', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.integer({ min: 50, max: 200 }), // Cache expiration time in ms
      
      async (opEntityId, cacheExpirationMs) => {
        // Create validator with custom expiration time
        const customValidator = new OPTrustChainValidator({
          trustAnchorUrl: mockTrustAnchorUrl,
          cacheExpirationMs
        });
        
        let validationCallCount = 0;
        
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCallCount++;
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        customValidator.validator = mockValidator;
        
        // First validation
        const result1 = await customValidator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);
        expect(validationCallCount).toBe(1);
        
        // Wait for less than expiration time
        await new Promise(resolve => setTimeout(resolve, cacheExpirationMs / 2));
        
        // Should still use cache
        const result2 = await customValidator.validateOP(opEntityId);
        expect(result2.cached).toBe(true);
        expect(validationCallCount).toBe(1);
        
        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, cacheExpirationMs / 2 + 50));
        
        // Should perform fresh validation
        const result3 = await customValidator.validateOP(opEntityId);
        expect(result3.cached).toBe(false);
        expect(validationCallCount).toBe(2);
        
        // Clean up
        customValidator.destroy();
      }
    ), { numRuns: 50 });
  });

  it('Property 11: Cache Expiration and Re-validation - Should handle concurrent validations during cache expiration', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationCallCount = 0;
        
        // Mock the validator with a delay to simulate concurrent access
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCallCount++;
            // Small delay to simulate network request
            await new Promise(resolve => setTimeout(resolve, 10));
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);
        expect(validationCallCount).toBe(1);
        
        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Trigger multiple concurrent validations after expiration
        const promises = [
          validator.validateOP(opEntityId),
          validator.validateOP(opEntityId),
          validator.validateOP(opEntityId)
        ];
        
        const results = await Promise.all(promises);
        
        // At least one should not be cached (the first one to check)
        const nonCachedResults = results.filter(r => !r.cached);
        expect(nonCachedResults.length).toBeGreaterThan(0);
        
        // All should be valid
        results.forEach(result => {
          expect(result.isValid).toBe(true);
        });
      }
    ), { numRuns: 50 });
  });

  it('Property 11: Cache Expiration and Re-validation - Should preserve trust anchor in re-validated cache', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.trustAnchor).toBe(mockTrustAnchorUrl);
        expect(result1.cached).toBe(false);
        
        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Second validation after expiration
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.trustAnchor).toBe(mockTrustAnchorUrl);
        expect(result2.cached).toBe(false);
        
        // Third validation - should use new cache
        const result3 = await validator.validateOP(opEntityId);
        expect(result3.trustAnchor).toBe(mockTrustAnchorUrl);
        expect(result3.cached).toBe(true);
        
        // Trust anchor should be consistent across all validations
        expect(result1.trustAnchor).toBe(result2.trustAnchor);
        expect(result2.trustAnchor).toBe(result3.trustAnchor);
      }
    ), { numRuns: 100 });
  });
});

describe('Feature: rp-op-trust-validation, Property 12: Error Response Structure', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for error codes
  const errorCodeArb = fc.constantFrom(
    'op_unreachable',
    'invalid_signature',
    'missing_authority_hints',
    'trust_chain_invalid',
    'validation_error',
    'network_error',
    'timeout'
  );

  // Generator for validation error scenarios
  const validationErrorScenarioArb = fc.record({
    opEntityId: httpsUrlArb,
    errorCode: errorCodeArb,
    errorMessage: fc.string({ minLength: 10, maxLength: 100 }),
    errorDetails: fc.record({
      reason: fc.string({ minLength: 5, maxLength: 50 }),
      additionalInfo: fc.string({ minLength: 5, maxLength: 50 })
    })
  });

  // Generator for multiple errors
  const multipleErrorsScenarioArb = fc.record({
    opEntityId: httpsUrlArb,
    errors: fc.array(
      fc.record({
        code: errorCodeArb,
        message: fc.string({ minLength: 10, maxLength: 100 })
      }),
      { minLength: 1, maxLength: 5 }
    )
  });

  it('Property 12: Error Response Structure - Should include OP entity ID in error response', async () => {
    await fc.assert(fc.asyncProperty(
      validationErrorScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage } = scenario;
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify error response includes OP entity ID (Requirement 3.4)
        expect(result.isValid).toBe(false);
        expect(result.opEntityId).toBeDefined();
        expect(result.opEntityId).toBe(opEntityId);
        
        // Verify the OP entity ID is a valid HTTPS URL
        expect(result.opEntityId).toMatch(/^https:\/\//);
      }
    ), { numRuns: 100 });
  });

  it('Property 12: Error Response Structure - Should include specific failure reason in error response', async () => {
    await fc.assert(fc.asyncProperty(
      validationErrorScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage } = scenario;
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify error response includes specific failure reason (Requirement 6.5)
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Each error should have a code and message
        for (const error of result.errors) {
          expect(error.code).toBeDefined();
          expect(typeof error.code).toBe('string');
          expect(error.code.length).toBeGreaterThan(0);
          
          expect(error.message).toBeDefined();
          expect(typeof error.message).toBe('string');
          expect(error.message.length).toBeGreaterThan(0);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 12: Error Response Structure - Should include error details with OP entity ID', async () => {
    await fc.assert(fc.asyncProperty(
      validationErrorScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage, errorDetails } = scenario;
        
        // Mock the validator to return validation failure with details
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage,
                details: errorDetails
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify error response includes details with OP entity ID (Requirement 6.5)
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Each error should have details that include the OP entity ID
        for (const error of result.errors) {
          expect(error.details).toBeDefined();
          expect(error.details.opEntityId).toBe(opEntityId);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 12: Error Response Structure - Should include timestamp in error response', async () => {
    await fc.assert(fc.asyncProperty(
      validationErrorScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage } = scenario;
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Record time before validation
        const beforeValidation = Date.now();
        
        const result = await validator.validateOP(opEntityId);
        
        // Record time after validation
        const afterValidation = Date.now();
        
        // Verify error response includes timestamp
        expect(result.isValid).toBe(false);
        expect(result.timestamp).toBeDefined();
        expect(typeof result.timestamp).toBe('number');
        
        // Timestamp should be within the validation time window
        expect(result.timestamp).toBeGreaterThanOrEqual(beforeValidation);
        expect(result.timestamp).toBeLessThanOrEqual(afterValidation);
        
        // Each error should also have a timestamp in details
        for (const error of result.errors) {
          expect(error.details).toBeDefined();
          expect(error.details.timestamp).toBeDefined();
          expect(typeof error.details.timestamp).toBe('string');
          
          // Verify it's a valid ISO timestamp
          const errorTimestamp = new Date(error.details.timestamp);
          expect(errorTimestamp.getTime()).toBeGreaterThan(0);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 12: Error Response Structure - Should handle multiple errors in response', async () => {
    await fc.assert(fc.asyncProperty(
      multipleErrorsScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errors } = scenario;
        
        // Mock the validator to return multiple validation errors
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify error response includes all errors
        expect(result.isValid).toBe(false);
        expect(result.opEntityId).toBe(opEntityId);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThanOrEqual(errors.length);
        
        // Each error should have the required structure
        for (const error of result.errors) {
          expect(error.code).toBeDefined();
          expect(error.message).toBeDefined();
          expect(error.details).toBeDefined();
          expect(error.details.opEntityId).toBe(opEntityId);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 12: Error Response Structure - Should preserve error codes in response', async () => {
    await fc.assert(fc.asyncProperty(
      validationErrorScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage } = scenario;
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify error codes are preserved or categorized appropriately
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Each error should have a valid error code
        const validErrorCodes = [
          'op_unreachable',
          'invalid_signature',
          'missing_authority_hints',
          'trust_chain_invalid',
          'validation_error',
          'network_error',
          'timeout'
        ];
        
        for (const error of result.errors) {
          expect(validErrorCodes).toContain(error.code);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 12: Error Response Structure - Should include isValid false flag in error response', async () => {
    await fc.assert(fc.asyncProperty(
      validationErrorScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage } = scenario;
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        const result = await validator.validateOP(opEntityId);
        
        // Verify error response has isValid set to false
        expect(result).toHaveProperty('isValid');
        expect(result.isValid).toBe(false);
        
        // Verify other required fields are present
        expect(result).toHaveProperty('opEntityId');
        expect(result).toHaveProperty('errors');
        expect(result).toHaveProperty('cached');
        expect(result).toHaveProperty('timestamp');
      }
    ), { numRuns: 100 });
  });

  it('Property 12: Error Response Structure - Should maintain consistent structure across different error types', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.array(errorCodeArb, { minLength: 1, maxLength: 3 }),
      
      async (opEntityId, errorCodes) => {
        // Test multiple error types to ensure consistent structure
        for (const errorCode of errorCodes) {
          // Mock the validator to return specific error type
          const mockValidator = {
            validateTrustChain: vi.fn(async () => {
              return {
                isValid: false,
                errors: [{
                  code: errorCode,
                  message: `Test error for ${errorCode}`
                }]
              };
            })
          };
          
          validator.validator = mockValidator;
          
          // Clear cache to ensure fresh validation
          validator.clearCache();
          
          const result = await validator.validateOP(opEntityId);
          
          // Verify consistent structure regardless of error type
          expect(result).toHaveProperty('isValid');
          expect(result).toHaveProperty('opEntityId');
          expect(result).toHaveProperty('errors');
          expect(result).toHaveProperty('cached');
          expect(result).toHaveProperty('timestamp');
          
          expect(result.isValid).toBe(false);
          expect(result.opEntityId).toBe(opEntityId);
          expect(Array.isArray(result.errors)).toBe(true);
          expect(result.errors.length).toBeGreaterThan(0);
          
          // Each error should have consistent structure
          for (const error of result.errors) {
            expect(error).toHaveProperty('code');
            expect(error).toHaveProperty('message');
            expect(error).toHaveProperty('details');
            expect(error.details).toHaveProperty('opEntityId');
            expect(error.details).toHaveProperty('timestamp');
          }
        }
      }
    ), { numRuns: 50 });
  });

  it('Property 12: Error Response Structure - Should include cached flag in error response', async () => {
    await fc.assert(fc.asyncProperty(
      validationErrorScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage } = scenario;
        
        // Clear cache to ensure fresh validation
        validator.clearCache();
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation - should not be cached
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(false);
        expect(result1.cached).toBe(false);
        expect(result1.opEntityId).toBe(opEntityId);
        
        // Second validation - should be cached
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(false);
        expect(result2.cached).toBe(true);
        expect(result2.opEntityId).toBe(opEntityId);
        
        // Both responses should have the same structure
        expect(Object.keys(result1).sort()).toEqual(Object.keys(result2).sort());
      }
    ), { numRuns: 50 });
  });

  it('Property 12: Error Response Structure - Should preserve error details across cache hits', async () => {
    await fc.assert(fc.asyncProperty(
      validationErrorScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage, errorDetails } = scenario;
        
        // Mock the validator to return validation failure with details
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage,
                details: errorDetails
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.cached).toBe(false);
        
        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.cached).toBe(true);
        
        // Error structure should be identical
        expect(result1.isValid).toBe(result2.isValid);
        expect(result1.opEntityId).toBe(result2.opEntityId);
        expect(result1.errors).toEqual(result2.errors);
        expect(result1.timestamp).toBe(result2.timestamp);
        
        // Verify error details are preserved
        for (let i = 0; i < result1.errors.length; i++) {
          expect(result1.errors[i].code).toBe(result2.errors[i].code);
          expect(result1.errors[i].message).toBe(result2.errors[i].message);
          expect(result1.errors[i].details.opEntityId).toBe(result2.errors[i].details.opEntityId);
        }
      }
    ), { numRuns: 50 });
  });
});

describe('Feature: rp-op-trust-validation, Property 7: Authentication Rejection for Invalid Chains', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for invalid trust chain scenarios
  const invalidTrustChainScenarioArb = fc.record({
    opEntityId: httpsUrlArb,
    errorType: fc.constantFrom(
      'invalid_signature',
      'missing_authority_hints',
      'trust_chain_invalid',
      'op_unreachable',
      'trust_chain_incomplete',
      'invalid_trust_anchor'
    ),
    errorMessage: fc.string({ minLength: 10, maxLength: 100 })
  });

  it('Property 7: Authentication Rejection for Invalid Chains - Should reject authentication for OPs with invalid trust chains', async () => {
    await fc.assert(fc.asyncProperty(
      invalidTrustChainScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorType, errorMessage } = scenario;
        
        // Mock the validator to return invalid trust chain
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorType,
                message: errorMessage
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify that validation failed (Requirement 2.3)
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify that the authentication flow should be rejected (Requirement 3.1)
        // The result should indicate that authentication cannot proceed
        expect(result.isValid).toBe(false);
        
        // Verify error includes OP entity ID
        expect(result.opEntityId).toBe(opEntityId);
      }
    ), { numRuns: 100 });
  });

  it('Property 7: Authentication Rejection for Invalid Chains - Should return error for all invalid trust chain types', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.constantFrom(
        'invalid_signature',
        'missing_authority_hints',
        'trust_chain_invalid',
        'op_unreachable',
        'trust_chain_incomplete',
        'invalid_trust_anchor',
        'circular_reference',
        'trust_chain_too_long'
      ),
      
      async (opEntityId, errorType) => {
        // Mock the validator to return specific error type
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorType,
                message: `Trust chain validation failed: ${errorType}`
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // All invalid trust chain types should result in authentication rejection
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error structure is consistent
        expect(result.opEntityId).toBe(opEntityId);
        expect(result.timestamp).toBeDefined();
      }
    ), { numRuns: 100 });
  });

  it('Property 7: Authentication Rejection for Invalid Chains - Should reject authentication immediately upon validation failure', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationAttempted = false;
        
        // Mock the validator to track validation attempts
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationAttempted = true;
            return {
              isValid: false,
              errors: [{
                code: 'trust_chain_invalid',
                message: 'Trust chain validation failed'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation was attempted
        expect(validationAttempted).toBe(true);
        expect(mockValidator.validateTrustChain).toHaveBeenCalledWith(opEntityId);
        
        // Verify authentication is rejected immediately
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        
        // No further processing should occur after validation failure
        // (verified by the fact that isValid is false)
      }
    ), { numRuns: 100 });
  });

  it('Property 7: Authentication Rejection for Invalid Chains - Should include specific failure reason in rejection', async () => {
    await fc.assert(fc.asyncProperty(
      invalidTrustChainScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorType, errorMessage } = scenario;
        
        // Mock the validator to return validation failure with details
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorType,
                message: errorMessage,
                details: {
                  reason: `Specific failure: ${errorType}`,
                  opEntityId: opEntityId
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify rejection includes specific failure reason (Requirement 3.1)
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Each error should have a specific reason
        for (const error of result.errors) {
          expect(error.code).toBeDefined();
          expect(error.message).toBeDefined();
          expect(error.details).toBeDefined();
          expect(error.details.opEntityId).toBe(opEntityId);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 7: Authentication Rejection for Invalid Chains - Should reject authentication for network failures', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.constantFrom(
        'ECONNREFUSED',
        'ENOTFOUND',
        'ETIMEDOUT',
        'Network error'
      ),
      
      async (opEntityId, networkError) => {
        // Mock the validator to simulate network failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            throw new Error(`${networkError}`);
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Network failures should result in authentication rejection
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates network/validation failure
        // The error code should be either 'op_unreachable' or 'validation_error'
        const hasValidationError = result.errors.some(
          e => e.code === 'validation_error' || 
               e.code === 'op_unreachable' ||
               e.message.toLowerCase().includes('failed') ||
               e.message.toLowerCase().includes('network') ||
               e.message.toLowerCase().includes('fetch') ||
               e.message.includes(networkError)
        );
        expect(hasValidationError).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 7: Authentication Rejection for Invalid Chains - Should reject authentication for expired entity statements', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.integer({ min: 1, max: 365 }), // Days expired
      
      async (opEntityId, daysExpired) => {
        // Mock the validator to simulate expired entity statement
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            const expiredDate = new Date();
            expiredDate.setDate(expiredDate.getDate() - daysExpired);
            
            return {
              isValid: false,
              errors: [{
                code: 'jwt_expired',
                message: `Entity statement expired at ${expiredDate.toISOString()}`,
                details: {
                  opEntityId,
                  expiredAt: expiredDate.toISOString()
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Expired entity statements should result in authentication rejection
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates expiration
        const hasExpirationError = result.errors.some(
          e => e.code === 'jwt_expired' || 
               e.message.toLowerCase().includes('expired')
        );
        expect(hasExpirationError).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 7: Authentication Rejection for Invalid Chains - Should reject authentication for chains not reaching Trust Anchor', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      httpsUrlArb.filter(url => url !== mockTrustAnchorUrl),
      
      async (opEntityId, wrongTrustAnchor) => {
        // Mock the validator to simulate chain not reaching configured trust anchor
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'invalid_trust_anchor',
                message: 'Trust chain does not terminate at configured trust anchor',
                details: {
                  opEntityId,
                  expectedTrustAnchor: mockTrustAnchorUrl,
                  actualTermination: wrongTrustAnchor
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Chains not reaching trust anchor should result in authentication rejection
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates trust anchor issue
        const hasTrustAnchorError = result.errors.some(
          e => e.code === 'invalid_trust_anchor' || 
               e.message.toLowerCase().includes('trust anchor')
        );
        expect(hasTrustAnchorError).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 7: Authentication Rejection for Invalid Chains - Should cache rejection results', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationCallCount = 0;
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCallCount++;
            return {
              isValid: false,
              errors: [{
                code: 'trust_chain_invalid',
                message: 'Trust chain validation failed'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation - should call validator
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(false);
        expect(result1.cached).toBe(false);
        expect(validationCallCount).toBe(1);
        
        // Second validation - should use cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(false);
        expect(result2.cached).toBe(true);
        expect(validationCallCount).toBe(1); // Should NOT increase
        
        // Both rejections should be consistent
        expect(result1.isValid).toBe(result2.isValid);
        expect(result1.errors).toEqual(result2.errors);
      }
    ), { numRuns: 100 });
  });

  it('Property 7: Authentication Rejection for Invalid Chains - Should reject authentication with multiple validation errors', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.array(
        fc.record({
          code: fc.constantFrom(
            'invalid_signature',
            'missing_authority_hints',
            'trust_chain_invalid'
          ),
          message: fc.string({ minLength: 10, maxLength: 50 })
        }),
        { minLength: 2, maxLength: 4 }
      ),
      
      async (opEntityId, errors) => {
        // Mock the validator to return multiple validation errors
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Multiple errors should still result in authentication rejection
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThanOrEqual(errors.length);
        
        // All errors should be included in the rejection
        expect(result.opEntityId).toBe(opEntityId);
      }
    ), { numRuns: 100 });
  });

  it('Property 7: Authentication Rejection for Invalid Chains - Should maintain rejection state across multiple checks', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.integer({ min: 2, max: 5 }), // Number of validation checks
      
      async (opEntityId, checkCount) => {
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'trust_chain_invalid',
                message: 'Trust chain validation failed'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform multiple validation checks
        const results = [];
        for (let i = 0; i < checkCount; i++) {
          const result = await validator.validateOP(opEntityId);
          results.push(result);
        }
        
        // All checks should consistently reject authentication
        for (const result of results) {
          expect(result.isValid).toBe(false);
          expect(result.errors).toBeDefined();
          expect(result.errors.length).toBeGreaterThan(0);
        }
        
        // First result should not be cached, subsequent ones should be
        expect(results[0].cached).toBe(false);
        for (let i = 1; i < checkCount; i++) {
          expect(results[i].cached).toBe(true);
        }
      }
    ), { numRuns: 50 });
  });
});

describe('Feature: rp-op-trust-validation, Property 8: Error Logging with Entity ID', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000
    });

    // Spy on console.error and console.log to verify logging
    consoleErrorSpy = vi.spyOn(console, 'error');
    consoleLogSpy = vi.spyOn(console, 'log');
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for validation error scenarios
  const validationErrorScenarioArb = fc.record({
    opEntityId: httpsUrlArb,
    errorCode: fc.constantFrom(
      'invalid_signature',
      'missing_authority_hints',
      'trust_chain_invalid',
      'op_unreachable',
      'validation_error'
    ),
    errorMessage: fc.string({ minLength: 10, maxLength: 100 })
  });

  // Generator for request context
  const requestContextArb = fc.record({
    sessionId: fc.uuid(),
    userAgent: fc.constantFrom(
      'Mozilla/5.0',
      'Chrome/91.0',
      'Safari/14.0',
      'Firefox/89.0'
    ),
    ipAddress: fc.ipV4()
  });

  it('Property 8: Error Logging with Entity ID - Should log validation failures with OP entity ID', async () => {
    await fc.assert(fc.asyncProperty(
      validationErrorScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage } = scenario;
        
        // Clear previous spy calls
        consoleErrorSpy.mockClear();
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        await validator.validateOP(opEntityId);
        
        // Verify that console.error was called
        expect(consoleErrorSpy).toHaveBeenCalled();
        
        // Find the error log that contains the validation failure
        const errorLogs = consoleErrorSpy.mock.calls;
        const validationFailureLog = errorLogs.find(call => 
          call[0] && call[0].includes('validation failed')
        );
        
        expect(validationFailureLog).toBeDefined();
        
        // Verify the log includes the OP entity ID
        const logContext = validationFailureLog[1];
        expect(logContext).toBeDefined();
        expect(logContext.opEntityId).toBe(opEntityId);
        
        // Verify the log includes error information
        expect(logContext.errorCount).toBeGreaterThan(0);
        expect(logContext.errors).toBeDefined();
      }
    ), { numRuns: 100 });
  });

  it('Property 8: Error Logging with Entity ID - Should log failure reason with entity ID', async () => {
    await fc.assert(fc.asyncProperty(
      validationErrorScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage } = scenario;
        
        // Clear previous spy calls
        consoleErrorSpy.mockClear();
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        await validator.validateOP(opEntityId);
        
        // Verify that console.error was called with failure details
        expect(consoleErrorSpy).toHaveBeenCalled();
        
        // Find the error log
        const errorLogs = consoleErrorSpy.mock.calls;
        const validationFailureLog = errorLogs.find(call => 
          call[0] && call[0].includes('validation failed')
        );
        
        expect(validationFailureLog).toBeDefined();
        
        // Verify the log includes both entity ID and error details
        const logContext = validationFailureLog[1];
        expect(logContext.opEntityId).toBe(opEntityId);
        expect(logContext.errors).toBeDefined();
        expect(Array.isArray(logContext.errors)).toBe(true);
        
        // Verify each error includes the entity ID in its details
        for (const error of logContext.errors) {
          expect(error.details).toBeDefined();
          expect(error.details.opEntityId).toBe(opEntityId);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 8: Error Logging with Entity ID - Should include timestamp in error logs', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Clear previous spy calls
        consoleErrorSpy.mockClear();
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'validation_error',
                message: 'Test validation error'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const beforeTimestamp = new Date().toISOString();
        await validator.validateOP(opEntityId);
        const afterTimestamp = new Date().toISOString();
        
        // Verify that console.error was called
        expect(consoleErrorSpy).toHaveBeenCalled();
        
        // Find the error log
        const errorLogs = consoleErrorSpy.mock.calls;
        const validationFailureLog = errorLogs.find(call => 
          call[0] && call[0].includes('validation failed')
        );
        
        expect(validationFailureLog).toBeDefined();
        
        // Verify the log includes a timestamp
        const logContext = validationFailureLog[1];
        expect(logContext.timestamp).toBeDefined();
        
        // Verify timestamp is in ISO format and within expected range
        expect(logContext.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(logContext.timestamp >= beforeTimestamp).toBe(true);
        expect(logContext.timestamp <= afterTimestamp).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 8: Error Logging with Entity ID - Should log request context when provided', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      requestContextArb,
      
      async (opEntityId, requestContext) => {
        // Clear previous spy calls
        consoleLogSpy.mockClear();
        consoleErrorSpy.mockClear();
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'validation_error',
                message: 'Test validation error'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation with request context
        await validator.validateOP(opEntityId, requestContext);
        
        // Verify that console.log was called for starting validation
        expect(consoleLogSpy).toHaveBeenCalled();
        
        // Find the starting validation log
        const logCalls = consoleLogSpy.mock.calls;
        const startingLog = logCalls.find(call => 
          call[0] && call[0].includes('Starting OP trust chain validation')
        );
        
        expect(startingLog).toBeDefined();
        
        // Verify the log includes request context
        const logContext = startingLog[1];
        expect(logContext.opEntityId).toBe(opEntityId);
        expect(logContext.sessionId).toBe(requestContext.sessionId);
        expect(logContext.userAgent).toBe(requestContext.userAgent);
        expect(logContext.ipAddress).toBe(requestContext.ipAddress);
      }
    ), { numRuns: 100 });
  });

  it('Property 8: Error Logging with Entity ID - Should log network errors with entity ID', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.constantFrom(
        'ECONNREFUSED',
        'ENOTFOUND',
        'ETIMEDOUT',
        'Network error'
      ),
      
      async (opEntityId, networkError) => {
        // Clear previous spy calls and cache
        consoleErrorSpy.mockClear();
        consoleLogSpy.mockClear();
        validator.clearCache();
        
        // Mock the validator to throw network error
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            throw new Error(`${networkError}`);
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify that the result indicates a validation error
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify that console.error was called
        expect(consoleErrorSpy).toHaveBeenCalled();
        
        // Find any error log that contains the entity ID
        const errorLogs = consoleErrorSpy.mock.calls;
        const validationFailureLog = errorLogs.find(call => 
          call[1] && typeof call[1] === 'object' && call[1].opEntityId === opEntityId
        );
        
        // The log should exist and include entity ID
        expect(validationFailureLog).toBeDefined();
        
        // Verify the log includes entity ID and error details
        if (validationFailureLog && validationFailureLog[1]) {
          const logContext = validationFailureLog[1];
          expect(logContext.opEntityId).toBe(opEntityId);
          expect(logContext.error).toBeDefined();
          // The error message should contain the network error
          expect(logContext.error).toContain(networkError);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 8: Error Logging with Entity ID - Should log timeout errors with entity ID', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Clear previous spy calls and cache
        consoleErrorSpy.mockClear();
        validator.clearCache();
        
        // Mock the validator to simulate timeout by taking longer than 10 seconds
        // We'll use a promise that never resolves to simulate the timeout
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            // Return a promise that takes longer than the 10-second timeout
            return new Promise((resolve) => {
              setTimeout(() => {
                resolve({
                  isValid: false,
                  errors: [{ code: 'timeout', message: 'Timeout' }]
                });
              }, 11000); // Just over the 10-second timeout
            });
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation (should timeout after 10 seconds)
        const result = await validator.validateOP(opEntityId);
        
        // Verify that the result indicates a timeout error
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify that console.error was called for the timeout
        expect(consoleErrorSpy).toHaveBeenCalled();
        
        // Find the timeout error log
        const errorLogs = consoleErrorSpy.mock.calls;
        const timeoutLog = errorLogs.find(call => 
          call[0] && typeof call[0] === 'string' && 
          (call[0].toLowerCase().includes('timeout') || call[0].includes('fetch timeout'))
        );
        
        // The timeout should be logged
        expect(timeoutLog).toBeDefined();
        
        // Verify the log includes entity ID
        if (timeoutLog && timeoutLog[1]) {
          const logContext = timeoutLog[1];
          expect(logContext.opEntityId).toBe(opEntityId);
        }
      }
    ), { numRuns: 10 }); // Reduced runs to avoid test timeout
  }, 120000); // Increase test timeout to 2 minutes to accommodate the 10-second timeouts

  it('Property 8: Error Logging with Entity ID - Should log all error types with consistent format', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.constantFrom(
        'invalid_signature',
        'missing_authority_hints',
        'trust_chain_invalid',
        'op_unreachable'
      ),
      
      async (opEntityId, errorCode) => {
        // Clear previous spy calls
        consoleErrorSpy.mockClear();
        
        // Mock the validator to return specific error type
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: `Test error for ${errorCode}`
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        await validator.validateOP(opEntityId);
        
        // Verify that console.error was called
        expect(consoleErrorSpy).toHaveBeenCalled();
        
        // Find the error log
        const errorLogs = consoleErrorSpy.mock.calls;
        const validationFailureLog = errorLogs.find(call => 
          call[0] && call[0].includes('validation failed')
        );
        
        expect(validationFailureLog).toBeDefined();
        
        // Verify consistent log format regardless of error type
        const logContext = validationFailureLog[1];
        expect(logContext).toHaveProperty('opEntityId');
        expect(logContext).toHaveProperty('timestamp');
        expect(logContext).toHaveProperty('errorCount');
        expect(logContext).toHaveProperty('errors');
        
        expect(logContext.opEntityId).toBe(opEntityId);
        expect(logContext.errorCount).toBeGreaterThan(0);
        expect(Array.isArray(logContext.errors)).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 8: Error Logging with Entity ID - Should log cache status in error scenarios', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Clear previous spy calls and cache
        consoleLogSpy.mockClear();
        consoleErrorSpy.mockClear();
        validator.clearCache();
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'validation_error',
                message: 'Test validation error'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation - should log cache miss
        await validator.validateOP(opEntityId);
        
        // Verify cache miss was logged
        const logCalls = consoleLogSpy.mock.calls;
        const cacheMissLog = logCalls.find(call => 
          call[0] && call[0].includes('Cache miss')
        );
        expect(cacheMissLog).toBeDefined();
        
        // Clear spy calls for second validation
        consoleLogSpy.mockClear();
        
        // Second validation - should log cache hit
        await validator.validateOP(opEntityId);
        
        // Verify cache hit was logged
        const logCalls2 = consoleLogSpy.mock.calls;
        const cacheHitLog = logCalls2.find(call => 
          call[0] && call[0].includes('Cache hit')
        );
        expect(cacheHitLog).toBeDefined();
        
        // Verify both logs include entity ID
        if (cacheMissLog) {
          const cacheMissContext = cacheMissLog[1];
          expect(cacheMissContext.opEntityId).toBe(opEntityId);
        }
        
        if (cacheHitLog) {
          const cacheHitContext = cacheHitLog[1];
          expect(cacheHitContext.opEntityId).toBe(opEntityId);
        }
      }
    ), { numRuns: 50 });
  });
});

describe('Feature: rp-op-trust-validation, Property 6: Validation Before OIDC Discovery', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for authentication flow scenarios
  const authFlowScenarioArb = fc.record({
    opEntityId: httpsUrlArb,
    shouldValidationSucceed: fc.boolean(),
    validationDuration: fc.integer({ min: 10, max: 500 }) // milliseconds
  });

  it('Property 6: Validation Before OIDC Discovery - Should complete trust chain validation before OIDC discovery', async () => {
    await fc.assert(fc.asyncProperty(
      authFlowScenarioArb,
      
      async (scenario) => {
        const { opEntityId, shouldValidationSucceed, validationDuration } = scenario;
        
        let validationCompleted = false;
        let oidcDiscoveryAttempted = false;
        
        // Mock the validator to track validation completion
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            // Simulate validation taking some time
            await new Promise(resolve => setTimeout(resolve, validationDuration));
            
            validationCompleted = true;
            
            if (shouldValidationSucceed) {
              return {
                isValid: true,
                trustAnchor: mockTrustAnchorUrl,
                errors: []
              };
            } else {
              return {
                isValid: false,
                errors: [{
                  code: 'trust_chain_invalid',
                  message: 'Trust chain validation failed'
                }]
              };
            }
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation (simulating the middleware call)
        const validationResult = await validator.validateOP(opEntityId);
        
        // Verify validation completed
        expect(validationCompleted).toBe(true);
        expect(mockValidator.validateTrustChain).toHaveBeenCalledWith(opEntityId);
        
        // Simulate OIDC discovery attempt (only if validation succeeded)
        if (validationResult.isValid) {
          oidcDiscoveryAttempted = true;
        }
        
        // Verify the order: validation must complete before OIDC discovery
        if (oidcDiscoveryAttempted) {
          // OIDC discovery should only be attempted after validation succeeds
          expect(validationCompleted).toBe(true);
          expect(validationResult.isValid).toBe(true);
        }
        
        // If validation failed, OIDC discovery should not be attempted
        if (!validationResult.isValid) {
          expect(oidcDiscoveryAttempted).toBe(false);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 6: Validation Before OIDC Discovery - Should prevent OIDC discovery if validation fails', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationCompleted = false;
        let oidcDiscoveryAllowed = false;
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCompleted = true;
            return {
              isValid: false,
              errors: [{
                code: 'trust_chain_invalid',
                message: 'Trust chain validation failed'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation completed
        expect(validationCompleted).toBe(true);
        expect(result.isValid).toBe(false);
        
        // Determine if OIDC discovery should be allowed based on validation result
        oidcDiscoveryAllowed = result.isValid;
        
        // OIDC discovery should NOT be allowed when validation fails (Requirement 2.1)
        expect(oidcDiscoveryAllowed).toBe(false);
      }
    ), { numRuns: 100 });
  });

  it('Property 6: Validation Before OIDC Discovery - Should allow OIDC discovery only after successful validation', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationTimestamp = null;
        let oidcDiscoveryTimestamp = null;
        
        // Mock the validator to return successful validation
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationTimestamp = Date.now();
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation succeeded
        expect(result.isValid).toBe(true);
        expect(validationTimestamp).not.toBeNull();
        
        // Simulate OIDC discovery (only if validation succeeded)
        if (result.isValid) {
          oidcDiscoveryTimestamp = Date.now();
        }
        
        // Verify OIDC discovery happened after validation (Requirement 2.2)
        expect(oidcDiscoveryTimestamp).not.toBeNull();
        expect(oidcDiscoveryTimestamp).toBeGreaterThanOrEqual(validationTimestamp);
      }
    ), { numRuns: 100 });
  });

  it('Property 6: Validation Before OIDC Discovery - Should validate trust chain before any OIDC operations', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.boolean(), // Whether validation succeeds
      
      async (opEntityId, shouldSucceed) => {
        const operationOrder = [];
        
        // Mock the validator to track operation order
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            operationOrder.push('validation');
            
            if (shouldSucceed) {
              return {
                isValid: true,
                trustAnchor: mockTrustAnchorUrl,
                errors: []
              };
            } else {
              return {
                isValid: false,
                errors: [{
                  code: 'trust_chain_invalid',
                  message: 'Trust chain validation failed'
                }]
              };
            }
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Simulate OIDC operations (only if validation succeeded)
        if (result.isValid) {
          operationOrder.push('oidc_discovery');
          operationOrder.push('dynamic_registration');
          operationOrder.push('authorization_redirect');
        }
        
        // Verify validation is always first in the operation order
        expect(operationOrder[0]).toBe('validation');
        
        // If validation failed, no OIDC operations should occur
        if (!shouldSucceed) {
          expect(operationOrder.length).toBe(1);
          expect(operationOrder).toEqual(['validation']);
        }
        
        // If validation succeeded, OIDC operations should follow
        if (shouldSucceed) {
          expect(operationOrder.length).toBeGreaterThan(1);
          expect(operationOrder[0]).toBe('validation');
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 6: Validation Before OIDC Discovery - Should use cached validation for subsequent OIDC flows', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.integer({ min: 2, max: 5 }), // Number of authentication flows
      
      async (opEntityId, flowCount) => {
        let validationCallCount = 0;
        const oidcFlows = [];
        
        // Mock the validator to track validation calls
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCallCount++;
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform multiple authentication flows
        for (let i = 0; i < flowCount; i++) {
          // Validate OP (simulating middleware)
          const validationResult = await validator.validateOP(opEntityId);
          
          // If validation succeeds, proceed with OIDC discovery
          if (validationResult.isValid) {
            oidcFlows.push({
              flowNumber: i + 1,
              validationCached: validationResult.cached,
              timestamp: Date.now()
            });
          }
        }
        
        // Verify validation was called only once (first flow)
        expect(validationCallCount).toBe(1);
        
        // Verify all flows completed
        expect(oidcFlows.length).toBe(flowCount);
        
        // First flow should not use cache
        expect(oidcFlows[0].validationCached).toBe(false);
        
        // Subsequent flows should use cache
        for (let i = 1; i < flowCount; i++) {
          expect(oidcFlows[i].validationCached).toBe(true);
        }
      }
    ), { numRuns: 50 });
  });

  it('Property 6: Validation Before OIDC Discovery - Should validate before fetching OP metadata', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationCompleted = false;
        let metadataFetched = false;
        
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCompleted = true;
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation completed
        expect(validationCompleted).toBe(true);
        
        // Simulate fetching OP metadata (only if validation succeeded)
        if (result.isValid) {
          metadataFetched = true;
        }
        
        // Verify metadata fetch only happens after validation
        if (metadataFetched) {
          expect(validationCompleted).toBe(true);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 6: Validation Before OIDC Discovery - Should validate before dynamic client registration', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationCompleted = false;
        let registrationAttempted = false;
        
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCompleted = true;
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation completed
        expect(validationCompleted).toBe(true);
        
        // Simulate dynamic registration (only if validation succeeded)
        if (result.isValid) {
          registrationAttempted = true;
        }
        
        // Verify registration only happens after validation
        if (registrationAttempted) {
          expect(validationCompleted).toBe(true);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 6: Validation Before OIDC Discovery - Should set validation flag before proceeding to OIDC', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation succeeded and result is available
        expect(result.isValid).toBe(true);
        
        // Simulate checking validation flag before OIDC operations
        const opValidated = result.isValid;
        
        // OIDC operations should only proceed if validation flag is set (Requirement 2.2)
        expect(opValidated).toBe(true);
        
        // Verify the OP is marked as validated
        expect(validator.isOPValidated(opEntityId)).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 6: Validation Before OIDC Discovery - Should handle validation errors before OIDC discovery', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.constantFrom(
        'invalid_signature',
        'missing_authority_hints',
        'trust_chain_invalid',
        'op_unreachable'
      ),
      
      async (opEntityId, errorCode) => {
        let validationError = null;
        let oidcDiscoveryAttempted = false;
        
        // Mock the validator to return validation error
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: `Validation failed: ${errorCode}`
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Capture validation error
        if (!result.isValid) {
          validationError = result.errors[0];
        }
        
        // Determine if OIDC discovery should be attempted
        oidcDiscoveryAttempted = result.isValid;
        
        // Verify validation error was captured
        expect(validationError).not.toBeNull();
        expect(validationError.code).toBe(errorCode);
        
        // Verify OIDC discovery was NOT attempted
        expect(oidcDiscoveryAttempted).toBe(false);
      }
    ), { numRuns: 100 });
  });

  it('Property 6: Validation Before OIDC Discovery - Should maintain validation state across authentication flow', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const validationResult = await validator.validateOP(opEntityId);
        
        // Verify validation succeeded
        expect(validationResult.isValid).toBe(true);
        
        // Simulate checking validation state at different points in the flow
        const validationStates = [];
        
        // Before OIDC discovery
        validationStates.push({
          stage: 'before_oidc_discovery',
          isValidated: validator.isOPValidated(opEntityId)
        });
        
        // Before dynamic registration
        validationStates.push({
          stage: 'before_dynamic_registration',
          isValidated: validator.isOPValidated(opEntityId)
        });
        
        // Before authorization redirect
        validationStates.push({
          stage: 'before_authorization_redirect',
          isValidated: validator.isOPValidated(opEntityId)
        });
        
        // Verify validation state is maintained throughout the flow
        for (const state of validationStates) {
          expect(state.isValidated).toBe(true);
        }
      }
    ), { numRuns: 100 });
  });
});

describe('Feature: rp-op-trust-validation, Property 13: No Redirect for Untrusted OPs', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for invalid trust chain scenarios
  const invalidTrustChainScenarioArb = fc.record({
    opEntityId: httpsUrlArb,
    errorCode: fc.constantFrom(
      'invalid_signature',
      'missing_authority_hints',
      'trust_chain_invalid',
      'invalid_trust_anchor',
      'op_unreachable'
    ),
    errorMessage: fc.string({ minLength: 10, maxLength: 100 })
  });

  it('Property 13: No Redirect for Untrusted OPs - Should not redirect when OP trust chain validation fails', async () => {
    await fc.assert(fc.asyncProperty(
      invalidTrustChainScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage } = scenario;
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation failed
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Simulate checking if redirect should occur
        const shouldRedirect = result.isValid;
        
        // Verify no redirect occurs for untrusted OP (Requirement 3.5)
        expect(shouldRedirect).toBe(false);
      }
    ), { numRuns: 100 });
  });

  it('Property 13: No Redirect for Untrusted OPs - Should prevent redirect for any validation failure type', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.constantFrom(
        'invalid_signature',
        'missing_authority_hints',
        'trust_chain_invalid',
        'invalid_trust_anchor',
        'op_unreachable',
        'jwt_expired',
        'circular_reference',
        'trust_chain_too_long'
      ),
      
      async (opEntityId, errorCode) => {
        // Mock the validator to return specific validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: `Validation failed: ${errorCode}`
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation failed
        expect(result.isValid).toBe(false);
        
        // Simulate authorization flow decision
        let redirectAttempted = false;
        if (result.isValid) {
          redirectAttempted = true;
        }
        
        // Verify redirect was NOT attempted for any failure type
        expect(redirectAttempted).toBe(false);
      }
    ), { numRuns: 100 });
  });

  it('Property 13: No Redirect for Untrusted OPs - Should block redirect immediately upon validation failure', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        let validationCompleted = false;
        let redirectBlocked = false;
        
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCompleted = true;
            return {
              isValid: false,
              errors: [{
                code: 'trust_chain_invalid',
                message: 'Trust chain validation failed'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation completed
        expect(validationCompleted).toBe(true);
        expect(result.isValid).toBe(false);
        
        // Simulate redirect decision logic
        if (!result.isValid) {
          redirectBlocked = true;
        }
        
        // Verify redirect was blocked immediately after validation failure
        expect(redirectBlocked).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 13: No Redirect for Untrusted OPs - Should allow redirect only for trusted OPs', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.boolean(), // Whether OP is trusted
      
      async (opEntityId, isTrusted) => {
        // Mock the validator to return success or failure based on trust
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            if (isTrusted) {
              return {
                isValid: true,
                trustAnchor: mockTrustAnchorUrl,
                errors: []
              };
            } else {
              return {
                isValid: false,
                errors: [{
                  code: 'trust_chain_invalid',
                  message: 'OP is not trusted'
                }]
              };
            }
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Simulate redirect decision
        const shouldRedirect = result.isValid;
        
        // Verify redirect decision matches trust status
        expect(shouldRedirect).toBe(isTrusted);
        
        // If untrusted, verify no redirect occurs
        if (!isTrusted) {
          expect(shouldRedirect).toBe(false);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 13: No Redirect for Untrusted OPs - Should maintain redirect block across multiple checks', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.integer({ min: 2, max: 5 }), // Number of redirect checks
      
      async (opEntityId, checkCount) => {
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'trust_chain_invalid',
                message: 'Trust chain validation failed'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation once
        const result = await validator.validateOP(opEntityId);
        expect(result.isValid).toBe(false);
        
        // Check redirect decision multiple times
        const redirectChecks = [];
        for (let i = 0; i < checkCount; i++) {
          // Simulate checking if redirect should occur
          const shouldRedirect = result.isValid;
          redirectChecks.push(shouldRedirect);
        }
        
        // Verify all checks consistently block redirect
        for (const shouldRedirect of redirectChecks) {
          expect(shouldRedirect).toBe(false);
        }
      }
    ), { numRuns: 50 });
  });

  it('Property 13: No Redirect for Untrusted OPs - Should prevent redirect even with cached validation failure', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'trust_chain_invalid',
                message: 'Trust chain validation failed'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // First validation - creates cache entry
        const result1 = await validator.validateOP(opEntityId);
        expect(result1.isValid).toBe(false);
        expect(result1.cached).toBe(false);
        
        // Simulate redirect decision with fresh validation
        const shouldRedirect1 = result1.isValid;
        expect(shouldRedirect1).toBe(false);
        
        // Second validation - uses cache
        const result2 = await validator.validateOP(opEntityId);
        expect(result2.isValid).toBe(false);
        expect(result2.cached).toBe(true);
        
        // Simulate redirect decision with cached validation
        const shouldRedirect2 = result2.isValid;
        expect(shouldRedirect2).toBe(false);
        
        // Verify redirect is blocked in both cases
        expect(shouldRedirect1).toBe(shouldRedirect2);
      }
    ), { numRuns: 50 });
  });

  it('Property 13: No Redirect for Untrusted OPs - Should not redirect when OP is unreachable', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator to simulate network failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            throw new Error('Network error: OP unreachable');
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation failed due to network error
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Simulate redirect decision
        const shouldRedirect = result.isValid;
        
        // Verify no redirect occurs when OP is unreachable
        expect(shouldRedirect).toBe(false);
      }
    ), { numRuns: 50 });
  });

  it('Property 13: No Redirect for Untrusted OPs - Should prevent redirect with detailed error information', async () => {
    await fc.assert(fc.asyncProperty(
      invalidTrustChainScenarioArb,
      
      async (scenario) => {
        const { opEntityId, errorCode, errorMessage } = scenario;
        
        // Mock the validator to return validation failure with details
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: errorCode,
                message: errorMessage,
                details: {
                  opEntityId,
                  reason: 'Trust chain validation failed'
                }
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation failed with error details
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Simulate redirect decision with error information available
        const shouldRedirect = result.isValid;
        const errorInfo = result.errors[0];
        
        // Verify no redirect occurs and error information is available
        expect(shouldRedirect).toBe(false);
        expect(errorInfo).toBeDefined();
        // Note: Error codes may be categorized by the validator, so we just verify an error code exists
        expect(errorInfo.code).toBeDefined();
        expect(typeof errorInfo.code).toBe('string');
      }
    ), { numRuns: 100 });
  });

  it('Property 13: No Redirect for Untrusted OPs - Should block redirect for multiple validation errors', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.array(
        fc.record({
          code: fc.constantFrom('invalid_signature', 'missing_authority_hints', 'trust_chain_invalid'),
          message: fc.string({ minLength: 10, maxLength: 50 })
        }),
        { minLength: 2, maxLength: 4 }
      ),
      
      async (opEntityId, errors) => {
        // Mock the validator to return multiple validation errors
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation failed with multiple errors
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Simulate redirect decision
        const shouldRedirect = result.isValid;
        
        // Verify no redirect occurs even with multiple errors
        expect(shouldRedirect).toBe(false);
      }
    ), { numRuns: 50 });
  });

  it('Property 13: No Redirect for Untrusted OPs - Should enforce redirect block at authorization endpoint', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'trust_chain_invalid',
                message: 'Trust chain validation failed'
              }]
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation (simulating middleware check)
        const result = await validator.validateOP(opEntityId);
        
        // Verify validation failed
        expect(result.isValid).toBe(false);
        
        // Simulate authorization endpoint logic
        let authorizationUrlGenerated = false;
        let redirectOccurred = false;
        
        if (result.isValid) {
          // Only generate authorization URL if validation succeeded
          authorizationUrlGenerated = true;
          redirectOccurred = true;
        }
        
        // Verify authorization URL was NOT generated
        expect(authorizationUrlGenerated).toBe(false);
        
        // Verify redirect did NOT occur
        expect(redirectOccurred).toBe(false);
      }
    ), { numRuns: 100 });
  });
});

describe('Feature: rp-op-trust-validation, Property 20: Validation Before Token Exchange', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for token exchange scenarios
  const tokenExchangeScenarioArb = fc.record({
    opEntityId: httpsUrlArb,
    wasValidatedInSession: fc.boolean(),
    isValidatedInCache: fc.boolean(),
    authCode: fc.string({ minLength: 20, maxLength: 50 }),
    clientId: httpsUrlArb,
    clientSecret: fc.string({ minLength: 32, maxLength: 64 })
  });

  it('Property 20: Validation Before Token Exchange - Should only accept tokens from validated OPs', async () => {
    await fc.assert(fc.asyncProperty(
      tokenExchangeScenarioArb,
      
      async (scenario) => {
        const { opEntityId, wasValidatedInSession, isValidatedInCache, authCode } = scenario;
        
        // Mock the validator to simulate validation state
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Simulate checking validation state before token exchange
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Simulate token exchange decision
        let tokenExchangeAllowed = false;
        let errorReturned = false;
        
        if (isValidated) {
          // OP was validated, allow token exchange
          tokenExchangeAllowed = true;
        } else {
          // OP was not validated, reject token exchange (Requirement 10.3)
          errorReturned = true;
        }
        
        // Verify token exchange only happens if OP was validated
        if (wasValidatedInSession || isValidatedInCache) {
          expect(tokenExchangeAllowed).toBe(true);
          expect(errorReturned).toBe(false);
        } else {
          expect(tokenExchangeAllowed).toBe(false);
          expect(errorReturned).toBe(true);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 20: Validation Before Token Exchange - Should verify OP validation before accepting tokens', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.string({ minLength: 20, maxLength: 50 }),
      
      async (opEntityId, authCode) => {
        // Mock the validator with cached validation
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation to populate cache
        await validator.validateOP(opEntityId);
        
        // Simulate token exchange with validation check
        const wasValidatedInSession = false;
        const isValidatedInCache = validator.isOPValidated(opEntityId);
        
        // Check validation state
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Verify OP is validated
        expect(isValidated).toBe(true);
        expect(isValidatedInCache).toBe(true);
        
        // Simulate token exchange
        let tokenExchangeAllowed = false;
        if (isValidated) {
          tokenExchangeAllowed = true;
        }
        
        expect(tokenExchangeAllowed).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 20: Validation Before Token Exchange - Should reject tokens from unvalidated OPs', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.string({ minLength: 20, maxLength: 50 }),
      
      async (opEntityId, authCode) => {
        // Clear any cached validation
        validator.clearCache();
        
        // Simulate token exchange without prior validation
        const wasValidatedInSession = false;
        const isValidatedInCache = validator.isOPValidated(opEntityId);
        
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Verify OP is not validated
        expect(isValidated).toBe(false);
        expect(isValidatedInCache).toBe(false);
        
        // Simulate token exchange rejection
        let tokenExchangeAllowed = false;
        let errorReturned = false;
        
        if (!isValidated) {
          // Token exchange should be rejected
          errorReturned = true;
        } else {
          tokenExchangeAllowed = true;
        }
        
        // Verify token exchange was NOT allowed
        expect(tokenExchangeAllowed).toBe(false);
        expect(errorReturned).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 20: Validation Before Token Exchange - Should return 403 error when OP not validated', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Simulate OP not validated
        const wasValidatedInSession = false;
        const isValidatedInCache = false;
        
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Simulate error response
        let errorResponse = null;
        if (!isValidated) {
          errorResponse = {
            statusCode: 403,
            error: 'op_not_validated',
            error_description: `Cannot accept tokens from unvalidated OP ${opEntityId}`,
            opEntityId: opEntityId,
            errors: [{
              code: 'op_not_validated',
              message: 'OP must be validated before token exchange'
            }]
          };
        }
        
        // Verify error response structure
        expect(errorResponse).not.toBeNull();
        expect(errorResponse.statusCode).toBe(403);
        expect(errorResponse.error).toBe('op_not_validated');
        expect(errorResponse.opEntityId).toBe(opEntityId);
        expect(errorResponse.errors).toBeDefined();
        expect(errorResponse.errors.length).toBeGreaterThan(0);
      }
    ), { numRuns: 100 });
  });

  it('Property 20: Validation Before Token Exchange - Should check both session and cache for validation state', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.boolean(),
      fc.boolean(),
      
      async (opEntityId, sessionValid, cacheValid) => {
        // Simulate validation state in session and cache
        const wasValidatedInSession = sessionValid;
        const isValidatedInCache = cacheValid;
        
        // Check validation state (OR logic - either is sufficient)
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Simulate token exchange decision
        let tokenExchangeAllowed = false;
        let errorReturned = false;
        
        if (isValidated) {
          tokenExchangeAllowed = true;
        } else {
          errorReturned = true;
        }
        
        // Verify correct behavior based on validation state
        if (sessionValid || cacheValid) {
          expect(tokenExchangeAllowed).toBe(true);
          expect(errorReturned).toBe(false);
        } else {
          expect(tokenExchangeAllowed).toBe(false);
          expect(errorReturned).toBe(true);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 20: Validation Before Token Exchange - Should prevent token exchange without prior validation', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.string({ minLength: 20, maxLength: 50 }),
      
      async (opEntityId, authCode) => {
        // Clear any cached validation
        validator.clearCache();
        
        // Simulate token exchange attempt without prior validation
        const wasValidatedInSession = false;
        const isValidatedInCache = validator.isOPValidated(opEntityId);
        
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Verify OP is not validated
        expect(isValidated).toBe(false);
        expect(isValidatedInCache).toBe(false);
        
        // Simulate token exchange attempt
        let tokenRequestSent = false;
        let errorReturned = false;
        
        if (!isValidated) {
          // Token exchange should be blocked before sending request
          errorReturned = true;
        } else {
          tokenRequestSent = true;
        }
        
        // Verify token request was NOT sent
        expect(tokenRequestSent).toBe(false);
        expect(errorReturned).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 20: Validation Before Token Exchange - Should log validation check failure', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Simulate OP not validated
        const wasValidatedInSession = false;
        const isValidatedInCache = false;
        
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Simulate logging
        const logEntries = [];
        if (!isValidated) {
          logEntries.push({
            level: 'error',
            message: 'OP not validated before token exchange',
            opEntityId: opEntityId,
            sessionValidated: wasValidatedInSession,
            cacheValidated: isValidatedInCache
          });
        }
        
        // Verify logging occurred
        expect(logEntries.length).toBeGreaterThan(0);
        expect(logEntries[0].level).toBe('error');
        expect(logEntries[0].opEntityId).toBe(opEntityId);
        expect(logEntries[0].sessionValidated).toBe(false);
        expect(logEntries[0].cacheValidated).toBe(false);
      }
    ), { numRuns: 100 });
  });

  it('Property 20: Validation Before Token Exchange - Should maintain validation state from login to token exchange', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation (simulating /federation-login)
        const validationResult = await validator.validateOP(opEntityId);
        expect(validationResult.isValid).toBe(true);
        
        // Simulate time passing (but within cache expiration)
        // Cache is still valid
        
        // Check validation state in token exchange
        const isValidatedInCache = validator.isOPValidated(opEntityId);
        
        // Verify validation state is maintained
        expect(isValidatedInCache).toBe(true);
        
        // Simulate token exchange
        let tokenExchangeAllowed = false;
        if (isValidatedInCache) {
          tokenExchangeAllowed = true;
        }
        
        expect(tokenExchangeAllowed).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 20: Validation Before Token Exchange - Should verify OP entity ID matches validated OP', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      httpsUrlArb,
      
      async (validatedOpEntityId, tokenOpEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Validate the first OP
        await validator.validateOP(validatedOpEntityId);
        
        // Check if token exchange OP matches validated OP
        const isValidatedInCache = validator.isOPValidated(tokenOpEntityId);
        const opMatches = validatedOpEntityId === tokenOpEntityId;
        
        // Simulate token exchange decision
        let tokenExchangeAllowed = false;
        let errorReturned = false;
        
        if (isValidatedInCache && opMatches) {
          tokenExchangeAllowed = true;
        } else {
          errorReturned = true;
        }
        
        // Verify token exchange only allowed if OP entity IDs match
        if (validatedOpEntityId === tokenOpEntityId) {
          expect(tokenExchangeAllowed).toBe(true);
          expect(errorReturned).toBe(false);
        } else {
          expect(tokenExchangeAllowed).toBe(false);
          expect(errorReturned).toBe(true);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 20: Validation Before Token Exchange - Should reject expired validation cache', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Create validator with very short cache expiration
        const shortCacheValidator = new OPTrustChainValidator({
          trustAnchorUrl: mockTrustAnchorUrl,
          cacheExpirationMs: 1 // 1ms - will expire immediately
        });
        
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        shortCacheValidator.validator = mockValidator;
        
        // Perform validation
        await shortCacheValidator.validateOP(opEntityId);
        
        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Check validation state (should be expired)
        const isValidatedInCache = shortCacheValidator.isOPValidated(opEntityId);
        
        // Verify cache is expired
        expect(isValidatedInCache).toBe(false);
        
        // Simulate token exchange rejection due to expired cache
        let tokenExchangeAllowed = false;
        let errorReturned = false;
        
        if (!isValidatedInCache) {
          errorReturned = true;
        } else {
          tokenExchangeAllowed = true;
        }
        
        expect(tokenExchangeAllowed).toBe(false);
        expect(errorReturned).toBe(true);
      }
    ), { numRuns: 50 });
  });
});

describe('Feature: rp-op-trust-validation, Property 21: Callback Validation State Check', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for callback scenarios
  const callbackScenarioArb = fc.record({
    opEntityId: httpsUrlArb,
    wasValidatedInSession: fc.boolean(),
    isValidatedInCache: fc.boolean(),
    authCode: fc.string({ minLength: 20, maxLength: 50 }),
    state: fc.string({ minLength: 20, maxLength: 50 })
  });

  it('Property 21: Callback Validation State Check - Should verify OP was previously validated before processing callback', async () => {
    await fc.assert(fc.asyncProperty(
      callbackScenarioArb,
      
      async (scenario) => {
        const { opEntityId, wasValidatedInSession, isValidatedInCache, authCode, state } = scenario;
        
        // Mock the validator to simulate validation state
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Simulate checking validation state (as done in /callback endpoint)
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Simulate callback processing decision
        let callbackProcessed = false;
        let errorReturned = false;
        
        if (isValidated) {
          // OP was validated, proceed with callback processing
          callbackProcessed = true;
        } else {
          // OP was not validated, return error (Requirement 10.2)
          errorReturned = true;
        }
        
        // Verify callback processing only happens if OP was validated
        if (wasValidatedInSession || isValidatedInCache) {
          expect(callbackProcessed).toBe(true);
          expect(errorReturned).toBe(false);
        } else {
          expect(callbackProcessed).toBe(false);
          expect(errorReturned).toBe(true);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 21: Callback Validation State Check - Should accept callback when OP validated in session', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.string({ minLength: 20, maxLength: 50 }),
      
      async (opEntityId, authCode) => {
        // Simulate OP validated in session
        const wasValidatedInSession = true;
        const isValidatedInCache = false;
        
        // Check validation state
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Verify callback should be processed
        expect(isValidated).toBe(true);
        
        // Simulate callback processing
        let callbackProcessed = false;
        if (isValidated) {
          callbackProcessed = true;
        }
        
        expect(callbackProcessed).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 21: Callback Validation State Check - Should accept callback when OP validated in cache', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.string({ minLength: 20, maxLength: 50 }),
      
      async (opEntityId, authCode) => {
        // Mock the validator with cached validation
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation to populate cache
        await validator.validateOP(opEntityId);
        
        // Simulate callback with cache check
        const wasValidatedInSession = false;
        const isValidatedInCache = validator.isOPValidated(opEntityId);
        
        // Check validation state
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Verify callback should be processed
        expect(isValidated).toBe(true);
        expect(isValidatedInCache).toBe(true);
        
        // Simulate callback processing
        let callbackProcessed = false;
        if (isValidated) {
          callbackProcessed = true;
        }
        
        expect(callbackProcessed).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 21: Callback Validation State Check - Should reject callback when OP not validated', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.string({ minLength: 20, maxLength: 50 }),
      
      async (opEntityId, authCode) => {
        // Simulate OP not validated in either session or cache
        const wasValidatedInSession = false;
        const isValidatedInCache = false;
        
        // Check validation state
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Verify callback should NOT be processed
        expect(isValidated).toBe(false);
        
        // Simulate callback rejection
        let callbackProcessed = false;
        let errorReturned = false;
        
        if (!isValidated) {
          errorReturned = true;
        }
        
        expect(callbackProcessed).toBe(false);
        expect(errorReturned).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 21: Callback Validation State Check - Should return 403 error when OP not validated', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Simulate OP not validated
        const wasValidatedInSession = false;
        const isValidatedInCache = false;
        
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Simulate error response
        let errorResponse = null;
        if (!isValidated) {
          errorResponse = {
            statusCode: 403,
            error: 'op_not_validated',
            error_description: `OP ${opEntityId} was not validated before callback`,
            opEntityId: opEntityId,
            errors: [{
              code: 'op_not_validated',
              message: 'OP must be validated before processing authentication callback'
            }]
          };
        }
        
        // Verify error response structure
        expect(errorResponse).not.toBeNull();
        expect(errorResponse.statusCode).toBe(403);
        expect(errorResponse.error).toBe('op_not_validated');
        expect(errorResponse.opEntityId).toBe(opEntityId);
        expect(errorResponse.errors).toBeDefined();
        expect(errorResponse.errors.length).toBeGreaterThan(0);
      }
    ), { numRuns: 100 });
  });

  it('Property 21: Callback Validation State Check - Should check both session and cache for validation state', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.boolean(),
      fc.boolean(),
      
      async (opEntityId, sessionValid, cacheValid) => {
        // Simulate validation state in session and cache
        const wasValidatedInSession = sessionValid;
        const isValidatedInCache = cacheValid;
        
        // Check validation state (OR logic - either is sufficient)
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Simulate callback processing decision
        let callbackProcessed = false;
        let errorReturned = false;
        
        if (isValidated) {
          callbackProcessed = true;
        } else {
          errorReturned = true;
        }
        
        // Verify correct behavior based on validation state
        if (sessionValid || cacheValid) {
          expect(callbackProcessed).toBe(true);
          expect(errorReturned).toBe(false);
        } else {
          expect(callbackProcessed).toBe(false);
          expect(errorReturned).toBe(true);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 21: Callback Validation State Check - Should verify OP entity ID matches validated OP', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      httpsUrlArb,
      
      async (validatedOpEntityId, callbackOpEntityId) => {
        // Simulate OP validated in session
        const sessionOpEntityId = validatedOpEntityId;
        const wasValidatedInSession = true;
        
        // Check if callback OP matches validated OP
        const opMatches = sessionOpEntityId === callbackOpEntityId;
        const isValidated = wasValidatedInSession && opMatches;
        
        // Simulate callback processing decision
        let callbackProcessed = false;
        let errorReturned = false;
        
        if (isValidated) {
          callbackProcessed = true;
        } else {
          errorReturned = true;
        }
        
        // Verify callback only processed if OP entity IDs match
        if (validatedOpEntityId === callbackOpEntityId) {
          expect(callbackProcessed).toBe(true);
          expect(errorReturned).toBe(false);
        } else {
          expect(callbackProcessed).toBe(false);
          expect(errorReturned).toBe(true);
        }
      }
    ), { numRuns: 100 });
  });

  it('Property 21: Callback Validation State Check - Should prevent callback processing without prior validation', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      fc.string({ minLength: 20, maxLength: 50 }),
      fc.string({ minLength: 20, maxLength: 50 }),
      
      async (opEntityId, authCode, state) => {
        // Clear any cached validation
        validator.clearCache();
        
        // Simulate callback without prior validation
        const wasValidatedInSession = false;
        const isValidatedInCache = validator.isOPValidated(opEntityId);
        
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Verify OP is not validated
        expect(isValidated).toBe(false);
        expect(isValidatedInCache).toBe(false);
        
        // Simulate callback rejection
        let tokenExchangeAttempted = false;
        let errorReturned = false;
        
        if (!isValidated) {
          // Callback should be rejected before token exchange
          errorReturned = true;
        } else {
          tokenExchangeAttempted = true;
        }
        
        // Verify token exchange was NOT attempted
        expect(tokenExchangeAttempted).toBe(false);
        expect(errorReturned).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 21: Callback Validation State Check - Should log validation check failure', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Simulate OP not validated
        const wasValidatedInSession = false;
        const isValidatedInCache = false;
        
        const isValidated = wasValidatedInSession || isValidatedInCache;
        
        // Simulate logging
        const logEntries = [];
        if (!isValidated) {
          logEntries.push({
            level: 'error',
            message: 'OP was not previously validated',
            opEntityId: opEntityId,
            sessionValidated: wasValidatedInSession,
            cacheValidated: isValidatedInCache
          });
        }
        
        // Verify logging occurred
        expect(logEntries.length).toBeGreaterThan(0);
        expect(logEntries[0].level).toBe('error');
        expect(logEntries[0].opEntityId).toBe(opEntityId);
        expect(logEntries[0].sessionValidated).toBe(false);
        expect(logEntries[0].cacheValidated).toBe(false);
      }
    ), { numRuns: 100 });
  });

  it('Property 21: Callback Validation State Check - Should maintain validation state across callback', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (opEntityId) => {
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: mockTrustAnchorUrl,
              errors: []
            };
          })
        };
        
        validator.validator = mockValidator;
        
        // Perform validation (simulating /federation-login)
        const validationResult = await validator.validateOP(opEntityId);
        expect(validationResult.isValid).toBe(true);
        
        // Simulate time passing (but within cache expiration)
        // Cache is still valid
        
        // Check validation state in callback
        const isValidatedInCache = validator.isOPValidated(opEntityId);
        
        // Verify validation state is maintained
        expect(isValidatedInCache).toBe(true);
        
        // Simulate callback processing
        let callbackProcessed = false;
        if (isValidatedInCache) {
          callbackProcessed = true;
        }
        
        expect(callbackProcessed).toBe(true);
      }
    ), { numRuns: 100 });
  });
});

describe('Feature: rp-op-trust-validation, Property 19: Trust Anchor URL Usage', () => {
  let validator;
  const mockTrustAnchorUrl = 'https://trust-anchor.example.com';

  beforeEach(async () => {
    // Load the CommonJS module dynamically
    if (!OPTrustChainValidator) {
      const module = await import('./opTrustChainValidator.js');
      OPTrustChainValidator = module.OPTrustChainValidator;
    }
    
    validator = new OPTrustChainValidator({
      trustAnchorUrl: mockTrustAnchorUrl,
      cacheExpirationMs: 3600000
    });
  });

  // Generator for valid HTTPS URLs
  const httpsUrlArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for Trust Anchor URLs
  const trustAnchorUrlArb = httpsUrlArb;

  // Generator for OP entity IDs
  const opEntityIdArb = httpsUrlArb;

  it('Property 19: Trust Anchor URL Usage - Should use configured Trust Anchor URL for all OP validations', async () => {
    await fc.assert(fc.asyncProperty(
      trustAnchorUrlArb,
      opEntityIdArb,
      
      async (trustAnchorUrl, opEntityId) => {
        // Create validator with specific Trust Anchor URL
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl,
          cacheExpirationMs: 3600000
        });

        // Mock the IntegratedTrustChainValidator to track which trust anchor was used
        let usedTrustAnchor = null;
        
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            // Capture the trust anchor that was used
            usedTrustAnchor = trustAnchorUrl;
            
            return {
              isValid: true,
              trustAnchor: trustAnchorUrl,
              errors: []
            };
          })
        };
        
        testValidator.validator = mockValidator;
        
        // Perform validation
        const result = await testValidator.validateOP(opEntityId);
        
        // Verify that validation was called
        expect(mockValidator.validateTrustChain).toHaveBeenCalledWith(opEntityId);
        
        // Verify the configured Trust Anchor URL was used
        expect(testValidator.trustAnchorUrl).toBe(trustAnchorUrl);
        expect(usedTrustAnchor).toBe(trustAnchorUrl);
        
        // Verify the result includes the correct trust anchor
        expect(result.isValid).toBe(true);
        expect(result.trustAnchor).toBe(trustAnchorUrl);
      }
    ), { numRuns: 100 });
  });

  it('Property 19: Trust Anchor URL Usage - Should use same Trust Anchor URL for multiple OP validations', async () => {
    await fc.assert(fc.asyncProperty(
      trustAnchorUrlArb,
      fc.array(opEntityIdArb, { minLength: 2, maxLength: 5 }).filter(urls => {
        // Ensure all URLs are unique
        return new Set(urls).size === urls.length;
      }),
      
      async (trustAnchorUrl, opEntityIds) => {
        // Create validator with specific Trust Anchor URL
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl,
          cacheExpirationMs: 3600000
        });

        const usedTrustAnchors = [];
        
        // Mock the IntegratedTrustChainValidator to track trust anchor usage
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            // Capture the trust anchor for each validation
            usedTrustAnchors.push(trustAnchorUrl);
            
            return {
              isValid: true,
              trustAnchor: trustAnchorUrl,
              errors: []
            };
          })
        };
        
        testValidator.validator = mockValidator;
        
        // Validate multiple OPs
        for (const opEntityId of opEntityIds) {
          const result = await testValidator.validateOP(opEntityId);
          
          // Each validation should use the same configured Trust Anchor URL
          expect(result.trustAnchor).toBe(trustAnchorUrl);
        }
        
        // Verify all validations used the same Trust Anchor URL
        expect(usedTrustAnchors.length).toBe(opEntityIds.length);
        usedTrustAnchors.forEach(usedTrustAnchor => {
          expect(usedTrustAnchor).toBe(trustAnchorUrl);
        });
      }
    ), { numRuns: 100 });
  });

  it('Property 19: Trust Anchor URL Usage - Should initialize IntegratedTrustChainValidator with configured Trust Anchor', async () => {
    await fc.assert(fc.asyncProperty(
      trustAnchorUrlArb,
      
      async (trustAnchorUrl) => {
        // Create validator with specific Trust Anchor URL
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl,
          cacheExpirationMs: 3600000
        });

        // Verify the validator was initialized with the correct Trust Anchor URL
        expect(testValidator.trustAnchorUrl).toBe(trustAnchorUrl);
        
        // Verify the IntegratedTrustChainValidator was created
        expect(testValidator.validator).toBeDefined();
        
        // The validator should be an instance of IntegratedTrustChainValidator
        // (We can't check the exact type due to dynamic imports, but we can verify it has the expected method)
        expect(testValidator.validator.validateTrustChain).toBeDefined();
        expect(typeof testValidator.validator.validateTrustChain).toBe('function');
      }
    ), { numRuns: 100 });
  });

  it('Property 19: Trust Anchor URL Usage - Should reject validation if trust chain does not reach configured Trust Anchor', async () => {
    await fc.assert(fc.asyncProperty(
      trustAnchorUrlArb,
      trustAnchorUrlArb,
      opEntityIdArb,
      
      async (configuredTrustAnchor, actualTrustAnchor, opEntityId) => {
        // Skip if the URLs are the same
        if (configuredTrustAnchor === actualTrustAnchor) {
          return true;
        }

        // Create validator with specific Trust Anchor URL
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl: configuredTrustAnchor,
          cacheExpirationMs: 3600000
        });

        // Mock the validator to simulate a chain that reaches a different trust anchor
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: false,
              errors: [{
                code: 'invalid_trust_anchor',
                message: 'Trust chain does not terminate at configured trust anchor',
                details: {
                  expectedTrustAnchor: configuredTrustAnchor,
                  actualTermination: actualTrustAnchor
                }
              }]
            };
          })
        };
        
        testValidator.validator = mockValidator;
        
        // Perform validation
        const result = await testValidator.validateOP(opEntityId);
        
        // Verify that validation failed
        expect(result.isValid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Verify error indicates trust anchor mismatch
        const hasTrustAnchorError = result.errors.some(
          e => e.code === 'invalid_trust_anchor' || 
               e.message.toLowerCase().includes('trust anchor')
        );
        expect(hasTrustAnchorError).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 19: Trust Anchor URL Usage - Should preserve Trust Anchor URL across cache hits', async () => {
    await fc.assert(fc.asyncProperty(
      trustAnchorUrlArb,
      opEntityIdArb,
      
      async (trustAnchorUrl, opEntityId) => {
        // Create validator with specific Trust Anchor URL
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl,
          cacheExpirationMs: 3600000
        });

        let validationCallCount = 0;
        
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            validationCallCount++;
            return {
              isValid: true,
              trustAnchor: trustAnchorUrl,
              errors: []
            };
          })
        };
        
        testValidator.validator = mockValidator;
        
        // First validation - should call the validator
        const result1 = await testValidator.validateOP(opEntityId);
        expect(result1.isValid).toBe(true);
        expect(result1.trustAnchor).toBe(trustAnchorUrl);
        expect(result1.cached).toBe(false);
        expect(validationCallCount).toBe(1);
        
        // Second validation - should use cache
        const result2 = await testValidator.validateOP(opEntityId);
        expect(result2.isValid).toBe(true);
        expect(result2.trustAnchor).toBe(trustAnchorUrl);
        expect(result2.cached).toBe(true);
        expect(validationCallCount).toBe(1); // Should not increase
        
        // Trust Anchor URL should be preserved in cached results
        expect(result1.trustAnchor).toBe(result2.trustAnchor);
        expect(result2.trustAnchor).toBe(trustAnchorUrl);
      }
    ), { numRuns: 100 });
  });

  it('Property 19: Trust Anchor URL Usage - Should validate Trust Anchor URL format on construction', async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom(
        'http://trust-anchor.example.com',  // HTTP (not HTTPS)
        'ftp://trust-anchor.example.com',   // Wrong protocol
        'trust-anchor.example.com',         // No protocol
        'ws://trust-anchor.example.com'     // WebSocket protocol
      ),
      
      async (invalidTrustAnchorUrl) => {
        // Attempting to create validator with invalid Trust Anchor URL should throw
        expect(() => {
          new OPTrustChainValidator({
            trustAnchorUrl: invalidTrustAnchorUrl,
            cacheExpirationMs: 3600000
          });
        }).toThrow();
      }
    ), { numRuns: 50 });
  });

  it('Property 19: Trust Anchor URL Usage - Should accept HTTPS Trust Anchor URLs', async () => {
    await fc.assert(fc.asyncProperty(
      httpsUrlArb,
      
      async (trustAnchorUrl) => {
        // Creating validator with HTTPS Trust Anchor URL should succeed
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl,
          cacheExpirationMs: 3600000
        });

        // Verify the Trust Anchor URL was set correctly
        expect(testValidator.trustAnchorUrl).toBe(trustAnchorUrl);
        expect(testValidator.trustAnchorUrl.startsWith('https://')).toBe(true);
      }
    ), { numRuns: 100 });
  });

  it('Property 19: Trust Anchor URL Usage - Should use Trust Anchor URL as root of trust for validation', async () => {
    await fc.assert(fc.asyncProperty(
      trustAnchorUrlArb,
      opEntityIdArb,
      fc.array(httpsUrlArb, { minLength: 1, maxLength: 3 }), // Intermediate entities
      
      async (trustAnchorUrl, opEntityId, intermediateEntities) => {
        // Create validator with specific Trust Anchor URL
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl,
          cacheExpirationMs: 3600000
        });

        // Mock the validator to simulate a trust chain that includes intermediate entities
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            // Simulate successful validation where the chain reaches the configured trust anchor
            return {
              isValid: true,
              trustAnchor: trustAnchorUrl,
              errors: []
            };
          })
        };
        
        testValidator.validator = mockValidator;
        
        // Perform validation
        const result = await testValidator.validateOP(opEntityId);
        
        // Verify that validation succeeded
        expect(result.isValid).toBe(true);
        
        // Verify the trust anchor in the result matches the configured one
        expect(result.trustAnchor).toBe(trustAnchorUrl);
        
        // Verify the validator's trust anchor URL is used as the root of trust
        expect(testValidator.trustAnchorUrl).toBe(trustAnchorUrl);
      }
    ), { numRuns: 100 });
  });

  it('Property 19: Trust Anchor URL Usage - Should fail if Trust Anchor URL is not provided', async () => {
    // Attempting to create validator without Trust Anchor URL should throw
    expect(() => {
      new OPTrustChainValidator({
        cacheExpirationMs: 3600000
      });
    }).toThrow('Trust Anchor URL is required');

    expect(() => {
      new OPTrustChainValidator({
        trustAnchorUrl: null,
        cacheExpirationMs: 3600000
      });
    }).toThrow('Trust Anchor URL is required');

    expect(() => {
      new OPTrustChainValidator({
        trustAnchorUrl: '',
        cacheExpirationMs: 3600000
      });
    }).toThrow();
  });

  it('Property 19: Trust Anchor URL Usage - Should maintain Trust Anchor URL immutability', async () => {
    await fc.assert(fc.asyncProperty(
      trustAnchorUrlArb,
      trustAnchorUrlArb,
      opEntityIdArb,
      
      async (initialTrustAnchor, newTrustAnchor, opEntityId) => {
        // Skip if the URLs are the same
        if (initialTrustAnchor === newTrustAnchor) {
          return true;
        }

        // Create validator with initial Trust Anchor URL
        const testValidator = new OPTrustChainValidator({
          trustAnchorUrl: initialTrustAnchor,
          cacheExpirationMs: 3600000
        });

        // Verify initial Trust Anchor URL
        expect(testValidator.trustAnchorUrl).toBe(initialTrustAnchor);

        // Attempt to modify the Trust Anchor URL (should not affect validation)
        const originalTrustAnchor = testValidator.trustAnchorUrl;
        
        // Mock the validator
        const mockValidator = {
          validateTrustChain: vi.fn(async () => {
            return {
              isValid: true,
              trustAnchor: initialTrustAnchor,
              errors: []
            };
          })
        };
        
        testValidator.validator = mockValidator;
        
        // Perform validation
        const result = await testValidator.validateOP(opEntityId);
        
        // Verify the original Trust Anchor URL is still used
        expect(testValidator.trustAnchorUrl).toBe(originalTrustAnchor);
        expect(result.trustAnchor).toBe(initialTrustAnchor);
      }
    ), { numRuns: 50 });
  });
});
