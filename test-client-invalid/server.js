require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;

// OpenID Connect Configuration from environment variables
const OAUTH_CONFIG = {
  clientId: process.env.CLIENT_ID || 'unregistered_client_invalid',
  clientSecret: process.env.CLIENT_SECRET || '', // Empty for dynamic registration
  authorizationServer: process.env.AUTHORIZATION_SERVER || 'http://localhost:3001',
  redirectUri: process.env.REDIRECT_URI || 'http://localhost:3007/callback',
  scope: process.env.SCOPE || 'openid profile email',
  entityId: process.env.ENTITY_ID || 'https://localhost:3007',
  clientName: process.env.CLIENT_NAME || 'Federation Test Client (Invalid Trust Chain)',
  useDynamicRegistration: process.env.USE_DYNAMIC_REGISTRATION === 'true'
};

// In-memory store for OAuth states (temporary solution)
const oauthStates = new Map();

// Clean up old states every 10 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  
  for (const [state, data] of oauthStates.entries()) {
    if (now - data.timestamp > maxAge) {
      oauthStates.delete(state);
    }
  }
  
  console.log('Cleaned up old OpenID Connect states. Current count:', oauthStates.size);
}, 10 * 60 * 1000);

// Session configuration
app.use(session({
  secret: 'test-client-session-secret-very-long-and-secure',
  resave: false,
  saveUninitialized: false,
  name: 'oauth.test.client.sid', // Custom session name
  cookie: { 
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax' // Important for OAuth redirects
  }
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Home page
app.get('/', (req, res) => {
  res.render('index', {
    user: req.session.user,
    accessToken: req.session.accessToken,
    idToken: req.session.idToken,
    config: OAUTH_CONFIG
  });
});

// Start OpenID Connect Authorization Code Flow
app.get('/login', (req, res) => {
  // Clear any existing OAuth state
  delete req.session.oauthState;
  delete req.session.accessToken;
  delete req.session.refreshToken;
  delete req.session.user;
  
  // Generate state parameter for CSRF protection
  const state = uuidv4();
  
  // Store state in both session and memory store
  req.session.oauthState = state;
  oauthStates.set(state, {
    timestamp: Date.now(),
    sessionId: req.sessionID
  });

  console.log('Starting OpenID Connect flow with state:', state);
  console.log('Session ID:', req.sessionID);
  console.log('States in memory:', oauthStates.size);

  // Save session explicitly
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).send('Session error');
    }

    // Build authorization URL
    const authUrl = new URL(`${OAUTH_CONFIG.authorizationServer}/authorize`);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', OAUTH_CONFIG.clientId);
    authUrl.searchParams.append('redirect_uri', OAUTH_CONFIG.redirectUri);
    authUrl.searchParams.append('scope', OAUTH_CONFIG.scope);
    authUrl.searchParams.append('state', state);

    console.log('Redirecting to authorization server:', authUrl.toString());
    res.redirect(authUrl.toString());
  });
});

// Start OpenID Federation Authorization Code Flow
app.get('/federation-login', (req, res) => {
  // Clear any existing OAuth state
  delete req.session.oauthState;
  delete req.session.accessToken;
  delete req.session.refreshToken;
  delete req.session.user;
  
  // Generate state parameter for CSRF protection
  const state = uuidv4();
  
  // Store state in both session and memory store
  req.session.oauthState = state;
  oauthStates.set(state, {
    timestamp: Date.now(),
    sessionId: req.sessionID
  });

  console.log('Starting OpenID Federation flow with state:', state);
  console.log('Session ID:', req.sessionID);
  console.log('States in memory:', oauthStates.size);

  // Save session explicitly
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).send('Session error');
    }

    // Create Request Object for Federation flow
    const requestObject = createFederationRequestObject(state);

    // Build authorization URL with Request Object
    const authUrl = new URL(`${OAUTH_CONFIG.authorizationServer}/authorize`);
    authUrl.searchParams.append('request', requestObject);

    console.log('Redirecting to Federation authorization server:', authUrl.toString());
    res.redirect(authUrl.toString());
  });
});

// Create Request Object for Federation flow (simplified for testing)
function createFederationRequestObject(state) {
  // In a real implementation, this would be a signed JWT
  // For testing purposes, we'll create a mock JWT structure
  const entityId = OAUTH_CONFIG.entityId; // Use configured entity ID
  const requestObjectPayload = {
    iss: entityId, // Client entity ID
    aud: OAUTH_CONFIG.authorizationServer,
    response_type: 'code',
    client_id: entityId, // Use entity ID as client_id for Federation
    redirect_uri: OAUTH_CONFIG.redirectUri,
    scope: OAUTH_CONFIG.scope,
    state: state,
    nonce: uuidv4(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300, // 5 minutes expiration
    client_metadata: {
      client_name: OAUTH_CONFIG.clientName,
      client_uri: entityId,
      redirect_uris: [OAUTH_CONFIG.redirectUri],
      response_types: ['code'],
      grant_types: ['authorization_code'],
      scope: OAUTH_CONFIG.scope,
      contacts: ['admin@example.com']
    }
  };

  // Create a mock JWT structure (header.payload.signature)
  const header = base64urlEncode(JSON.stringify({ typ: 'JWT', alg: 'none' }));
  const payload = base64urlEncode(JSON.stringify(requestObjectPayload));
  const signature = 'mock-signature-for-testing';
  
  return `${header}.${payload}.${signature}`;
}

// Helper function for base64url encoding
function base64urlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// OpenID Connect Callback endpoint
app.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  console.log('Callback received:', {
    code: code ? 'present' : 'missing',
    state: state,
    error: error,
    sessionID: req.sessionID,
    sessionKeys: Object.keys(req.session || {}),
    sessionState: req.session?.oauthState,
    memoryStoreHasState: oauthStates.has(state)
  });

  // Handle authorization errors
  if (error) {
    console.error('Authorization error:', error, error_description);
    return res.render('error', {
      error: error,
      error_description: error_description || 'Authorization failed'
    });
  }

  // Verify state parameter using both session and memory store
  const sessionStateValid = state && state === req.session.oauthState;
  const memoryStateValid = state && oauthStates.has(state);
  
  console.log('State verification:', {
    receivedState: state,
    sessionState: req.session.oauthState,
    sessionStateValid: sessionStateValid,
    memoryStateValid: memoryStateValid,
    finalValid: sessionStateValid || memoryStateValid
  });
  
  if (!state || (!sessionStateValid && !memoryStateValid)) {
    console.error('Invalid state parameter');
    console.error('Received state:', state);
    console.error('Session state:', req.session.oauthState);
    console.error('Memory store has state:', memoryStateValid);
    return res.render('error', {
      error: 'invalid_state',
      error_description: 'Invalid state parameter - possible CSRF attack'
    });
  }

  // Clean up state from memory store
  if (memoryStateValid) {
    oauthStates.delete(state);
  }

  // Clear state from session
  delete req.session.oauthState;

  if (!code) {
    return res.render('error', {
      error: 'missing_code',
      error_description: 'Authorization code not received'
    });
  }

  try {
    // Exchange authorization code for access token
    console.log('Exchanging authorization code for access token...');
    console.log('Token request details:', {
      url: `${OAUTH_CONFIG.authorizationServer}/token`,
      clientId: OAUTH_CONFIG.clientId,
      clientSecret: OAUTH_CONFIG.clientSecret ? '[SET]' : '[NOT SET]',
      redirectUri: OAUTH_CONFIG.redirectUri,
      code: code ? '[PRESENT]' : '[MISSING]'
    });
    
    const tokenResponse = await axios.post(
      `${OAUTH_CONFIG.authorizationServer}/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: OAUTH_CONFIG.redirectUri,
        client_id: OAUTH_CONFIG.clientId,
        client_secret: OAUTH_CONFIG.clientSecret
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const tokenData = tokenResponse.data;
    console.log('Token response:', tokenData);

    // Store tokens in session
    req.session.accessToken = tokenData.access_token;
    req.session.refreshToken = tokenData.refresh_token;
    req.session.idToken = tokenData.id_token; // OpenID Connect ID Token
    req.session.tokenType = tokenData.token_type || 'Bearer';
    req.session.expiresIn = tokenData.expires_in;

    // Store user info (in a real app, you might call a userinfo endpoint)
    req.session.user = {
      id: 'test-user',
      name: 'Test User',
      authenticated: true
    };

    console.log('Successfully obtained access token');
    res.redirect('/');

  } catch (error) {
    console.error('Token exchange error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        data: error.config?.data
      }
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

// Test API call with access token
app.get('/api-test', async (req, res) => {
  if (!req.session.accessToken) {
    return res.redirect('/');
  }

  try {
    // Test token introspection
    console.log('Testing token introspection...');
    
    const introspectionResponse = await axios.post(
      `${OAUTH_CONFIG.authorizationServer}/introspect`,
      new URLSearchParams({
        token: req.session.accessToken,
        client_id: OAUTH_CONFIG.clientId,
        client_secret: OAUTH_CONFIG.clientSecret
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const introspectionData = introspectionResponse.data;
    console.log('Introspection response:', introspectionData);

    // Test UserInfo endpoint if we have openid scope
    let userInfoData = null;
    if (req.session.idToken) {
      try {
        console.log('Testing UserInfo endpoint...');
        const userInfoResponse = await axios.get(
          `${OAUTH_CONFIG.authorizationServer}/userinfo`,
          {
            headers: {
              'Authorization': `Bearer ${req.session.accessToken}`
            }
          }
        );
        userInfoData = userInfoResponse.data;
        console.log('UserInfo response:', userInfoData);
      } catch (userInfoError) {
        console.error('UserInfo test error:', userInfoError.response?.data || userInfoError.message);
      }
    }

    res.render('api-test', {
      introspectionData: introspectionData,
      userInfoData: userInfoData,
      accessToken: req.session.accessToken,
      idToken: req.session.idToken
    });

  } catch (error) {
    console.error('API test error:', error.response?.data || error.message);
    res.render('error', {
      error: 'api_test_failed',
      error_description: error.response?.data?.error_description || 'Failed to test API with access token'
    });
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
    service: 'openid-connect-test-client'
  });
});

// Entity Configuration endpoint for OpenID Federation
app.get('/.well-known/openid-federation', (req, res) => {
  // Use configured entity ID
  const baseUrl = OAUTH_CONFIG.entityId;
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + (24 * 60 * 60); // 24 hours

  const entityConfiguration = {
    iss: baseUrl,
    sub: baseUrl,
    iat: now,
    exp: expiration,
    jwks: {
      keys: [] // In production, this would contain actual signing keys
    },
    metadata: {
      openid_relying_party: {
        client_name: OAUTH_CONFIG.clientName,
        client_uri: baseUrl,
        redirect_uris: [OAUTH_CONFIG.redirectUri],
        response_types: ['code'],
        grant_types: ['authorization_code'],
        scope: OAUTH_CONFIG.scope,
        contacts: ['admin@example.com'],
        application_type: 'web'
      },
      federation_entity: {
        organization_name: OAUTH_CONFIG.clientName,
        homepage_uri: baseUrl,
        contacts: ['admin@example.com']
      }
    },
    authority_hints: [
      'https://trust-anchor.example.com' // Example Trust Anchor
    ]
  };

  // In a real implementation, this would be signed as a JWT
  // For now, return the unsigned JSON for development/testing
  res.setHeader('Content-Type', 'application/entity-statement+jwt');
  res.json(entityConfiguration);

  console.log('Entity Configuration requested:', {
    issuer: entityConfiguration.iss,
    subject: entityConfiguration.sub
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

// Start server
app.listen(PORT, () => {
  console.log(`OpenID Connect Test Client running on http://localhost:${PORT}`);
  console.log('Configuration:');
  console.log(`- Client ID: ${OAUTH_CONFIG.clientId}`);
  console.log(`- Client Secret: ${OAUTH_CONFIG.clientSecret ? '[SET]' : '[NOT SET]'}`);
  console.log(`- Client Secret (first 10 chars): ${OAUTH_CONFIG.clientSecret ? OAUTH_CONFIG.clientSecret.substring(0, 10) + '...' : '[NOT SET]'}`);
  console.log(`- Authorization Server: ${OAUTH_CONFIG.authorizationServer}`);
  console.log(`- Redirect URI: ${OAUTH_CONFIG.redirectUri}`);
  console.log(`- Scope: ${OAUTH_CONFIG.scope}`);
  
  // Debug environment variables
  console.log('\nEnvironment Variables:');
  console.log(`- process.env.CLIENT_ID: ${process.env.CLIENT_ID}`);
  console.log(`- process.env.CLIENT_SECRET: ${process.env.CLIENT_SECRET ? process.env.CLIENT_SECRET.substring(0, 10) + '...' : '[NOT SET]'}`);
  
  // Validate configuration
  if (!OAUTH_CONFIG.clientSecret || OAUTH_CONFIG.clientSecret === 'test-client-secret' || OAUTH_CONFIG.clientSecret === 'your-actual-client-secret-here') {
    console.warn('⚠️  WARNING: Using default client secret. Please set CLIENT_SECRET in .env file');
  } else {
    console.log('✅ Client secret appears to be properly configured');
  }
});