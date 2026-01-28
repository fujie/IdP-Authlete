require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const crypto = require('crypto');
const { SignJWT, generateKeyPair, importJWK, exportJWK } = require('jose');

const app = express();
const PORT = process.env.PORT || 3007;

// Federation Configuration
const FEDERATION_CONFIG = {
  entityId: process.env.ENTITY_ID || 'https://localhost:3007',
  authorizationServer: process.env.AUTHORIZATION_SERVER || 'http://localhost:3001',
  redirectUri: process.env.REDIRECT_URI || 'http://localhost:3007/callback',
  scope: process.env.SCOPE || 'openid profile email',
  trustAnchorId: process.env.TRUST_ANCHOR_ID || 'https://trust-anchor.example.com',
  federationRegistrationEndpoint: process.env.FEDERATION_REGISTRATION_ENDPOINT || 'http://localhost:3001/federation/registration',
  clientName: process.env.CLIENT_NAME || 'Invalid OpenID Federation Test Client',
  clientUri: process.env.CLIENT_URI || 'https://localhost:3007',
  contacts: [process.env.CONTACTS || 'admin@localhost:3007']
};

// Key pair storage (in production, these would be persisted securely)
let keyPair = null;
let publicJWK = null;
let privateKey = null;

// Dynamic client registration state
let registeredClientId = null;
let registeredClientSecret = null;
let registrationError = null;

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
  secret: 'federation-test-client-invalid-session-secret',
  resave: false,
  saveUninitialized: false,
  name: 'federation.invalid.client.sid',
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
    // Reference the Trust Anchor (but this client is NOT registered there)
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

  const payload = {
    iss: FEDERATION_CONFIG.entityId,
    aud: FEDERATION_CONFIG.authorizationServer,
    iat: now,
    exp: expiration,
    response_type: 'code',
    client_id: FEDERATION_CONFIG.entityId,
    redirect_uri: FEDERATION_CONFIG.redirectUri,
    scope: FEDERATION_CONFIG.scope,
    state: state,
    nonce: nonce
  };

  // Sign the request object
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: publicJWK.kid })
    .sign(privateKey);

  return jwt;
}

// Perform dynamic client registration
async function performDynamicRegistration() {
  if (registeredClientId) {
    console.log('Client already registered with ID:', registeredClientId);
    return { clientId: registeredClientId, clientSecret: registeredClientSecret };
  }

  try {
    console.log('Performing dynamic client registration...');
    console.log('⚠️  WARNING: This client uses an entity ID NOT registered in the trust anchor');
    console.log('Expected result: Registration should FAIL');
    
    // Create entity configuration
    const entityConfiguration = await createEntityConfiguration();
    
    // Prepare registration request
    const registrationRequest = {
      entity_configuration: entityConfiguration
    };

    console.log('Sending registration request to:', FEDERATION_CONFIG.federationRegistrationEndpoint);
    console.log('Request payload:', JSON.stringify(registrationRequest, null, 2));

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

    console.log('⚠️  UNEXPECTED: Registration response received:', response.data);
    console.log('⚠️  This should have failed since the entity ID is not in the trust anchor');

    // Store registered client credentials (this shouldn't happen for invalid client)
    registeredClientId = response.data.client_id;
    registeredClientSecret = response.data.client_secret;

    console.log('⚠️  UNEXPECTED: Dynamic registration succeeded when it should have failed!');
    console.log('Client ID:', registeredClientId);
    console.log('Client Secret:', registeredClientSecret ? '[SET]' : '[NOT SET]');

    return { clientId: registeredClientId, clientSecret: registeredClientSecret };

  } catch (error) {
    console.log('✅ EXPECTED: Dynamic registration failed as expected');
    console.log('Error details:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    });
    
    // Store the registration error for display
    registrationError = {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    };
    
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
    registeredClientId: registeredClientId,
    registrationError: registrationError,
    entityId: FEDERATION_CONFIG.entityId,
    isValid: false
  });
});

// Start OpenID Federation Authorization Code Flow with Dynamic Registration
app.get('/federation-login', async (req, res) => {
  try {
    // Clear any existing OAuth state
    delete req.session.oauthState;
    delete req.session.accessToken;
    delete req.session.refreshToken;
    delete req.session.user;
    
    // Attempt dynamic registration first (this should fail)
    const registration = await performDynamicRegistration();
    
    // If we get here, registration unexpectedly succeeded
    console.log('⚠️  WARNING: Registration succeeded when it should have failed');
    
    // Generate state and nonce parameters
    const state = uuidv4();
    const nonce = uuidv4();
    
    // Store state in both session and memory store
    req.session.oauthState = state;
    oauthStates.set(state, {
      timestamp: Date.now(),
      sessionId: req.sessionID
    });

    console.log('Starting OpenID Federation flow with unexpected successful registration');
    console.log('State:', state);
    console.log('Registered Client ID:', registration.clientId);

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

        console.log('Redirecting to federation authorization server:', authUrl.toString());
        res.redirect(authUrl.toString());

      } catch (requestError) {
        console.error('Failed to create request object:', requestError);
        res.status(500).send('Failed to create federation request');
      }
    });

  } catch (error) {
    console.log('✅ EXPECTED: Federation login failed due to registration failure');
    res.render('error', {
      error: 'registration_failed',
      error_description: error.response?.data?.error_description || 'Dynamic registration failed as expected for invalid client',
      isExpected: true
    });
  }
});

// OpenID Connect Callback endpoint
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
      error_description: error_description || 'Authorization failed',
      isExpected: true
    });
  }

  // Verify state parameter
  const sessionStateValid = state && state === req.session.oauthState;
  const memoryStateValid = state && oauthStates.has(state);
  
  if (!state || (!sessionStateValid && !memoryStateValid)) {
    console.error('Invalid state parameter');
    return res.render('error', {
      error: 'invalid_state',
      error_description: 'Invalid state parameter - possible CSRF attack',
      isExpected: false
    });
  }

  // Clean up state
  if (memoryStateValid) {
    oauthStates.delete(state);
  }
  delete req.session.oauthState;

  if (!code) {
    return res.render('error', {
      error: 'missing_code',
      error_description: 'Authorization code not received',
      isExpected: false
    });
  }

  try {
    // Exchange authorization code for access token using registered client credentials
    console.log('⚠️  WARNING: Attempting token exchange for invalid client');
    
    if (!registeredClientId || !registeredClientSecret) {
      throw new Error('Client not registered - missing credentials');
    }
    
    const tokenResponse = await axios.post(
      `${FEDERATION_CONFIG.authorizationServer}/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: FEDERATION_CONFIG.redirectUri,
        client_id: registeredClientId,
        client_secret: registeredClientSecret
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const tokenData = tokenResponse.data;
    console.log('⚠️  WARNING: Token response received for invalid client');

    // Store tokens in session
    req.session.accessToken = tokenData.access_token;
    req.session.refreshToken = tokenData.refresh_token;
    req.session.idToken = tokenData.id_token;
    req.session.tokenType = tokenData.token_type || 'Bearer';
    req.session.expiresIn = tokenData.expires_in;

    // Store user info
    req.session.user = {
      id: 'federation-test-user-invalid',
      name: 'Federation Test User (Invalid - Should Not Work)',
      authenticated: true
    };

    console.log('⚠️  WARNING: Successfully obtained access token for invalid client');
    res.redirect('/');

  } catch (error) {
    console.log('✅ EXPECTED: Token exchange failed for invalid client');
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
      error_description: errorDescription,
      isExpected: true
    });
  }
});

// Test dynamic registration endpoint
app.get('/test-registration', async (req, res) => {
  try {
    const registration = await performDynamicRegistration();
    res.json({
      success: true,
      clientId: registration.clientId,
      clientSecret: registration.clientSecret ? '[SET]' : '[NOT SET]',
      entityId: FEDERATION_CONFIG.entityId,
      message: '⚠️  WARNING: Dynamic registration succeeded when it should have failed',
      warning: 'This client should not be able to register successfully'
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      details: error.response?.data,
      entityId: FEDERATION_CONFIG.entityId,
      message: '✅ EXPECTED: Dynamic registration failed as expected',
      explanation: 'This client entity ID is not registered in the trust anchor'
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
    console.log('Note: This entity ID is NOT registered in the trust anchor');
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
    service: 'openid-federation-test-client-invalid',
    entityId: FEDERATION_CONFIG.entityId,
    port: PORT,
    registered: !!registeredClientId,
    expectedBehavior: 'Registration should fail - entity ID not in trust anchor'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).render('error', {
    error: 'internal_error',
    error_description: 'An internal error occurred',
    isExpected: false
  });
});

// Initialize and start server
async function startServer() {
  try {
    await initializeKeyPair();
    
    app.listen(PORT, () => {
      console.log(`OpenID Federation Test Client (Invalid) running on http://localhost:${PORT}`);
      console.log('Configuration:');
      console.log(`- Entity ID: ${FEDERATION_CONFIG.entityId}`);
      console.log(`- Authorization Server: ${FEDERATION_CONFIG.authorizationServer}`);
      console.log(`- Redirect URI: ${FEDERATION_CONFIG.redirectUri}`);
      console.log(`- Trust Anchor: ${FEDERATION_CONFIG.trustAnchorId}`);
      console.log(`- Federation Registration Endpoint: ${FEDERATION_CONFIG.federationRegistrationEndpoint}`);
      console.log('- Key Pair: Generated');
      console.log('- Status: Ready for dynamic registration (should fail)');
      console.log('');
      console.log('⚠️  IMPORTANT: This client uses an entity ID NOT registered in the trust anchor');
      console.log('Expected behavior: Dynamic registration should FAIL');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();