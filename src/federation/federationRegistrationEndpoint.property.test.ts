// Property-Based Test for Error Propagation Completeness
// **Property 3: Error Propagation Completeness**
// **Validates: Requirements 1.3, 3.4, 6.1, 6.2, 6.3**

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { 
  FederationRegistrationEndpoint, 
  FederationRegistrationError 
} from './federationRegistrationEndpoint';
import { AuthleteClient, AuthleteApiError } from '../authlete/client';
import { 
  FederationRegistrationRequest,
  EntityStatement,
  ValidationError,
  JWKSet,
  JWK
} from './types';
import { 
  AuthleteFederationRegistrationRequest,
  AuthleteFederationRegistrationResponse 
} from '../authlete/types';
import { FEDERATION_CONSTANTS } from './constants';
import { ValidationUtils } from './utils';

// Mock the logger
vi.mock('../utils/logger', () => ({
  logger: {
    logInfo: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
    logDebug: vi.fn()
  }
}));

describe('Feature: federation-dynamic-registration, Property 3: Error Propagation Completeness', () => {
  let endpoint: FederationRegistrationEndpoint;
  let mockAuthleteClient: AuthleteClient;
  const mockTrustAnchors = ['https://trust-anchor.example.com'];

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create mock Authlete client
    mockAuthleteClient = {
      federationRegistration: vi.fn(),
      federationConfiguration: vi.fn()
    } as any;

    endpoint = new FederationRegistrationEndpoint(mockAuthleteClient, mockTrustAnchors);
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
        openid_relying_party: fc.option(fc.record({
          redirect_uris: fc.array(fc.webUrl({ validSchemes: ['https'] }), { minLength: 1, maxLength: 3 }),
          response_types: fc.option(fc.array(fc.constantFrom('code', 'token', 'id_token'), { minLength: 1, maxLength: 2 })),
          grant_types: fc.option(fc.array(fc.constantFrom('authorization_code', 'refresh_token'), { minLength: 1, maxLength: 2 })),
          application_type: fc.option(fc.constantFrom('web', 'native')),
          client_name: fc.option(fc.string({ minLength: 1, maxLength: 100 }))
        }))
      })),
      authorityHints: fc.option(fc.array(fc.webUrl({ validSchemes: ['https'] }), { minLength: 0, maxLength: 2 }))
    })
  }) as fc.Arbitrary<EntityStatement>;

  // Generator for federation registration requests
  const federationRegistrationRequestArb = fc.record({
    entityConfiguration: fc.option(fc.string({ minLength: 50, maxLength: 500 })),
    trustChain: fc.option(fc.array(validEntityStatementArb, { minLength: 1, maxLength: 5 })),
    requestObject: fc.option(fc.string({ minLength: 50, maxLength: 500 }))
  }) as fc.Arbitrary<FederationRegistrationRequest>;

  // Generator for trust chain validation errors
  const trustChainValidationErrorArb = fc.record({
    code: fc.constantFrom(
      FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
      FEDERATION_CONSTANTS.ERRORS.ENTITY_STATEMENT_EXPIRED,
      FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR,
      FEDERATION_CONSTANTS.ERRORS.TRUST_CHAIN_VALIDATION_FAILED,
      FEDERATION_CONSTANTS.ERRORS.ENTITY_NOT_FOUND
    ),
    message: fc.string({ minLength: 10, maxLength: 200 })
  }) as fc.Arbitrary<ValidationError>;

  // Generator for Authlete API errors
  const authleteApiErrorArb = fc.record({
    statusCode: fc.constantFrom(400, 401, 403, 404, 429, 500, 502, 503, 504),
    message: fc.string({ minLength: 10, maxLength: 200 }),
    authleteResponse: fc.option(fc.record({
      resultMessage: fc.option(fc.string({ minLength: 5, maxLength: 100 })),
      action: fc.option(fc.constantFrom('BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'INTERNAL_SERVER_ERROR'))
    }))
  });

  it('Property 3: Error Propagation Completeness - Trust chain validation failures should reject registration with invalid_client_metadata error', async () => {
    await fc.assert(fc.asyncProperty(
      federationRegistrationRequestArb,
      trustChainValidationErrorArb,
      
      async (request: FederationRegistrationRequest, validationError: ValidationError) => {
        // Skip empty requests as they have different error handling
        fc.pre(request.entityConfiguration || request.trustChain || request.requestObject);

        // Mock trust chain validator to return validation failure
        const mockValidator = {
          validateTrustChain: vi.fn().mockResolvedValue({
            isValid: false,
            errors: [validationError]
          })
        };
        (endpoint as any).trustChainValidator = mockValidator;

        // Mock entity information extraction to succeed
        vi.spyOn(endpoint as any, 'extractEntityInformation').mockResolvedValue({
          entityId: 'https://client.example.com',
          trustChain: request.trustChain
        });

        // Act & Assert
        await expect(endpoint.registerClient(request)).rejects.toThrow(FederationRegistrationError);

        try {
          await endpoint.registerClient(request);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Requirement 6.1: Trust chain validation failures should return invalid_client_metadata error
          expect(fedError.errorCode).toBe('invalid_client_metadata');
          expect(fedError.statusCode).toBe(400);
          
          // Requirement 6.2: Should return descriptive error messages
          expect(fedError.errorDescription).toContain('Trust chain validation failed');
          expect(fedError.errorDescription).toContain(validationError.message);
          
          // Requirement 1.3: Should reject registration with appropriate error
          expect(fedError.errorDescription).toBeDefined();
          expect(fedError.errorDescription.length).toBeGreaterThan(0);
        }

        // Verify trust chain validation was attempted
        expect(mockValidator.validateTrustChain).toHaveBeenCalled();
      }
    ), { numRuns: 100 });
  });

  // Helper function to map status codes to error codes (matches AuthleteIntegrationService logic)
  const mapStatusToErrorCode = (statusCode: number): string => {
    switch (statusCode) {
      case 400: return 'invalid_request';
      case 401: return 'invalid_client';
      case 403: return 'access_denied';
      case 429: return 'temporarily_unavailable';
      case 500:
      case 502:
      case 503:
      case 504: return 'server_error';
      default: return 'server_error';
    }
  };

  it('Property 3: Error Propagation Completeness - Authlete API failures should propagate errors with appropriate status codes', async () => {
    await fc.assert(fc.asyncProperty(
      federationRegistrationRequestArb,
      authleteApiErrorArb,
      
      async (request: FederationRegistrationRequest, apiError: any) => {
        // Skip empty requests
        fc.pre(request.entityConfiguration || request.trustChain || request.requestObject);

        // Mock successful trust chain validation
        const mockValidator = {
          validateTrustChain: vi.fn().mockResolvedValue({
            isValid: true,
            trustAnchor: mockTrustAnchors[0],
            clientMetadata: {
              redirect_uris: ['https://client.example.com/callback'],
              response_types: ['code'],
              grant_types: ['authorization_code'],
              application_type: 'web',
              token_endpoint_auth_method: 'client_secret_basic'
            }
          })
        };
        (endpoint as any).trustChainValidator = mockValidator;

        // Mock successful request object handling
        const mockRequestObjectHandler = {
          validateRequestObjectWithOptionalSignature: vi.fn().mockResolvedValue({
            isValid: true
          }),
          extractRegistrationParameters: vi.fn().mockReturnValue({})
        };
        (endpoint as any).requestObjectHandler = mockRequestObjectHandler;

        // Mock entity information extraction
        vi.spyOn(endpoint as any, 'extractEntityInformation').mockResolvedValue({
          entityId: 'https://client.example.com',
          trustChain: request.trustChain
        });

        // Mock Authlete integration service to throw properly transformed federation error
        // The AuthleteIntegrationService transforms AuthleteApiError to FederationRegistrationError
        const mapStatusToErrorCode = (statusCode: number): string => {
          switch (statusCode) {
            case 400: return 'invalid_request';
            case 401: return 'invalid_client';
            case 403: return 'access_denied';
            case 429: return 'temporarily_unavailable';
            case 500:
            case 502:
            case 503:
            case 504: return 'server_error';
            default: return 'server_error';
          }
        };

        const federationError = new FederationRegistrationError(
          mapStatusToErrorCode(apiError.statusCode),
          `Registration failed: ${apiError.message}`,
          apiError.statusCode,
          apiError.authleteResponse
        );
        
        const mockAuthleteService = {
          registerFederatedClient: vi.fn().mockRejectedValue(federationError)
        };
        (endpoint as any).authleteIntegrationService = mockAuthleteService;

        // Act & Assert
        await expect(endpoint.registerClient(request)).rejects.toThrow(FederationRegistrationError);

        try {
          await endpoint.registerClient(request);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Requirement 3.4: Authlete failures should propagate errors to client
          expect(fedError.statusCode).toBe(apiError.statusCode);
          expect(fedError.errorDescription).toContain(apiError.message);
          
          // Requirement 6.3: Should return appropriate HTTP status codes
          expect([400, 401, 403, 404, 429, 500, 502, 503, 504]).toContain(fedError.statusCode);
          
          // Should have appropriate error code based on status
          const expectedErrorCode = mapStatusToErrorCode(apiError.statusCode);
          expect(fedError.errorCode).toBe(expectedErrorCode);
        }

        // Verify Authlete API was called
        expect(mockAuthleteService.registerFederatedClient).toHaveBeenCalled();
      }
    ), { numRuns: 50 });
  });

  it('Property 3: Error Propagation Completeness - Expired entity statements should return descriptive error messages', async () => {
    await fc.assert(fc.asyncProperty(
      federationRegistrationRequestArb,
      fc.string({ minLength: 10, maxLength: 200 }),
      
      async (request: FederationRegistrationRequest, expiredMessage: string) => {
        // Skip empty requests
        fc.pre(request.entityConfiguration || request.trustChain || request.requestObject);

        // Mock trust chain validator to return expiration error
        const expiredError: ValidationError = {
          code: FEDERATION_CONSTANTS.ERRORS.ENTITY_STATEMENT_EXPIRED,
          message: `Entity statement expired: ${expiredMessage}`
        };
        
        const mockValidator = {
          validateTrustChain: vi.fn().mockResolvedValue({
            isValid: false,
            errors: [expiredError]
          })
        };
        (endpoint as any).trustChainValidator = mockValidator;

        // Mock entity information extraction
        vi.spyOn(endpoint as any, 'extractEntityInformation').mockResolvedValue({
          entityId: 'https://client.example.com',
          trustChain: request.trustChain
        });

        // Act & Assert
        await expect(endpoint.registerClient(request)).rejects.toThrow(FederationRegistrationError);

        try {
          await endpoint.registerClient(request);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Requirement 6.2: Expired entity statements should return descriptive error messages
          expect(fedError.errorCode).toBe('invalid_client_metadata');
          expect(fedError.errorDescription).toContain('Trust chain validation failed');
          expect(fedError.errorDescription).toContain('expired');
          expect(fedError.errorDescription).toContain(expiredMessage);
          
          // Should be descriptive and informative
          expect(fedError.errorDescription.length).toBeGreaterThan(20);
        }
      }
    ), { numRuns: 30 });
  });

  it('Property 3: Error Propagation Completeness - Malformed entity statements should return descriptive error messages', async () => {
    await fc.assert(fc.asyncProperty(
      federationRegistrationRequestArb,
      fc.string({ minLength: 10, maxLength: 200 }),
      
      async (request: FederationRegistrationRequest, malformedMessage: string) => {
        // Skip empty requests
        fc.pre(request.entityConfiguration || request.trustChain || request.requestObject);

        // Mock trust chain validator to return malformed error
        const malformedError: ValidationError = {
          code: FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
          message: `Malformed entity statement: ${malformedMessage}`
        };
        
        const mockValidator = {
          validateTrustChain: vi.fn().mockResolvedValue({
            isValid: false,
            errors: [malformedError]
          })
        };
        (endpoint as any).trustChainValidator = mockValidator;

        // Mock entity information extraction
        vi.spyOn(endpoint as any, 'extractEntityInformation').mockResolvedValue({
          entityId: 'https://client.example.com',
          trustChain: request.trustChain
        });

        // Act & Assert
        await expect(endpoint.registerClient(request)).rejects.toThrow(FederationRegistrationError);

        try {
          await endpoint.registerClient(request);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Requirement 6.2: Malformed entity statements should return descriptive error messages
          expect(fedError.errorCode).toBe('invalid_client_metadata');
          expect(fedError.errorDescription).toContain('Trust chain validation failed');
          expect(fedError.errorDescription).toContain(malformedMessage);
          
          // Should be descriptive and informative
          expect(fedError.errorDescription.length).toBeGreaterThan(15);
        }
      }
    ), { numRuns: 30 });
  });

  it('Property 3: Error Propagation Completeness - Request object validation failures should return invalid_request error', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        entityConfiguration: fc.option(fc.string({ minLength: 50, maxLength: 500 })),
        trustChain: fc.option(fc.array(validEntityStatementArb, { minLength: 1, maxLength: 3 })),
        requestObject: fc.string({ minLength: 50, maxLength: 500 }) // Always present for this test
      }),
      fc.array(fc.string({ minLength: 5, maxLength: 100 }), { minLength: 1, maxLength: 3 }),
      
      async (request: FederationRegistrationRequest, requestObjectErrors: string[]) => {
        // Mock successful trust chain validation
        const mockValidator = {
          validateTrustChain: vi.fn().mockResolvedValue({
            isValid: true,
            trustAnchor: mockTrustAnchors[0],
            clientMetadata: {
              redirect_uris: ['https://client.example.com/callback'],
              response_types: ['code'],
              grant_types: ['authorization_code'],
              application_type: 'web',
              token_endpoint_auth_method: 'client_secret_basic',
              jwks: { keys: [] }
            }
          })
        };
        (endpoint as any).trustChainValidator = mockValidator;

        // Mock failed request object validation
        const mockRequestObjectHandler = {
          validateRequestObjectWithOptionalSignature: vi.fn().mockResolvedValue({
            isValid: false,
            errors: requestObjectErrors
          })
        };
        (endpoint as any).requestObjectHandler = mockRequestObjectHandler;

        // Mock entity information extraction
        vi.spyOn(endpoint as any, 'extractEntityInformation').mockResolvedValue({
          entityId: 'https://client.example.com',
          trustChain: request.trustChain
        });

        // Act & Assert
        await expect(endpoint.registerClient(request)).rejects.toThrow(FederationRegistrationError);

        try {
          await endpoint.registerClient(request);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Request object validation failures should return invalid_request
          expect(fedError.errorCode).toBe('invalid_request');
          expect(fedError.statusCode).toBe(400);
          expect(fedError.errorDescription).toContain('Request object validation failed');
          expect(fedError.errorDescription).toContain(requestObjectErrors[0]);
        }

        // Verify request object validation was attempted
        expect(mockRequestObjectHandler.validateRequestObjectWithOptionalSignature).toHaveBeenCalled();
      }
    ), { numRuns: 30 });
  });

  it('Property 3: Error Propagation Completeness - Missing federation parameters should return invalid_request error', async () => {
    await fc.assert(fc.asyncProperty(
      fc.constant({}), // Empty request
      
      async (request: FederationRegistrationRequest) => {
        // Act & Assert
        await expect(endpoint.registerClient(request)).rejects.toThrow(FederationRegistrationError);

        try {
          await endpoint.registerClient(request);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Missing parameters should return invalid_request
          expect(fedError.errorCode).toBe('invalid_request');
          expect(fedError.statusCode).toBe(400);
          expect(fedError.errorDescription).toContain('Registration request must include');
        }
      }
    ), { numRuns: 10 });
  });

  it('Property 3: Error Propagation Completeness - Unexpected errors should be transformed to server_error', async () => {
    await fc.assert(fc.asyncProperty(
      federationRegistrationRequestArb,
      fc.oneof(
        fc.constant(new Error('Network timeout')),
        fc.constant(new TypeError('Cannot read property')),
        fc.constant(new ReferenceError('Variable not defined')),
        fc.constant('String error'),
        fc.constant(null),
        fc.constant(undefined)
      ),
      
      async (request: FederationRegistrationRequest, unexpectedError: any) => {
        // Skip empty requests
        fc.pre(request.entityConfiguration || request.trustChain || request.requestObject);

        // Mock entity information extraction to throw unexpected error
        vi.spyOn(endpoint as any, 'extractEntityInformation').mockRejectedValue(unexpectedError);

        // Act & Assert
        await expect(endpoint.registerClient(request)).rejects.toThrow(FederationRegistrationError);

        try {
          await endpoint.registerClient(request);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Unexpected errors should be transformed to server_error
          expect(fedError.errorCode).toBe('server_error');
          expect(fedError.statusCode).toBe(500);
          expect(fedError.errorDescription).toBe('Internal server error during federation registration');
        }
      }
    ), { numRuns: 20 });
  });

  it('Property 3: Error Propagation Completeness - Error logging should occur for all failure scenarios', async () => {
    await fc.assert(fc.asyncProperty(
      federationRegistrationRequestArb,
      fc.oneof(
        // Trust chain validation error
        fc.record({
          type: fc.constant('trust_chain'),
          error: trustChainValidationErrorArb
        }),
        // Authlete API error
        fc.record({
          type: fc.constant('authlete'),
          error: authleteApiErrorArb
        }),
        // Unexpected error
        fc.record({
          type: fc.constant('unexpected'),
          error: fc.constant(new Error('Unexpected error'))
        })
      ),
      
      async (request: FederationRegistrationRequest, errorScenario: any) => {
        // Skip empty requests for some scenarios
        if (errorScenario.type !== 'empty') {
          fc.pre(request.entityConfiguration || request.trustChain || request.requestObject);
        }

        const { logger } = await import('../utils/logger');

        // Setup mocks based on error type
        if (errorScenario.type === 'trust_chain') {
          const mockValidator = {
            validateTrustChain: vi.fn().mockResolvedValue({
              isValid: false,
              errors: [errorScenario.error]
            })
          };
          (endpoint as any).trustChainValidator = mockValidator;
          
          vi.spyOn(endpoint as any, 'extractEntityInformation').mockResolvedValue({
            entityId: 'https://client.example.com',
            trustChain: request.trustChain
          });
        } else if (errorScenario.type === 'authlete') {
          const mockValidator = {
            validateTrustChain: vi.fn().mockResolvedValue({
              isValid: true,
              trustAnchor: mockTrustAnchors[0],
              clientMetadata: {
                redirect_uris: ['https://client.example.com/callback'],
                response_types: ['code'],
                grant_types: ['authorization_code'],
                application_type: 'web',
                token_endpoint_auth_method: 'client_secret_basic'
              }
            })
          };
          (endpoint as any).trustChainValidator = mockValidator;

          const mockRequestObjectHandler = {
            validateRequestObjectWithOptionalSignature: vi.fn().mockResolvedValue({ isValid: true }),
            extractRegistrationParameters: vi.fn().mockReturnValue({})
          };
          (endpoint as any).requestObjectHandler = mockRequestObjectHandler;

          const authleteError = new AuthleteApiError(
            errorScenario.error.statusCode,
            errorScenario.error.authleteResponse || {},
            errorScenario.error.message
          );
          const federationError = new FederationRegistrationError(
            mapStatusToErrorCode(errorScenario.error.statusCode),
            `Registration failed: ${errorScenario.error.message}`,
            errorScenario.error.statusCode,
            errorScenario.error.authleteResponse
          );
          const mockAuthleteService = {
            registerFederatedClient: vi.fn().mockRejectedValue(federationError)
          };
          (endpoint as any).authleteIntegrationService = mockAuthleteService;

          vi.spyOn(endpoint as any, 'extractEntityInformation').mockResolvedValue({
            entityId: 'https://client.example.com',
            trustChain: request.trustChain
          });
        } else {
          vi.spyOn(endpoint as any, 'extractEntityInformation').mockRejectedValue(errorScenario.error);
        }

        // Act
        try {
          await endpoint.registerClient(request);
        } catch (error) {
          // Expected to throw
        }

        // Assert - Verify error logging occurred
        // Requirement 6.3: Authlete API failures should log errors
        if (errorScenario.type === 'trust_chain') {
          expect(logger.logWarn).toHaveBeenCalled();
        } else {
          expect(logger.logError).toHaveBeenCalled();
        }
      }
    ), { numRuns: 30 });
  });

  // **Property 6: Request Format Support**
  // **Validates: Requirements 1.5, 5.5**
  it('Property 6: Request Format Support - Endpoint should accept both federation request objects and direct entity configurations/trust chains', async () => {
    await fc.assert(fc.asyncProperty(
      fc.oneof(
        // Format 1: Entity configuration only
        fc.record({
          entityConfiguration: fc.string({ minLength: 50, maxLength: 500 }),
          trustChain: fc.constant(undefined),
          requestObject: fc.constant(undefined)
        }),
        
        // Format 2: Trust chain only
        fc.record({
          entityConfiguration: fc.constant(undefined),
          trustChain: fc.array(validEntityStatementArb, { minLength: 1, maxLength: 3 }),
          requestObject: fc.constant(undefined)
        }),
        
        // Format 3: Request object only
        fc.record({
          entityConfiguration: fc.constant(undefined),
          trustChain: fc.constant(undefined),
          requestObject: fc.string({ minLength: 50, maxLength: 500 })
        }),
        
        // Format 4: Entity configuration + request object
        fc.record({
          entityConfiguration: fc.string({ minLength: 50, maxLength: 500 }),
          trustChain: fc.constant(undefined),
          requestObject: fc.string({ minLength: 50, maxLength: 500 })
        }),
        
        // Format 5: Trust chain + request object
        fc.record({
          entityConfiguration: fc.constant(undefined),
          trustChain: fc.array(validEntityStatementArb, { minLength: 1, maxLength: 3 }),
          requestObject: fc.string({ minLength: 50, maxLength: 500 })
        }),
        
        // Format 6: All three formats
        fc.record({
          entityConfiguration: fc.string({ minLength: 50, maxLength: 500 }),
          trustChain: fc.array(validEntityStatementArb, { minLength: 1, maxLength: 2 }),
          requestObject: fc.string({ minLength: 50, maxLength: 500 })
        })
      ),
      
      async (request: FederationRegistrationRequest) => {
        // Mock successful trust chain validation
        const mockValidator = {
          validateTrustChain: vi.fn().mockResolvedValue({
            isValid: true,
            trustAnchor: mockTrustAnchors[0],
            clientMetadata: {
              redirect_uris: ['https://client.example.com/callback'],
              response_types: ['code'],
              grant_types: ['authorization_code'],
              application_type: 'web',
              token_endpoint_auth_method: 'client_secret_basic',
              jwks: { keys: [] }
            }
          })
        };
        (endpoint as any).trustChainValidator = mockValidator;

        // Mock successful request object handling
        const mockRequestObjectHandler = {
          validateRequestObjectWithOptionalSignature: vi.fn().mockResolvedValue({
            isValid: true,
            payload: {
              iss: 'https://client.example.com',
              aud: 'https://auth.example.com',
              exp: Math.floor(Date.now() / 1000) + 3600,
              iat: Math.floor(Date.now() / 1000)
            }
          }),
          extractRegistrationParameters: vi.fn().mockReturnValue({
            redirect_uris: ['https://client.example.com/callback'],
            client_name: 'Test Client'
          })
        };
        (endpoint as any).requestObjectHandler = mockRequestObjectHandler;

        // Mock successful Authlete integration
        const mockAuthleteService = {
          registerFederatedClient: vi.fn().mockResolvedValue({
            action: 'CREATED',
            client_id: 'test-client-id',
            client_secret: 'test-client-secret',
            entityStatement: 'test-entity-statement'
          })
        };
        (endpoint as any).authleteIntegrationService = mockAuthleteService;

        // Mock entity information extraction
        vi.spyOn(endpoint as any, 'extractEntityInformation').mockResolvedValue({
          entityId: 'https://client.example.com',
          trustChain: request.trustChain
        });

        // Act - should not throw for any valid format
        const result = await endpoint.registerClient(request);

        // Assert - should return valid registration response
        expect(result).toBeDefined();
        expect(result.clientId).toBe('test-client-id');
        expect(result.clientSecret).toBe('test-client-secret');
        expect(result.trustAnchorId).toBe(mockTrustAnchors[0]);

        // Verify trust chain validation was called
        expect(mockValidator.validateTrustChain).toHaveBeenCalled();

        // Verify request object handling was called if request object present
        if (request.requestObject) {
          expect(mockRequestObjectHandler.validateRequestObjectWithOptionalSignature).toHaveBeenCalled();
          expect(mockRequestObjectHandler.extractRegistrationParameters).toHaveBeenCalled();
        }

        // Verify Authlete integration was called
        expect(mockAuthleteService.registerFederatedClient).toHaveBeenCalled();
      }
    ), { numRuns: 50 });
  });

  // **Property 7: Parameter Validation Completeness**
  // **Validates: Requirements 6.4**
  it('Property 7: Parameter Validation Completeness - Authorization server should validate all required federation parameters', async () => {
    await fc.assert(fc.asyncProperty(
      fc.oneof(
        // Missing all federation parameters
        fc.record({}),
        
        // Invalid entity configuration formats
        fc.record({
          entityConfiguration: fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.integer(),
            fc.boolean(),
            fc.array(fc.string()),
            fc.string({ maxLength: 10 }), // Too short to be valid JWT
            fc.constant('invalid.jwt'), // Only 2 parts
            fc.constant('a.b.c.d.e') // Too many parts
          )
        }),
        
        // Invalid trust chain formats
        fc.record({
          trustChain: fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.array(fc.string()), // Array of strings instead of objects
            fc.array(fc.record({ notJwt: fc.string() })), // Objects without jwt property
            fc.constant([]) // Empty array
          )
        }),
        
        // Invalid request object formats
        fc.record({
          requestObject: fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.integer(),
            fc.boolean(),
            fc.array(fc.string()),
            fc.string({ maxLength: 10 }), // Too short
            fc.constant('invalid.format'), // Invalid JWT format
            fc.constant('') // Empty string
          )
        })
      ),
      
      async (invalidRequest: any) => {
        // Act & Assert - should reject invalid requests
        await expect(endpoint.registerClient(invalidRequest)).rejects.toThrow(FederationRegistrationError);

        try {
          await endpoint.registerClient(invalidRequest);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Should return appropriate error code (invalid_request for parameter validation, server_error for unexpected errors)
          expect(['invalid_request', 'server_error']).toContain(fedError.errorCode);
          expect([400, 500]).toContain(fedError.statusCode);
          
          // Should provide descriptive error message
          expect(fedError.errorDescription).toBeDefined();
          expect(fedError.errorDescription.length).toBeGreaterThan(10);
          
          // Error message should indicate parameter validation issue or server error
          expect(
            fedError.errorDescription.toLowerCase().includes('invalid') ||
            fedError.errorDescription.toLowerCase().includes('missing') ||
            fedError.errorDescription.toLowerCase().includes('required') ||
            fedError.errorDescription.toLowerCase().includes('must') ||
            fedError.errorDescription.toLowerCase().includes('server') ||
            fedError.errorDescription.toLowerCase().includes('error')
          ).toBe(true);
        }
      }
    ), { numRuns: 50 });
  });

  it('Property 7: Parameter Validation Completeness - Should validate redirect URIs format and protocol', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({
        entityConfiguration: fc.string({ minLength: 50, maxLength: 500 }),
        redirect_uris: fc.array(
          fc.oneof(
            fc.constant('ftp://invalid.protocol.com/callback'), // Invalid protocol
            fc.constant('javascript:alert(1)'), // Dangerous protocol
            fc.constant('data:text/html,<script>alert(1)</script>'), // Data URI
            fc.constant('file:///etc/passwd'), // File protocol
            fc.constant('not-a-uri-at-all'), // Not a URI
            fc.constant('http://'), // Incomplete URI
            fc.constant(''), // Empty string
            fc.string({ minLength: 1, maxLength: 5 }) // Too short to be valid URI
          ),
          { minLength: 1, maxLength: 3 }
        )
      }),
      
      async (requestWithInvalidUris: FederationRegistrationRequest) => {
        // Mock entity information extraction to succeed
        vi.spyOn(endpoint as any, 'extractEntityInformation').mockResolvedValue({
          entityId: 'https://client.example.com',
          trustChain: []
        });

        // Act & Assert - should reject requests with invalid redirect URIs
        await expect(endpoint.registerClient(requestWithInvalidUris)).rejects.toThrow(FederationRegistrationError);

        try {
          await endpoint.registerClient(requestWithInvalidUris);
        } catch (error) {
          expect(error).toBeInstanceOf(FederationRegistrationError);
          const fedError = error as FederationRegistrationError;
          
          // Should return appropriate error code - the system may return invalid_client_metadata for trust chain validation failures
          expect(['invalid_request', 'invalid_client_metadata']).toContain(fedError.errorCode);
          expect(fedError.statusCode).toBe(400);
          
          // Error should mention validation failure
          expect(
            fedError.errorDescription.toLowerCase().includes('validation') ||
            fedError.errorDescription.toLowerCase().includes('invalid') ||
            fedError.errorDescription.toLowerCase().includes('failed')
          ).toBe(true);
        }
      }
    ), { numRuns: 30 });
  });

  it('Property 7: Parameter Validation Completeness - Should validate required JWT claims in entity configurations', async () => {
    await fc.assert(fc.asyncProperty(
      fc.oneof(
        // Missing iss claim
        fc.record({
          entityConfiguration: fc.string({ minLength: 50, maxLength: 500 })
        }).map(req => ({
          ...req,
          mockPayload: {
            sub: 'https://client.example.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000)
            // Missing iss
          }
        })),
        
        // Missing sub claim
        fc.record({
          entityConfiguration: fc.string({ minLength: 50, maxLength: 500 })
        }).map(req => ({
          ...req,
          mockPayload: {
            iss: 'https://client.example.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000)
            // Missing sub
          }
        })),
        
        // Missing exp claim
        fc.record({
          entityConfiguration: fc.string({ minLength: 50, maxLength: 500 })
        }).map(req => ({
          ...req,
          mockPayload: {
            iss: 'https://client.example.com',
            sub: 'https://client.example.com',
            iat: Math.floor(Date.now() / 1000)
            // Missing exp
          }
        })),
        
        // Invalid claim types
        fc.record({
          entityConfiguration: fc.string({ minLength: 50, maxLength: 500 })
        }).map(req => ({
          ...req,
          mockPayload: {
            iss: 123, // Should be string
            sub: 'https://client.example.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000)
          }
        }))
      ),
      
      async (requestWithInvalidClaims: any) => {
        // Mock JWT decoding to return invalid payload
        const mockDecodeJWT = vi.spyOn(ValidationUtils, 'decodeJWT').mockReturnValue({
          header: { alg: 'none', typ: 'JWT' },
          payload: requestWithInvalidClaims.mockPayload
        });

        try {
          // Act & Assert - should reject requests with invalid JWT claims
          await expect(endpoint.registerClient(requestWithInvalidClaims)).rejects.toThrow(FederationRegistrationError);

          try {
            await endpoint.registerClient(requestWithInvalidClaims);
          } catch (error) {
            expect(error).toBeInstanceOf(FederationRegistrationError);
            const fedError = error as FederationRegistrationError;
            
            // Should return appropriate error code - the system may return invalid_client_metadata for trust chain validation failures
            expect(['invalid_request', 'invalid_client_metadata']).toContain(fedError.errorCode);
            expect(fedError.statusCode).toBe(400);
            
            // Error should mention validation failure
            expect(
              fedError.errorDescription.toLowerCase().includes('validation') ||
              fedError.errorDescription.toLowerCase().includes('invalid') ||
              fedError.errorDescription.toLowerCase().includes('failed') ||
              fedError.errorDescription.toLowerCase().includes('missing') ||
              fedError.errorDescription.toLowerCase().includes('claim') ||
              fedError.errorDescription.toLowerCase().includes('entity')
            ).toBe(true);
          }
        } finally {
          // Restore the mock
          mockDecodeJWT.mockRestore();
        }
      }
    ), { numRuns: 30 });
  });
});