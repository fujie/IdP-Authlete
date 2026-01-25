import { Router } from 'express';

const router = Router();

// OpenID Connect Discovery endpoint
router.get('/.well-known/openid-configuration', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  const discoveryDocument = {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    userinfo_endpoint: `${baseUrl}/userinfo`,
    introspection_endpoint: `${baseUrl}/introspect`,
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    scopes_supported: [
      'openid',
      'profile',
      'email',
      'address',
      'phone',
      'offline_access'
    ],
    response_types_supported: [
      'code',
      'id_token',
      'code id_token'
    ],
    response_modes_supported: [
      'query',
      'fragment',
      'form_post'
    ],
    grant_types_supported: [
      'authorization_code',
      'refresh_token'
    ],
    subject_types_supported: [
      'public'
    ],
    id_token_signing_alg_values_supported: [
      'RS256',
      'ES256',
      'HS256'
    ],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post'
    ],
    claims_supported: [
      'sub',
      'name',
      'given_name',
      'family_name',
      'middle_name',
      'nickname',
      'preferred_username',
      'profile',
      'picture',
      'website',
      'email',
      'email_verified',
      'gender',
      'birthdate',
      'zoneinfo',
      'locale',
      'phone_number',
      'phone_number_verified',
      'address',
      'updated_at'
    ],
    code_challenge_methods_supported: [
      'plain',
      'S256'
    ]
  };

  res.json(discoveryDocument);
});

// JWKS endpoint (JSON Web Key Set)
router.get('/.well-known/jwks.json', (_req, res) => {
  // In a real implementation, this would return the actual public keys
  // For now, return an empty key set as Authlete handles the actual signing
  const jwks = {
    keys: []
  };

  res.json(jwks);
});

export default router;