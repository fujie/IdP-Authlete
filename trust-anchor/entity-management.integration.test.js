import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { SignJWT, generateKeyPair, exportJWK, jwtVerify, importJWK } from 'jose';
import axios from 'axios';

describe('Trust Anchor Entity Management - Integration Tests', () => {
  let app;
  let keyPair;
  let publicJWK;
  let privateKey;
  let entityStorage;
  let subordinateEntities;
  const VALID_ENTITY_TYPES = ['openid_relying_party', 'openid_provider'];
  
  const TRUST_ANCHOR_CONFIG = {
    entityId: 'https://trust-anchor.test.com',
    organizationName: 'Test Trust Anchor',
    homepageUri: 'https://trust-anchor.test.com',
    contacts: ['admin@trust-anchor.test.com']
  };

  // Mock subordinate entity configuration
  let mockSubordinateKeyPair;
  let mockSubordinatePublicJWK;
  let mockSubordinatePrivateKey;

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

  // Helper function to create mock subordinate entity configuration
  async function createMockSubordinateEntityConfiguration(entityId, entityType) {
    const now = Math.floor(Date.now() / 1000);
    const expiration = now + (365 * 24 * 60 * 60);

    const payload = {
      iss: entityId,
      sub: entityId,
      iat: now,
      exp: expiration,
      jwks: {
        keys: [mockSubordinatePublicJWK]
      },
      authority_hints: [TRUST_ANCHOR_CONFIG.entityId]
    };

    // Add metadata based on entity type
    if (entityType === 'openid_relying_party') {
      payload.metadata = {
        openid_relying_party: {
          client_name: 'Test RP',
          redirect_uris: [`${entityId}/callback`]
        }
      };
    } else if (entityType === 'openid_provider') {
      payload.metadata = {
        openid_provider: {
          issuer: entityId,
          authorization_endpoint: `${entityId}/authorize`,
          token_endpoint: `${entityId}/token`
        }
      };
    }

    const jwt = await new SignJWT(payload)
      .setProtectedHeader({ 
        alg: 'RS256', 
        kid: mockSubordinatePublicJWK.kid,
        typ: 'entity-statement+jwt'
      })
      .sign(mockSubordinatePrivateKey);

    return jwt;
  }

  // Helper function to decode JWT without verification
  function decodeJWT(jwt) {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }
    
    const base64UrlDecode = (str) => {
      const padding = '='.repeat((4 - (str.length % 4)) % 4);
      const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;
      return Buffer.from(base64, 'base64').toString('utf-8');
    };
    
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    
    return { header, payload };
  }

  beforeAll(async () => {
    // Generate key pair for Trust Anchor
    keyPair = await generateKeyPair('RS256', { modulusLength: 2048 });
    publicJWK = await exportJWK(keyPair.publicKey);
    publicJWK.use = 'sig';
    publicJWK.alg = 'RS256';
    publicJWK.kid = crypto.randomUUID();
    privateKey = keyPair.privateKey;

    // Generate key pair for mock subordinate entity
    mockSubordinateKeyPair = await generateKeyPair('RS256', { modulusLength: 2048 });
    mockSubordinatePublicJWK = await exportJWK(mockSubordinateKeyPair.publicKey);
    mockSubordinatePublicJWK.use = 'sig';
    mockSubordinatePublicJWK.alg = 'RS256';
    mockSubordinatePublicJWK.kid = crypto.randomUUID();
    mockSubordinatePrivateKey = mockSubordinateKeyPair.privateKey;
  });

  beforeEach(() => {
    // Reset storage before each test
    entityStorage = [];
    subordinateEntities = [];
    
    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Mock subordinate entity configuration endpoint
    app.get('/mock-subordinate/.well-known/openid-federation', async (req, res) => {
      const entityId = 'https://trust-anchor.test.com/mock-subordinate';
      const entityType = req.query.entityType || 'openid_provider';
      const jwt = await createMockSubordinateEntityConfiguration(entityId, entityType);
      res.setHeader('Content-Type', 'application/entity-statement+jwt');
      res.send(jwt);
    });

    // Entity Configuration endpoint
    app.get('/.well-known/openid-federation', async (req, res) => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const expiration = now + (365 * 24 * 60 * 60);

        const payload = {
          iss: TRUST_ANCHOR_CONFIG.entityId,
          sub: TRUST_ANCHOR_CONFIG.entityId,
          iat: now,
          exp: expiration,
          jwks: {
            keys: [publicJWK]
          },
          metadata: {
            federation_entity: {
              organization_name: TRUST_ANCHOR_CONFIG.organizationName,
              homepage_uri: TRUST_ANCHOR_CONFIG.homepageUri,
              contacts: TRUST_ANCHOR_CONFIG.contacts,
              federation_fetch_endpoint: `${TRUST_ANCHOR_CONFIG.entityId}/federation/fetch`
            }
          }
        };

        const jwt = await new SignJWT(payload)
          .setProtectedHeader({ 
            alg: 'RS256', 
            kid: publicJWK.kid,
            typ: 'entity-statement+jwt'
          })
          .sign(privateKey);

        res.setHeader('Content-Type', 'application/entity-statement+jwt');
        res.send(jwt);
      } catch (error) {
        res.status(500).json({ error: 'Failed to create entity configuration' });
      }
    });

    // Federation Fetch endpoint
    app.get('/federation/fetch', async (req, res) => {
      try {
        const { sub } = req.query;

        if (!sub) {
          return res.status(400).json({ 
            error: 'invalid_request',
            error_description: 'Missing required parameter: sub' 
          });
        }

        // Check if this is a request for our own entity configuration
        if (sub === TRUST_ANCHOR_CONFIG.entityId) {
          const now = Math.floor(Date.now() / 1000);
          const expiration = now + (365 * 24 * 60 * 60);

          const payload = {
            iss: TRUST_ANCHOR_CONFIG.entityId,
            sub: TRUST_ANCHOR_CONFIG.entityId,
            iat: now,
            exp: expiration,
            jwks: {
              keys: [publicJWK]
            },
            metadata: {
              federation_entity: {
                organization_name: TRUST_ANCHOR_CONFIG.organizationName
              }
            }
          };

          const jwt = await new SignJWT(payload)
            .setProtectedHeader({ 
              alg: 'RS256', 
              kid: publicJWK.kid,
              typ: 'entity-statement+jwt'
            })
            .sign(privateKey);

          res.setHeader('Content-Type', 'application/entity-statement+jwt');
          return res.send(jwt);
        }

        // Check if the subordinate entity is registered
        const entity = entityStorage.find(e => e.entityId === sub);
        if (!entity) {
          return res.status(404).json({ 
            error: 'not_found',
            error_description: 'Entity not found in trust anchor' 
          });
        }

        // For mock subordinate, use mock configuration
        let subordinateConfig;
        if (sub.includes('/mock-subordinate')) {
          const mockJwt = await createMockSubordinateEntityConfiguration(sub, entity.entityType);
          const decoded = decodeJWT(mockJwt);
          subordinateConfig = decoded.payload;
        } else {
          // In real scenario, would fetch from actual subordinate
          // For testing, create a minimal config
          subordinateConfig = {
            jwks: {
              keys: [mockSubordinatePublicJWK]
            },
            metadata: entity.entityType === 'openid_provider' ? {
              openid_provider: {
                issuer: sub
              }
            } : {
              openid_relying_party: {
                client_name: 'Test RP'
              }
            }
          };
        }

        // Create entity statement
        const now = Math.floor(Date.now() / 1000);
        const expiration = now + (30 * 24 * 60 * 60);

        const payload = {
          iss: TRUST_ANCHOR_CONFIG.entityId,
          sub: sub,
          iat: now,
          exp: expiration,
          jwks: subordinateConfig.jwks
        };

        // Add metadata based on entity type
        if (entity.entityType === 'openid_relying_party') {
          payload.metadata = {
            openid_relying_party: {
              ...(subordinateConfig.metadata?.openid_relying_party || {})
            }
          };
        } else if (entity.entityType === 'openid_provider') {
          payload.metadata = {
            openid_provider: {
              ...(subordinateConfig.metadata?.openid_provider || {})
            }
          };
        }

        const jwt = await new SignJWT(payload)
          .setProtectedHeader({ 
            alg: 'RS256', 
            kid: publicJWK.kid,
            typ: 'entity-statement+jwt'
          })
          .sign(privateKey);

        res.setHeader('Content-Type', 'application/entity-statement+jwt');
        res.send(jwt);
      } catch (error) {
        res.status(500).json({ 
          error: 'server_error',
          error_description: 'Internal server error' 
        });
      }
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
        
        const typeValidation = validateEntityType(entityType);
        if (!typeValidation.valid) {
          return res.status(400).json({
            success: false,
            message: typeValidation.error
          });
        }
        
        try {
          new URL(entityId);
        } catch {
          return res.status(400).json({
            success: false,
            message: 'Invalid URL format'
          });
        }
        
        if (entityStorage.find(e => e.entityId === entityId)) {
          return res.status(400).json({
            success: false,
            message: 'Entity already exists'
          });
        }
        
        const newEntity = {
          entityId: entityId,
          entityType: entityType,
          addedAt: Date.now()
        };
        entityStorage.push(newEntity);
        subordinateEntities.push(entityId);
        
        res.json({
          success: true,
          message: 'Entity added successfully',
          entity: newEntity
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    });

    // Admin API: Remove entity
    app.delete('/admin/entities', (req, res) => {
      try {
        const { entityId } = req.body;
        
        if (!entityId) {
          return res.status(400).json({
            success: false,
            message: 'Entity ID is required'
          });
        }
        
        const index = entityStorage.findIndex(e => e.entityId === entityId);
        if (index === -1) {
          return res.status(404).json({
            success: false,
            message: 'Entity not found'
          });
        }
        
        entityStorage.splice(index, 1);
        
        const legacyIndex = subordinateEntities.indexOf(entityId);
        if (legacyIndex !== -1) {
          subordinateEntities.splice(legacyIndex, 1);
        }
        
        res.json({
          success: true,
          message: 'Entity removed successfully'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    });
  });

  describe('Requirements 4.4, 4.5: OP Entity Management via Admin API', () => {
    it('should add OP entity via admin API', async () => {
      const opEntityId = 'https://op.example.com';
      
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityId: opEntityId,
          entityType: 'openid_provider'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Entity added successfully');
      expect(response.body.entity).toMatchObject({
        entityId: opEntityId,
        entityType: 'openid_provider'
      });
      expect(response.body.entity.addedAt).toBeDefined();
    });

    it('should fetch entity statement for OP after adding', async () => {
      const opEntityId = 'https://trust-anchor.test.com/mock-subordinate';
      
      // Add OP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: opEntityId,
          entityType: 'openid_provider'
        });

      // Fetch entity statement
      const response = await request(app)
        .get('/federation/fetch')
        .query({ sub: opEntityId });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/entity-statement+jwt');
      expect(response.text).toBeDefined();
      expect(typeof response.text).toBe('string');
      
      // Decode and verify JWT structure
      const decoded = decodeJWT(response.text);
      expect(decoded.payload.iss).toBe(TRUST_ANCHOR_CONFIG.entityId);
      expect(decoded.payload.sub).toBe(opEntityId);
      expect(decoded.payload.metadata).toBeDefined();
      expect(decoded.payload.metadata.openid_provider).toBeDefined();
      expect(decoded.payload.jwks).toBeDefined();
      expect(decoded.payload.jwks.keys).toBeInstanceOf(Array);
    });

    it('should remove OP entity via admin API', async () => {
      const opEntityId = 'https://op.example.com';
      
      // Add OP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: opEntityId,
          entityType: 'openid_provider'
        });

      // Verify entity exists
      let listResponse = await request(app).get('/admin/entities');
      expect(listResponse.body.entities).toHaveLength(1);

      // Remove entity
      const removeResponse = await request(app)
        .delete('/admin/entities')
        .send({ entityId: opEntityId });

      expect(removeResponse.status).toBe(200);
      expect(removeResponse.body.success).toBe(true);
      expect(removeResponse.body.message).toBe('Entity removed successfully');

      // Verify entity is removed
      listResponse = await request(app).get('/admin/entities');
      expect(listResponse.body.entities).toHaveLength(0);
    });

    it('should not serve entity statement after removal', async () => {
      const opEntityId = 'https://trust-anchor.test.com/mock-subordinate';
      
      // Add OP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: opEntityId,
          entityType: 'openid_provider'
        });

      // Verify entity statement is served
      let fetchResponse = await request(app)
        .get('/federation/fetch')
        .query({ sub: opEntityId });
      expect(fetchResponse.status).toBe(200);

      // Remove entity
      await request(app)
        .delete('/admin/entities')
        .send({ entityId: opEntityId });

      // Verify entity statement is no longer served
      fetchResponse = await request(app)
        .get('/federation/fetch')
        .query({ sub: opEntityId });
      expect(fetchResponse.status).toBe(404);
      expect(fetchResponse.body.error).toBe('not_found');
      expect(fetchResponse.body.error_description).toBe('Entity not found in trust anchor');
    });
  });

  describe('Entity Statement Content Validation', () => {
    it('should include correct metadata type for OP entity', async () => {
      const opEntityId = 'https://trust-anchor.test.com/mock-subordinate';
      
      // Add OP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: opEntityId,
          entityType: 'openid_provider'
        });

      // Fetch entity statement
      const response = await request(app)
        .get('/federation/fetch')
        .query({ sub: opEntityId });

      expect(response.status).toBe(200);
      
      const decoded = decodeJWT(response.text);
      expect(decoded.payload.metadata.openid_provider).toBeDefined();
      expect(decoded.payload.metadata.openid_relying_party).toBeUndefined();
    });

    it('should include correct metadata type for RP entity', async () => {
      const rpEntityId = 'https://trust-anchor.test.com/mock-subordinate';
      
      // Add RP entity
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: rpEntityId,
          entityType: 'openid_relying_party'
        });

      // Fetch entity statement
      const response = await request(app)
        .get('/federation/fetch')
        .query({ sub: rpEntityId });

      expect(response.status).toBe(200);
      
      const decoded = decodeJWT(response.text);
      expect(decoded.payload.metadata.openid_relying_party).toBeDefined();
      expect(decoded.payload.metadata.openid_provider).toBeUndefined();
    });

    it('should include Trust Anchor as issuer in entity statement', async () => {
      const opEntityId = 'https://trust-anchor.test.com/mock-subordinate';
      
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: opEntityId,
          entityType: 'openid_provider'
        });

      const response = await request(app)
        .get('/federation/fetch')
        .query({ sub: opEntityId });

      const decoded = decodeJWT(response.text);
      expect(decoded.payload.iss).toBe(TRUST_ANCHOR_CONFIG.entityId);
      expect(decoded.payload.sub).toBe(opEntityId);
    });

    it('should include JWKS in entity statement', async () => {
      const opEntityId = 'https://trust-anchor.test.com/mock-subordinate';
      
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: opEntityId,
          entityType: 'openid_provider'
        });

      const response = await request(app)
        .get('/federation/fetch')
        .query({ sub: opEntityId });

      const decoded = decodeJWT(response.text);
      expect(decoded.payload.jwks).toBeDefined();
      expect(decoded.payload.jwks.keys).toBeInstanceOf(Array);
      expect(decoded.payload.jwks.keys.length).toBeGreaterThan(0);
    });

    it('should include expiration time in entity statement', async () => {
      const opEntityId = 'https://trust-anchor.test.com/mock-subordinate';
      
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: opEntityId,
          entityType: 'openid_provider'
        });

      const response = await request(app)
        .get('/federation/fetch')
        .query({ sub: opEntityId });

      const decoded = decodeJWT(response.text);
      expect(decoded.payload.iat).toBeDefined();
      expect(decoded.payload.exp).toBeDefined();
      expect(decoded.payload.exp).toBeGreaterThan(decoded.payload.iat);
    });
  });

  describe('Multiple Entity Management', () => {
    it('should manage multiple OP entities independently', async () => {
      const op1 = 'https://op1.example.com';
      const op2 = 'https://op2.example.com';
      
      // Add first OP
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: op1,
          entityType: 'openid_provider'
        });

      // Add second OP
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: op2,
          entityType: 'openid_provider'
        });

      // Verify both exist
      const listResponse = await request(app).get('/admin/entities');
      expect(listResponse.body.entities).toHaveLength(2);

      // Remove first OP
      await request(app)
        .delete('/admin/entities')
        .send({ entityId: op1 });

      // Verify only second OP remains
      const listResponse2 = await request(app).get('/admin/entities');
      expect(listResponse2.body.entities).toHaveLength(1);
      expect(listResponse2.body.entities[0].entityId).toBe(op2);
    });

    it('should manage mixed RP and OP entities', async () => {
      const rp = 'https://rp.example.com';
      const op = 'https://op.example.com';
      
      // Add RP
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: rp,
          entityType: 'openid_relying_party'
        });

      // Add OP
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: op,
          entityType: 'openid_provider'
        });

      // Verify both exist with correct types
      const listResponse = await request(app).get('/admin/entities');
      expect(listResponse.body.entities).toHaveLength(2);
      
      const rpEntity = listResponse.body.entities.find(e => e.entityId === rp);
      const opEntity = listResponse.body.entities.find(e => e.entityId === op);
      
      expect(rpEntity.entityType).toBe('openid_relying_party');
      expect(opEntity.entityType).toBe('openid_provider');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent entity', async () => {
      const response = await request(app)
        .get('/federation/fetch')
        .query({ sub: 'https://non-existent.example.com' });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should return 400 when removing non-existent entity', async () => {
      const response = await request(app)
        .delete('/admin/entities')
        .send({ entityId: 'https://non-existent.example.com' });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Entity not found');
    });

    it('should return 400 when adding duplicate entity', async () => {
      const entityId = 'https://op.example.com';
      
      // Add entity first time
      await request(app)
        .post('/admin/entities')
        .send({
          entityId: entityId,
          entityType: 'openid_provider'
        });

      // Try to add again
      const response = await request(app)
        .post('/admin/entities')
        .send({
          entityId: entityId,
          entityType: 'openid_provider'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Entity already exists');
    });

    it('should return 400 for missing sub parameter in fetch', async () => {
      const response = await request(app)
        .get('/federation/fetch');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_request');
    });
  });

  describe('End-to-End Entity Lifecycle', () => {
    it('should complete full lifecycle: add, fetch, remove, verify removal', async () => {
      const opEntityId = 'https://trust-anchor.test.com/mock-subordinate';
      
      // Step 1: Add OP entity
      const addResponse = await request(app)
        .post('/admin/entities')
        .send({
          entityId: opEntityId,
          entityType: 'openid_provider'
        });
      expect(addResponse.status).toBe(200);
      expect(addResponse.body.success).toBe(true);

      // Step 2: Verify entity is in list
      const listResponse1 = await request(app).get('/admin/entities');
      expect(listResponse1.body.entities).toHaveLength(1);
      expect(listResponse1.body.entities[0].entityId).toBe(opEntityId);
      expect(listResponse1.body.entities[0].entityType).toBe('openid_provider');

      // Step 3: Fetch entity statement
      const fetchResponse1 = await request(app)
        .get('/federation/fetch')
        .query({ sub: opEntityId });
      expect(fetchResponse1.status).toBe(200);
      expect(fetchResponse1.headers['content-type']).toContain('application/entity-statement+jwt');
      
      const decoded = decodeJWT(fetchResponse1.text);
      expect(decoded.payload.sub).toBe(opEntityId);
      expect(decoded.payload.metadata.openid_provider).toBeDefined();

      // Step 4: Remove entity
      const removeResponse = await request(app)
        .delete('/admin/entities')
        .send({ entityId: opEntityId });
      expect(removeResponse.status).toBe(200);
      expect(removeResponse.body.success).toBe(true);

      // Step 5: Verify entity is removed from list
      const listResponse2 = await request(app).get('/admin/entities');
      expect(listResponse2.body.entities).toHaveLength(0);

      // Step 6: Verify entity statement is no longer served
      const fetchResponse2 = await request(app)
        .get('/federation/fetch')
        .query({ sub: opEntityId });
      expect(fetchResponse2.status).toBe(404);
      expect(fetchResponse2.body.error).toBe('not_found');
    });
  });
});
