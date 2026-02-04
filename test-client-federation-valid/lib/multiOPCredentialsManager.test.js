import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MultiOPCredentialsManager } from './multiOPCredentialsManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('MultiOPCredentialsManager - Unit Tests', () => {
  let manager;
  let testCredentialsFile;

  beforeEach(() => {
    testCredentialsFile = path.join(__dirname, '..', `.op-credentials-test-${Date.now()}-${Math.random()}.json`);
    manager = new MultiOPCredentialsManager({
      rpEntityId: 'https://test-rp.example.com',
      credentialsFile: testCredentialsFile
    });
  });

  afterEach(() => {
    if (fs.existsSync(testCredentialsFile)) {
      fs.unlinkSync(testCredentialsFile);
    }
  });

  describe('Storing credentials', () => {
    it('should store credentials for a single OP', () => {
      manager.storeCredentials('https://op1.example.com', 'secret123');

      const creds = manager.getCredentials('https://op1.example.com');
      expect(creds).not.toBeNull();
      expect(creds.clientSecret).toBe('secret123');
      expect(creds.opEntityId).toBe('https://op1.example.com');
    });

    it('should store credentials for multiple OPs', () => {
      manager.storeCredentials('https://op1.example.com', 'secret1');
      manager.storeCredentials('https://op2.example.com', 'secret2');
      manager.storeCredentials('https://op3.example.com', 'secret3');

      expect(manager.getCredentials('https://op1.example.com').clientSecret).toBe('secret1');
      expect(manager.getCredentials('https://op2.example.com').clientSecret).toBe('secret2');
      expect(manager.getCredentials('https://op3.example.com').clientSecret).toBe('secret3');
    });

    it('should update credentials if stored again', () => {
      manager.storeCredentials('https://op1.example.com', 'secret1');
      manager.storeCredentials('https://op1.example.com', 'secret2');

      const creds = manager.getCredentials('https://op1.example.com');
      expect(creds.clientSecret).toBe('secret2');
    });

    it('should include registeredAt timestamp', () => {
      const before = new Date().toISOString();
      manager.storeCredentials('https://op1.example.com', 'secret123');
      const after = new Date().toISOString();

      const creds = manager.getCredentials('https://op1.example.com');
      expect(creds.registeredAt).toBeDefined();
      expect(creds.registeredAt >= before).toBe(true);
      expect(creds.registeredAt <= after).toBe(true);
    });
  });

  describe('Retrieving credentials', () => {
    it('should return null for non-existent OP', () => {
      const creds = manager.getCredentials('https://nonexistent.example.com');
      expect(creds).toBeNull();
    });

    it('should return credentials with all required fields', () => {
      manager.storeCredentials('https://op1.example.com', 'secret123');

      const creds = manager.getCredentials('https://op1.example.com');
      expect(creds).toHaveProperty('opEntityId');
      expect(creds).toHaveProperty('clientSecret');
      expect(creds).toHaveProperty('registeredAt');
      expect(creds).toHaveProperty('rpEntityId');
    });
  });

  describe('Checking credentials existence', () => {
    it('should return true for existing OP', () => {
      manager.storeCredentials('https://op1.example.com', 'secret123');
      expect(manager.hasCredentials('https://op1.example.com')).toBe(true);
    });

    it('should return false for non-existent OP', () => {
      expect(manager.hasCredentials('https://nonexistent.example.com')).toBe(false);
    });
  });

  describe('Clearing credentials', () => {
    it('should clear credentials for specific OP', () => {
      manager.storeCredentials('https://op1.example.com', 'secret1');
      manager.storeCredentials('https://op2.example.com', 'secret2');

      manager.clearCredentials('https://op1.example.com');

      expect(manager.hasCredentials('https://op1.example.com')).toBe(false);
      expect(manager.hasCredentials('https://op2.example.com')).toBe(true);
    });

    it('should handle clearing non-existent OP gracefully', () => {
      expect(() => {
        manager.clearCredentials('https://nonexistent.example.com');
      }).not.toThrow();
    });

    it('should persist cleared state to disk', () => {
      manager.storeCredentials('https://op1.example.com', 'secret1');
      manager.clearCredentials('https://op1.example.com');

      // Create new manager instance
      const manager2 = new MultiOPCredentialsManager({
        rpEntityId: 'https://test-rp.example.com',
        credentialsFile: testCredentialsFile
      });

      expect(manager2.hasCredentials('https://op1.example.com')).toBe(false);
    });
  });

  describe('Getting registered OPs', () => {
    it('should return empty array when no OPs registered', () => {
      const ops = manager.getRegisteredOPs();
      expect(ops).toEqual([]);
    });

    it('should return all registered OP entity IDs', () => {
      manager.storeCredentials('https://op1.example.com', 'secret1');
      manager.storeCredentials('https://op2.example.com', 'secret2');
      manager.storeCredentials('https://op3.example.com', 'secret3');

      const ops = manager.getRegisteredOPs();
      expect(ops).toHaveLength(3);
      expect(ops).toContain('https://op1.example.com');
      expect(ops).toContain('https://op2.example.com');
      expect(ops).toContain('https://op3.example.com');
    });
  });

  describe('Persistence', () => {
    it('should persist credentials to disk', () => {
      manager.storeCredentials('https://op1.example.com', 'secret123');

      expect(fs.existsSync(testCredentialsFile)).toBe(true);

      const data = JSON.parse(fs.readFileSync(testCredentialsFile, 'utf8'));
      expect(data.rpEntityId).toBe('https://test-rp.example.com');
      expect(data.ops['https://op1.example.com']).toBeDefined();
      expect(data.ops['https://op1.example.com'].clientSecret).toBe('secret123');
    });

    it('should load credentials from disk on initialization', () => {
      manager.storeCredentials('https://op1.example.com', 'secret123');

      // Create new manager instance
      const manager2 = new MultiOPCredentialsManager({
        rpEntityId: 'https://test-rp.example.com',
        credentialsFile: testCredentialsFile
      });

      const creds = manager2.getCredentials('https://op1.example.com');
      expect(creds).not.toBeNull();
      expect(creds.clientSecret).toBe('secret123');
    });

    it('should not load credentials if RP entity ID differs', () => {
      manager.storeCredentials('https://op1.example.com', 'secret123');

      // Create manager with different RP entity ID
      const manager2 = new MultiOPCredentialsManager({
        rpEntityId: 'https://different-rp.example.com',
        credentialsFile: testCredentialsFile
      });

      expect(manager2.hasCredentials('https://op1.example.com')).toBe(false);
    });
  });

  describe('Statistics', () => {
    it('should return correct statistics', () => {
      manager.storeCredentials('https://op1.example.com', 'secret1');
      manager.storeCredentials('https://op2.example.com', 'secret2');

      const stats = manager.getStats();
      expect(stats.rpEntityId).toBe('https://test-rp.example.com');
      expect(stats.totalOPs).toBe(2);
      expect(stats.ops).toHaveLength(2);
    });
  });

  describe('Migration from old format', () => {
    it('should migrate from old single-OP format', () => {
      const oldCredentialsFile = path.join(__dirname, '..', `.old-credentials-test-${Date.now()}.json`);

      // Create old format credentials file
      const oldCreds = {
        entityId: 'https://test-rp.example.com',
        clientSecret: 'old-secret-123',
        registeredAt: '2026-01-29T12:00:00.000Z'
      };
      fs.writeFileSync(oldCredentialsFile, JSON.stringify(oldCreds, null, 2));

      // Set environment variable for OP entity ID
      process.env.AUTHORIZATION_SERVER = 'https://op.diddc.site';

      // Perform migration
      const migrated = manager.migrateFromOldFormat(oldCredentialsFile);

      expect(migrated).toBe(true);
      expect(manager.hasCredentials('https://op.diddc.site')).toBe(true);

      const creds = manager.getCredentials('https://op.diddc.site');
      expect(creds.clientSecret).toBe('old-secret-123');

      // Clean up
      fs.unlinkSync(oldCredentialsFile);
      delete process.env.AUTHORIZATION_SERVER;
    });

    it('should skip migration if old file does not exist', () => {
      const migrated = manager.migrateFromOldFormat('/nonexistent/file.json');
      expect(migrated).toBe(false);
    });

    it('should skip migration if old file is not in expected format', () => {
      const oldCredentialsFile = path.join(__dirname, '..', `.old-credentials-test-${Date.now()}.json`);

      // Create file with unexpected format
      const unexpectedFormat = {
        ops: {
          'https://op1.example.com': {
            clientSecret: 'secret123'
          }
        }
      };
      fs.writeFileSync(oldCredentialsFile, JSON.stringify(unexpectedFormat, null, 2));

      const migrated = manager.migrateFromOldFormat(oldCredentialsFile);
      expect(migrated).toBe(false);

      // Clean up
      fs.unlinkSync(oldCredentialsFile);
    });
  });
});
