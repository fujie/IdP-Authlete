require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;

// Federation Configuration
const FEDERATION_CONFIG = {
  clientName: process.env.CLIENT_NAME || 'Federation Test Client 1 (Valid)',
  entityId: process.env.ENTITY_ID || 'https://localhost:3002',
  authorizationServer: process.env.AUTHORIZATION_SERVER || 'http://localhost:3001',
  redirectUri: process.env.REDIRECT_URI || 'https://localhost:3002/callback',
  scope: process.env.SCOPE || 'openid profile email',
  trustChainStatus: process.env.TRUST_CHAIN_STATUS || 'valid',
  trustAnchor: process.env.TRUST_ANCHOR || 'https://trust-anchor.example.com',
  useDynamicRegistration: process.env.USE_DYNAMIC_REGISTRATION === 'true'
};

// Client registration state
let clientRegistration = null;
let registrationError = null;

// In-memory store for OAuth states
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
}, 10 * 60 * 1000);

// Session configuration
app.use(session({
  secret: 'federation-test-client-1-session-secret',
  resave: false,
  saveUninitialized: false,
  name: 'fed.client1.sid',
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

// Dynamic Client Registration
async function performDynamicRegistration() {
  if (clientRegistration) {
    console.log('Client already registered:', clientRegistration.client_id);
    return clientRegistration;
  }

  try {
    console.log('Performing dynamic client registration...');
    console.log('Entity ID:', FEDERATION_CONFIG.entityId);
    console.log('Authorization Server:', FEDERATION_CONFIG.authorizationServer);

    const registrationRequest = {
      entity_id: FEDERATION_CONFIG.entityId,
      redirect_uris: [FEDERATION_CONFIG.redirectUri.replace('https://', 'http://')], // Use HTTP for actual callback
      client_name: FEDERATION_CONFIG.clientName,
      client_uri: FEDERATION_CONFIG.entityId,
      contacts: ['admin@example.com'],
      tos_uri: `${FEDERATION_CONFIG.entityId}/tos`,
      policy_uri: `${FEDERATION_CONFIG.entityId}/policy`
    };

    const response = await axios.post(
      `${FEDERATION_CONFIG.authorizationServer}/federation/register`,
      registrationRequest,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    clientRegistration = response.data;
    registrationError = null;

    console.log('Dynamic registration successful!');
    console.log('Client ID:', clientRegistration.client_id);
    console.log('Trust Chain Valid:', clientRegistration.trust_chain_validation.isValid);
    console.log('Trust Anchor:', clientRegistration.trust_chain_validation.trustAnchor);

    return clientRegistration;

  } catch (error) {
    console.error('Dynamic registration failed:', error.response?.data || error.message);
    registrationError = error.response?.data || {
      error: 'registration_failed',
      error_description: error.message
    };
    return null;
  }
}

// Home page
app.get('/', async (req, res) => {
  // Attempt dynamic registration if not already done
  if (FEDERATION_CONFIG.useDynamicRegistration && !clientRegistration && !registrationError) {
    await performDynamicRegistration();
  }

  res.render('index', {
    user: req.session.user,
    accessToken: req.session.accessToken,
    idToken: req.session.idToken,
    config: FEDERATION_CONFIG,
    clientRegistration: clientRegistration,
    registrationError: registrationError
  });
});

// Start OpenID Connect Authorization Code Flow with Request Object
app.get('/login', async (req, res) => {
  // Clear any existing OAuth state
  delete req.session.oauthState;
  delete req.session.accessToken;
  delete req.session.refreshToken;
  delete req.session.user;
  
  // Generate state parameter for CSRF protection
  const state = uuidv4();
  
  // Store state
  req.session.oauthState = state;
  oauthStates.set(state, {
    timestamp: Date.now(),
    sessionId: req.sessionID
  });

  console.log('Starting Federation OpenID Connect flow with Request Object and state:', state);

  // Save session explicitly
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).send('Session error');
    }

    try {
      // Create Request Object (JWT) for OpenID Federation 1.0
      const requestObject = createRequestObject({
        client_id: FEDERATION_CONFIG.entityId, // Use entity ID as client_id
        redirect_uri: FEDERATION_CONFIG.redirectUri,
        scope: FEDERATION_CONFIG.scope,
        state: state,
        response_type: 'code',
        client_metadata: {
          client_name: FEDERATION_CONFIG.clientName,
          client_uri: FEDERATION_CONFIG.entityId,
          contacts: ['admin@example.com'],
          tos_uri: `${FEDERATION_CONFIG.entityId}/tos`,
          policy_uri: `${FEDERATION_CONFIG.entityId}/policy`,
          redirect_uris: [FEDERATION_CONFIG.redirectUri.replace('https://', 'http://')], // Use HTTP for actual callback
          response_types: ['code'],
          grant_types: ['authorization_code', 'refresh_token'],
          application_type: 'web',
          subject_type: 'public',
          id_token_signed_response_alg: 'RS256',
          token_endpoint_auth_method: 'client_secret_basic'
        }
      });

      // Build authorization URL with Request Object
      const authUrl = new URL(`${FEDERATION_CONFIG.authorizationServer}/authorize`);
      authUrl.searchParams.append('request', requestObject);
      // Note: When using Request Object, other parameters are optional but can be included for compatibility
      authUrl.searchParams.append('client_id', FEDERATION_CONFIG.entityId);
      authUrl.searchParams.append('response_type', 'code');

      console.log('Request Object created:', requestObject.substring(0, 100) + '...');
      console.log('Redirecting to authorization server with Request Object:', authUrl.toString());
      res.redirect(authUrl.toString());
    } catch (error) {
      console.error('Error creating Request Object:', error);
      res.render('error', {
        error: 'request_object_error',
        error_description: 'Failed to create Request Object for Federation authentication'
      });
    }
  });
});

// Function to create Request Object JWT
function createRequestObject(params) {
  const now = Math.floor(Date.now() / 1000);
  
  // Request Object payload (claims)
  const payload = {
    // Standard JWT claims
    iss: params.client_id, // Issuer (client_id)
    sub: params.client_id, // Subject (same as issuer for self-issued)
    aud: FEDERATION_CONFIG.authorizationServer, // Audience (authorization server)
    exp: now + (5 * 60), // Expires in 5 minutes
    iat: now, // Issued at
    jti: uuidv4(), // JWT ID
    
    // OAuth 2.0 Authorization Request parameters
    response_type: params.response_type,
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    scope: params.scope,
    state: params.state,
    
    // OpenID Federation specific claims
    client_metadata: params.client_metadata
  };

  // Create JWT structure (mock signing for development)
  const header = {
    typ: 'JWT',
    alg: 'RS256',
    kid: 'test-client-1-key'
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = 'mock-signature-for-federation-request-object-development';

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// OpenID Connect Callback endpoint
app.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  console.log('Callback received:', {
    code: code ? 'present' : 'missing',
    state: state,
    error: error
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
    // For Federation clients, we need to determine the client credentials
    // The OP should have registered the client dynamically during authorization
    let clientId = FEDERATION_CONFIG.entityId; // Original entity ID
    let clientSecret = 'dynamic'; // Will be determined by the OP
    
    // Check if we have pre-registered client info
    if (clientRegistration) {
      clientId = clientRegistration.client_id;
      clientSecret = clientRegistration.client_secret;
      console.log('Using pre-registered client credentials for token exchange');
    } else {
      console.log('Using Federation entity ID for token exchange (OP should handle dynamic registration)');
    }

    // Exchange authorization code for access token
    console.log('Exchanging authorization code for access token...');
    
    const tokenResponse = await axios.post(
      `${FEDERATION_CONFIG.authorizationServer}/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: FEDERATION_CONFIG.redirectUri.replace('https://', 'http://'), // Use HTTP for actual callback
        client_id: clientId,
        ...(clientSecret !== 'dynamic' && { client_secret: clientSecret })
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
      id: 'federation-user-1',
      name: 'Federation Test User 1',
      authenticated: true
    };

    console.log('Successfully obtained access token via Federation Request Object flow');
    res.redirect('/');

  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    
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
    // Determine client credentials for API testing
    let clientId = FEDERATION_CONFIG.entityId;
    let clientSecret = 'dynamic';
    
    if (clientRegistration) {
      clientId = clientRegistration.client_id;
      clientSecret = clientRegistration.client_secret;
    }

    // Test token introspection
    console.log('Testing token introspection...');
    
    const introspectionResponse = await axios.post(
      `${FEDERATION_CONFIG.authorizationServer}/introspect`,
      new URLSearchParams({
        token: req.session.accessToken,
        client_id: clientId,
        ...(clientSecret !== 'dynamic' && { client_secret: clientSecret })
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const introspectionData = introspectionResponse.data;
    console.log('Introspection response:', introspectionData);

    // Test UserInfo endpoint
    let userInfoData = null;
    if (req.session.idToken) {
      try {
        console.log('Testing UserInfo endpoint...');
        const userInfoResponse = await axios.get(
          `${FEDERATION_CONFIG.authorizationServer}/userinfo`,
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
      idToken: req.session.idToken,
      clientRegistration: clientRegistration,
      federationFlow: true
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

// Terms of Service endpoint
app.get('/tos', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>利用規約 - Federation Test Client 1</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
        <div class="container mt-5">
            <div class="card">
                <div class="card-header bg-success text-white">
                    <h1 class="h3 mb-0">利用規約</h1>
                </div>
                <div class="card-body">
                    <h5>Federation Test Client 1 利用規約</h5>
                    <p>これはOpenID Federation 1.0のテスト用クライアントです。</p>
                    <ul>
                        <li>このクライアントはテスト目的でのみ使用されます</li>
                        <li>有効なTrust Chainを持つクライアントとして動作します</li>
                        <li>実際のプロダクション環境では使用しないでください</li>
                    </ul>
                    <p><strong>Entity ID:</strong> ${FEDERATION_CONFIG.entityId}</p>
                    <p><strong>Trust Anchor:</strong> ${FEDERATION_CONFIG.trustAnchor}</p>
                </div>
            </div>
        </div>
    </body>
    </html>
  `);
});

// Privacy Policy endpoint
app.get('/policy', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>プライバシーポリシー - Federation Test Client 1</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
        <div class="container mt-5">
            <div class="card">
                <div class="card-header bg-success text-white">
                    <h1 class="h3 mb-0">プライバシーポリシー</h1>
                </div>
                <div class="card-body">
                    <h5>Federation Test Client 1 プライバシーポリシー</h5>
                    <p>このテストクライアントのプライバシーポリシーです。</p>
                    <ul>
                        <li>テスト目的でのみ個人情報を処理します</li>
                        <li>OpenID Connect標準に従ってユーザー情報を取得します</li>
                        <li>取得した情報はセッション中のみ保持されます</li>
                        <li>第三者への情報提供は行いません</li>
                    </ul>
                    <p><strong>Entity ID:</strong> ${FEDERATION_CONFIG.entityId}</p>
                    <p><strong>連絡先:</strong> admin@example.com</p>
                </div>
            </div>
        </div>
    </body>
    </html>
  `);
});

// OpenID Federation Entity Configuration endpoint
app.get('/.well-known/openid-federation', (req, res) => {
  // Generate Entity Configuration (Entity Statement)
  const now = Math.floor(Date.now() / 1000);
  const entityConfiguration = {
    // Standard JWT claims - use HTTPS entity identifier
    iss: FEDERATION_CONFIG.entityId, // This will be https://localhost:3002
    sub: FEDERATION_CONFIG.entityId, // This will be https://localhost:3002
    iat: now,
    exp: now + (24 * 60 * 60), // 24 hours
    
    // Entity metadata
    metadata: {
      openid_relying_party: {
        client_name: FEDERATION_CONFIG.clientName,
        redirect_uris: [FEDERATION_CONFIG.redirectUri.replace('https://', 'http://')], // Use HTTP for actual callback
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
        application_type: 'web',
        subject_type: 'public',
        id_token_signed_response_alg: 'RS256',
        token_endpoint_auth_method: 'client_secret_basic',
        scope: FEDERATION_CONFIG.scope,
        client_uri: FEDERATION_CONFIG.entityId,
        contacts: ['admin@example.com'],
        tos_uri: `${FEDERATION_CONFIG.entityId}/tos`,
        policy_uri: `${FEDERATION_CONFIG.entityId}/policy`,
        // Federation-specific metadata
        federation_entity: {
          federation_fetch_endpoint: `${FEDERATION_CONFIG.entityId}/federation/fetch`,
          federation_list_endpoint: `${FEDERATION_CONFIG.entityId}/federation/list`,
          federation_trust_mark_status_endpoint: `${FEDERATION_CONFIG.entityId}/federation/trust_mark_status`
        }
      }
    },
    
    // Trust marks and authority hints
    authority_hints: [FEDERATION_CONFIG.trustAnchor],
    
    // JWKS for entity verification (mock keys for development)
    jwks: {
      keys: [
        {
          kty: 'RSA',
          use: 'sig',
          kid: 'test-client-1-key',
          alg: 'RS256',
          n: 'mock-rsa-public-key-modulus-for-test-client-1',
          e: 'AQAB'
        }
      ]
    },
    
    // Trust chain information
    trust_anchor_id: FEDERATION_CONFIG.trustAnchor,
    
    // Additional Federation metadata
    federation_entity: {
      contacts: ['admin@example.com'],
      homepage_uri: FEDERATION_CONFIG.entityId,
      policy_uri: `${FEDERATION_CONFIG.entityId}/policy`,
      tos_uri: `${FEDERATION_CONFIG.entityId}/tos`
    }
  };

  // In a real implementation, this would be a properly signed JWT
  // For development, we return a mock JWT structure
  const header = Buffer.from(JSON.stringify({ 
    typ: 'entity-statement+jwt', 
    alg: 'RS256',
    kid: 'test-client-1-key'
  })).toString('base64url');
  
  const payload = Buffer.from(JSON.stringify(entityConfiguration)).toString('base64url');
  const signature = 'mock-signature-for-test-client-1-development';
  
  const entityStatement = `${header}.${payload}.${signature}`;

  // Set appropriate headers for JWT response
  res.setHeader('Content-Type', 'application/entity-statement+jwt');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  res.send(entityStatement);
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'federation-test-client-1',
    entityId: FEDERATION_CONFIG.entityId,
    trustChainStatus: FEDERATION_CONFIG.trustChainStatus,
    clientRegistered: !!clientRegistration,
    entityConfigurationEndpoint: `${FEDERATION_CONFIG.entityId}/.well-known/openid-federation`
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
  console.log(`Federation Test Client 1 running on http://localhost:${PORT}`);
  console.log('Configuration:');
  console.log(`- Entity ID: ${FEDERATION_CONFIG.entityId}`);
  console.log(`- Client Name: ${FEDERATION_CONFIG.clientName}`);
  console.log(`- Authorization Server: ${FEDERATION_CONFIG.authorizationServer}`);
  console.log(`- Redirect URI: ${FEDERATION_CONFIG.redirectUri}`);
  console.log(`- Trust Chain Status: ${FEDERATION_CONFIG.trustChainStatus}`);
  console.log(`- Trust Anchor: ${FEDERATION_CONFIG.trustAnchor}`);
  console.log(`- Use Dynamic Registration: ${FEDERATION_CONFIG.useDynamicRegistration}`);
  
  // Perform initial dynamic registration if enabled
  if (FEDERATION_CONFIG.useDynamicRegistration) {
    console.log('\n🔄 Attempting dynamic client registration...');
    performDynamicRegistration().then(() => {
      if (clientRegistration) {
        console.log('✅ Dynamic registration completed successfully');
      } else {
        console.log('❌ Dynamic registration failed');
      }
    });
  }
});