import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MultiOPCredentialsManager } from './multiOPCredentialsManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('MultiOPCredentialsManager - Property-Based Tests', () => {
  let manager;
  let testCredentialsFile;

  beforeEach(() => {
    // Use a unique test-specific credentials file for each test
    testCredentialsFile = path.join(__dirname, '..', `.op-credentials-test-${Date.now()}-${Math.random()}.json`);
    manager = new MultiOPCredentialsManager({
      rpEntityId: 'https://test-rp.example.com',
      credentialsFile: testCredentialsFile
    });
  });

  afterEach(() => {
    // Clean up test credentials file
    if (fs.existsSync(testCredentialsFile)) {
      fs.unlinkSync(testCredentialsFile);
    }
  });

  /**
   * Property 13: Credentials storage round-trip
   * Feature: rp-multi-op-selection
   * Validates: Requirements 6.1, 6.2, 6.3
   * 
   * For any OP entity_id and client_secret, after storing the credentials 
   * and then retrieving them, the retrieved secret should match the stored secret
   */
  describe('Property 13: Credentials storage round-trip', () => {
    it('should retrieve the same credentials that were stored', () => {
      fc.assert(
        fc.property(
          fc.webUrl({ withFragments: false, withQueryParameters: false }),
          fc.string({ minLength: 20, maxLength: 100 }),
          (opEntityId, clientSecret) => {
            // Create a fresh manager for each test iteration
            const testFile = path.join(__dirname, '..', `.op-credentials-test-${Date.now()}-${Math.random()}.json`);
            const testManager = new MultiOPCredentialsManager({
              rpEntityId: 'https://test-rp.example.com',
              credentialsFile: testFile
            });

            // Store credentials
            testManager.storeCredentials(opEntityId, clientSecret);

            // Retrieve credentials
            const retrieved = testManager.getCredentials(opEntityId);

            // Verify round-trip
            expect(retrieved).not.toBeNull();
            expect(retrieved.opEntityId).toBe(opEntityId);
            expect(retrieved.clientSecret).toBe(clientSecret);
            expect(retrieved.rpEntityId).toBe('https://test-rp.example.com');
            expect(retrieved.registeredAt).toBeDefined();

            // Verify hasCredentials returns true
            expect(testManager.hasCredentials(opEntityId)).toBe(true);

            // Clean up
            if (fs.existsSync(testFile)) {
              fs.unlinkSync(testFile);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle multiple OPs independently', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              opEntityId: fc.webUrl({ withFragments: false, withQueryParameters: false }),
              clientSecret: fc.string({ minLength: 20, maxLength: 100 })
            }),
            { minLength: 1, maxLength: 10 }
          ),
          (ops) => {
            // Create a fresh manager for each test iteration
            const testFile = path.join(__dirname, '..', `.op-credentials-test-${Date.now()}-${Math.random()}.json`);
            const testManager = new MultiOPCredentialsManager({
              rpEntityId: 'https://test-rp.example.com',
              credentialsFile: testFile
            });

            // Store all credentials
            ops.forEach(op => {
              testManager.storeCredentials(op.opEntityId, op.clientSecret);
            });

            // Verify each OP's credentials independently
            ops.forEach(op => {
              const retrieved = testManager.getCredentials(op.opEntityId);
              expect(retrieved).not.toBeNull();
              expect(retrieved.clientSecret).toBe(op.clientSecret);
            });

            // Verify all OPs are registered
            const registeredOPs = testManager.getRegisteredOPs();
            expect(registeredOPs.length).toBe(ops.length);

            // Clean up
            if (fs.existsSync(testFile)) {
              fs.unlinkSync(testFile);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should return null for non-existent OP', () => {
      fc.assert(
        fc.property(
          fc.webUrl({ withFragments: false, withQueryParameters: false }),
          (opEntityId) => {
            // Don't store anything
            const retrieved = manager.getCredentials(opEntityId);
            expect(retrieved).toBeNull();
            expect(manager.hasCredentials(opEntityId)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 14: Credentials persistence
   * Feature: rp-multi-op-selection
   * Validates: Requirements 6.4
   * 
   * For any stored credentials, after persisting to disk and reloading 
   * from disk, the credentials should be identical
   */
  describe('Property 14: Credentials persistence', () => {
    it('should persist credentials across manager instances', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              opEntityId: fc.webUrl({ withFragments: false, withQueryParameters: false }),
              clientSecret: fc.string({ minLength: 20, maxLength: 100 })
            }),
            { minLength: 1, maxLength: 5 }
          ),
          (ops) => {
            // Create a fresh test file for this iteration
            const testFile = path.join(__dirname, '..', `.op-credentials-test-${Date.now()}-${Math.random()}.json`);
            
            // Store credentials in first manager instance
            const testManager1 = new MultiOPCredentialsManager({
              rpEntityId: 'https://test-rp.example.com',
              credentialsFile: testFile
            });

            ops.forEach(op => {
              testManager1.storeCredentials(op.opEntityId, op.clientSecret);
            });

            // Create new manager instance with same credentials file
            const testManager2 = new MultiOPCredentialsManager({
              rpEntityId: 'https://test-rp.example.com',
              credentialsFile: testFile
            });

            // Verify all credentials are loaded in new instance
            ops.forEach(op => {
              const retrieved = testManager2.getCredentials(op.opEntityId);
              expect(retrieved).not.toBeNull();
              expect(retrieved.clientSecret).toBe(op.clientSecret);
              expect(retrieved.opEntityId).toBe(op.opEntityId);
            });

            // Verify registered OPs match
            const registeredOPs = testManager2.getRegisteredOPs();
            expect(registeredOPs.length).toBe(ops.length);

            // Clean up
            if (fs.existsSync(testFile)) {
              fs.unlinkSync(testFile);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle empty credentials file correctly', () => {
      fc.assert(
        fc.property(
          fc.constant(null),
          () => {
            // Create manager with no stored credentials
            const emptyManager = new MultiOPCredentialsManager({
              rpEntityId: 'https://test-rp.example.com',
              credentialsFile: testCredentialsFile
            });

            // Verify no OPs are registered
            expect(emptyManager.getRegisteredOPs()).toEqual([]);
            expect(emptyManager.getStats().totalOPs).toBe(0);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should preserve registeredAt timestamps across persistence', () => {
      fc.assert(
        fc.property(
          fc.webUrl({ withFragments: false, withQueryParameters: false }),
          fc.string({ minLength: 20, maxLength: 100 }),
          (opEntityId, clientSecret) => {
            // Create a fresh test file for this iteration
            const testFile = path.join(__dirname, '..', `.op-credentials-test-${Date.now()}-${Math.random()}.json`);
            
            // Store credentials
            const testManager1 = new MultiOPCredentialsManager({
              rpEntityId: 'https://test-rp.example.com',
              credentialsFile: testFile
            });
            testManager1.storeCredentials(opEntityId, clientSecret);
            const original = testManager1.getCredentials(opEntityId);

            // Create new manager instance
            const testManager2 = new MultiOPCredentialsManager({
              rpEntityId: 'https://test-rp.example.com',
              credentialsFile: testFile
            });

            // Verify timestamp is preserved
            const reloaded = testManager2.getCredentials(opEntityId);
            expect(reloaded.registeredAt).toBe(original.registeredAt);

            // Clean up
            if (fs.existsSync(testFile)) {
              fs.unlinkSync(testFile);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 4: Previously used OPs retrieval
   * Feature: rp-multi-op-selection
   * Validates: Requirements 3.3
   * 
   * For any set of stored OP credentials, the credentials manager should 
   * return the complete list of OP entity_ids
   */
  describe('Property 4: Previously used OPs retrieval', () => {
    it('should return all registered OP entity_ids', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.webUrl({ withFragments: false, withQueryParameters: false }),
            { minLength: 1, maxLength: 10 }
          ),
          fc.string({ minLength: 20, maxLength: 100 }),
          (opEntityIds, clientSecret) => {
            // Create a fresh manager for each test iteration
            const testFile = path.join(__dirname, '..', `.op-credentials-test-${Date.now()}-${Math.random()}.json`);
            const testManager = new MultiOPCredentialsManager({
              rpEntityId: 'https://test-rp.example.com',
              credentialsFile: testFile
            });

            // Remove duplicates
            const uniqueOPs = [...new Set(opEntityIds)];

            // Store credentials for all OPs
            uniqueOPs.forEach(opEntityId => {
              testManager.storeCredentials(opEntityId, clientSecret);
            });

            // Retrieve registered OPs
            const registeredOPs = testManager.getRegisteredOPs();

            // Verify all OPs are returned
            expect(registeredOPs.length).toBe(uniqueOPs.length);
            uniqueOPs.forEach(opEntityId => {
              expect(registeredOPs).toContain(opEntityId);
            });

            // Clean up
            if (fs.existsSync(testFile)) {
              fs.unlinkSync(testFile);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should return empty array when no OPs are registered', () => {
      fc.assert(
        fc.property(
          fc.constant(null),
          () => {
            const registeredOPs = manager.getRegisteredOPs();
            expect(registeredOPs).toEqual([]);
            expect(Array.isArray(registeredOPs)).toBe(true);
          }
        ),
        { numRuns: 10 }
      );
    });

    it('should update registered OPs list after clearing credentials', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.webUrl({ withFragments: false, withQueryParameters: false }),
            { minLength: 2, maxLength: 5 }
          ),
          fc.string({ minLength: 20, maxLength: 100 }),
          (opEntityIds, clientSecret) => {
            // Create a fresh manager for each test iteration
            const testFile = path.join(__dirname, '..', `.op-credentials-test-${Date.now()}-${Math.random()}.json`);
            const testManager = new MultiOPCredentialsManager({
              rpEntityId: 'https://test-rp.example.com',
              credentialsFile: testFile
            });

            // Remove duplicates
            const uniqueOPs = [...new Set(opEntityIds)];
            if (uniqueOPs.length < 2) return true; // Skip if not enough unique OPs

            // Store credentials for all OPs
            uniqueOPs.forEach(opEntityId => {
              testManager.storeCredentials(opEntityId, clientSecret);
            });

            // Clear credentials for first OP
            const clearedOP = uniqueOPs[0];
            testManager.clearCredentials(clearedOP);

            // Verify registered OPs list is updated
            const registeredOPs = testManager.getRegisteredOPs();
            expect(registeredOPs.length).toBe(uniqueOPs.length - 1);
            expect(registeredOPs).not.toContain(clearedOP);

            // Verify remaining OPs are still registered
            uniqueOPs.slice(1).forEach(opEntityId => {
              expect(registeredOPs).toContain(opEntityId);
            });

            // Clean up
            if (fs.existsSync(testFile)) {
              fs.unlinkSync(testFile);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
