import { TrustAnchorMetadata, IntermediateAuthorityMetadata, JWK } from './types';

// Example Trust Anchor metadata
// In production, this would be provided by the actual Trust Anchor
export function createTrustAnchorMetadata(): TrustAnchorMetadata {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + (365 * 24 * 60 * 60); // 1 year

  return {
    iss: 'https://trust-anchor.example.com',
    sub: 'https://trust-anchor.example.com',
    iat: now,
    exp: expiration,
    jwks: {
      keys: [
        // Example RSA key for Trust Anchor
        // In production, this would be the actual public key
        {
          kty: 'RSA',
          use: 'sig',
          kid: 'trust-anchor-key-1',
          alg: 'RS256',
          n: 'example-modulus-base64url',
          e: 'AQAB'
        }
      ]
    },
    metadata: {
      federation_entity: {
        federation_fetch_endpoint: 'https://trust-anchor.example.com/federation/fetch',
        federation_list_endpoint: 'https://trust-anchor.example.com/federation/list',
        federation_resolve_endpoint: 'https://trust-anchor.example.com/federation/resolve',
        organization_name: 'Example Trust Anchor',
        homepage_uri: 'https://trust-anchor.example.com',
        contacts: ['admin@trust-anchor.example.com']
      }
    },
    constraints: {
      max_path_length: 2,
      naming_constraints: {
        permitted: [
          'https://*.example.com',
          'https://*.example.org'
        ],
        excluded: [
          'https://malicious.example.com'
        ]
      }
    }
  };
}

// Example Intermediate Authority metadata
// In production, this would be provided by the actual Intermediate Authority
export function createIntermediateAuthorityMetadata(): IntermediateAuthorityMetadata {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + (90 * 24 * 60 * 60); // 90 days

  return {
    iss: 'https://intermediate.example.com',
    sub: 'https://intermediate.example.com',
    iat: now,
    exp: expiration,
    jwks: {
      keys: [
        // Example RSA key for Intermediate Authority
        // In production, this would be the actual public key
        {
          kty: 'RSA',
          use: 'sig',
          kid: 'intermediate-key-1',
          alg: 'RS256',
          n: 'example-intermediate-modulus-base64url',
          e: 'AQAB'
        }
      ]
    },
    metadata: {
      federation_entity: {
        federation_fetch_endpoint: 'https://intermediate.example.com/federation/fetch',
        federation_list_endpoint: 'https://intermediate.example.com/federation/list',
        federation_resolve_endpoint: 'https://intermediate.example.com/federation/resolve',
        organization_name: 'Example Intermediate Authority',
        homepage_uri: 'https://intermediate.example.com',
        contacts: ['admin@intermediate.example.com']
      },
      openid_provider: {
        issuer: 'https://intermediate.example.com',
        authorization_endpoint: 'https://intermediate.example.com/authorize',
        token_endpoint: 'https://intermediate.example.com/token',
        userinfo_endpoint: 'https://intermediate.example.com/userinfo',
        jwks_uri: 'https://intermediate.example.com/.well-known/jwks.json',
        scopes_supported: ['openid', 'profile', 'email'],
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post']
      }
    },
    authority_hints: [
      'https://trust-anchor.example.com'
    ],
    constraints: {
      max_path_length: 1
    }
  };
}

// Helper function to create example JWK for development
export function createExampleJWK(keyId: string, algorithm: string = 'RS256'): JWK {
  return {
    kty: 'RSA',
    use: 'sig',
    kid: keyId,
    alg: algorithm,
    // These are example values - in production, use actual key material
    n: 'example-modulus-' + keyId + '-base64url-encoded',
    e: 'AQAB'
  };
}

// Helper function to get federation metadata for known entities
export function getFederationMetadata(entityId: string): TrustAnchorMetadata | IntermediateAuthorityMetadata | null {
  switch (entityId) {
    case 'https://trust-anchor.example.com':
      return createTrustAnchorMetadata();
    case 'https://intermediate.example.com':
      return createIntermediateAuthorityMetadata();
    default:
      return null;
  }
}

// Helper function to check if an entity is a known Trust Anchor
export function isTrustAnchor(entityId: string): boolean {
  return entityId === 'https://trust-anchor.example.com';
}

// Helper function to check if an entity is a known Intermediate Authority
export function isIntermediateAuthority(entityId: string): boolean {
  return entityId === 'https://intermediate.example.com';
}