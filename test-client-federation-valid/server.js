require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SignJWT, generateKeyPair, importJWK, exportJWK } = require('jose');
const { OPTrustChainValidator } = require('./lib/opTrustChainValidator');

const app = express();
const PORT = process.env.PORT || 3006;

// Persistent storage file for client credentials
const CREDENTIALS_FILE = path.join(__dirname, '.client-credentials.json');

// Federation Configuration
const FEDERATION_CONFIG = {
  entityId: process.env.ENTITY_ID || 'https://localhost:3006',
  authorizationServer: process.env.AUTHORIZATION_SERVER || 'http://localhost:3001',
  redirectUri: process.env.REDIRECT_URI || 'http://localhost:3006/callback',
  scope: process.env.SCOPE || 'openid profile email',
  trustAnchorId: process.env.TRUST_ANCHOR_ID || 'https://trust-anchor.example.com',
  federationRegistrationEndpoint: process.env.FEDERATION_REGISTRATION_ENDPOINT || 'http://localhost:3001/federation/registration',
  clientName: process.env.CLIENT_NAME || 'Valid OpenID Federation Test Client',
  clientUri: process.env.CLIENT_URI || 'https://localhost:3006',
  contacts: [process.env.CONTACTS || 'admin@localhost:3006']
};

// Key pair storage (in production, these would be persisted securely)
let keyPair = null;
let publicJWK = null;
let privateKey = null;

// Dynamic client registration state
// Note: entity_idを常にclient_idとして使用するため、registeredClientIdは不要
let registeredClientSecret = null;

// OP Trust Chain Validator instance
let opValidator = null;

// Load persisted credentials if available
function loadPersistedCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const data = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
      const credentials = JSON.parse(data);
      
      // Verify the credentials are for the current entity ID
      if (credentials.entityId === FEDERATION_CONFIG.entityId) {
        registeredClientSecret = credentials.clientSecret;
        console.log('✓ Loaded persisted client credentials');
        console.log('  Entity ID (client_id):', credentials.entityId);
        return true;
      } else {
        console.log('⚠️  Persisted credentials are for different entity ID, ignoring');
        return false;
      }
    }
  } catch (error) {
    console.error('Failed to load persisted credentials:', error.message);
  }
  return false;
}

// Save credentials to persistent storage
function saveCredentials(clientSecret) {
  try {
    const credentials = {
      entityId: FEDERATION_CONFIG.entityId,
      clientSecret: clientSecret,
      registeredAt: new Date().toISOString()
    };
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
    console.log('✓ Saved client credentials to persistent storage');
  } catch (error) {
    console.error('Failed to save credentials:', error.message);
  }
}

// Clear persisted credentials
function clearPersistedCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
      console.log('✓ Cleared persisted credentials');
    }
    registeredClientSecret = null;
  } catch (error) {
    console.error('Failed to clear credentials:', error.message);
  }
}

// In-memory store for OAuth states
const oauthStates = new Map();

// Initialize key pair on startup
async function initializeKeyPair() {
  try {
    console.log('Generating RSA key pair for federation client...');
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

// Clean up old states every 10 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  
  for (const [state, data] of oauthStates.entries()) {
    if (now - data.timestamp > maxAge) {
      oauthStates.delete(state);
    }
  }
}, 10 * 60 * 1000);

// Session configuration
app.use(session({
  secret: 'federation-test-client-valid-session-secret',
  resave: false,
  saveUninitialized: false,
  name: 'federation.valid.client.sid',
  cookie: { 
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/**
 * OP Validation Middleware
 * 
 * Validates that the OP is registered in the Trust Anchor before allowing authentication.
 * Implements Requirements: 2.1, 2.2, 2.3, 3.1, 3.3
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
async function validateOPMiddleware(req, res, next) {
  const opEntityId = FEDERATION_CONFIG.authorizationServer;
  
  console.log('Validating OP trust chain', {
    opEntityId,
    sessionId: req.sessionID,
    userAgent: req.get('user-agent')
  });

  try {
    // Validate OP trust chain
    const result = await opValidator.validateOP(opEntityId, {
      sessionId: req.sessionID,
      userAgent: req.get('user-agent')
    });

    if (!result.isValid) {
      // Return 403 error if validation fails (Requirement 3.3)
      console.error('OP trust chain validation failed, rejecting authentication', {
        opEntityId,
        errors: result.errors
      });

      return res.status(403).render('error', {
        error: 'untrusted_op',
        error_description: `OP ${opEntityId} is not registered in Trust Anchor`,
        opEntityId: opEntityId,
        errors: result.errors || []
      });
    }

    // Set flag indicating OP was validated (Requirement 2.2)
    req.opValidated = true;
    req.session.opValidated = true;
    req.session.opEntityId = opEntityId;
    req.session.opValidatedAt = Date.now();

    console.log('OP trust chain validation succeeded', {
      opEntityId,
      trustAnchor: result.trustAnchor,
      cached: result.cached
    });

    next();
  } catch (error) {
    console.error('OP validation middleware error', {
      opEntityId,
      error: error.message,
      stack: error.stack
    });

    return res.status(500).render('error', {
      error: 'validation_error',
      error_description: 'Failed to validate OP trust chain',
      opEntityId: opEntityId,
      errors: [{
        code: 'validation_error',
        message: error.message
      }]
    });
  }
}

// Create entity configuration JWT
async function createEntityConfiguration() {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + (24 * 60 * 60); // 24 hours

  const payload = {
    iss: FEDERATION_CONFIG.entityId,
    sub: FEDERATION_CONFIG.entityId,
    iat: now,
    exp: expiration,
    jwks: {
      keys: [publicJWK]
    },
    metadata: {
      openid_relying_party: {
        client_name: FEDERATION_CONFIG.clientName,
        client_uri: FEDERATION_CONFIG.clientUri,
        redirect_uris: [FEDERATION_CONFIG.redirectUri],
        response_types: ['code'],
        grant_types: ['authorization_code'],
        scope: FEDERATION_CONFIG.scope,
        contacts: FEDERATION_CONFIG.contacts,
        application_type: 'web',
        token_endpoint_auth_method: 'client_secret_basic',
        id_token_signed_response_alg: 'RS256',
        token_endpoint_auth_signing_alg: 'RS256',
        userinfo_signed_response_alg: 'RS256',
        client_registration_types: ['explicit']
      },
      federation_entity: {
        organization_name: FEDERATION_CONFIG.clientName,
        homepage_uri: FEDERATION_CONFIG.clientUri,
        contacts: FEDERATION_CONFIG.contacts
      }
    },
    // Reference the independent Trust Anchor
    authority_hints: [FEDERATION_CONFIG.trustAnchorId]
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

// Create federation request object
async function createFederationRequestObject(state, nonce) {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 300; // 5 minutes

  // OpenID Federation: 常にEntity IDをclient_idとして使用
  const clientId = FEDERATION_CONFIG.entityId;

  const payload = {
    iss: FEDERATION_CONFIG.entityId,
    aud: FEDERATION_CONFIG.authorizationServer,
    iat: now,
    exp: expiration,
    response_type: 'code',
    client_id: clientId, // 常にEntity ID
    redirect_uri: FEDERATION_CONFIG.redirectUri,
    scope: FEDERATION_CONFIG.scope,
    state: state,
    nonce: nonce
  };

  console.log('Creating request object with entity_id as client_id:', clientId);

  // Sign the request object
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: publicJWK.kid })
    .sign(privateKey);

  return jwt;
}

// Perform dynamic client registration
async function performDynamicRegistration() {
  // Check if already registered in this session
  if (registeredClientSecret) {
    console.log('Client already registered with entity_id:', FEDERATION_CONFIG.entityId);
    return { entityId: FEDERATION_CONFIG.entityId, clientSecret: registeredClientSecret };
  }

  try {
    console.log('Performing dynamic client registration...');
    console.log('Entity ID (client_id):', FEDERATION_CONFIG.entityId);
    
    // Create entity configuration
    const entityConfiguration = await createEntityConfiguration();
    
    // Prepare registration request
    const registrationRequest = {
      entity_configuration: entityConfiguration
    };

    console.log('Sending registration request to:', FEDERATION_CONFIG.federationRegistrationEndpoint);

    // Send registration request
    const response = await axios.post(
      FEDERATION_CONFIG.federationRegistrationEndpoint,
      registrationRequest,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Registration response:', response.data);

    // Check if client is already registered
    if (response.data.already_registered) {
      console.log('⚠️  Client already registered');
      
      // Try to load persisted credentials
      if (loadPersistedCredentials()) {
        console.log('✓ Using persisted credentials');
        console.log('Entity ID (client_id):', FEDERATION_CONFIG.entityId);
        console.log('Client Secret:', registeredClientSecret ? '[SET]' : '[NOT SET]');
        return { entityId: FEDERATION_CONFIG.entityId, clientSecret: registeredClientSecret };
      }
      
      // If no persisted credentials, this means the client was registered in Authlete
      // but the local credentials were cleared. We cannot proceed without the client_secret.
      console.log('⚠️  Client is registered in Authlete but local credentials are missing');
      console.log('⚠️  Please delete the client from Authlete dashboard or contact administrator');
      
      // Return a special error that indicates this situation
      throw new Error(
        'CREDENTIALS_MISSING: Client is registered in Authlete but local credentials are not available. ' +
        'Please delete the client from Authlete dashboard (Entity ID: ' + FEDERATION_CONFIG.entityId + ') ' +
        'or restore the credentials file.'
      );
    }

    // Store registered client secret (entity_idは常に同じなので保存不要)
    registeredClientSecret = response.data.client_secret;

    // Save credentials to persistent storage
    saveCredentials(registeredClientSecret);

    console.log('Dynamic registration successful!');
    console.log('Entity ID (client_id):', FEDERATION_CONFIG.entityId);
    console.log('Client Secret:', registeredClientSecret ? '[SET]' : '[NOT SET]');

    return { entityId: FEDERATION_CONFIG.entityId, clientSecret: registeredClientSecret };

  } catch (error) {
    // Check if this is a duplicate registration error (Entity ID already exists)
    if (error.response?.status === 500 && 
        error.response?.data?.error_description?.includes('already in use')) {
      console.log('⚠️  Entity ID already registered (duplicate registration detected)');
      console.log('This is expected behavior - the client was registered in a previous session');
      
      // Try to load persisted credentials
      if (loadPersistedCredentials()) {
        console.log('✓ Using persisted credentials');
        return { entityId: FEDERATION_CONFIG.entityId, clientSecret: registeredClientSecret };
      }
      
      // If no persisted credentials, provide helpful error
      throw new Error(
        'Client already registered but credentials not available. ' +
        'Please use the /clear-registration endpoint to reset, or delete the client from Authlete.'
      );
    }
    
    console.error('Dynamic registration failed:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    });
    throw error;
  }
}

// Home page
app.get('/', (req, res) => {
  res.render('index', {
    user: req.session.user,
    accessToken: req.session.accessToken,
    idToken: req.session.idToken,
    config: FEDERATION_CONFIG,
    registeredClientId: registeredClientSecret ? FEDERATION_CONFIG.entityId : null, // entity_idをclient_idとして使用、ただしclient_secretがある場合のみ
    entityId: FEDERATION_CONFIG.entityId,
    isValid: true,
    hasClientSecret: !!registeredClientSecret
  });
});

// Start OpenID Federation Authorization Code Flow with Dynamic Registration
// Implements Requirements: 2.1, 10.1
app.get('/federation-login', validateOPMiddleware, async (req, res) => {
  try {
    // Clear any existing OAuth state
    delete req.session.oauthState;
    delete req.session.accessToken;
    delete req.session.refreshToken;
    delete req.session.user;
    
    // Perform dynamic registration first
    const registration = await performDynamicRegistration();
    
    console.log('=== Federation Login Flow ===');
    console.log('Entity ID (client_id):', registration.entityId);
    console.log('Has Client Secret:', !!registration.clientSecret);
    
    // Generate state and nonce parameters
    const state = uuidv4();
    const nonce = uuidv4();
    
    // Store state in both session and memory store
    req.session.oauthState = state;
    oauthStates.set(state, {
      timestamp: Date.now(),
      sessionId: req.sessionID
    });

    console.log('Starting OpenID Federation flow with dynamic registration');
    console.log('State:', state);
    console.log('Nonce:', nonce);

    // Save session explicitly
    req.session.save(async (err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).send('Session error');
      }

      try {
        // Create federation request object
        const requestObject = await createFederationRequestObject(state, nonce);

        // Build authorization URL with request object
        const authUrl = new URL(`${FEDERATION_CONFIG.authorizationServer}/authorize`);
        authUrl.searchParams.append('request', requestObject);

        console.log('Redirecting to federation authorization server');
        console.log('Authorization URL:', authUrl.toString().substring(0, 100) + '...');
        res.redirect(authUrl.toString());

      } catch (requestError) {
        console.error('Failed to create request object:', requestError);
        res.status(500).send('Failed to create federation request');
      }
    });

  } catch (error) {
    console.error('Federation login failed:', error);
    res.render('error', {
      error: 'registration_failed',
      error_description: error.response?.data?.error_description || error.message || 'Dynamic registration failed'
    });
  }
});

// OpenID Connect Callback endpoint
// Implements Requirement: 10.2
app.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  console.log('Callback received:', {
    code: code ? 'present' : 'missing',
    state: state,
    error: error,
    sessionID: req.sessionID
  });

  // Handle authorization errors
  if (error) {
    console.error('Authorization error:', error, error_description);
    return res.render('error', {
      error: error,
      error_description: error_description || 'Authorization failed'
    });
  }

  // Verify state parameter
  const sessionStateValid = state && state === req.session.oauthState;
  const memoryStateValid = state && oauthStates.has(state);
  
  if (!state || (!sessionStateValid && !memoryStateValid)) {
    console.error('Invalid state parameter');
    return res.render('error', {
      error: 'invalid_state',
      error_description: 'Invalid state parameter - possible CSRF attack'
    });
  }

  // Verify OP was previously validated (Requirement 10.2)
  const opEntityId = FEDERATION_CONFIG.authorizationServer;
  const wasValidatedInSession = req.session.opValidated && req.session.opEntityId === opEntityId;
  const isValidatedInCache = opValidator.isOPValidated(opEntityId);

  if (!wasValidatedInSession && !isValidatedInCache) {
    console.error('OP was not previously validated', {
      opEntityId,
      sessionValidated: wasValidatedInSession,
      cacheValidated: isValidatedInCache
    });

    return res.status(403).render('error', {
      error: 'op_not_validated',
      error_description: `OP ${opEntityId} was not validated before callback`,
      opEntityId: opEntityId,
      errors: [{
        code: 'op_not_validated',
        message: 'OP must be validated before processing authentication callback'
      }]
    });
  }

  console.log('OP validation check passed for callback', {
    opEntityId,
    sessionValidated: wasValidatedInSession,
    cacheValidated: isValidatedInCache
  });

  // Clean up state
  if (memoryStateValid) {
    oauthStates.delete(state);
  }
  delete req.session.oauthState;

  if (!code) {
    return res.render('error', {
      error: 'missing_code',
      error_description: 'Authorization code not received'
    });
  }

  try {
    // Verify OP is validated before accepting tokens (Requirement 10.3)
    if (!isValidatedInCache && !wasValidatedInSession) {
      console.error('OP not validated before token exchange', {
        opEntityId,
        sessionValidated: wasValidatedInSession,
        cacheValidated: isValidatedInCache
      });

      return res.status(403).render('error', {
        error: 'op_not_validated',
        error_description: `Cannot accept tokens from unvalidated OP ${opEntityId}`,
        opEntityId: opEntityId,
        errors: [{
          code: 'op_not_validated',
          message: 'OP must be validated before token exchange'
        }]
      });
    }

    console.log('OP validation check passed for token exchange', {
      opEntityId,
      sessionValidated: wasValidatedInSession,
      cacheValidated: isValidatedInCache
    });

    // Exchange authorization code for access token using entity_id as client_id
    console.log('Exchanging authorization code for access token...');
    console.log('Using entity_id as client_id:', FEDERATION_CONFIG.entityId);
    
    if (!registeredClientSecret) {
      throw new Error('Client not registered - missing client secret');
    }
    
    const tokenResponse = await axios.post(
      `${FEDERATION_CONFIG.authorizationServer}/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: FEDERATION_CONFIG.redirectUri,
        client_id: FEDERATION_CONFIG.entityId, // entity_idをclient_idとして使用
        client_secret: registeredClientSecret
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const tokenData = tokenResponse.data;
    console.log('Token response received');

    // Store tokens in session
    req.session.accessToken = tokenData.access_token;
    req.session.refreshToken = tokenData.refresh_token;
    req.session.idToken = tokenData.id_token;
    req.session.tokenType = tokenData.token_type || 'Bearer';
    req.session.expiresIn = tokenData.expires_in;

    // Store user info
    req.session.user = {
      id: 'federation-test-user-valid',
      name: 'Federation Test User (Valid)',
      authenticated: true
    };

    console.log('Successfully obtained access token via federation');
    res.redirect('/');

  } catch (error) {
    console.error('Token exchange error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    });
    
    const errorDescription = error.response?.data?.error_description || 
                           error.response?.data?.error || 
                           'Failed to exchange authorization code for access token';
    
    res.render('error', {
      error: 'token_exchange_failed',
      error_description: errorDescription
    });
  }
});

// Test dynamic registration endpoint
app.get('/test-registration', async (req, res) => {
  try {
    const registration = await performDynamicRegistration();
    res.json({
      success: true,
      clientId: registration.entityId, // entity_idをclient_idとして使用
      clientSecret: registration.clientSecret ? '[SET]' : '[NOT SET]',
      entityId: FEDERATION_CONFIG.entityId,
      message: 'Dynamic registration successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
});

// Entity Configuration endpoint for OpenID Federation
app.get('/.well-known/openid-federation', async (req, res) => {
  try {
    const entityConfiguration = await createEntityConfiguration();
    
    res.setHeader('Content-Type', 'application/entity-statement+jwt');
    res.send(entityConfiguration);

    console.log('Entity Configuration served for:', FEDERATION_CONFIG.entityId);
  } catch (error) {
    console.error('Failed to create entity configuration:', error);
    res.status(500).json({ error: 'Failed to create entity configuration' });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }
    res.redirect('/');
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'openid-federation-test-client-valid',
    entityId: FEDERATION_CONFIG.entityId,
    port: PORT,
    registered: !!registeredClientSecret
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).render('error', {
    error: 'internal_error',
    error_description: 'An internal error occurred'
  });
});

// Clear registration endpoint (for testing/debugging)
app.get('/clear-registration', (req, res) => {
  clearPersistedCredentials();
  
  res.json({
    success: true,
    message: 'Client registration cleared. You can now register again.'
  });
});

// Clear OP validation cache endpoint (for testing/debugging)
app.get('/clear-cache', (req, res) => {
  if (opValidator) {
    opValidator.clearCache();
    console.log('OP validation cache cleared via API');
    
    res.json({
      success: true,
      message: 'OP validation cache cleared successfully.'
    });
  } else {
    res.status(500).json({
      success: false,
      message: 'OP validator not initialized.'
    });
  }
});

/**
 * Validate Trust Anchor URL configuration
 * Implements Requirements: 9.1, 9.2, 9.3
 * 
 * @param {string} url - Trust Anchor URL to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function validateTrustAnchorUrl(url) {
  if (!url) {
    console.error('FATAL: TRUST_ANCHOR_URL is not configured');
    console.error('Configuration Error Details:');
    console.error('  - Environment variable TRUST_ANCHOR_URL is missing or empty');
    console.error('  - This variable is required for OP trust chain validation');
    console.error('  - Please set TRUST_ANCHOR_URL to a valid HTTPS URL');
    console.error('  - Example: TRUST_ANCHOR_URL=https://trust-anchor.example.com');
    return false;
  }

  // Validate URL format (must be HTTPS)
  try {
    const parsedUrl = new URL(url);
    
    if (parsedUrl.protocol !== 'https:') {
      console.error('FATAL: TRUST_ANCHOR_URL must use HTTPS protocol');
      console.error('Configuration Error Details:');
      console.error(`  - Provided URL: ${url}`);
      console.error(`  - Protocol: ${parsedUrl.protocol}`);
      console.error('  - Required protocol: https:');
      console.error('  - Security requirement: Trust Anchor URLs must use HTTPS for secure communication');
      console.error('  - Please update TRUST_ANCHOR_URL to use HTTPS');
      return false;
    }

    console.log('✓ Trust Anchor URL validation passed');
    console.log(`  - URL: ${url}`);
    console.log(`  - Protocol: ${parsedUrl.protocol}`);
    console.log(`  - Host: ${parsedUrl.host}`);
    
    return true;
  } catch (error) {
    console.error('FATAL: TRUST_ANCHOR_URL has invalid URL format');
    console.error('Configuration Error Details:');
    console.error(`  - Provided value: ${url}`);
    console.error(`  - Parse error: ${error.message}`);
    console.error('  - A valid URL must include protocol, host, and optionally port and path');
    console.error('  - Example: TRUST_ANCHOR_URL=https://trust-anchor.example.com');
    return false;
  }
}

// Initialize and start server
async function startServer() {
  try {
    await initializeKeyPair();
    
    // Read Trust Anchor URL from environment variables
    // Implements Requirements: 9.1, 9.2, 9.3
    const trustAnchorUrl = process.env.TRUST_ANCHOR_URL;
    
    // Validate Trust Anchor URL configuration
    if (!validateTrustAnchorUrl(trustAnchorUrl)) {
      console.error('');
      console.error('Server startup failed due to configuration error');
      console.error('Please fix the TRUST_ANCHOR_URL configuration and restart the server');
      process.exit(1);
    }

    // Initialize OP Trust Chain Validator
    // Implements Requirements: 9.1, 9.4
    console.log('Initializing OP Trust Chain Validator...');
    
    try {
      opValidator = new OPTrustChainValidator({
        trustAnchorUrl: trustAnchorUrl,
        cacheExpirationMs: 3600000 // 1 hour
      });
      console.log('✓ OP Trust Chain Validator initialized successfully');
    } catch (validatorError) {
      console.error('FATAL: Failed to initialize OP Trust Chain Validator');
      console.error('Initialization Error Details:');
      console.error(`  - Error: ${validatorError.message}`);
      console.error(`  - Trust Anchor URL: ${trustAnchorUrl}`);
      console.error('  - This error prevents OP trust chain validation from functioning');
      console.error('  - Please check the Trust Anchor URL and validator configuration');
      throw validatorError;
    }
    
    // Load persisted credentials if available
    loadPersistedCredentials();
    
    app.listen(PORT, () => {
      console.log(`OpenID Federation Test Client (Valid) running on http://localhost:${PORT}`);
      console.log('Configuration:');
      console.log(`- Entity ID: ${FEDERATION_CONFIG.entityId}`);
      console.log(`- Authorization Server: ${FEDERATION_CONFIG.authorizationServer}`);
      console.log(`- Redirect URI: ${FEDERATION_CONFIG.redirectUri}`);
      console.log(`- Trust Anchor: ${trustAnchorUrl}`);
      console.log(`- Federation Registration Endpoint: ${FEDERATION_CONFIG.federationRegistrationEndpoint}`);
      console.log('- Key Pair: Generated');
      console.log(`- Client Registration: ${registeredClientSecret ? 'Loaded from storage' : 'Not registered'}`);
      console.log('- OP Validation: Enabled');
      console.log('- Status: Ready');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();