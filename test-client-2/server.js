require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3004;

// Federation Configuration
const FEDERATION_CONFIG = {
  clientName: process.env.CLIENT_NAME || 'Federation Test Client 2 (Invalid)',
  entityId: process.env.ENTITY_ID || 'https://localhost:3004',
  authorizationServer: process.env.AUTHORIZATION_SERVER || 'http://localhost:3001',
  redirectUri: process.env.REDIRECT_URI || 'https://localhost:3004/callback',
  scope: process.env.SCOPE || 'openid profile email',
  trustChainStatus: process.env.TRUST_CHAIN_STATUS || 'invalid',
  trustAnchor: process.env.TRUST_ANCHOR || 'https://unknown-trust-anchor.example.com',
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
  secret: 'federation-test-client-2-session-secret',
  resave: false,
  saveUninitialized: false,
  name: 'fed.client2.sid',
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

// Dynamic Client Registration (will fail due to invalid trust chain)
async function performDynamicRegistration() {
  if (clientRegistration || registrationError) {
    console.log('Registration already attempted');
    return clientRegistration;
  }

  try {
    console.log('Performing dynamic client registration...');
    console.log('Entity ID:', FEDERATION_CONFIG.entityId);
    console.log('Authorization Server:', FEDERATION_CONFIG.authorizationServer);
    console.log('⚠️  WARNING: This client has an INVALID Trust Chain and should be rejected');

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

    // This should not happen for this client
    clientRegistration = response.data;
    registrationError = null;

    console.log('❌ UNEXPECTED: Dynamic registration succeeded for invalid client!');
    console.log('Client ID:', clientRegistration.client_id);

    return clientRegistration;

  } catch (error) {
    console.log('✅ EXPECTED: Dynamic registration failed (invalid Trust Chain)');
    console.log('Error:', error.response?.data || error.message);
    
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

// Start OpenID Connect Authorization Code Flow (should fail)
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

  console.log('Starting Federation OpenID Connect flow with Request Object (should fail) and state:', state);

  // Save session explicitly
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).send('Session error');
    }

    try {
      // Create Request Object (JWT) for OpenID Federation 1.0
      // This should fail due to invalid Trust Chain
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

      console.log('Request Object created (should fail during processing):', requestObject.substring(0, 100) + '...');
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
    kid: 'test-client-2-key'
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = 'mock-signature-for-federation-request-object-development';

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// Callback endpoint (should receive error)
app.get('/callback', (req, res) => {
  const { error, error_description, state } = req.query;
  
  console.log('Callback received (expected error):', {
    error: error,
    error_description: error_description,
    state: state
  });

  if (error) {
    console.log('✅ EXPECTED: Received error in callback due to invalid Trust Chain');
    return res.render('error', {
      error: error,
      error_description: error_description || 'Authorization failed due to invalid Trust Chain (expected behavior)'
    });
  }

  // This should not happen
  console.log('❌ UNEXPECTED: Received successful callback for invalid Trust Chain client');
  res.render('error', {
    error: 'unexpected_success',
    error_description: 'This client should not receive successful callbacks due to invalid Trust Chain.'
  });
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
        <title>利用規約 - Federation Test Client 2</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
        <div class="container mt-5">
            <div class="card">
                <div class="card-header bg-danger text-white">
                    <h1 class="h3 mb-0">利用規約</h1>
                </div>
                <div class="card-body">
                    <h5>Federation Test Client 2 利用規約</h5>
                    <p>これはOpenID Federation 1.0のテスト用クライアントです。</p>
                    <ul>
                        <li>このクライアントはテスト目的でのみ使用されます</li>
                        <li><strong>無効なTrust Chain</strong>を持つクライアントとして動作します</li>
                        <li>動的登録が失敗することを確認するためのテストクライアントです</li>
                        <li>実際のプロダクション環境では使用しないでください</li>
                    </ul>
                    <p><strong>Entity ID:</strong> ${FEDERATION_CONFIG.entityId}</p>
                    <p><strong>Trust Anchor:</strong> ${FEDERATION_CONFIG.trustAnchor} (無効)</p>
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
        <title>プライバシーポリシー - Federation Test Client 2</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    </head>
    <body>
        <div class="container mt-5">
            <div class="card">
                <div class="card-header bg-danger text-white">
                    <h1 class="h3 mb-0">プライバシーポリシー</h1>
                </div>
                <div class="card-body">
                    <h5>Federation Test Client 2 プライバシーポリシー</h5>
                    <p>このテストクライアントのプライバシーポリシーです。</p>
                    <ul>
                        <li>テスト目的でのみ個人情報を処理します</li>
                        <li>このクライアントは無効なTrust Chainを持つため、通常は動作しません</li>
                        <li>OpenID Federation 1.0のセキュリティ機能をテストするためのクライアントです</li>
                        <li>実際の個人情報処理は行われません</li>
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
    // Standard JWT claims
    iss: FEDERATION_CONFIG.entityId,
    sub: FEDERATION_CONFIG.entityId,
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
    
    // Trust marks and authority hints (invalid trust anchor)
    authority_hints: [FEDERATION_CONFIG.trustAnchor], // This points to unknown trust anchor
    
    // JWKS for entity verification (mock keys for development)
    jwks: {
      keys: [
        {
          kty: 'RSA',
          use: 'sig',
          kid: 'test-client-2-key',
          alg: 'RS256',
          n: 'mock-rsa-public-key-modulus-for-test-client-2',
          e: 'AQAB'
        }
      ]
    },
    
    // Trust chain information (invalid)
    trust_anchor_id: FEDERATION_CONFIG.trustAnchor, // Unknown trust anchor
    
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
    kid: 'test-client-2-key'
  })).toString('base64url');
  
  const payload = Buffer.from(JSON.stringify(entityConfiguration)).toString('base64url');
  const signature = 'mock-signature-for-test-client-2-development';
  
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
    service: 'federation-test-client-2',
    entityId: FEDERATION_CONFIG.entityId,
    trustChainStatus: FEDERATION_CONFIG.trustChainStatus,
    clientRegistered: !!clientRegistration,
    registrationFailed: !!registrationError,
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
  console.log(`Federation Test Client 2 running on http://localhost:${PORT}`);
  console.log('Configuration:');
  console.log(`- Entity ID: ${FEDERATION_CONFIG.entityId}`);
  console.log(`- Client Name: ${FEDERATION_CONFIG.clientName}`);
  console.log(`- Authorization Server: ${FEDERATION_CONFIG.authorizationServer}`);
  console.log(`- Redirect URI: ${FEDERATION_CONFIG.redirectUri}`);
  console.log(`- Trust Chain Status: ${FEDERATION_CONFIG.trustChainStatus}`);
  console.log(`- Trust Anchor: ${FEDERATION_CONFIG.trustAnchor}`);
  console.log(`- Use Dynamic Registration: ${FEDERATION_CONFIG.useDynamicRegistration}`);
  
  console.log('\n⚠️  WARNING: This client has an INVALID Trust Chain');
  console.log('Expected behavior: Dynamic registration should FAIL');
  
  // Perform initial dynamic registration if enabled
  if (FEDERATION_CONFIG.useDynamicRegistration) {
    console.log('\n🔄 Attempting dynamic client registration (should fail)...');
    performDynamicRegistration().then(() => {
      if (clientRegistration) {
        console.log('❌ UNEXPECTED: Dynamic registration succeeded');
      } else {
        console.log('✅ EXPECTED: Dynamic registration failed');
      }
    });
  }
});