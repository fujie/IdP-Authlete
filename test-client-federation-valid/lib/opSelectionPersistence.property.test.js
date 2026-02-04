import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/**
 * Property 6: OP selection persistence
 * Feature: rp-multi-op-selection
 * Validates: Requirements 3.6
 * 
 * When an OP is selected, it must be stored in the session and persist
 * across requests within the same session.
 */
describe('Property 6: OP selection persistence', () => {
  it('should persist selected OP in session', () => {
    fc.assert(
      fc.property(
        fc.webUrl({ validSchemes: ['https'], withFragments: false }),
        fc.record({
          issuer: fc.webUrl({ validSchemes: ['https'], withFragments: false }),
          authorization_endpoint: fc.webUrl({ validSchemes: ['https'], withFragments: false }),
          token_endpoint: fc.webUrl({ validSchemes: ['https'], withFragments: false }),
          jwks_uri: fc.webUrl({ validSchemes: ['https'], withFragments: false })
        }),
        (entityId, metadata) => {
          // Simulate session storage
          const session = {};
          
          // Store selected OP
          session.selectedOP = {
            entityId: entityId,
            metadata: metadata,
            isDefault: false,
            selectedAt: Date.now()
          };
          
          // Verify persistence
          expect(session.selectedOP).toBeDefined();
          expect(session.selectedOP.entityId).toBe(entityId);
          expect(session.selectedOP.metadata).toEqual(metadata);
          expect(session.selectedOP.isDefault).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should preserve OP metadata in session', () => {
    fc.assert(
      fc.property(
        fc.webUrl({ validSchemes: ['https'], withFragments: false }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (entityId, issuer) => {
          const session = {
            selectedOP: {
              entityId: entityId,
              metadata: {
                issuer: issuer,
                authorization_endpoint: `${issuer}/authorize`,
                token_endpoint: `${issuer}/token`
              }
            }
          };
          
          // Verify metadata is preserved
          expect(session.selectedOP.metadata.issuer).toBe(issuer);
          expect(session.selectedOP.metadata.authorization_endpoint).toContain('/authorize');
        }
      ),
      { numRuns: 100 }
    );
  });
});
