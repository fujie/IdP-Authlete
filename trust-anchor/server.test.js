import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';

describe('Trust Anchor Admin API - Entity Type Handling', () => {
  let app;
  let keyPair;
  let publicJWK;
  let privateKey;
  let entityStorage;
  const VALID_ENTITY_TYPES = ['openid_relying_party', 'openid_provider'];
  
  const TRUST_ANCHOR_CONFIG = {
    entityId: 'https://trust-anchor.test.com',
    organizationName: 'Test Trust Anchor',
    homepageUri: 'https://trust-anchor.test.com',
    contacts: ['admin@trust-anchor.test.com'],
    subordinateEntities: []
  };

  // Helper function to validate entity type
  function validateEntityType(entityType) {
    if (!entityType) {
      return { valid: false, error: 'Entity type is required' };
    }
    if (!VALID_ENTITY_TYPES.includes(entityType)) {
      return { valid: false, error: `Invalid entity type. Must be one of: ${VALID_ENTITY_TYPES.join(', ')}` };
    }
    return { valid: true };
  }

  beforeAll(async () => {
    // Generate key pair for testing
    keyPair = await generateKeyPair('RS256', { modulusLength: 2048 });
    publicJWK = await exportJWK(keyPair.publicKey);
    publicJWK.use = 'sig';
    publicJWK.alg = 'RS256';
    publicJWK.kid = crypto.randomUUID();
    privateKey = keyPair.privateKey;
  });

  beforeEach(() => {
    // Reset entity storage before each test
    entityStorage = [];
    
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Admin API: Get entities
    app.get('/admin/entities', (req, res) => {
      res.json({
        success: true,
        entities: entityStorage.map(e => ({
          entityId: e.entityId,
          entityType: e.entityType,
          addedAt: e.addedAt
        }))
      });
    });

    // Admin API: Add entity
    app.post('/admin/entities', (req, res) => {
      try {
        const { entityId, entityType } = req.body;
        
        if (!entityId) {
          return res.status(400).json({
            success: false,
            message: 'Entity ID is required'
          });
        }
        
        // Validate entity type
        const typeValidation = validateEntityType(entityType);
        if (!typeValidation.valid) {
          return res.status(400).json({
            success: false,
            message: typeValidation.error
          });
        }
        
        // Validate URL format
        try {
          new URL(entityId);
        } catch {
          return res.status(400).json({
            success: false,
            message: 'Invalid URL format'
          });
        }
        
        // Check if already exists
        if (entityStorage.find(e => e.entityId === entityId)) {
          return res.status(400).json({
            success: false,
            message: 'Entity already exists'
          });
        }
        
        // Add entity to storage
        const newEntity = {
          entityId: entityId,
          entityType: entityType,
          addedAt: Date.now()
        };
        entityStorage.push(newEntity);
        
        res.json({
          success: true,
          message: 'Entity added successfully',
          entity: newEntity,
          entities: entityStorage.map(e => ({
            entityId: e.entityId,
            entityType: e.entityType,
            addedAt: e.addedAt
          }))
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    });
  });

  describe('POST /admin/entities - Add RP Entity', () => {
    it('should successfully add an RP entity with correct type', async () => {
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp.example.com',
          entityType: 'openid_relying_party'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Entity added successfully');
      expect(response.body.entity).toMatchObject({
        entityId: 'https://rp.example.com',
        entityType: 'openid_relying_party'
      });
      expect(response.body.entity.addedAt).toBeDefined();
      expect(typeof response.body.entity.addedAt).toBe('number');
    });

    it('should return RP entity in entities list after adding', async () => {
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp.example.com',
          entityType: 'openid_relying_party'
        });

      const response = await request(app).get('/admin/entities');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.entities).toHaveLength(1);
      expect(response.body.entities[0]).toMatchObject({
        entityId: 'https://rp.example.com',
        entityType: 'openid_relying_party'
      });
    });
  });

  describe('POST /admin/entities - Add OP Entity', () => {
    it('should successfully add an OP entity with correct type', async () => {
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://op.example.com',
          entityType: 'openid_provider'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Entity added successfully');
      expect(response.body.entity).toMatchObject({
        entityId: 'https://op.example.com',
        entityType: 'openid_provider'
      });
      expect(response.body.entity.addedAt).toBeDefined();
      expect(typeof response.body.entity.addedAt).toBe('number');
    });

    it('should return OP entity in entities list after adding', async () => {
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://op.example.com',
          entityType: 'openid_provider'
        });

      const response = await request(app).get('/admin/entities');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.entities).toHaveLength(1);
      expect(response.body.entities[0]).toMatchObject({
        entityId: 'https://op.example.com',
        entityType: 'openid_provider'
      });
    });
  });

  describe('POST /admin/entities - Entity Type Validation', () => {
    it('should reject entity without entity type', async () => {
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://entity.example.com'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Entity type is required');
    });

    it('should reject entity with invalid entity type', async () => {
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://entity.example.com',
          entityType: 'invalid_type'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid entity type');
      expect(response.body.message).toContain('openid_relying_party');
      expect(response.body.message).toContain('openid_provider');
    });

    it('should reject entity with empty entity type', async () => {
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://entity.example.com',
          entityType: ''
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Entity type is required');
    });

    it('should reject entity without entity ID', async () => {
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityType: 'openid_relying_party'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Entity ID is required');
    });

    it('should reject entity with invalid URL format', async () => {
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'not-a-valid-url',
          entityType: 'openid_relying_party'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid URL format');
    });

    it('should reject duplicate entity', async () => {
      // Add entity first time
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://entity.example.com',
          entityType: 'openid_relying_party'
        });

      // Try to add same entity again
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://entity.example.com',
          entityType: 'openid_relying_party'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Entity already exists');
    });
  });

  describe('POST /admin/entities - Multiple Entities', () => {
    it('should support adding both RP and OP entities', async () => {
      // Add RP entity
      const rpResponse = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp.example.com',
          entityType: 'openid_relying_party'
        });

      expect(rpResponse.status).toBe(200);
      expect(rpResponse.body.success).toBe(true);

      // Add OP entity
      const opResponse = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://op.example.com',
          entityType: 'openid_provider'
        });

      expect(opResponse.status).toBe(200);
      expect(opResponse.body.success).toBe(true);

      // Verify both entities are in storage
      const listResponse = await request(app).get('/admin/entities');

      expect(listResponse.status).toBe(200);
      expect(listResponse.body.entities).toHaveLength(2);
      
      const rpEntity = listResponse.body.entities.find(e => e.entityId === 'https://rp.example.com');
      const opEntity = listResponse.body.entities.find(e => e.entityId === 'https://op.example.com');
      
      expect(rpEntity).toBeDefined();
      expect(rpEntity.entityType).toBe('openid_relying_party');
      
      expect(opEntity).toBeDefined();
      expect(opEntity.entityType).toBe('openid_provider');
    });
  });

  describe('GET /admin/entities - Entity Type in Response', () => {
    it('should return entity type for all entities', async () => {
      // Add multiple entities
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp1.example.com',
          entityType: 'openid_relying_party'
        });

      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://op1.example.com',
          entityType: 'openid_provider'
        });

      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp2.example.com',
          entityType: 'openid_relying_party'
        });

      const response = await request(app).get('/admin/entities');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.entities).toHaveLength(3);

      // Verify all entities have entityType field
      response.body.entities.forEach(entity => {
        expect(entity.entityType).toBeDefined();
        expect(VALID_ENTITY_TYPES).toContain(entity.entityType);
        expect(entity.entityId).toBeDefined();
        expect(entity.addedAt).toBeDefined();
      });
    });

    it('should return empty array when no entities exist', async () => {
      const response = await request(app).get('/admin/entities');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.entities).toEqual([]);
    });
  });
});
