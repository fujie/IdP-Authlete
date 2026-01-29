// Authlete API request/response types based on the design document

export interface AuthorizationRequest {
  parameters: string;  // URL-encoded query parameters
  clientId?: string;   // Optional for validation
}

export interface AuthorizationResponse {
  action: 'INTERACTION' | 'NO_INTERACTION' | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR';
  ticket: string;
  client: ClientInfo;
  service: ServiceInfo;
  scopes?: ScopeInfo[];
  responseContent?: string;
}

export interface AuthorizationIssueRequest {
  ticket: string;
  subject: string;
}

export interface AuthorizationIssueResponse {
  action: 'LOCATION' | 'OK' | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR';
  responseContent: string;
  authorizationCode?: string;
}

export interface AuthorizationFailRequest {
  ticket: string;
  reason: 'UNKNOWN' | 'ACCESS_DENIED' | 'SERVER_ERROR';
}

export interface AuthorizationFailResponse {
  action: 'LOCATION' | 'OK' | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR';
  responseContent: string;
}

export interface TokenRequest {
  parameters: string;  // URL-encoded form parameters
  clientId?: string;   // For client authentication
  clientSecret?: string;
}

export interface TokenResponse {
  action: 'OK' | 'INVALID_CLIENT' | 'INVALID_REQUEST' | 'INVALID_GRANT' | 'INTERNAL_SERVER_ERROR';
  responseContent: string;  // JSON token response
  accessToken?: string;
  refreshToken?: string;
  accessTokenDuration?: number;
  idToken?: string;  // OpenID Connect ID Token
}

export interface IntrospectionRequest {
  token: string;
  scopes?: string[];
  subject?: string;
}

export interface IntrospectionResponse {
  action: 'OK' | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR';
  responseContent?: string;
  active: boolean;
  clientId?: number;
  subject?: string;
  scopes?: string[];
  expiresAt?: number;
}

export interface ClientInfo {
  clientId: number;
  clientName: string;
  description?: string;
}

export interface ServiceInfo {
  serviceName: string;
  description?: string;
}

export interface ScopeInfo {
  name: string;
  description?: string;
}

// OpenID Connect UserInfo endpoint types
export interface UserInfoRequest {
  token: string;
}

export interface UserInfoResponse {
  action: 'OK' | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR';
  responseContent?: string;
  subject?: string;
  claims?: Record<string, any>;
}

// OpenID Federation 1.0 API types
export interface FederationFetchRequest {
  iss: string;
  sub: string;
}

export interface FederationFetchResponse {
  action: 'OK' | 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR';
  entity_configuration?: string; // JWT
}

export interface FederationListRequest {
  iss: string;
  entity_type?: string;
}

export interface FederationListResponse {
  action: 'OK' | 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR';
  entity_ids?: string[];
}

export interface FederationResolveRequest {
  sub: string;
  anchor: string;
  type?: string;
}

export interface FederationResolveResponse {
  action: 'OK' | 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL_SERVER_ERROR';
  trust_chain?: string[]; // Array of JWTs
  metadata?: any;
}

// Authlete Client Management API types
export interface AuthleteClientCreateRequest {
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: {
    keys: any[];
  };
  redirect_uris: string[];
  response_types?: string[];
  grant_types?: string[];
  application_type?: string;
  subject_type?: string;
  id_token_signed_response_alg?: string;
  token_endpoint_auth_method?: string;
  // Federation-specific metadata
  software_statement?: string;
  software_id?: string;
  software_version?: string;
}

export interface AuthleteClientCreateResponse {
  action: 'CREATED' | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR';
  client_id?: number;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris?: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: {
    keys: any[];
  };
  response_types?: string[];
  grant_types?: string[];
  application_type?: string;
  subject_type?: string;
  id_token_signed_response_alg?: string;
  token_endpoint_auth_method?: string;
  responseContent?: string;
}

// Authlete Federation Registration API types
export interface AuthleteFederationRegistrationRequest {
  // OpenID Connect Dynamic Client Registration parameters
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: {
    keys: any[];
  };
  response_types?: string[];
  grant_types?: string[];
  application_type?: string;
  subject_type?: string;
  id_token_signed_response_alg?: string;
  token_endpoint_auth_method?: string;
  // Federation-specific parameters
  entityConfiguration?: string;  // JWT entity configuration
  trustChain?: string[];         // Array of entity statements (JWTs)
  trustAnchorId?: string;        // Trust anchor identifier
  software_statement?: string;   // JWT containing entity statement (legacy)
}

export interface AuthleteFederationRegistrationResponse {
  action: 'OK' | 'CREATED' | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR';
  client_id?: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris?: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: {
    keys: any[];
  };
  response_types?: string[];
  grant_types?: string[];
  application_type?: string;
  subject_type?: string;
  id_token_signed_response_alg?: string;
  token_endpoint_auth_method?: string;
  responseContent?: string;
  // Federation-specific response fields
  entityStatement?: string;      // JWT entity statement for the client
  entityConfiguration?: string | undefined;  // JWT entity configuration from request
  trustChain?: string[];         // Validated trust chain
  trustChainExpiresAt?: number;  // Trust chain expiration
  trustAnchorId?: string | undefined;        // Trust anchor used for validation
  // Standard Authlete response fields
  resultCode?: string;
  resultMessage?: string;
  // Nested client object from Authlete
  client?: {
    number?: number;
    serviceNumber?: number;
    clientId?: number;
    clientSecret?: string;
    clientName?: string;
    clientUri?: string;
    redirectUris?: string[];
    responseTypes?: string[];
    grantTypes?: string[];
    applicationType?: string;
    contacts?: string[];
    subjectType?: string;
    idTokenSignAlg?: string;
    userInfoSignAlg?: string;
    tokenAuthMethod?: string;
    tokenAuthSignAlg?: string;
    entityId?: string;
    trustAnchorId?: string;
    trustChain?: string[];
    trustChainExpiresAt?: number;
    trustChainUpdatedAt?: number;
    clientRegistrationTypes?: string[];
    [key: string]: any;
  };
}

// Authlete Dynamic Client Registration API types
export interface AuthleteDynamicRegistrationRequest {
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: {
    keys: any[];
  };
  response_types?: string[];
  grant_types?: string[];
  application_type?: string;
  subject_type?: string;
  id_token_signed_response_alg?: string;
  token_endpoint_auth_method?: string;
  // Federation-specific metadata
  software_statement?: string;
  software_id?: string;
  software_version?: string;
}

export interface AuthleteDynamicRegistrationResponse {
  action: 'CREATED' | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR';
  client_id?: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris?: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: {
    keys: any[];
  };
  response_types?: string[];
  grant_types?: string[];
  application_type?: string;
  subject_type?: string;
  id_token_signed_response_alg?: string;
  token_endpoint_auth_method?: string;
  responseContent?: string;
}

// Authlete Federation Configuration API types
export interface AuthleteFederationConfigurationRequest {
  // No parameters needed - returns server's entity configuration
}

export interface AuthleteFederationConfigurationResponse {
  action: 'OK' | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'INTERNAL_SERVER_ERROR';
  entityConfiguration?: string; // JWT entity configuration
  responseContent?: string;
  resultCode?: string;
  resultMessage?: string;
}