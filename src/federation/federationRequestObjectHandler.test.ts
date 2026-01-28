// Federation Request Object Handler Tests

import { FederationRequestObjectHandler } from './federationRequestObjectHandler';
import { JWKSet, JWK } from './types';

describe('FederationRequestObjectHandler', () => {
  let handler: FederationRequestObjectHandler;
  
  beforeEach(() => {
    handler = new FederationRequestObjectHandler();
  });

  describe('extractRegistrationParameters', () => {
    it('should extract basic registration parameters from request object', () => {
      // Create a simple unsigned JWT for testing parameter extraction
      const header = { alg: 'none', typ: 'JWT' };
      const payload = {
        iss: 'https://client.example.com',
        aud: 'https://auth.example.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        client_metadata: {
          redirect_uris: ['https://client.example.com/callback'],
          client_name: 'Test Client',
          client_uri: 'https://client.example.com',
          contacts: ['admin@client.example.com']
        }
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const requestObject = `${headerB64}.${payloadB64}.`;

      const params = handler.extractRegistrationParameters(requestObject);

      expect(params.redirect_uris).toEqual(['https://client.example.com/callback']);
      expect(params.client_name).toBe('Test Client');
      expect(params.client_uri).toBe('https://client.example.com');
      expect(params.contacts).toEqual(['admin@client.example.com']);
    });

    it('should return empty redirect_uris on invalid request object', () => {
      const invalidRequestObject = 'invalid.jwt.format';
      
      const params = handler.extractRegistrationParameters(invalidRequestObject);
      
      expect(params.redirect_uris).toEqual([]);
    });

    it('should handle request object without client_metadata', () => {
      const header = { alg: 'none', typ: 'JWT' };
      const payload = {
        iss: 'https://client.example.com',
        aud: 'https://auth.example.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
        // No client_metadata
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const requestObject = `${headerB64}.${payloadB64}.`;

      const params = handler.extractRegistrationParameters(requestObject);

      expect(params.redirect_uris).toEqual([]);
      expect(params.client_name).toBeUndefined();
    });
  });

  describe('validateRequestObjectWithOptionalSignature', () => {
    it('should validate unsigned request object', async () => {
      const header = { alg: 'none', typ: 'JWT' };
      const payload = {
        iss: 'https://client.example.com',
        aud: 'https://auth.example.com',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        client_metadata: {
          redirect_uris: ['https://client.example.com/callback']
        }
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const requestObject = `${headerB64}.${payloadB64}.`;

      const result = await handler.validateRequestObjectWithOptionalSignature(requestObject);

      expect(result.isValid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload?.iss).toBe('https://client.example.com');
    });

    it('should reject request object with invalid structure', async () => {
      const invalidRequestObject = 'invalid.jwt';
      
      const result = await handler.validateRequestObjectWithOptionalSignature(invalidRequestObject);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('validation failed');
    });

    it('should reject expired request object', async () => {
      const header = { alg: 'none', typ: 'JWT' };
      const payload = {
        iss: 'https://client.example.com',
        aud: 'https://auth.example.com',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        iat: Math.floor(Date.now() / 1000) - 7200,
        client_metadata: {
          redirect_uris: ['https://client.example.com/callback']
        }
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const requestObject = `${headerB64}.${payloadB64}.`;

      const result = await handler.validateRequestObjectWithOptionalSignature(requestObject);

      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('expired');
    });

    it('should reject request object missing required claims', async () => {
      const header = { alg: 'none', typ: 'JWT' };
      const payload = {
        // Missing iss, aud, exp, iat
        client_metadata: {
          redirect_uris: ['https://client.example.com/callback']
        }
      };

      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const requestObject = `${headerB64}.${payloadB64}.`;

      const result = await handler.validateRequestObjectWithOptionalSignature(requestObject);

      expect(result.isValid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });

  describe('getSupportedAlgorithms', () => {
    it('should return supported signing algorithms', () => {
      const algorithms = handler.getSupportedAlgorithms();
      
      expect(algorithms).toContain('RS256');
      expect(algorithms).toContain('ES256');
      expect(algorithms.length).toBeGreaterThan(0);
    });
  });
});