require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { SignJWT, generateKeyPair, exportJWK } = require('jose');

const app = express();
const PORT = process.env.PORT || 3010;

// Trust Anchor Configuration
const TRUST_ANCHOR_CONFIG = {
  entityId: process.env.ENTITY_ID || 'https://trust-anchor.example.com',
  organizationName: process.env.ORGANIZATION_NAME || 'OpenID Federation Test Trust Anchor',
  homepageUri: process.env.HOMEPAGE_URI || 'https://trust-anchor.example.com',
  contacts: (process.env.CONTACTS || 'admin@trust-anchor.example.com').split(','),
  subordinateEntities: (process.env.SUBORDINATE_ENTITIES || '').split(',').filter(e => e.trim())
};

// Key pair storage
let keyPair = null;
let publicJWK = null;
let privateKey = null;

// Initialize key pair on startup
async function initializeKeyPair() {
  try {
    console.log('Generating RSA key pair for Trust Anchor...');
    keyPair = await generateKeyPair('RS256', { modulusLength: 2048 });
    
    // Export public key as JWK
    publicJWK = await exportJWK(keyPair.publicKey);
    publicJWK.use = 'sig';
    publicJWK.alg = 'RS256';
    publicJWK.kid = crypto.randomUUID();
    
    privateKey = keyPair.privateKey;
    
    console.log('Key pair generated successfully');
    console.log('Public JWK:', JSON.stringify(publicJWK, null, 2));
  } catch (error) {
    console.error('Failed to generate key pair:', error);
    process.exit(1);
  }
}

// Create Trust Anchor Entity Configuration
async function createEntityConfiguration() {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + (365 * 24 * 60 * 60); // 1 year

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
        federation_fetch_endpoint: `${TRUST_ANCHOR_CONFIG.entityId}/federation/fetch`,
        federation_list_endpoint: `${TRUST_ANCHOR_CONFIG.entityId}/federation/list`,
        federation_resolve_endpoint: `${TRUST_ANCHOR_CONFIG.entityId}/federation/resolve`
      }
    }
    // Note: Trust Anchor has no authority_hints (it's the root of trust)
  };

  // Sign the entity configuration
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ 
      alg: 'RS256', 
      kid: publicJWK.kid,
      typ: 'entity-statement+jwt'
    })
    .sign(privateKey);

  return jwt;
}

// Fetch subordinate entity configuration
async function fetchSubordinateEntityConfiguration(entityId) {
  try {
    const url = `${entityId}/.well-known/openid-federation`;
    console.log('Fetching subordinate entity configuration from:', url);
    
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/entity-statement+jwt'
      }
    });
    
    const jwt = response.data;
    
    // Decode JWT to extract JWKS (without verification for simplicity in this test setup)
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    console.log('Subordinate entity configuration fetched successfully');
    console.log('Subordinate JWKS:', JSON.stringify(payload.jwks, null, 2));
    
    return payload;
  } catch (error) {
    console.error('Failed to fetch subordinate entity configuration:', error.message);
    throw error;
  }
}

// Create Entity Statement for a subordinate entity
async function createEntityStatement(subordinateEntityId) {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + (30 * 24 * 60 * 60); // 30 days

  // Fetch the subordinate's entity configuration to get their public keys
  const subordinateConfig = await fetchSubordinateEntityConfiguration(subordinateEntityId);

  const payload = {
    iss: TRUST_ANCHOR_CONFIG.entityId,
    sub: subordinateEntityId,
    iat: now,
    exp: expiration,
    // Include the subordinate's public keys from their entity configuration
    jwks: subordinateConfig.jwks
  };

  // Sign the entity statement with the Trust Anchor's private key
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ 
      alg: 'RS256', 
      kid: publicJWK.kid,
      typ: 'entity-statement+jwt'
    })
    .sign(privateKey);

  return jwt;
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Entity Configuration endpoint (OpenID Federation)
app.get('/.well-known/openid-federation', async (req, res) => {
  try {
    const entityConfiguration = await createEntityConfiguration();
    
    res.setHeader('Content-Type', 'application/entity-statement+jwt');
    res.send(entityConfiguration);

    console.log('Entity Configuration served for Trust Anchor');
  } catch (error) {
    console.error('Failed to create entity configuration:', error);
    res.status(500).json({ error: 'Failed to create entity configuration' });
  }
});

// Federation Fetch endpoint
app.get('/federation/fetch', async (req, res) => {
  try {
    const { iss, sub } = req.query;

    console.log('Federation fetch request:', { iss, sub });

    // Validate parameters
    if (!sub) {
      return res.status(400).json({ 
        error: 'invalid_request',
        error_description: 'Missing required parameter: sub' 
      });
    }

    // Check if this is a request for our own entity configuration
    if (sub === TRUST_ANCHOR_CONFIG.entityId) {
      const entityConfiguration = await createEntityConfiguration();
      res.setHeader('Content-Type', 'application/entity-statement+jwt');
      return res.send(entityConfiguration);
    }

    // Check if the subordinate entity is registered
    if (!TRUST_ANCHOR_CONFIG.subordinateEntities.includes(sub)) {
      console.log('Entity not found in trust anchor:', sub);
      console.log('Registered entities:', TRUST_ANCHOR_CONFIG.subordinateEntities);
      return res.status(404).json({ 
        error: 'not_found',
        error_description: 'Entity not found in trust anchor' 
      });
    }

    // Create and return entity statement for the subordinate
    const entityStatement = await createEntityStatement(sub);
    res.setHeader('Content-Type', 'application/entity-statement+jwt');
    res.send(entityStatement);

    console.log('Entity statement served for:', sub);
  } catch (error) {
    console.error('Federation fetch error:', error);
    res.status(500).json({ 
      error: 'server_error',
      error_description: 'Internal server error' 
    });
  }
});

// Federation List endpoint
app.get('/federation/list', async (req, res) => {
  try {
    const { entity_type } = req.query;

    console.log('Federation list request:', { entity_type });

    // Return list of subordinate entities
    res.json(TRUST_ANCHOR_CONFIG.subordinateEntities);

    console.log('Entity list served:', TRUST_ANCHOR_CONFIG.subordinateEntities);
  } catch (error) {
    console.error('Federation list error:', error);
    res.status(500).json({ 
      error: 'server_error',
      error_description: 'Internal server error' 
    });
  }
});

// Federation Resolve endpoint (simplified for testing)
app.get('/federation/resolve', async (req, res) => {
  try {
    const { sub, anchor } = req.query;

    console.log('Federation resolve request:', { sub, anchor });

    // Validate parameters
    if (!sub) {
      return res.status(400).json({ 
        error: 'invalid_request',
        error_description: 'Missing required parameter: sub' 
      });
    }

    // Check if the subordinate entity is registered
    if (!TRUST_ANCHOR_CONFIG.subordinateEntities.includes(sub)) {
      return res.status(404).json({ 
        error: 'not_found',
        error_description: 'Entity not found in trust anchor' 
      });
    }

    // Return trust chain (simplified - just the entity statement)
    const entityStatement = await createEntityStatement(sub);
    
    res.json({
      trust_chain: [entityStatement],
      metadata: {}
    });

    console.log('Trust chain resolved for:', sub);
  } catch (error) {
    console.error('Federation resolve error:', error);
    res.status(500).json({ 
      error: 'server_error',
      error_description: 'Internal server error' 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'openid-federation-trust-anchor',
    entityId: TRUST_ANCHOR_CONFIG.entityId,
    port: PORT,
    subordinateEntities: TRUST_ANCHOR_CONFIG.subordinateEntities
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'OpenID Federation Trust Anchor',
    entityId: TRUST_ANCHOR_CONFIG.entityId,
    organizationName: TRUST_ANCHOR_CONFIG.organizationName,
    endpoints: {
      entityConfiguration: '/.well-known/openid-federation',
      federationFetch: '/federation/fetch',
      federationList: '/federation/list',
      federationResolve: '/federation/resolve',
      health: '/health'
    },
    subordinateEntities: TRUST_ANCHOR_CONFIG.subordinateEntities
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'internal_error',
    error_description: 'An internal error occurred'
  });
});

// Initialize and start server
async function startServer() {
  try {
    await initializeKeyPair();
    
    app.listen(PORT, () => {
      console.log(`\n========================================`);
      console.log(`OpenID Federation Trust Anchor`);
      console.log(`========================================`);
      console.log(`Running on: http://localhost:${PORT}`);
      console.log(`Entity ID: ${TRUST_ANCHOR_CONFIG.entityId}`);
      console.log(`Organization: ${TRUST_ANCHOR_CONFIG.organizationName}`);
      console.log(`\nEndpoints:`);
      console.log(`- Entity Configuration: http://localhost:${PORT}/.well-known/openid-federation`);
      console.log(`- Federation Fetch: http://localhost:${PORT}/federation/fetch`);
      console.log(`- Federation List: http://localhost:${PORT}/federation/list`);
      console.log(`- Federation Resolve: http://localhost:${PORT}/federation/resolve`);
      console.log(`- Health Check: http://localhost:${PORT}/health`);
      console.log(`\nSubordinate Entities:`);
      TRUST_ANCHOR_CONFIG.subordinateEntities.forEach(entity => {
        console.log(`- ${entity}`);
      });
      console.log(`========================================\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
