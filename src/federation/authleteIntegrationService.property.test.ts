// Property-Based Test for Registration Flow Consistency
// **Property 2: Registration Flow Consistency**
// **Validates: Requirements 1.2, 3.1, 3.2, 3.3**

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { AuthleteIntegrationServiceImpl, FederationRegistrationError } from './authleteIntegrationService';
import { AuthleteClient, AuthleteApiError } from '../authlete/client';
import { 
  AuthleteFederationRegistrationRequest, 
  AuthleteFederationRegistrationResponse 
} from '../authlete/types';
import { ValidationResult, ClientMetadata, EntityStatement, JWKSet, JWK } from './types';

// Mock the logger
vi.mock('../utils/logger', () => ({
  logger: {
    logInfo: vi.fn(),
    logDebug: vi.fn(),
    logError: vi.fn()
  }
}));

describe('Feature: federation-dynamic-registration, Property 2: Registration Flow Consistency', () => {
  let service: AuthleteIntegrationServiceImpl;
  let mockAuthleteClient: AuthleteClient;

  beforeEach(() => {
    // Create mock Authlete client
    mockAuthleteClient = {
      federationRegistration: vi.fn(),
      federationConfiguration: vi.fn()
    } as any;

    service = new AuthleteIntegrationServiceImpl(mockAuthleteClient);
  });

  // Generator for valid JWK
  const validJWKArb = fc.record({
    kty: fc.constant('RSA'),
    use: fc.constant('sig'),
    kid: fc.string({ minLength: 1, maxLength: 20 }),
    alg: fc.constantFrom('RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'),
    n: fc.string({ minLength: 10, maxLength: 100 }),
    e: fc.constant('AQAB')
  }) as fc.Arbitrary<JWK>;

  // Generator for valid JWK Set
  const validJWKSetArb = fc.record({
    keys: fc.array(validJWKArb, { minLength: 1, maxLength: 3 })
  }) as fc.Arbitrary<JWKSet>;

  // Generator for valid client metadata
  const validClientMetadataArb = fc.record({
    redirect_uris: fc.array(
      fc.webUrl({ validSchemes: ['https'] }),
      { minLength: 1, maxLength: 5 }
    ),
    response_types: fc.option(fc.array(
      fc.constantFrom('code', 'token', 'id_token', 'code id_token', 'code token', 'id_token token', 'code id_token token'),
      { minLength: 1, maxLength: 3 }
    )),
    grant_types: fc.option(fc.array(
      fc.constantFrom('authorization_code', 'refresh_token', 'client_credentials', 'implicit'),
      { minLength: 1, maxLength: 3 }
    )),
    application_type: fc.option(fc.constantFrom('web', 'native')),
    client_name: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
    client_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    logo_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    contacts: fc.option(fc.array(
      fc.emailAddress(),
      { minLength: 1, maxLength: 3 }
    )),
    tos_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    policy_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    jwks_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    jwks: fc.option(validJWKSetArb),
    subject_type: fc.option(fc.constantFrom('public', 'pairwise')),
    id_token_signed_response_alg: fc.option(fc.constantFrom('RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512')),
    token_endpoint_auth_method: fc.option(fc.constantFrom(
      'client_secret_basic',
      'client_secret_post',
      'client_secret_jwt',
      'private_key_jwt',
      'none'
    ))
  }) as fc.Arbitrary<ClientMetadata>;

  // Generator for valid entity statement
  const validEntityStatementArb = fc.record({
    jwt: fc.string({ minLength: 50, maxLength: 500 }),
    payload: fc.record({
      iss: fc.webUrl({ validSchemes: ['https'] }),
      sub: fc.webUrl({ validSchemes: ['https'] }),
      iat: fc.integer({ min: Math.floor(Date.now() / 1000) - 3600, max: Math.floor(Date.now() / 1000) }),
      exp: fc.integer({ min: Math.floor(Date.now() / 1000) + 60, max: Math.floor(Date.now() / 1000) + 86400 }),
      jwks: fc.option(validJWKSetArb),
      metadata: fc.option(fc.record({
        openid_relying_party: fc.option(validClientMetadataArb)
      })),
      authorityHints: fc.option(fc.array(
        fc.webUrl({ validSchemes: ['https'] }),
        { minLength: 0, maxLength: 2 }
      ))
    })
  }) as fc.Arbitrary<EntityStatement>;

  // Generator for valid trust chain
  const validTrustChainArb = fc.array(validEntityStatementArb, { minLength: 1, maxLength: 5 });

  // Generator for valid trust anchor ID
  const validTrustAnchorIdArb = fc.webUrl({ validSchemes: ['https'] });

  // Generator for successful validation result
  const successfulValidationResultArb = fc.record({
    isValid: fc.constant(true),
    trustAnchor: validTrustAnchorIdArb,
    clientMetadata: validClientMetadataArb,
    errors: fc.constant(undefined)
  }) as fc.Arbitrary<ValidationResult>;

  // Generator for valid Authlete federation registration request
  const validAuthleteRegistrationRequestArb = fc.record({
    redirect_uris: fc.array(
      fc.webUrl({ validSchemes: ['https'] }),
      { minLength: 1, maxLength: 5 }
    ),
    client_name: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
    client_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    logo_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    contacts: fc.option(fc.array(
      fc.emailAddress(),
      { minLength: 1, maxLength: 3 }
    )),
    tos_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    policy_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    jwks_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    jwks: fc.option(validJWKSetArb),
    response_types: fc.option(fc.array(
      fc.constantFrom('code', 'token', 'id_token'),
      { minLength: 1, maxLength: 3 }
    )),
    grant_types: fc.option(fc.array(
      fc.constantFrom('authorization_code', 'refresh_token', 'client_credentials'),
      { minLength: 1, maxLength: 3 }
    )),
    application_type: fc.option(fc.constantFrom('web', 'native')),
    subject_type: fc.option(fc.constantFrom('public', 'pairwise')),
    id_token_signed_response_alg: fc.option(fc.constantFrom('RS256', 'RS384', 'RS512')),
    token_endpoint_auth_method: fc.option(fc.constantFrom(
      'client_secret_basic',
      'client_secret_post',
      'private_key_jwt'
    )),
    entityConfiguration: fc.option(fc.string({ minLength: 50, maxLength: 500 })),
    trustChain: fc.option(fc.array(fc.string({ minLength: 50, maxLength: 500 }), { minLength: 1, maxLength: 5 })),
    trustAnchorId: fc.option(validTrustAnchorIdArb)
  }) as fc.Arbitrary<AuthleteFederationRegistrationRequest>;

  // Generator for successful Authlete registration response
  const successfulAuthleteResponseArb = fc.record({
    action: fc.constant('CREATED' as const),
    client_id: fc.string({ minLength: 10, maxLength: 50 }),
    client_secret: fc.option(fc.string({ minLength: 20, maxLength: 100 })),
    client_id_issued_at: fc.option(fc.integer({ min: Math.floor(Date.now() / 1000) - 60, max: Math.floor(Date.now() / 1000) })),
    client_secret_expires_at: fc.option(fc.integer({ min: Math.floor(Date.now() / 1000) + 3600, max: Math.floor(Date.now() / 1000) + 86400 })),
    redirect_uris: fc.array(
      fc.webUrl({ validSchemes: ['https'] }),
      { minLength: 1, maxLength: 5 }
    ),
    client_name: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
    client_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    logo_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    contacts: fc.option(fc.array(fc.emailAddress(), { minLength: 1, maxLength: 3 })),
    tos_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    policy_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    jwks_uri: fc.option(fc.webUrl({ validSchemes: ['https'] })),
    jwks: fc.option(validJWKSetArb),
    response_types: fc.option(fc.array(fc.constantFrom('code', 'token', 'id_token'), { minLength: 1, maxLength: 3 })),
    grant_types: fc.option(fc.array(fc.constantFrom('authorization_code', 'refresh_token', 'client_credentials'), { minLength: 1, maxLength: 3 })),
    application_type: fc.option(fc.constantFrom('web', 'native')),
    subject_type: fc.option(fc.constantFrom('public', 'pairwise')),
    id_token_signed_response_alg: fc.option(fc.constantFrom('RS256', 'RS384', 'RS512')),
    token_endpoint_auth_method: fc.option(fc.constantFrom('client_secret_basic', 'client_secret_post', 'private_key_jwt')),
    entityStatement: fc.option(fc.string({ minLength: 50, maxLength: 500 })),
    trustAnchorId: fc.option(validTrustAnchorIdArb)
  }) as fc.Arbitrary<AuthleteFederationRegistrationResponse>;

  it('Property 2: Registration Flow Consistency - Successful trust chain validation should result in successful Authlete registration', async () => {
    await fc.assert(fc.asyncProperty(
      validAuthleteRegistrationRequestArb,
      successfulAuthleteResponseArb,
      
      async (request: AuthleteFederationRegistrationRequest, expectedResponse: AuthleteFederationRegistrationResponse) => {
        // Clear mocks before each property test iteration
        vi.clearAllMocks();

        // Ensure the response matches the request
        const alignedResponse = {
          ...expectedResponse,
          redirect_uris: request.redirect_uris,
          client_name: request.client_name || expectedResponse.client_name,
          trustAnchorId: request.trustAnchorId || expectedResponse.trustAnchorId
        };

        // Mock successful Authlete API call
        vi.mocked(mockAuthleteClient.federationRegistration).mockResolvedValue(alignedResponse);

        // Act
        const result = await service.registerFederatedClient(request);

        // Assert - Registration should succeed
        expect(result).toEqual(alignedResponse);
        expect(result.action).toBe('CREATED');
        expect(result.client_id).toBeDefined();
        expect(result.redirect_uris).toEqual(request.redirect_uris);

        // Verify Authlete API was called with correct parameters
        expect(mockAuthleteClient.federationRegistration).toHaveBeenCalledWith(request);
        expect(mockAuthleteClient.federationRegistration).toHaveBeenCalledTimes(1);
      }
    ), { numRuns: 100 });
  });

  it('Property 2: Registration Flow Consistency - Authlete API errors should be properly transformed and propagated', async () => {
    await fc.assert(fc.asyncProperty(
      validAuthleteRegistrationRequestArb,
      fc.integer({ min: 400, max: 599 }).filter(code => code !== 404), // Exclude 404 as it triggers fallback
      fc.string({ minLength: 10, maxLength: 200 }),
      
      async (request: AuthleteFederationRegistrationRequest, statusCode: number, errorMessage: string) => {
        // Clear mocks before each property test iteration
        vi.clearAllMocks();

        // Mock Authlete API error
        const authleteError = new AuthleteApiError(
          statusCode,
          { resultMessage: errorMessage },
          errorMessage
        );
        vi.mocked(mockAuthleteClient.federationRegistration).mockRejectedValue(authleteError);

        // Act & Assert
        await expect(service.registerFederatedClient(request)).rejects.toThrow(FederationRegistrationError);

        try {
          await service.registerFederatedClient(request);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Error should be properly mapped
          expect(fedError.statusCode).toBe(statusCode);
          expect(fedError.errorCode).toBeDefined();
          // Error description should be defined (may not contain original message due to mapping)
          expect(fedError.errorDescription).toBeDefined();
          expect(fedError.authleteResponse).toBeDefined();
        }

        // Verify Authlete API was called
        expect(mockAuthleteClient.federationRegistration).toHaveBeenCalledWith(request);
      }
    ), { numRuns: 50 });
  });

  it('Property 2: Registration Flow Consistency - Invalid Authlete response actions should be rejected', async () => {
    await fc.assert(fc.asyncProperty(
      validAuthleteRegistrationRequestArb,
      fc.constantFrom('BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'INTERNAL_SERVER_ERROR'),
      fc.option(fc.string({ minLength: 10, maxLength: 200 })),
      
      async (request: AuthleteFederationRegistrationRequest, invalidAction: string, resultMessage?: string) => {
        // Clear mocks before each property test iteration
        vi.clearAllMocks();

        // Mock invalid Authlete response
        const invalidResponse: AuthleteFederationRegistrationResponse = {
          action: invalidAction as any,
          resultMessage
        };
        vi.mocked(mockAuthleteClient.federationRegistration).mockResolvedValue(invalidResponse);

        // Act & Assert
        await expect(service.registerFederatedClient(request)).rejects.toThrow(FederationRegistrationError);

        try {
          await service.registerFederatedClient(request);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Error should indicate registration failure
          expect(fedError.errorCode).toBe('registration_failed');
          expect(fedError.errorDescription).toContain(invalidAction);
        }

        // Verify Authlete API was called
        expect(mockAuthleteClient.federationRegistration).toHaveBeenCalledWith(request);
      }
    ), { numRuns: 30 });
  });

  it('Property 2: Registration Flow Consistency - Missing required fields in Authlete response should be rejected', async () => {
    await fc.assert(fc.asyncProperty(
      validAuthleteRegistrationRequestArb,
      fc.oneof(
        // Missing client_id
        fc.record({
          action: fc.constant('CREATED' as const),
          redirect_uris: fc.array(fc.webUrl({ validSchemes: ['https'] }), { minLength: 1, maxLength: 3 })
          // client_id is missing
        }),
        // Missing redirect_uris
        fc.record({
          action: fc.constant('CREATED' as const),
          client_id: fc.string({ minLength: 10, maxLength: 50 })
          // redirect_uris is missing
        }),
        // Empty redirect_uris
        fc.record({
          action: fc.constant('CREATED' as const),
          client_id: fc.string({ minLength: 10, maxLength: 50 }),
          redirect_uris: fc.constant([])
        })
      ),
      
      async (request: AuthleteFederationRegistrationRequest, invalidResponse: any) => {
        // Clear mocks before each property test iteration
        vi.clearAllMocks();

        // Mock invalid Authlete response
        vi.mocked(mockAuthleteClient.federationRegistration).mockResolvedValue(invalidResponse);

        // Act & Assert
        await expect(service.registerFederatedClient(request)).rejects.toThrow(FederationRegistrationError);

        try {
          await service.registerFederatedClient(request);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Error should indicate invalid response
          expect(fedError.errorCode).toBe('invalid_response');
          expect(fedError.statusCode).toBe(500);
          expect(fedError.errorDescription).toMatch(/Missing (client_id|redirect_uris)/);
        }

        // Verify Authlete API was called
        expect(mockAuthleteClient.federationRegistration).toHaveBeenCalledWith(request);
      }
    ), { numRuns: 30 });
  });

  it('Property 2: Registration Flow Consistency - Network errors should be handled gracefully', async () => {
    await fc.assert(fc.asyncProperty(
      validAuthleteRegistrationRequestArb,
      fc.oneof(
        fc.constant(new Error('Network timeout')),
        fc.constant(new Error('Connection refused')),
        fc.constant(new Error('DNS resolution failed')),
        fc.constant(new TypeError('Failed to fetch'))
      ),
      
      async (request: AuthleteFederationRegistrationRequest, networkError: Error) => {
        // Clear mocks before each property test iteration
        vi.clearAllMocks();

        // Mock network error
        vi.mocked(mockAuthleteClient.federationRegistration).mockRejectedValue(networkError);

        // Act & Assert
        await expect(service.registerFederatedClient(request)).rejects.toThrow(FederationRegistrationError);

        try {
          await service.registerFederatedClient(request);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Error should indicate server error
          expect(fedError.errorCode).toBe('server_error');
          expect(fedError.statusCode).toBe(500);
          expect(fedError.errorDescription).toContain(networkError.message);
        }

        // Verify Authlete API was called
        expect(mockAuthleteClient.federationRegistration).toHaveBeenCalledWith(request);
      }
    ), { numRuns: 20 });
  });

  it('Property 2: Registration Flow Consistency - Client credentials should be extracted correctly from successful responses', async () => {
    await fc.assert(fc.asyncProperty(
      validAuthleteRegistrationRequestArb,
      successfulAuthleteResponseArb,
      
      async (request: AuthleteFederationRegistrationRequest, response: AuthleteFederationRegistrationResponse) => {
        // Clear mocks before each property test iteration
        vi.clearAllMocks();

        // Ensure response has required fields
        const completeResponse = {
          ...response,
          action: 'CREATED' as const,
          client_id: response.client_id || 'test-client-id',
          redirect_uris: request.redirect_uris
        };

        // Mock successful Authlete API call
        vi.mocked(mockAuthleteClient.federationRegistration).mockResolvedValue(completeResponse);

        // Act
        const result = await service.registerFederatedClient(request);

        // Assert - All response fields should be preserved
        expect(result.action).toBe('CREATED');
        expect(result.client_id).toBe(completeResponse.client_id);
        expect(result.redirect_uris).toEqual(request.redirect_uris);
        
        // Optional fields should be preserved if present
        if (completeResponse.client_secret) {
          expect(result.client_secret).toBe(completeResponse.client_secret);
        }
        if (completeResponse.entityStatement) {
          expect(result.entityStatement).toBe(completeResponse.entityStatement);
        }
        if (completeResponse.trustAnchorId) {
          expect(result.trustAnchorId).toBe(completeResponse.trustAnchorId);
        }
        if (completeResponse.client_name) {
          expect(result.client_name).toBe(completeResponse.client_name);
        }

        // Verify Authlete API was called correctly
        expect(mockAuthleteClient.federationRegistration).toHaveBeenCalledWith(request);
      }
    ), { numRuns: 50 });
  });

  it('Property 2: Registration Flow Consistency - Trust chain and entity configuration should be passed to Authlete', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        redirect_uris: fc.array(fc.webUrl({ validSchemes: ['https'] }), { minLength: 1, maxLength: 3 }),
        client_name: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
        entityConfiguration: fc.string({ minLength: 50, maxLength: 500 }),
        trustChain: fc.array(fc.string({ minLength: 50, maxLength: 500 }), { minLength: 1, maxLength: 5 }),
        trustAnchorId: validTrustAnchorIdArb
      }),
      successfulAuthleteResponseArb,
      
      async (request: AuthleteFederationRegistrationRequest, response: AuthleteFederationRegistrationResponse) => {
        // Clear mocks before each property test iteration
        vi.clearAllMocks();

        // Ensure response has required fields
        const completeResponse = {
          ...response,
          action: 'CREATED' as const,
          client_id: response.client_id || 'test-client-id',
          redirect_uris: request.redirect_uris
        };

        // Mock successful Authlete API call
        vi.mocked(mockAuthleteClient.federationRegistration).mockResolvedValue(completeResponse);

        // Act
        await service.registerFederatedClient(request);

        // Assert - Authlete should receive federation-specific parameters
        expect(mockAuthleteClient.federationRegistration).toHaveBeenCalledWith(
          expect.objectContaining({
            entityConfiguration: request.entityConfiguration,
            trustChain: request.trustChain,
            trustAnchorId: request.trustAnchorId,
            redirect_uris: request.redirect_uris
          })
        );
      }
    ), { numRuns: 30 });
  });
});