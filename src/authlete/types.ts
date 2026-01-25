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