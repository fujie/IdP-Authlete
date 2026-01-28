// Federation Constants and Configuration

/**
 * Federation Grant Types
 */
export const FEDERATION_GRANT_TYPES = {
  AUTHORIZATION_CODE: 'authorization_code',
  REFRESH_TOKEN: 'refresh_token',
  CLIENT_CREDENTIALS: 'client_credentials'
} as const;

/**
 * Federation Response Types
 */
export const FEDERATION_RESPONSE_TYPES = {
  CODE: 'code',
  TOKEN: 'token',
  ID_TOKEN: 'id_token'
} as const;

/**
 * OpenID Federation 1.0 Constants
 */
export const FEDERATION_CONSTANTS = {
  // Well-known endpoints
  ENTITY_CONFIGURATION_PATH: '/.well-known/openid_federation',
  
  // JWT algorithms
  SUPPORTED_SIGNING_ALGORITHMS: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
  DEFAULT_SIGNING_ALGORITHM: 'RS256',
  
  // Trust chain limits
  MAX_TRUST_CHAIN_LENGTH: 10,
  DEFAULT_TRUST_CHAIN_TTL: 24 * 60 * 60, // 24 hours in seconds
  
  // Request object limits
  MAX_REQUEST_OBJECT_AGE: 60 * 60, // 1 hour in seconds
  REQUEST_OBJECT_CLOCK_SKEW: 5 * 60, // 5 minutes in seconds
  
  // Entity statement limits
  MAX_ENTITY_STATEMENT_AGE: 24 * 60 * 60, // 24 hours in seconds
  ENTITY_STATEMENT_CLOCK_SKEW: 5 * 60, // 5 minutes in seconds
  
  // Cache settings
  DEFAULT_CACHE_TTL: 60 * 60, // 1 hour in seconds
  MAX_CACHE_SIZE: 1000,
  
  // Rate limiting
  DEFAULT_RATE_LIMIT: 100, // requests per hour per entity
  RATE_LIMIT_WINDOW: 60 * 60, // 1 hour in seconds
  
  // Request size limits
  MAX_REQUEST_SIZE: 1024 * 1024, // 1MB in bytes
  
  // Grant types
  FEDERATION_GRANT_TYPES: FEDERATION_GRANT_TYPES,
  
  // Response types
  FEDERATION_RESPONSE_TYPES: FEDERATION_RESPONSE_TYPES,
  
  // Error codes
  ERRORS: {
    INVALID_CLIENT_METADATA: 'invalid_client_metadata',
    INVALID_REQUEST: 'invalid_request',
    INVALID_REQUEST_OBJECT: 'invalid_request_object',
    UNAUTHORIZED_CLIENT: 'unauthorized_client',
    ACCESS_DENIED: 'access_denied',
    UNSUPPORTED_RESPONSE_TYPE: 'unsupported_response_type',
    INVALID_SCOPE: 'invalid_scope',
    SERVER_ERROR: 'server_error',
    TEMPORARILY_UNAVAILABLE: 'temporarily_unavailable',
    // Federation-specific errors
    TRUST_CHAIN_VALIDATION_FAILED: 'trust_chain_validation_failed',
    ENTITY_STATEMENT_EXPIRED: 'entity_statement_expired',
    INVALID_TRUST_ANCHOR: 'invalid_trust_anchor',
    ENTITY_NOT_FOUND: 'entity_not_found',
    FEDERATION_FETCH_FAILED: 'federation_fetch_failed'
  }
} as const;

/**
 * Default Federation Configuration
 */
export const DEFAULT_FEDERATION_CONFIG = {
  // Trust anchor configuration
  trustAnchors: [
    'https://trust-anchor.example.com'
  ],
  
  // Entity configuration
  entityId: process.env.FEDERATION_ENTITY_ID || 'https://localhost:3001',
  
  // Security settings
  security: {
    maxTrustChainLength: FEDERATION_CONSTANTS.MAX_TRUST_CHAIN_LENGTH,
    trustChainCacheTtl: FEDERATION_CONSTANTS.DEFAULT_TRUST_CHAIN_TTL,
    requestObjectMaxAge: FEDERATION_CONSTANTS.MAX_REQUEST_OBJECT_AGE,
    clockSkew: FEDERATION_CONSTANTS.REQUEST_OBJECT_CLOCK_SKEW
  },
  
  // Cache settings
  cache: {
    ttl: FEDERATION_CONSTANTS.DEFAULT_CACHE_TTL,
    maxSize: FEDERATION_CONSTANTS.MAX_CACHE_SIZE
  },
  
  // Rate limiting
  rateLimit: {
    maxRequests: FEDERATION_CONSTANTS.DEFAULT_RATE_LIMIT,
    windowMs: FEDERATION_CONSTANTS.RATE_LIMIT_WINDOW
  },
  
  // Endpoints
  endpoints: {
    registration: '/federation/registration',
    entityConfiguration: FEDERATION_CONSTANTS.ENTITY_CONFIGURATION_PATH
  }
} as const;

/**
 * Federation HTTP Status Codes
 */
export const FEDERATION_HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
} as const;

/**
 * Federation Content Types
 */
export const FEDERATION_CONTENT_TYPES = {
  JWT: 'application/jwt',
  JSON: 'application/json',
  FORM_URLENCODED: 'application/x-www-form-urlencoded',
  ENTITY_STATEMENT: 'application/entity-statement+jwt'
} as const;

/**
 * Federation Application Types
 */
export const FEDERATION_APPLICATION_TYPES = {
  WEB: 'web',
  NATIVE: 'native'
} as const;

/**
 * Federation Subject Types
 */
export const FEDERATION_SUBJECT_TYPES = {
  PUBLIC: 'public',
  PAIRWISE: 'pairwise'
} as const;

/**
 * Federation Token Endpoint Auth Methods
 */
export const FEDERATION_TOKEN_AUTH_METHODS = {
  CLIENT_SECRET_BASIC: 'client_secret_basic',
  CLIENT_SECRET_POST: 'client_secret_post',
  CLIENT_SECRET_JWT: 'client_secret_jwt',
  PRIVATE_KEY_JWT: 'private_key_jwt',
  NONE: 'none'
} as const;