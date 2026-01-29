// OpenID Federation 1.0 types

export interface EntityConfiguration {
  iss: string;                    // Entity ID
  sub: string;                    // Same as iss for self-signed
  iat: number;                    // Issued at timestamp
  exp: number;                    // Expiration timestamp
  jwks: JWKSet;                   // Public keys
  metadata?: {
    openid_provider?: OpenIDProviderMetadata;
    openid_relying_party?: OpenIDRelyingPartyMetadata;
    federation_entity?: FederationEntityMetadata;
  };
  authority_hints?: string[];     // Parent authorities
  trust_marks?: TrustMark[];
}

export interface JWKSet {
  keys: JWK[];
}

export interface JWK {
  kty: string;
  use?: string;
  key_ops?: string[];
  alg?: string;
  kid?: string;
  x5u?: string;
  x5c?: string[];
  x5t?: string;
  'x5t#S256'?: string;
  // RSA keys
  n?: string;
  e?: string;
  d?: string;
  p?: string;
  q?: string;
  dp?: string;
  dq?: string;
  qi?: string;
  // EC keys
  crv?: string;
  x?: string;
  y?: string;
  // Symmetric keys
  k?: string;
}

export interface OpenIDProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported: string[];
  response_modes_supported?: string[];
  grant_types_supported?: string[];
  acr_values_supported?: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  id_token_encryption_alg_values_supported?: string[];
  id_token_encryption_enc_values_supported?: string[];
  userinfo_signing_alg_values_supported?: string[];
  userinfo_encryption_alg_values_supported?: string[];
  userinfo_encryption_enc_values_supported?: string[];
  request_object_signing_alg_values_supported?: string[];
  request_object_encryption_alg_values_supported?: string[];
  request_object_encryption_enc_values_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  token_endpoint_auth_signing_alg_values_supported?: string[];
  display_values_supported?: string[];
  claim_types_supported?: string[];
  claims_supported?: string[];
  service_documentation?: string;
  claims_locales_supported?: string[];
  ui_locales_supported?: string[];
  claims_parameter_supported?: boolean;
  request_parameter_supported?: boolean;
  request_uri_parameter_supported?: boolean;
  require_request_uri_registration?: boolean;
  op_policy_uri?: string;
  op_tos_uri?: string;
}

export interface OpenIDRelyingPartyMetadata {
  redirect_uris: string[];
  response_types?: string[];
  grant_types?: string[];
  application_type?: string;
  contacts?: string[];
  client_name?: string;
  logo_uri?: string;
  client_uri?: string;
  policy_uri?: string;
  tos_uri?: string;
  jwks_uri?: string;
  jwks?: JWKSet;
  sector_identifier_uri?: string;
  subject_type?: string;
  id_token_signed_response_alg?: string;
  id_token_encrypted_response_alg?: string;
  id_token_encrypted_response_enc?: string;
  userinfo_signed_response_alg?: string;
  userinfo_encrypted_response_alg?: string;
  userinfo_encrypted_response_enc?: string;
  request_object_signing_alg?: string;
  request_object_encryption_alg?: string;
  request_object_encryption_enc?: string;
  token_endpoint_auth_method?: string;
  token_endpoint_auth_signing_alg?: string;
  default_max_age?: number;
  require_auth_time?: boolean;
  default_acr_values?: string[];
  initiate_login_uri?: string;
  request_uris?: string[];
}

export interface FederationEntityMetadata {
  federation_fetch_endpoint?: string;
  federation_list_endpoint?: string;
  federation_resolve_endpoint?: string;
  federation_trust_mark_status_endpoint?: string;
  organization_name?: string;
  homepage_uri?: string;
  policy_uri?: string;
  logo_uri?: string;
  contacts?: string[];
}

export interface TrustMark {
  id: string;
  trust_mark: string;
}

export interface TrustChain {
  chain: string[];
  iat: number;
  exp: number;
  sub: string;
  trust_anchor_id: string;
}

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

export interface TrustAnchorMetadata {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  jwks: JWKSet;
  metadata: {
    federation_entity: FederationEntityMetadata;
  };
  constraints?: {
    max_path_length?: number;
    naming_constraints?: {
      permitted?: string[];
      excluded?: string[];
    };
  };
}

export interface IntermediateAuthorityMetadata {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  jwks: JWKSet;
  metadata: {
    federation_entity: FederationEntityMetadata;
    openid_provider?: OpenIDProviderMetadata;
  };
  authority_hints: string[];
  constraints?: {
    max_path_length?: number;
  };
}

// Enhanced federation interfaces from design document

export interface EntityStatement {
  jwt: string;
  payload: {
    iss: string;
    sub: string;
    iat?: number;
    exp: number;
    jwks?: JWKSet;
    metadata?: EntityMetadata;
    authorityHints?: string[];
  };
}

export interface EntityMetadata {
  openid_provider?: OpenIDProviderMetadata;
  openid_relying_party?: OpenIDRelyingPartyMetadata;
  federation_entity?: FederationEntityMetadata;
}

export interface ValidationResult {
  isValid: boolean;
  trustAnchor?: string;
  clientMetadata?: ClientMetadata;
  errors?: ValidationError[];
}

export interface ValidationError {
  code: string;
  message: string;
  details?: any;
}

export interface ClientMetadata extends OpenIDRelyingPartyMetadata {
  // Additional client metadata fields
}

export interface RequestObjectValidation {
  isValid: boolean;
  payload?: any;
  errors?: string[];
}

export interface RegistrationParameters {
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  contacts?: string[];
  tos_uri?: string;
  policy_uri?: string;
  jwks_uri?: string;
  jwks?: JWKSet;
  response_types?: string[];
  grant_types?: string[];
  application_type?: string;
  subject_type?: string;
  id_token_signed_response_alg?: string;
  token_endpoint_auth_method?: string;
}

// Federation Registration Endpoint interfaces
export interface FederationRegistrationRequest {
  entityConfiguration?: string;  // JWT entity configuration
  trustChain?: EntityStatement[]; // Array of entity statements
  requestObject?: string;        // Signed federation request object
}

export interface FederationRegistrationResponse {
  clientId: string;
  clientSecret?: string;
  entityStatement: string;       // JWT response from Authlete
  trustAnchorId: string;
}

// Trust Chain interfaces
export interface TrustChainValidationResult {
  isValid: boolean;
  trustAnchor?: string;
  clientMetadata?: ClientMetadata;
  errors?: ValidationError[];
}

// Test Client Configuration
export interface TestClientConfig {
  entityId: string;
  port: number;
  privateKey: string;
  publicKey: JWK;
  isValidInTrustAnchor: boolean;
  metadata: ClientMetadata;
}