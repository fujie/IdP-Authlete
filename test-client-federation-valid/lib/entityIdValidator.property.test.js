import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateEntityId, isValidEntityId } from './entityIdValidator.js';

describe('EntityIdValidator - Property-Based Tests', () => {
  /**
   * Property 5: Entity ID URL validation
   * Feature: rp-multi-op-selection
   * Validates: Requirements 3.4
   * 
   * For any string input, the validation function should accept only valid 
   * HTTPS URLs (or http://localhost for development) as entity_ids
   */
  describe('Property 5: Entity ID URL validation', () => {
    it('should accept all valid HTTPS URLs', () => {
      fc.assert(
        fc.property(
          fc.webUrl({ 
            withFragments: false, 
            withQueryParameters: false,
            validSchemes: ['https']
          }),
          (url) => {
            const result = validateEntityId(url);
            expect(result.isValid).toBe(true);
            expect(result.errors).toBeUndefined();
            expect(isValidEntityId(url)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should accept http://localhost URLs', () => {
      fc.assert(
        fc.property(
          fc.record({
            port: fc.option(fc.integer({ min: 1, max: 65535 })),
            path: fc.option(fc.constantFrom('', '/path', '/path/to/resource'))
          }),
          ({ port, path }) => {
            const portPart = port ? `:${port}` : '';
            const pathPart = path || '';
            const url = `http://localhost${portPart}${pathPart}`;

            const result = validateEntityId(url);
            expect(result.isValid).toBe(true);
            expect(result.errors).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject HTTP URLs (non-localhost)', () => {
      fc.assert(
        fc.property(
          fc.domain(),
          (domain) => {
            // Skip localhost domains
            if (domain === 'localhost' || domain === '127.0.0.1') {
              return true;
            }

            const url = `http://${domain}`;
            const result = validateEntityId(url);
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors.some(e => e.code === 'INSECURE_PROTOCOL')).toBe(true);
            expect(isValidEntityId(url)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject URLs with fragments', () => {
      fc.assert(
        fc.property(
          fc.webUrl({ withFragments: false, withQueryParameters: false, validSchemes: ['https'] }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (url, fragment) => {
            const urlWithFragment = `${url}#${fragment}`;
            const result = validateEntityId(urlWithFragment);
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors.some(e => e.code === 'FRAGMENT_NOT_ALLOWED')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject invalid URL formats', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => {
            // Filter out whitespace-only strings (covered by another test)
            if (s.trim() === '') {
              return false;
            }
            // Filter out strings that might be valid URLs
            try {
              new URL(s);
              return false;
            } catch {
              return true;
            }
          }),
          (invalidUrl) => {
            const result = validateEntityId(invalidUrl);
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors.some(e => e.code === 'INVALID_URL_FORMAT')).toBe(true);
            expect(isValidEntityId(invalidUrl)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject empty or whitespace-only strings', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('', ' ', '  ', '\t', '\n', '   \t\n  '),
          (emptyString) => {
            const result = validateEntityId(emptyString);
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toBeDefined();
            expect(isValidEntityId(emptyString)).toBe(false);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should reject non-string inputs', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.integer(),
            fc.boolean(),
            fc.object()
          ),
          (nonString) => {
            const result = validateEntityId(nonString);
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors.some(e => e.code === 'MISSING_ENTITY_ID')).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should provide parsed URL components for valid URLs', () => {
      fc.assert(
        fc.property(
          fc.webUrl({ 
            withFragments: false, 
            withQueryParameters: false,
            validSchemes: ['https']
          }),
          (url) => {
            const result = validateEntityId(url);
            
            expect(result.parsed).toBeDefined();
            expect(result.parsed.protocol).toBeDefined();
            expect(result.parsed.hostname).toBeDefined();
            expect(result.entityId).toBe(url);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
