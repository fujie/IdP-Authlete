// Property-Based Test for Entity Type Persistence
// **Property 15: Entity Type Persistence**
// **Validates: Requirements 5.3, 5.4**

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import axios from 'axios';

describe('Feature: rp-op-trust-validation, Property 15: Entity Type Persistence', () => {
  const TRUST_ANCHOR_BASE_URL = process.env.TRUST_ANCHOR_URL || 'http://localhost:3010';
  const ADMIN_API_BASE = `${TRUST_ANCHOR_BASE_URL}/admin`;

  // Generator for valid entity types
  const validEntityTypeArb = fc.constantFrom('openid_relying_party', 'openid_provider');

  // Generator for valid HTTPS URLs
  const validEntityIdArb = fc.webUrl({ validSchemes: ['https'] });

  // Helper to add entity via admin API
  async function addEntity(entityId: string, entityType: string) {
    try {
      const response = await axios.post(`${ADMIN_API_BASE}/entities`, {
        entityId,
        entityType
      });
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        message: error.response?.data?.message || error.message
      };
    }
  }

  // Helper to get entities via admin API
  async function getEntities() {
    try {
      const response = await axios.get(`${ADMIN_API_BASE}/entities`);
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get entities: ${error.message}`);
    }
  }

  // Helper to remove entity via admin API
  async function removeEntity(entityId: string) {
    try {
      const response = await axios.delete(`${ADMIN_API_BASE}/entities`, {
        data: { entityId }
      });
      return response.data;
    } catch (error: any) {
      return {
        success: false,
        message: error.response?.data?.message || error.message
      };
    }
  }

  // Helper to check if trust anchor is running
  async function isTrustAnchorRunning(): Promise<boolean> {
    try {
      await axios.get(`${TRUST_ANCHOR_BASE_URL}/health`, { timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }

  beforeAll(async () => {
    const isRunning = await isTrustAnchorRunning();
    if (!isRunning) {
      console.warn(`
⚠️  Trust Anchor is not running at ${TRUST_ANCHOR_BASE_URL}
   Please start the Trust Anchor server before running these tests:
   cd trust-anchor && npm start
      `);
      throw new Error('Trust Anchor server is not running');
    }
  });

  afterAll(async () => {
    // Cleanup: Remove all test entities
    try {
      const result = await getEntities();
      if (result.success && result.entities) {
        for (const entity of result.entities) {
          if (entity.entityId.includes('test-entity') || entity.entityId.includes('example.com')) {
            await removeEntity(entity.entityId);
          }
        }
      }
    } catch (error) {
      console.warn('Cleanup failed:', error);
    }
  });

  it('Property 15: Entity Type Persistence - Added entities should persist with correct entity type', async () => {
    await fc.assert(fc.asyncProperty(
      validEntityIdArb,
      validEntityTypeArb,
      
      async (entityId: string, entityType: string) => {
        // Ensure entity doesn't already exist
        await removeEntity(entityId);

        // Add entity with specific type
        const addResult = await addEntity(entityId, entityType);
        
        // Skip if entity already exists (from previous test run)
        if (!addResult.success && addResult.message?.includes('already exists')) {
          await removeEntity(entityId);
          const retryResult = await addEntity(entityId, entityType);
          expect(retryResult.success).toBe(true);
        } else {
          expect(addResult.success).toBe(true);
        }

        // Retrieve entities and verify the added entity is present with correct type
        const getResult = await getEntities();
        expect(getResult.success).toBe(true);
        expect(getResult.entities).toBeDefined();
        
        const addedEntity = getResult.entities.find((e: any) => e.entityId === entityId);
        expect(addedEntity).toBeDefined();
        expect(addedEntity.entityType).toBe(entityType);
        expect(addedEntity.addedAt).toBeDefined();
        expect(typeof addedEntity.addedAt).toBe('number');

        // Cleanup
        await removeEntity(entityId);
      }
    ), { numRuns: 3, timeout: 20000 });
  }, 40000);

  it('Property 15: Entity Type Persistence - Entity type should be returned in query results', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(
        fc.record({
          entityId: validEntityIdArb,
          entityType: validEntityTypeArb
        }),
        { minLength: 1, maxLength: 2 }
      ),
      
      async (entities: Array<{ entityId: string; entityType: string }>) => {
        // Remove duplicates by entityId
        const uniqueEntities = entities.filter((entity, index, self) =>
          index === self.findIndex((e) => e.entityId === entity.entityId)
        );

        // Add all entities
        const addedEntityIds: string[] = [];
        for (const entity of uniqueEntities) {
          await removeEntity(entity.entityId); // Ensure clean state
          const result = await addEntity(entity.entityId, entity.entityType);
          if (result.success) {
            addedEntityIds.push(entity.entityId);
          }
        }

        // Query all entities
        const getResult = await getEntities();
        expect(getResult.success).toBe(true);
        expect(getResult.entities).toBeDefined();

        // Verify all added entities are present with correct types
        for (const entity of uniqueEntities) {
          if (addedEntityIds.includes(entity.entityId)) {
            const foundEntity = getResult.entities.find((e: any) => e.entityId === entity.entityId);
            expect(foundEntity).toBeDefined();
            expect(foundEntity.entityType).toBe(entity.entityType);
            expect(foundEntity.entityId).toBe(entity.entityId);
            expect(foundEntity.addedAt).toBeDefined();
          }
        }

        // Cleanup
        for (const entityId of addedEntityIds) {
          await removeEntity(entityId);
        }
      }
    ), { numRuns: 3, timeout: 20000 });
  }, 40000);

  it('Property 15: Entity Type Persistence - Entity type should persist across multiple queries', async () => {
    await fc.assert(fc.asyncProperty(
      validEntityIdArb,
      validEntityTypeArb,
      fc.integer({ min: 2, max: 3 }),
      
      async (entityId: string, entityType: string, queryCount: number) => {
        // Ensure clean state
        await removeEntity(entityId);

        // Add entity
        const addResult = await addEntity(entityId, entityType);
        expect(addResult.success).toBe(true);

        // Query multiple times and verify entity type is consistent
        for (let i = 0; i < queryCount; i++) {
          const getResult = await getEntities();
          expect(getResult.success).toBe(true);
          
          const foundEntity = getResult.entities.find((e: any) => e.entityId === entityId);
          expect(foundEntity).toBeDefined();
          expect(foundEntity.entityType).toBe(entityType);
          expect(foundEntity.entityId).toBe(entityId);
        }

        // Cleanup
        await removeEntity(entityId);
      }
    ), { numRuns: 3, timeout: 20000 });
  }, 40000);

  it('Property 15: Entity Type Persistence - Invalid entity types should be rejected', async () => {
    await fc.assert(fc.asyncProperty(
      validEntityIdArb,
      fc.oneof(
        fc.constant(''),
        fc.constant('invalid_type'),
        fc.constant('openid_client'),
        fc.constant('authorization_server'),
        fc.string({ minLength: 1, maxLength: 30 }).filter(s => 
          s !== 'openid_relying_party' && s !== 'openid_provider'
        )
      ),
      
      async (entityId: string, invalidEntityType: string) => {
        // Ensure clean state
        await removeEntity(entityId);

        // Attempt to add entity with invalid type
        const addResult = await addEntity(entityId, invalidEntityType);
        
        // Should fail with appropriate error
        expect(addResult.success).toBe(false);
        expect(addResult.message).toBeDefined();
        
        // Verify entity was not added
        const getResult = await getEntities();
        const foundEntity = getResult.entities?.find((e: any) => e.entityId === entityId);
        expect(foundEntity).toBeUndefined();
      }
    ), { numRuns: 3, timeout: 20000 });
  }, 40000);

  it('Property 15: Entity Type Persistence - Missing entity type should be rejected', async () => {
    await fc.assert(fc.asyncProperty(
      validEntityIdArb,
      
      async (entityId: string) => {
        // Ensure clean state
        await removeEntity(entityId);

        // Attempt to add entity without entity type
        try {
          const response = await axios.post(`${ADMIN_API_BASE}/entities`, {
            entityId
            // entityType is missing
          });
          
          // Should fail
          expect(response.data.success).toBe(false);
        } catch (error: any) {
          // Should return 400 error
          expect(error.response?.status).toBe(400);
          expect(error.response?.data?.success).toBe(false);
        }

        // Verify entity was not added
        const getResult = await getEntities();
        const foundEntity = getResult.entities?.find((e: any) => e.entityId === entityId);
        expect(foundEntity).toBeUndefined();
      }
    ), { numRuns: 3, timeout: 20000 });
  }, 40000);

  it('Property 15: Entity Type Persistence - Entity type should be preserved after removal and re-addition', async () => {
    await fc.assert(fc.asyncProperty(
      validEntityIdArb,
      validEntityTypeArb,
      validEntityTypeArb,
      
      async (entityId: string, firstType: string, secondType: string) => {
        // Ensure clean state
        await removeEntity(entityId);

        // Add entity with first type
        const addResult1 = await addEntity(entityId, firstType);
        expect(addResult1.success).toBe(true);

        // Verify first type
        let getResult = await getEntities();
        let foundEntity = getResult.entities.find((e: any) => e.entityId === entityId);
        expect(foundEntity?.entityType).toBe(firstType);

        // Remove entity
        const removeResult = await removeEntity(entityId);
        expect(removeResult.success).toBe(true);

        // Verify entity is removed
        getResult = await getEntities();
        foundEntity = getResult.entities.find((e: any) => e.entityId === entityId);
        expect(foundEntity).toBeUndefined();

        // Re-add entity with second type
        const addResult2 = await addEntity(entityId, secondType);
        expect(addResult2.success).toBe(true);

        // Verify second type (should be the new type, not the old one)
        getResult = await getEntities();
        foundEntity = getResult.entities.find((e: any) => e.entityId === entityId);
        expect(foundEntity?.entityType).toBe(secondType);

        // Cleanup
        await removeEntity(entityId);
      }
    ), { numRuns: 3, timeout: 30000 });
  }, 60000);

  it('Property 15: Entity Type Persistence - Both RP and OP entity types should be supported', async () => {
    await fc.assert(fc.asyncProperty(
      validEntityIdArb,
      validEntityIdArb,
      
      async (rpEntityId: string, opEntityId: string) => {
        // Ensure different entity IDs
        if (rpEntityId === opEntityId) {
          return; // Skip this case
        }

        // Ensure clean state
        await removeEntity(rpEntityId);
        await removeEntity(opEntityId);

        // Add RP entity
        const rpResult = await addEntity(rpEntityId, 'openid_relying_party');
        expect(rpResult.success).toBe(true);

        // Add OP entity
        const opResult = await addEntity(opEntityId, 'openid_provider');
        expect(opResult.success).toBe(true);

        // Query and verify both entities exist with correct types
        const getResult = await getEntities();
        expect(getResult.success).toBe(true);

        const rpEntity = getResult.entities.find((e: any) => e.entityId === rpEntityId);
        expect(rpEntity).toBeDefined();
        expect(rpEntity.entityType).toBe('openid_relying_party');

        const opEntity = getResult.entities.find((e: any) => e.entityId === opEntityId);
        expect(opEntity).toBeDefined();
        expect(opEntity.entityType).toBe('openid_provider');

        // Cleanup
        await removeEntity(rpEntityId);
        await removeEntity(opEntityId);
      }
    ), { numRuns: 3, timeout: 20000 });
  }, 40000);
});
