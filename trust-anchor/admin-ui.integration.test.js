import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Trust Anchor Admin UI - Integration Tests', () => {
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
    
    // Set up EJS view engine
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // Admin UI endpoint
    app.get('/admin', (req, res) => {
      res.render('admin', {
        config: TRUST_ANCHOR_CONFIG,
        entities: entityStorage
      });
    });

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

  describe('Admin UI Rendering', () => {
    it('should render admin UI with empty entity list', async () => {
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/html');
      expect(response.text).toContain('Trust Anchor Management');
      expect(response.text).toContain('No subordinate entities registered yet');
    });

    it('should render admin UI with entity type selector in form', async () => {
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Entity Type');
      expect(response.text).toContain('openid_relying_party');
      expect(response.text).toContain('openid_provider');
      expect(response.text).toContain('Relying Party (RP)');
      expect(response.text).toContain('OpenID Provider (OP)');
    });

    it('should render admin UI with filter buttons', async () => {
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Filter by Type:');
      expect(response.text).toContain('filterEntities');
      expect(response.text).toContain('Relying Parties');
      expect(response.text).toContain('OpenID Providers');
    });
  });

  describe('Adding OP Entity Through UI', () => {
    it('should successfully add OP entity via form submission', async () => {
      // Simulate form submission
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
    });

    it('should display OP entity in admin UI after adding', async () => {
      // Add OP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://op.example.com',
          entityType: 'openid_provider'
        });

      // Fetch admin UI
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('https://op.example.com');
      expect(response.text).toContain('badge-op');
      expect(response.text).toContain('OP');
      expect(response.text).toContain('OpenID Provider');
    });

    it('should display RP entity in admin UI after adding', async () => {
      // Add RP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp.example.com',
          entityType: 'openid_relying_party'
        });

      // Fetch admin UI
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('https://rp.example.com');
      expect(response.text).toContain('badge-rp');
      expect(response.text).toContain('RP');
      expect(response.text).toContain('Relying Party');
    });

    it('should add multiple entities of different types', async () => {
      // Add RP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp1.example.com',
          entityType: 'openid_relying_party'
        });

      // Add OP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://op1.example.com',
          entityType: 'openid_provider'
        });

      // Add another RP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp2.example.com',
          entityType: 'openid_relying_party'
        });

      // Fetch admin UI
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('https://rp1.example.com');
      expect(response.text).toContain('https://op1.example.com');
      expect(response.text).toContain('https://rp2.example.com');
      
      // Verify entities are rendered with correct types by checking entity items
      // Each entity should have its URL and type in the same list item
      expect(response.text).toMatch(/data-entity-type="openid_relying_party"[\s\S]*?https:\/\/rp1\.example\.com/);
      expect(response.text).toMatch(/data-entity-type="openid_relying_party"[\s\S]*?https:\/\/rp2\.example\.com/);
      expect(response.text).toMatch(/data-entity-type="openid_provider"[\s\S]*?https:\/\/op1\.example\.com/);
    });
  });

  describe('Entity Type Display', () => {
    it('should display OP badge for OpenID Provider entities', async () => {
      // Add OP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://op.example.com',
          entityType: 'openid_provider'
        });

      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('badge-op');
      expect(response.text).toContain('>OP</span>');
      expect(response.text).toContain('OpenID Provider');
    });

    it('should display RP badge for Relying Party entities', async () => {
      // Add RP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp.example.com',
          entityType: 'openid_relying_party'
        });

      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('badge-rp');
      expect(response.text).toContain('>RP</span>');
      expect(response.text).toContain('Relying Party');
    });

    it('should display entity type in data attribute for filtering', async () => {
      // Add entities of both types
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp.example.com',
          entityType: 'openid_relying_party'
        });

      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://op.example.com',
          entityType: 'openid_provider'
        });

      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('data-entity-type="openid_relying_party"');
      expect(response.text).toContain('data-entity-type="openid_provider"');
    });

    it('should display entity count statistics', async () => {
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
          entityId: 'https://rp2.example.com',
          entityType: 'openid_relying_party'
        });

      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://op1.example.com',
          entityType: 'openid_provider'
        });

      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      // Check for stats section
      expect(response.text).toContain('Registered Entities');
      expect(response.text).toContain('Relying Parties');
      expect(response.text).toContain('OpenID Providers');
      expect(response.text).toContain('id="rpCount"');
      expect(response.text).toContain('id="opCount"');
    });
  });

  describe('Entity Type Filtering', () => {
    beforeEach(async () => {
      // Add test entities
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp1.example.com',
          entityType: 'openid_relying_party'
        });

      await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://rp2.example.com',
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
          entityId: 'https://op2.example.com',
          entityType: 'openid_provider'
        });
    });

    it('should include filter buttons in UI', async () => {
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('filterEntities(\'all\')');
      expect(response.text).toContain('filterEntities(\'openid_relying_party\')');
      expect(response.text).toContain('filterEntities(\'openid_provider\')');
    });

    it('should include filter counts in UI', async () => {
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('id="allCount"');
      expect(response.text).toContain('id="rpFilterCount"');
      expect(response.text).toContain('id="opFilterCount"');
    });

    it('should include JavaScript filter function', async () => {
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('function filterEntities(type)');
      expect(response.text).toContain('data-entity-type');
      expect(response.text).toContain('filter-btn');
    });

    it('should render all entities with correct data attributes for filtering', async () => {
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      
      // Check that all entities are rendered with data-entity-type
      expect(response.text).toContain('https://rp1.example.com');
      expect(response.text).toContain('https://rp2.example.com');
      expect(response.text).toContain('https://op1.example.com');
      expect(response.text).toContain('https://op2.example.com');
      
      // Verify each entity has correct type by checking entity items
      expect(response.text).toMatch(/data-entity-type="openid_relying_party"[\s\S]*?https:\/\/rp1\.example\.com/);
      expect(response.text).toMatch(/data-entity-type="openid_relying_party"[\s\S]*?https:\/\/rp2\.example\.com/);
      expect(response.text).toMatch(/data-entity-type="openid_provider"[\s\S]*?https:\/\/op1\.example\.com/);
      expect(response.text).toMatch(/data-entity-type="openid_provider"[\s\S]*?https:\/\/op2\.example\.com/);
    });

    it('should include updateCounts function for dynamic count updates', async () => {
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('function updateCounts()');
      expect(response.text).toContain('getElementById(\'rpCount\')');
      expect(response.text).toContain('getElementById(\'opCount\')');
      expect(response.text).toContain('getElementById(\'allCount\')');
    });
  });

  describe('Form Validation in UI', () => {
    it('should include required attribute on entity type selector', async () => {
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('id="entityType"');
      expect(response.text).toContain('required');
    });

    it('should include both entity type options in selector', async () => {
      const response = await request(app).get('/admin');

      expect(response.status).toBe(200);
      expect(response.text).toContain('value="openid_relying_party"');
      expect(response.text).toContain('value="openid_provider"');
    });

    it('should reject form submission without entity type', async () => {
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://entity.example.com'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Entity type is required');
    });

    it('should reject form submission with invalid entity type', async () => {
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://entity.example.com',
          entityType: 'invalid_type'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid entity type');
    });
  });

  describe('End-to-End UI Workflow', () => {
    it('should complete full workflow: add OP, display, and filter', async () => {
      // Step 1: Verify empty state
      let response = await request(app).get('/admin');
      expect(response.status).toBe(200);
      expect(response.text).toContain('No subordinate entities registered yet');

      // Step 2: Add OP entity
      const addResponse = await request(app)
        .post('/admin/entities')
        .send({
          entityId: 'https://op.example.com',
          entityType: 'openid_provider'
        });
      expect(addResponse.status).toBe(200);
      expect(addResponse.body.success).toBe(true);

      // Step 3: Verify entity appears in UI
      response = await request(app).get('/admin');
      expect(response.status).toBe(200);
      expect(response.text).toContain('https://op.example.com');
      expect(response.text).toContain('badge-op');
      expect(response.text).toContain('data-entity-type="openid_provider"');

      // Step 4: Verify filter functionality is present
      expect(response.text).toContain('filterEntities');
      expect(response.text).toContain('filter-btn');
    });

    it('should handle mixed entity types in UI', async () => {
      // Add multiple entities of different types
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

      // Verify UI displays all entities correctly
      const response = await request(app).get('/admin');
      expect(response.status).toBe(200);

      // Check all entities are present
      expect(response.text).toContain('https://rp1.example.com');
      expect(response.text).toContain('https://op1.example.com');
      expect(response.text).toContain('https://rp2.example.com');

      // Verify each entity has correct type by checking entity items
      expect(response.text).toMatch(/data-entity-type="openid_relying_party"[\s\S]*?https:\/\/rp1\.example\.com/);
      expect(response.text).toMatch(/data-entity-type="openid_relying_party"[\s\S]*?https:\/\/rp2\.example\.com/);
      expect(response.text).toMatch(/data-entity-type="openid_provider"[\s\S]*?https:\/\/op1\.example\.com/);
    });
  });
});
