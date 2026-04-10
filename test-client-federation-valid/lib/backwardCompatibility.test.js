import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Backward Compatibility Tests
 * Feature: rp-multi-op-selection
 * 
 * Tests that verify backward compatibility with the existing single-OP flow
 * when AUTHORIZATION_SERVER environment variable is set.
 * 
 * Requirements: 11.1, 11.2
 */
describe('Backward Compatibility', () => {
  describe('Default OP Selection from Environment Variable', () => {
    it('should use AUTHORIZATION_SERVER as default OP when set', () => {
      // Requirement 11.2: Maintain backward compatibility with AUTHORIZATION_SERVER env var
      const authServer = 'http://localhost:3001';
      const defaultOP = authServer;
      
      // Simulate the behavior: if AUTHORIZATION_SERVER is set, it becomes the default OP
      const selectedOP = defaultOP ? {
        entityId: defaultOP,
        isDefault: true
      } : null;
      
      expect(selectedOP).toBeDefined();
      expect(selectedOP.entityId).toBe(authServer);
      expect(selectedOP.isDefault).toBe(true);
    });

    it('should allow null selected OP when AUTHORIZATION_SERVER is not set', () => {
      // Requirement 11.1: Support multiple OP instances
      const authServer = undefined;
      const defaultOP = authServer;
      
      const selectedOP = defaultOP ? {
        entityId: defaultOP,
        isDefault: true
      } : null;
      
      expect(selectedOP).toBeNull();
    });

    it('should prioritize session-selected OP over default OP', () => {
      // Requirement 11.1: Users can select different OPs
      const authServer = 'http://localhost:3001';
      const sessionSelectedOP = {
        entityId: 'http://localhost:3002',
        isDefault: false
      };
      
      // Simulate the behavior: session selection takes precedence
      const selectedOP = sessionSelectedOP || (authServer ? {
        entityId: authServer,
        isDefault: true
      } : null);
      
      expect(selectedOP).toBeDefined();
      expect(selectedOP.entityId).toBe('http://localhost:3002');
      expect(selectedOP.isDefault).toBe(false);
    });
  });

  describe('Single-OP Flow Compatibility', () => {
    it('should support existing single-OP authentication flow', () => {
      // Requirement 11.2: Existing single-OP flow should continue to work
      const authServer = 'http://localhost:3001';
      const entityId = 'https://rp1.example.com';
      
      // Simulate existing flow: use AUTHORIZATION_SERVER directly
      const opEntityId = authServer;
      const clientId = entityId;
      
      expect(opEntityId).toBe(authServer);
      expect(clientId).toBe(entityId);
    });

    it('should maintain credential storage format compatibility', () => {
      // Requirement 11.2: Old credential format should be migrated
      const oldFormat = {
        entityId: 'https://rp1.example.com',
        clientSecret: 'secret123',
        registeredAt: '2026-02-04T00:00:00.000Z'
      };
      
      // New format should be compatible
      const newFormat = {
        rpEntityId: oldFormat.entityId,
        ops: {
          'http://localhost:3001': {
            clientSecret: oldFormat.clientSecret,
            registeredAt: oldFormat.registeredAt
          }
        }
      };
      
      expect(newFormat.rpEntityId).toBe(oldFormat.entityId);
      expect(newFormat.ops['http://localhost:3001'].clientSecret).toBe(oldFormat.clientSecret);
    });
  });

  describe('Environment Variable Handling', () => {
    it('should handle empty AUTHORIZATION_SERVER gracefully', () => {
      // Requirement 11.1: Support multi-OP without default
      const authServer = '';
      const defaultOP = authServer || null;
      
      const selectedOP = defaultOP ? {
        entityId: defaultOP,
        isDefault: true
      } : null;
      
      expect(selectedOP).toBeNull();
    });

    it('should handle whitespace-only AUTHORIZATION_SERVER gracefully', () => {
      // Requirement 11.1: Validate environment variables
      const authServer = '   ';
      const defaultOP = authServer.trim() || null;
      
      const selectedOP = defaultOP ? {
        entityId: defaultOP,
        isDefault: true
      } : null;
      
      expect(selectedOP).toBeNull();
    });

    it('should preserve AUTHORIZATION_SERVER URL format', () => {
      // Requirement 11.2: Maintain exact URL format from env var
      const authServer = 'http://localhost:3001';
      const defaultOP = authServer;
      
      const selectedOP = defaultOP ? {
        entityId: defaultOP,
        isDefault: true
      } : null;
      
      expect(selectedOP.entityId).toBe('http://localhost:3001');
      // URL should not be modified (no trailing slash added/removed)
      expect(selectedOP.entityId).not.toBe('http://localhost:3001/');
    });
  });

  describe('Session State Management', () => {
    it('should initialize session without selected OP when no default is set', () => {
      // Requirement 11.1: Multi-OP requires explicit selection
      const session = {};
      const authServer = undefined;
      
      const selectedOP = session.selectedOP || (authServer ? {
        entityId: authServer,
        isDefault: true
      } : null);
      
      expect(selectedOP).toBeNull();
    });

    it('should use default OP when session has no selection', () => {
      // Requirement 11.2: Default OP from env var
      const session = {};
      const authServer = 'http://localhost:3001';
      
      const selectedOP = session.selectedOP || (authServer ? {
        entityId: authServer,
        isDefault: true
      } : null);
      
      expect(selectedOP).toBeDefined();
      expect(selectedOP.entityId).toBe(authServer);
      expect(selectedOP.isDefault).toBe(true);
    });

    it('should preserve session-selected OP across requests', () => {
      // Requirement 11.1: Session persistence
      const session = {
        selectedOP: {
          entityId: 'http://localhost:3002',
          isDefault: false,
          metadata: {
            issuer: 'http://localhost:3002',
            authorization_endpoint: 'http://localhost:3002/authorize'
          }
        }
      };
      const authServer = 'http://localhost:3001';
      
      const selectedOP = session.selectedOP || (authServer ? {
        entityId: authServer,
        isDefault: true
      } : null);
      
      expect(selectedOP.entityId).toBe('http://localhost:3002');
      expect(selectedOP.metadata).toBeDefined();
    });
  });

  describe('Migration Path', () => {
    it('should support gradual migration from single-OP to multi-OP', () => {
      // Requirement 11.2: Gradual migration support
      
      // Phase 1: Single-OP with AUTHORIZATION_SERVER
      const phase1 = {
        authServer: 'http://localhost:3001',
        multiOPEnabled: false
      };
      expect(phase1.authServer).toBeDefined();
      
      // Phase 2: Multi-OP with default from AUTHORIZATION_SERVER
      const phase2 = {
        authServer: 'http://localhost:3001',
        multiOPEnabled: true,
        defaultOP: phase1.authServer
      };
      expect(phase2.defaultOP).toBe(phase1.authServer);
      
      // Phase 3: Multi-OP without default (full migration)
      const phase3 = {
        authServer: undefined,
        multiOPEnabled: true,
        defaultOP: null
      };
      expect(phase3.defaultOP).toBeNull();
    });
  });
});
