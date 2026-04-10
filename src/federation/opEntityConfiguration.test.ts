import { describe, it, expect } from 'vitest';
import { generateOPEntityConfiguration } from './opEntityConfiguration';
import * as jose from 'jose';

describe('OP Entity Configuration', () => {
  it('should generate valid entity configuration JWT', async () => {
    const entityId = 'https://op.example.com';
    const trustAnchorId = 'https://trust-anchor.example.com';
    
    const jwt = await generateOPEntityConfiguration(entityId, trustAnchorId);
    
    // Verify it's a JWT
    expect(jwt).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
    
    // Decode and verify payload
    const parts = jwt.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    
    expect(payload.iss).toBe(entityId);
    expect(payload.sub).toBe(entityId);
    expect(payload.authority_hints).toEqual([trustAnchorId]);
    expect(payload.metadata.openid_provider).toBeDefined();
    expect(payload.metadata.openid_provider.issuer).toBe(entityId);
    expect(payload.jwks.keys).toHaveLength(1);
  });
  
  it('should include required OP metadata', async () => {
    const entityId = 'https://op.example.com';
    const trustAnchorId = 'https://trust-anchor.example.com';
    
    const jwt = await generateOPEntityConfiguration(entityId, trustAnchorId);
    
    const parts = jwt.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    
    const opMetadata = payload.metadata.openid_provider;
    
    expect(opMetadata.authorization_endpoint).toBe(`${entityId}/authorization`);
    expect(opMetadata.token_endpoint).toBe(`${entityId}/token`);
    expect(opMetadata.userinfo_endpoint).toBe(`${entityId}/userinfo`);
    expect(opMetadata.jwks_uri).toBe(`${entityId}/.well-known/jwks.json`);
    expect(opMetadata.registration_endpoint).toBe(`${entityId}/federation/registration`);
    expect(opMetadata.scopes_supported).toContain('openid');
    expect(opMetadata.response_types_supported).toContain('code');
    expect(opMetadata.grant_types_supported).toContain('authorization_code');
  });
  
  it('should generate JWT with valid signature', async () => {
    const entityId = 'https://op.example.com';
    const trustAnchorId = 'https://trust-anchor.example.com';
    
    const jwt = await generateOPEntityConfiguration(entityId, trustAnchorId);
    
    // Extract JWK from payload
    const parts = jwt.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const jwk = payload.jwks.keys[0];
    
    // Import public key
    const publicKey = await jose.importJWK(jwk, 'RS256');
    
    // Verify signature
    const { payload: verifiedPayload } = await jose.jwtVerify(jwt, publicKey);
    
    expect(verifiedPayload.iss).toBe(entityId);
  });
});
