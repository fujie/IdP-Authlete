import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { SignJWT, generateKeyPair, importJWK, exportJWK } from 'jose';
import { OPTrustChainValidator } from './lib/opTrustChainValidator.js';
import { OPDiscoveryService } from './lib/opDiscoveryService.js';
import { MultiOPCredentialsManager } from './lib/multiOPCredentialsManager.js';
import { validateEntityId } from './lib/entityIdValidator.js';

// ES modules equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Multi-OP selection services
let opDiscoveryService = null;
let multiOPCredentialsManager = null;

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

// Create federation request object for selected OP
async function createFederationRequestObjectForOP(opEntityId, state, nonce) {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 300; // 5 minutes

  // OpenID Federation: 常にEntity IDをclient_idとして使用
  const clientId = FEDERATION_CONFIG.entityId;

  const payload = {
    iss: FEDERATION_CONFIG.entityId,
    aud: opEntityId, // Use selected OP as audience
    iat: now,
    exp: expiration,
    response_type: 'code',
    client_id: clientId, // 常にEntity ID
    redirect_uri: FEDERATION_CONFIG.redirectUri,
    scope: FEDERATION_CONFIG.scope,
    state: state,
    nonce: nonce
  };

  console.log('Creating request object for selected OP', {
    clientId: clientId,
    audience: opEntityId
  });

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
  // Get selected OP from session, or use default from env var (backward compatibility)
  const selectedOP = req.session.selectedOP || (FEDERATION_CONFIG.authorizationServer ? {
    entityId: FEDERATION_CONFIG.authorizationServer,
    isDefault: true
  } : null);
  
  // Check if we have credentials for the selected OP (or default OP)
  const opEntityId = selectedOP ? selectedOP.entityId : null;
  const hasCredentials = opEntityId ? !!multiOPCredentialsManager.getCredentials(opEntityId) : false;
  
  res.render('index', {
    user: req.session.user,
    accessToken: req.session.accessToken,
    idToken: req.session.idToken,
    config: FEDERATION_CONFIG,
    registeredClientId: hasCredentials ? FEDERATION_CONFIG.entityId : null, // entity_idをclient_idとして使用、ただしclient_secretがある場合のみ
    entityId: FEDERATION_CONFIG.entityId,
    isValid: true,
    hasClientSecret: hasCredentials,
    selectedOP: selectedOP,
    defaultOP: FEDERATION_CONFIG.authorizationServer || null
  });
});

// Start OpenID Federation Authorization Code Flow with Dynamic Registration
// Implements Requirements: 2.1, 10.1, 5.1, 5.2, 5.3, 5.4, 6.3, 6.5, 7.1, 7.2, 7.3, 7.5
app.get('/federation-login', async (req, res) => {
  try {
    // Get selected OP from session, or use default from env var (Requirement 5.1)
    const selectedOP = req.session.selectedOP || (FEDERATION_CONFIG.authorizationServer ? {
      entityId: FEDERATION_CONFIG.authorizationServer,
      isDefault: true
    } : null);
    
    // Verify OP is selected before proceeding (Requirement 10.3)
    if (!selectedOP || !selectedOP.entityId) {
      console.error('No OP selected for login');
      return res.render('error', {
        error: 'no_op_selected',
        error_description: 'Please select an OpenID Provider before attempting to login'
      });
    }
    
    const opEntityId = selectedOP.entityId;
    console.log('Federation login with selected OP', { opEntityId });
    
    // Validate OP trust chain before proceeding
    console.log('Validating OP trust chain', { opEntityId });
    const trustValidation = await opValidator.validateOP(opEntityId, {
      sessionId: req.sessionID,
      userAgent: req.get('user-agent')
    });
    
    if (!trustValidation.isValid) {
      console.error('OP trust chain validation failed', {
        opEntityId,
        errors: trustValidation.errors
      });
      return res.status(403).render('error', {
        error: 'untrusted_op',
        error_description: `OP ${opEntityId} is not registered in Trust Anchor`,
        opEntityId: opEntityId,
        errors: trustValidation.errors || []
      });
    }
    
    console.log('OP trust chain validation succeeded', { opEntityId });
    
    // Clear any existing OAuth state
    delete req.session.oauthState;
    delete req.session.accessToken;
    delete req.session.refreshToken;
    delete req.session.user;
    
    // Use selected OP's metadata for endpoints (Requirement 5.1)
    let opMetadata = selectedOP.metadata;
    if (!opMetadata) {
      // Discover metadata if not already cached
      console.log('Discovering OP metadata', { opEntityId });
      opMetadata = await opDiscoveryService.discoverOP(opEntityId);
    }
    
    // Retrieve OP-specific credentials from credentials manager (Requirement 5.2)
    let opCredentials = multiOPCredentialsManager.getCredentials(opEntityId);
    
    // Perform dynamic registration if credentials missing (Requirement 6.5, 7.1)
    if (!opCredentials) {
      console.log('No credentials found for OP, performing dynamic registration', { opEntityId });
      
      // Create entity configuration
      const entityConfiguration = await createEntityConfiguration();
      
      // Prepare registration request (Requirement 7.2, 7.3)
      const registrationRequest = {
        entity_configuration: entityConfiguration
      };
      
      // Determine registration endpoint
      // Check both federation_registration_endpoint and registration_endpoint
      const registrationEndpoint = opMetadata.federation_registration_endpoint || 
                                   opMetadata.registration_endpoint ||
                                   `${opEntityId}/federation/registration`;
      
      console.log('Sending registration request to:', registrationEndpoint);
      
      // Send registration request
      const response = await axios.post(
        registrationEndpoint,
        registrationRequest,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log('Registration response:', response.data);
      
      // Store credentials for selected OP after registration (Requirement 6.3)
      const clientSecret = response.data.client_secret;
      multiOPCredentialsManager.storeCredentials(opEntityId, clientSecret);
      
      opCredentials = { clientSecret };
      
      console.log('Dynamic registration successful for OP', { opEntityId });
    } else {
      console.log('Using existing credentials for OP', { opEntityId });
    }
    
    console.log('=== Federation Login Flow ===');
    console.log('OP Entity ID:', opEntityId);
    console.log('Client ID (Entity ID):', FEDERATION_CONFIG.entityId); // Requirement 7.5
    console.log('Has Client Secret:', !!opCredentials.clientSecret);
    
    // Generate unique state and nonce for each request (Requirement 5.3, 5.4)
    const state = uuidv4();
    const nonce = uuidv4();
    
    // Store state in both session and memory store
    req.session.oauthState = state;
    req.session.selectedOPForAuth = opEntityId; // Store for callback
    oauthStates.set(state, {
      timestamp: Date.now(),
      sessionId: req.sessionID,
      opEntityId: opEntityId
    });

    console.log('Starting OpenID Federation flow');
    console.log('State:', state);
    console.log('Nonce:', nonce);

    // Save session explicitly
    req.session.save(async (err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).send('Session error');
      }

      try {
        // Create federation request object with selected OP as audience
        const requestObject = await createFederationRequestObjectForOP(opEntityId, state, nonce);

        // Build authorization URL with selected OP's authorization_endpoint (Requirement 5.1)
        const authUrl = new URL(opMetadata.authorization_endpoint);
        authUrl.searchParams.append('request', requestObject);

        console.log('Redirecting to selected OP authorization server');
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
      error: 'login_failed',
      error_description: error.response?.data?.error_description || error.message || 'Federation login failed'
    });
  }
});

// OpenID Connect Callback endpoint
// Implements Requirements: 5.5, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1
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

  // Verify state parameter matches stored value (Requirement 5.5)
  const sessionStateValid = state && state === req.session.oauthState;
  const memoryStateValid = state && oauthStates.has(state);
  
  if (!state || (!sessionStateValid && !memoryStateValid)) {
    console.error('Invalid state parameter');
    return res.render('error', {
      error: 'invalid_state',
      error_description: 'Invalid state parameter - possible CSRF attack'
    });
  }

  // Read selected OP from session (Requirement 8.1)
  const opEntityId = req.session.selectedOPForAuth || 
                     (req.session.selectedOP && req.session.selectedOP.entityId) ||
                     FEDERATION_CONFIG.authorizationServer;
  
  if (!opEntityId) {
    console.error('No OP entity ID found in session');
    return res.render('error', {
      error: 'no_op_selected',
      error_description: 'No OP was selected for authentication'
    });
  }
  
  console.log('Processing callback for OP', { opEntityId });

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
    // Get OP metadata for token endpoint (Requirement 8.1)
    let opMetadata = req.session.selectedOP && req.session.selectedOP.metadata;
    if (!opMetadata) {
      // Discover metadata if not in session
      console.log('Discovering OP metadata for token exchange', { opEntityId });
      opMetadata = await opDiscoveryService.discoverOP(opEntityId);
    }
    
    // Use OP-specific credentials for token exchange (Requirement 8.2)
    const opCredentials = multiOPCredentialsManager.getCredentials(opEntityId);
    
    if (!opCredentials || !opCredentials.clientSecret) {
      console.error('No credentials found for OP', { opEntityId });
      throw new Error(`No credentials found for OP ${opEntityId}. Please try logging in again.`);
    }

    // Exchange authorization code for access token using selected OP's token_endpoint (Requirement 8.1)
    console.log('Exchanging authorization code for access token...');
    console.log('OP Entity ID:', opEntityId);
    console.log('Token Endpoint:', opMetadata.token_endpoint);
    console.log('Using entity_id as client_id:', FEDERATION_CONFIG.entityId);
    
    const tokenResponse = await axios.post(
      opMetadata.token_endpoint, // Use selected OP's token endpoint
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: FEDERATION_CONFIG.redirectUri,
        client_id: FEDERATION_CONFIG.entityId, // entity_idをclient_idとして使用
        client_secret: opCredentials.clientSecret // Use OP-specific credentials
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const tokenData = tokenResponse.data;
    console.log('Token response received');

    // Store access_token and id_token in session (Requirement 8.3, 8.4)
    req.session.accessToken = tokenData.access_token;
    req.session.refreshToken = tokenData.refresh_token;
    req.session.idToken = tokenData.id_token;
    req.session.tokenType = tokenData.token_type || 'Bearer';
    req.session.expiresIn = tokenData.expires_in;

    // Store OP entity_id in session after successful auth (Requirement 9.1)
    req.session.authenticatedOP = opEntityId;
    
    // Update selectedOP to reflect authentication
    if (!req.session.selectedOP) {
      req.session.selectedOP = {
        entityId: opEntityId,
        metadata: opMetadata,
        isDefault: opEntityId === FEDERATION_CONFIG.authorizationServer
      };
    }

    // Store user info
    req.session.user = {
      id: 'federation-test-user-valid',
      name: 'Federation Test User (Valid)',
      authenticated: true
    };

    console.log('Successfully obtained access token via federation');
    console.log('Authenticated with OP:', opEntityId);
    res.redirect('/');

  } catch (error) {
    console.error('Token exchange error:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      opEntityId: opEntityId
    });
    
    const errorDescription = error.response?.data?.error_description || 
                           error.response?.data?.error || 
                           error.message ||
                           'Failed to exchange authorization code for access token';
    
    res.render('error', {
      error: 'token_exchange_failed',
      error_description: errorDescription,
      opEntityId: opEntityId
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
  // Clear all OP credentials (Multi-OP support)
  multiOPCredentialsManager.clearAll();
  
  // Also clear old single-OP credentials if they exist
  clearPersistedCredentials();
  
  res.json({
    success: true,
    message: 'All client registrations cleared. You can now register again.'
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
 * OP Selection Routes
 * Implements Requirements: 3.4, 3.6, 4.1, 4.4
 */

// POST /select-op - Select an OP for authentication
app.post('/select-op', async (req, res) => {
  try {
    const { entity_id } = req.body;
    
    console.log('OP selection request received', { entity_id });
    
    // Validate entity_id input (Requirement 3.4)
    const validation = validateEntityId(entity_id);
    if (!validation.isValid) {
      console.log('Invalid entity_id', { errors: validation.errors });
      return res.status(400).json({
        success: false,
        error: 'invalid_entity_id',
        errors: validation.errors
      });
    }
    
    // Discover OP metadata
    console.log('Discovering OP metadata', { entity_id });
    let metadata;
    try {
      metadata = await opDiscoveryService.discoverOP(entity_id);
    } catch (discoveryError) {
      console.log('OP discovery failed', { 
        entity_id, 
        error: discoveryError.message 
      });
      return res.status(400).json({
        success: false,
        error: 'discovery_failed',
        message: discoveryError.message
      });
    }
    
    // Validate OP trust chain (Requirement 4.1)
    console.log('Validating OP trust chain', { entity_id });
    const trustValidation = await opValidator.validateOP(entity_id, {
      sessionId: req.sessionID,
      userAgent: req.get('user-agent')
    });
    
    if (!trustValidation.isValid) {
      console.log('OP trust chain validation failed', {
        entity_id,
        errors: trustValidation.errors
      });
      return res.status(403).json({
        success: false,
        error: 'trust_validation_failed',
        message: `OP ${entity_id} is not registered in Trust Anchor`,
        errors: trustValidation.errors,
        cached: trustValidation.cached
      });
    }
    
    console.log('OP trust chain validation succeeded', {
      entity_id,
      cached: trustValidation.cached
    });
    
    // Store selection in session (Requirement 3.6)
    req.session.selectedOP = {
      entityId: entity_id,
      metadata: metadata,
      isDefault: false,
      selectedAt: Date.now(),
      trustValidation: {
        isValid: true,
        trustAnchor: trustValidation.trustAnchor,
        cached: trustValidation.cached
      }
    };
    
    // Save session
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    console.log('OP selected successfully', { entity_id });
    
    // Return OP metadata and validation status
    res.json({
      success: true,
      op: {
        entityId: entity_id,
        metadata: metadata,
        trustValidation: {
          isValid: true,
          trustAnchor: trustValidation.trustAnchor,
          cached: trustValidation.cached
        }
      }
    });
    
  } catch (error) {
    console.error('OP selection error', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: error.message
    });
  }
});

// GET /discover-op - Discover OP metadata (AJAX endpoint)
app.get('/discover-op', async (req, res) => {
  try {
    const { entity_id } = req.query;
    
    console.log('OP discovery request received', { entity_id });
    
    // Validate entity_id input
    const validation = validateEntityId(entity_id);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'invalid_entity_id',
        errors: validation.errors
      });
    }
    
    // Discover OP metadata
    let metadata;
    try {
      metadata = await opDiscoveryService.discoverOP(entity_id);
    } catch (discoveryError) {
      return res.status(400).json({
        success: false,
        error: 'discovery_failed',
        message: discoveryError.message
      });
    }
    
    res.json({
      success: true,
      metadata: metadata
    });
    
  } catch (error) {
    console.error('OP discovery error', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: error.message
    });
  }
});

// GET /list-ops - List previously used OPs
app.get('/list-ops', (req, res) => {
  try {
    console.log('List OPs request received');
    
    // Get list of previously used OPs from credentials manager
    const opEntityIds = multiOPCredentialsManager.getRegisteredOPs();
    
    // Build response with entity IDs
    const ops = opEntityIds.map(entityId => ({
      entityId: entityId,
      hasCredentials: true
    }));
    
    console.log('Previously used OPs', { count: ops.length });
    
    res.json({
      success: true,
      ops: ops
    });
    
  } catch (error) {
    console.error('List OPs error', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: error.message
    });
  }
});

// POST /clear-op - Clear OP credentials
app.post('/clear-op', (req, res) => {
  try {
    const { entity_id } = req.body;
    
    console.log('Clear OP credentials request received', { entity_id });
    
    if (!entity_id) {
      return res.status(400).json({
        success: false,
        error: 'missing_entity_id',
        message: 'entity_id is required'
      });
    }
    
    // Clear credentials for the specified OP
    multiOPCredentialsManager.clearCredentials(entity_id);
    
    console.log('OP credentials cleared', { entity_id });
    
    res.json({
      success: true,
      message: `Credentials cleared for OP: ${entity_id}`
    });
    
  } catch (error) {
    console.error('Clear OP credentials error', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'internal_error',
      message: error.message
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
    
    // Initialize Multi-OP selection services
    // Implements Requirements: 11.1, 11.2
    console.log('Initializing Multi-OP selection services...');
    
    try {
      opDiscoveryService = new OPDiscoveryService();
      multiOPCredentialsManager = new MultiOPCredentialsManager({
        rpEntityId: FEDERATION_CONFIG.entityId,
        storageFile: path.join(__dirname, '.op-credentials.json')
      });
      console.log('✓ Multi-OP selection services initialized successfully');
    } catch (multiOPError) {
      console.error('FATAL: Failed to initialize Multi-OP selection services');
      console.error('Initialization Error Details:');
      console.error(`  - Error: ${multiOPError.message}`);
      console.error('  - This error prevents multi-OP selection from functioning');
      throw multiOPError;
    }
    
    // Load persisted credentials if available
    loadPersistedCredentials();
    
    // Check for default OP from environment variable (backward compatibility)
    // Implements Requirement: 11.2
    const defaultOP = process.env.AUTHORIZATION_SERVER;
    if (defaultOP) {
      console.log('✓ Default OP configured from AUTHORIZATION_SERVER:', defaultOP);
      console.log('  - This OP will be used for backward compatibility');
      console.log('  - Users can still select other OPs via the UI');
    } else {
      console.log('ℹ No default OP configured (AUTHORIZATION_SERVER not set)');
      console.log('  - Users must select an OP via the UI before authentication');
    }
    
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
      console.log('- Multi-OP Selection: Enabled');
      console.log('- Status: Ready');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();