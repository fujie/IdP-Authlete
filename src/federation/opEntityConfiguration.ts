import * as jose from 'jose';
import { logger } from '../utils/logger';

/**
 * Generate OP Entity Configuration JWT
 * 
 * This generates a self-signed JWT containing the OP's entity configuration
 * for OpenID Federation.
 */
export async function generateOPEntityConfiguration(
  entityId: string,
  trustAnchorId: string
): Promise<string> {
  try {
    // Generate a key pair for signing
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256');
    
    // Export public key as JWK
    const jwk = await jose.exportJWK(publicKey);
    jwk.kid = 'op-key-1';
    jwk.use = 'sig';
    jwk.alg = 'RS256';
    
    // Create entity configuration payload
    const payload = {
      iss: entityId,
      sub: entityId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
      jwks: {
        keys: [jwk]
      },
      metadata: {
        openid_provider: {
          issuer: entityId,
          authorization_endpoint: `${entityId}/authorization`,
          token_endpoint: `${entityId}/token`,
          userinfo_endpoint: `${entityId}/userinfo`,
          jwks_uri: `${entityId}/.well-known/jwks.json`,
          registration_endpoint: `${entityId}/federation/registration`,
          scopes_supported: ['openid', 'profile', 'email'],
          response_types_supported: ['code', 'id_token', 'token id_token'],
          grant_types_supported: ['authorization_code', 'implicit', 'refresh_token'],
          subject_types_supported: ['public', 'pairwise'],
          id_token_signing_alg_values_supported: ['RS256', 'ES256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'],
          claims_supported: ['sub', 'name', 'email', 'email_verified']
        }
      },
      authority_hints: [trustAnchorId]
    };
    
    // Sign the JWT
    const jwt = await new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'op-key-1', typ: 'entity-statement+jwt' })
      .sign(privateKey);
    
    logger.logInfo(
      'Generated OP entity configuration',
      'OPEntityConfiguration',
      {
        entityId,
        trustAnchorId,
        expiresIn: '24h'
      }
    );
    
    return jwt;
  } catch (error) {
    logger.logError({
      message: 'Failed to generate OP entity configuration',
      component: 'OPEntityConfiguration',
      error: {
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error)
      }
    });
    
    throw error;
  }
}
