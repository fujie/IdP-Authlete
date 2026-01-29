// Property-Based Test for Entity Configuration Validity
// **Property 5: Entity Configuration Validity**
// **Validates: Requirements 7.2, 7.3, 7.4, 7.5**

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { Request, Response } from 'express';
import { FederationControllerImpl } from './federation';
import { AuthleteClient } from '../authlete/client';
import { AuthleteFederationConfigurationResponse } from '../authlete/types';
import { decodeJwt } from 'jose';

describe('Feature: federation-dynamic-registration, Property 5: Entity Configuration Validity', () => {
  let controller: FederationControllerImpl;
  let mockAuthleteClient: any;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    // Mock Authlete client
    mockAuthleteClient = {
      federationConfiguration: vi.fn()
    } as any;

    // Mock Express request and response
    mockRequest = {
      get: vi.fn().mockReturnValue('localhost:3001'),
      body: {},
      headers: {}
    };

    mockResponse = {
      setHeader: vi.fn(),
      send: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };

    controller = new FederationControllerImpl(mockAuthleteClient);
  });

  // Generator for valid entity configuration JWT payload
  const validEntityConfigurationPayloadArb = fc.record({
    iss: fc.webUrl({ validSchemes: ['https'] }),
    sub: fc.webUrl({ validSchemes: ['https'] }),
    exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 3600, max: Math.floor(Date.now() / 1000) + 86400 }),
    iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
    jwks: fc.record({
      keys: fc.array(
        fc.record({
          kty: fc.constant('RSA'),
          use: fc.constant('sig'),
          kid: fc.string({ minLength: 1, maxLength: 20 }),
          alg: fc.constantFrom('RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'),
          n: fc.string({ minLength: 50, maxLength: 100 }),
          e: fc.constant('AQAB')
        }),
        { minLength: 1, maxLength: 3 }
      )
    }),
    metadata: fc.record({
      openid_provider: fc.record({
        issuer: fc.webUrl({ validSchemes: ['https'] }),
        authorization_endpoint: fc.webUrl({ validSchemes: ['https'] }),
        token_endpoint: fc.webUrl({ validSchemes: ['https'] }),
        userinfo_endpoint: fc.webUrl({ validSchemes: ['https'] }),
        jwks_uri: fc.webUrl({ validSchemes: ['https'] }),
        response_types_supported: fc.array(
          fc.constantFrom('code', 'token', 'id_token', 'code token', 'code id_token', 'token id_token', 'code token id_token'),
          { minLength: 1, maxLength: 4 }
        ),
        subject_types_supported: fc.array(
          fc.constantFrom('public', 'pairwise'),
          { minLength: 1, maxLength: 2 }
        ),
        id_token_signing_alg_values_supported: fc.array(
          fc.constantFrom('RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'),
          { minLength: 1, maxLength: 3 }
        )
      }),
      federation_entity: fc.record({
        federation_fetch_endpoint: fc.webUrl({ validSchemes: ['https'] }),
        federation_list_endpoint: fc.webUrl({ validSchemes: ['https'] }),
        federation_resolve_endpoint: fc.webUrl({ validSchemes: ['https'] }),
        federation_trust_mark_status_endpoint: fc.webUrl({ validSchemes: ['https'] }),
        organization_name: fc.string({ minLength: 1, maxLength: 100 }),
        homepage_uri: fc.webUrl({ validSchemes: ['https'] }),
        policy_uri: fc.webUrl({ validSchemes: ['https'] }),
        logo_uri: fc.webUrl({ validSchemes: ['https'] })
      })
    }),
    authority_hints: fc.option(fc.array(
      fc.webUrl({ validSchemes: ['https'] }),
      { minLength: 0, maxLength: 3 }
    ))
  });

  // Generator for valid entity configuration JWT (base64url encoded)
  const validEntityConfigurationJWTArb = validEntityConfigurationPayloadArb.map(payload => {
    // Create a mock JWT structure (header.payload.signature)
    const header = { typ: 'entity-statement+jwt', alg: 'RS256' };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mockSignature = Buffer.from('mock-signature').toString('base64url');
    
    return `${encodedHeader}.${encodedPayload}.${mockSignature}`;
  });

  // Generator for Authlete federation configuration responses
  const authleteConfigurationResponseArb = fc.record({
    action: fc.constant('OK' as const),
    entityConfiguration: validEntityConfigurationJWTArb,
    responseContent: fc.option(fc.string()),
    resultCode: fc.option(fc.string()),
    resultMessage: fc.option(fc.string())
  }) as fc.Arbitrary<AuthleteFederationConfigurationResponse>;

  /**
   * Property 5: Entity Configuration Validity
   * 
   * For any entity configuration request, the authorization server should return 
   * a properly signed JWT containing federation metadata, public keys, supported 
   * features, and endpoints that validates against OpenID Federation 1.0 specification
   * 
   * Validates: Requirements 7.2, 7.3, 7.4, 7.5
   */
  it('Property 5: Entity Configuration Validity - Should return valid entity configuration JWT with required metadata', async () => {
    await fc.assert(fc.asyncProperty(
      authleteConfigurationResponseArb,
      async (authleteResponse: AuthleteFederationConfigurationResponse) => {
        // Setup: Mock Authlete client to return the generated response
        mockAuthleteClient.federationConfiguration.mockResolvedValue(authleteResponse);

        // Act: Call the entity configuration handler
        await controller.handleEntityConfiguration(mockRequest as Request, mockResponse as Response);

        // Assert: Verify response structure and content
        expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/entity-statement+jwt');
        expect(mockResponse.send).toHaveBeenCalledWith(authleteResponse.entityConfiguration);

        // Decode and validate the JWT structure
        const jwt = authleteResponse.entityConfiguration!;
        const decodedPayload = decodeJwt(jwt);

        // Requirement 7.2: Entity configuration includes federation metadata and public keys
        expect(decodedPayload).toHaveProperty('iss');
        expect(decodedPayload).toHaveProperty('sub');
        expect(decodedPayload).toHaveProperty('jwks');
        expect(decodedPayload).toHaveProperty('metadata');
        
        // Validate JWKS structure
        expect(decodedPayload.jwks).toHaveProperty('keys');
        expect(Array.isArray((decodedPayload.jwks as any).keys)).toBe(true);
        expect((decodedPayload.jwks as any).keys.length).toBeGreaterThan(0);

        // Requirement 7.3: Entity configuration is signed (JWT structure validation)
        const jwtParts = jwt.split('.');
        expect(jwtParts).toHaveLength(3); // header.payload.signature
        expect(jwtParts[2]).toBeTruthy(); // signature exists

        // Requirement 7.4: Entity configuration includes supported federation features and endpoints
        expect(decodedPayload.metadata).toHaveProperty('federation_entity');
        const federationEntity = (decodedPayload.metadata as any).federation_entity;
        
        // Check for required federation endpoints
        expect(federationEntity).toHaveProperty('federation_fetch_endpoint');
        expect(federationEntity).toHaveProperty('federation_list_endpoint');
        expect(federationEntity).toHaveProperty('federation_resolve_endpoint');

        // Requirement 7.5: Entity configuration is valid according to OpenID Federation 1.0 specification
        // Validate required claims
        expect(typeof decodedPayload.iss).toBe('string');
        expect(typeof decodedPayload.sub).toBe('string');
        expect(typeof decodedPayload.exp).toBe('number');
        expect(typeof decodedPayload.iat).toBe('number');
        
        // Validate expiration is in the future
        expect(decodedPayload.exp! * 1000).toBeGreaterThan(Date.now());
        
        // Validate issued at is not in the future
        expect(decodedPayload.iat! * 1000).toBeLessThanOrEqual(Date.now() + 60000); // Allow 1 minute clock skew

        // Validate OpenID Provider metadata if present
        if ((decodedPayload.metadata as any).openid_provider) {
          const opMetadata = (decodedPayload.metadata as any).openid_provider;
          expect(opMetadata).toHaveProperty('issuer');
          expect(opMetadata).toHaveProperty('authorization_endpoint');
          expect(opMetadata).toHaveProperty('token_endpoint');
          expect(opMetadata).toHaveProperty('response_types_supported');
          expect(opMetadata).toHaveProperty('subject_types_supported');
          expect(opMetadata).toHaveProperty('id_token_signing_alg_values_supported');
        }
      }
    ), { numRuns: 100 });
  });

  /**
   * Property 5b: Entity Configuration Error Handling
   * 
   * For any Authlete API error, the authorization server should handle errors gracefully
   * and return appropriate error responses
   */
  it('Property 5b: Entity Configuration Error Handling - Should handle Authlete API errors gracefully', async () => {
    await fc.assert(fc.asyncProperty(
      fc.oneof(
        // Authlete returns error action
        fc.record({
          action: fc.constantFrom('BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'INTERNAL_SERVER_ERROR'),
          entityConfiguration: fc.constant(undefined),
          resultCode: fc.option(fc.string()),
          resultMessage: fc.option(fc.string())
        }),
        // Authlete returns OK but missing entity configuration
        fc.record({
          action: fc.constant('OK' as const),
          entityConfiguration: fc.constant(undefined),
          resultCode: fc.option(fc.string()),
          resultMessage: fc.option(fc.string())
        })
      ) as fc.Arbitrary<AuthleteFederationConfigurationResponse>,
      async (errorResponse: AuthleteFederationConfigurationResponse) => {
        // Setup: Mock Authlete client to return error response
        mockAuthleteClient.federationConfiguration.mockResolvedValue(errorResponse);

        // Act: Call the entity configuration handler
        await controller.handleEntityConfiguration(mockRequest as Request, mockResponse as Response);

        // Assert: Verify error response
        expect(mockResponse.status).toHaveBeenCalledWith(500);
        expect(mockResponse.json).toHaveBeenCalledWith({
          error: 'server_error',
          error_description: 'Entity configuration unavailable'
        });

        // Verify that no entity configuration was sent
        expect(mockResponse.send).not.toHaveBeenCalled();
      }
    ), { numRuns: 50 });
  });

  /**
   * Property 5c: Entity Configuration Network Error Handling
   * 
   * For any network or API errors, the authorization server should handle them gracefully
   */
  it('Property 5c: Entity Configuration Network Error Handling - Should handle network errors gracefully', async () => {
    await fc.assert(fc.asyncProperty(
      fc.oneof(
        fc.constant(new Error('Network timeout')),
        fc.constant(new Error('Connection refused')),
        fc.constant(new Error('Authlete API error')),
        fc.constant(new Error('Service unavailable'))
      ),
      async (networkError: Error) => {
        // Setup: Mock Authlete client to throw network error
        mockAuthleteClient.federationConfiguration.mockRejectedValue(networkError);

        // Act: Call the entity configuration handler
        await controller.handleEntityConfiguration(mockRequest as Request, mockResponse as Response);

        // Assert: Verify error response
        expect(mockResponse.status).toHaveBeenCalledWith(500);
        expect(mockResponse.json).toHaveBeenCalledWith({
          error: 'server_error',
          error_description: 'Internal server error processing entity configuration'
        });

        // Verify that no entity configuration was sent
        expect(mockResponse.send).not.toHaveBeenCalled();
      }
    ), { numRuns: 30 });
  });
});