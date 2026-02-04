# Design Document: RP Multi-OP Selection

## Overview

This design extends the existing RP (Relying Party) test client to support dynamic selection and authentication with multiple OpenID Provider (OP) instances. The current implementation is hardcoded to work with a single OP specified via the `AUTHORIZATION_SERVER` environment variable. This enhancement will enable users to:

1. Select from multiple OP instances at runtime
2. Discover OP metadata using OpenID Connect Discovery
3. Validate each OP's trust chain using OpenID Federation
4. Maintain separate client credentials for each OP
5. Perform dynamic registration with each selected OP

The design leverages existing components (OPTrustChainValidator, dynamic registration flow) while adding new UI components and state management for multi-OP support.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Relying Party (RP)                        │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │           OP Selection UI                          │    │
│  │  - OP entity_id input                              │    │
│  │  - Previously used OPs list                        │    │
│  │  - OP metadata display                             │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│                   ↓                                          │
│  ┌────────────────────────────────────────────────────┐    │
│  │      OP Discovery Service                          │    │
│  │  - Fetch .well-known/openid-configuration          │    │
│  │  - Parse and validate OP metadata                  │    │
│  │  - Cache discovered metadata                       │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│                   ↓                                          │
│  ┌────────────────────────────────────────────────────┐    │
│  │      OPTrustChainValidator (existing)              │    │
│  │  - Validate OP trust chain                         │    │
│  │  - Check Trust Anchor registration                 │    │
│  │  - Cache validation results                        │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│                   ↓                                          │
│  ┌────────────────────────────────────────────────────┐    │
│  │   Multi-OP Credentials Manager                     │    │
│  │  - Store credentials per OP entity_id              │    │
│  │  - Persist to disk (.op-credentials.json)          │    │
│  │  - Retrieve credentials for selected OP            │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│                   ↓                                          │
│  ┌────────────────────────────────────────────────────┐    │
│  │   Dynamic Registration (per OP)                    │    │
│  │  - Register with selected OP                       │    │
│  │  - Store client_secret per OP                      │    │
│  │  - Use entity_id as client_id                      │    │
│  └────────────────┬───────────────────────────────────┘    │
│                   │                                          │
│                   ↓                                          │
│  ┌────────────────────────────────────────────────────┐    │
│  │   Authorization Flow Handler                       │    │
│  │  - Build authorization request for selected OP     │    │
│  │  - Handle callback with OP-specific credentials    │    │
│  │  - Exchange code at selected OP's token endpoint   │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                           │
                           │ OpenID Connect Discovery
                           │ Trust Chain Validation
                           │ Dynamic Registration
                           │ Authorization Flow
                           ↓
┌──────────────────────────────────────────────────────────────┐
│                  Multiple OP Instances                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   OP #1      │  │   OP #2      │  │   OP #3      │     │
│  │ Port: 3001   │  │ Port: 3002   │  │ Port: 3003   │     │
│  │ Entity ID: A │  │ Entity ID: B │  │ Entity ID: C │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└──────────────────────────────────────────────────────────────┘
                           │
                           │ Trust Chain Validation
                           ↓
┌──────────────────────────────────────────────────────────────┐
│                     Trust Anchor                             │
│  - Maintains list of trusted OPs                             │
│  - Issues entity statements                                  │
└──────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

```
User → OP Selection UI → OP Discovery Service → OPTrustChainValidator
                                ↓
                    Multi-OP Credentials Manager
                                ↓
                    Dynamic Registration (if needed)
                                ↓
                    Authorization Flow Handler → Selected OP
```

## Components and Interfaces

### 1. OP Discovery Service

**File**: `test-client-federation-valid/lib/opDiscoveryService.js`

**Purpose**: Fetch and parse OpenID Connect Discovery metadata from OPs.

**Interface**:
```javascript
class OPDiscoveryService {
  /**
   * Discover OP metadata from .well-known/openid-configuration
   * @param {string} opEntityId - OP's entity ID (base URL)
   * @returns {Promise<OPMetadata>} Discovered OP metadata
   * @throws {Error} If discovery fails or metadata is invalid
   */
  async discoverOP(opEntityId);

  /**
   * Get cached OP metadata if available
   * @param {string} opEntityId - OP's entity ID
   * @returns {OPMetadata|null} Cached metadata or null
   */
  getCachedMetadata(opEntityId);

  /**
   * Clear cached metadata for an OP
   * @param {string} opEntityId - OP's entity ID
   */
  clearCache(opEntityId);
}
```

**OPMetadata Type**:
```javascript
{
  issuer: string,
  authorization_endpoint: string,
  token_endpoint: string,
  jwks_uri: string,
  registration_endpoint?: string,
  scopes_supported?: string[],
  response_types_supported?: string[],
  // ... other standard OIDC discovery fields
}
```

**Key Methods**:
- `discoverOP()`: Fetches `.well-known/openid-configuration` and validates required fields
- `getCachedMetadata()`: Returns cached metadata to avoid repeated network calls
- `clearCache()`: Clears cached metadata for testing/debugging

### 2. Multi-OP Credentials Manager

**File**: `test-client-federation-valid/lib/multiOPCredentialsManager.js`

**Purpose**: Manage client credentials for multiple OPs with persistent storage.

**Interface**:
```javascript
class MultiOPCredentialsManager {
  /**
   * Store credentials for an OP
   * @param {string} opEntityId - OP's entity ID
   * @param {string} clientSecret - Client secret from registration
   */
  storeCredentials(opEntityId, clientSecret);

  /**
   * Retrieve credentials for an OP
   * @param {string} opEntityId - OP's entity ID
   * @returns {OPCredentials|null} Credentials or null if not found
   */
  getCredentials(opEntityId);

  /**
   * Check if credentials exist for an OP
   * @param {string} opEntityId - OP's entity ID
   * @returns {boolean} True if credentials exist
   */
  hasCredentials(opEntityId);

  /**
   * Clear credentials for an OP
   * @param {string} opEntityId - OP's entity ID
   */
  clearCredentials(opEntityId);

  /**
   * Get all registered OPs
   * @returns {string[]} Array of OP entity IDs
   */
  getRegisteredOPs();
}
```

**OPCredentials Type**:
```javascript
{
  opEntityId: string,
  clientSecret: string,
  registeredAt: string (ISO timestamp),
  rpEntityId: string
}
```

**Storage Format** (`.op-credentials.json`):
```json
{
  "rpEntityId": "https://rp1.diddc.site",
  "ops": {
    "https://op.diddc.site": {
      "clientSecret": "secret123...",
      "registeredAt": "2026-01-29T12:00:00.000Z"
    },
    "https://op2.diddc.site": {
      "clientSecret": "secret456...",
      "registeredAt": "2026-01-29T13:00:00.000Z"
    }
  }
}
```

### 3. OP Selection UI Component

**File**: `test-client-federation-valid/views/index.ejs` (modified)

**Purpose**: Provide user interface for selecting and managing OPs.

**UI Elements**:
1. **OP Selection Form**:
   - Input field for OP entity_id (with validation)
   - "Discover OP" button
   - Validation feedback (URL format, HTTPS requirement)

2. **Previously Used OPs List**:
   - Display list of OPs with stored credentials
   - Show OP name, entity_id, and registration status
   - "Select" button for each OP
   - "Remove" button to clear credentials

3. **Selected OP Display**:
   - OP name and entity_id
   - Trust chain validation status
   - Authorization endpoint
   - Token endpoint
   - "Login with this OP" button

4. **Default OP Indicator**:
   - Show if AUTHORIZATION_SERVER env var is set
   - Pre-select default OP on page load

### 4. Authorization Flow Handler (Modified)

**File**: `test-client-federation-valid/server.js` (modified)

**Purpose**: Handle authorization flows with selected OP.

**Key Changes**:
- Read selected OP from session instead of environment variable
- Use OP-specific metadata for endpoints
- Use OP-specific credentials for token exchange
- Store OP entity_id in session after successful authentication

**Modified Routes**:
- `GET /select-op`: Select an OP and store in session
- `GET /discover-op`: Discover OP metadata and validate trust chain
- `GET /federation-login`: Use selected OP from session
- `GET /callback`: Use selected OP's token endpoint

### 5. Session State Management

**Session Data Structure**:
```javascript
{
  // Existing fields
  user: { ... },
  accessToken: string,
  idToken: string,
  oauthState: string,
  
  // New fields for multi-OP
  selectedOP: {
    entityId: string,
    metadata: OPMetadata,
    trustChainValid: boolean,
    validatedAt: number
  },
  opValidated: boolean,
  opEntityId: string,
  opValidatedAt: number
}
```

## Data Models

### OP Metadata Model

```javascript
{
  // Required fields (from OIDC Discovery)
  issuer: string,                    // OP's issuer identifier
  authorization_endpoint: string,    // Authorization endpoint URL
  token_endpoint: string,            // Token endpoint URL
  jwks_uri: string,                  // JWKS endpoint URL
  
  // Optional fields
  registration_endpoint: string,     // Dynamic registration endpoint
  userinfo_endpoint: string,         // UserInfo endpoint
  scopes_supported: string[],        // Supported scopes
  response_types_supported: string[], // Supported response types
  grant_types_supported: string[],   // Supported grant types
  subject_types_supported: string[], // Supported subject types
  
  // Metadata
  discoveredAt: number,              // Timestamp of discovery
  cached: boolean                    // Whether from cache
}
```

### OP Credentials Model

```javascript
{
  opEntityId: string,        // OP's entity ID (key)
  clientSecret: string,      // Client secret from registration
  registeredAt: string,      // ISO timestamp of registration
  rpEntityId: string         // RP's entity ID (for validation)
}
```

### OP Selection State Model

```javascript
{
  entityId: string,          // Selected OP's entity ID
  metadata: OPMetadata,      // Discovered metadata
  trustChainValid: boolean,  // Trust chain validation result
  validatedAt: number,       // Timestamp of validation
  hasCredentials: boolean    // Whether credentials exist
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property Reflection

After analyzing all acceptance criteria, I identified the following redundancies:

1. **Discovery field extraction (2.2, 2.3, 2.4)**: These three properties all test extraction of different fields from the same discovery response. They can be combined into a single comprehensive property that verifies all required fields are extracted.

2. **Token storage (8.3, 8.4)**: Both properties test storing tokens in session after successful exchange. They can be combined into a single property that verifies both tokens are stored.

3. **Credential operations (6.1, 6.2, 6.3)**: Properties 6.1 and 6.2 both test storing credentials, while 6.3 tests retrieval. Property 6.2 (storing after registration) subsumes 6.1 (general storage), and together with 6.3 they form a round-trip property.

4. **Authorization request parameters (5.3, 5.4)**: Both test generation of unique parameters for authorization requests. They can be combined into a single property that verifies both state and nonce are unique.

5. **Registration data flow (7.2, 7.3)**: Property 7.3 (storing secret after registration) is a consequence of 7.2 (sending registration request). They can be combined into a single property about the registration round-trip.

After reflection, the remaining properties provide unique validation value without logical redundancy.

### Correctness Properties

Property 1: Discovery endpoint construction
*For any* valid OP entity_id, the discovery service should construct the discovery URL as `{entity_id}/.well-known/openid-configuration`
**Validates: Requirements 2.1**

Property 2: Required metadata field extraction
*For any* valid OIDC discovery response, the discovery service should extract all required fields (authorization_endpoint, token_endpoint, jwks_uri) and return them in the metadata object
**Validates: Requirements 2.2, 2.3, 2.4**

Property 3: Missing field validation
*For any* discovery response missing required fields, the discovery service should return an error indicating which specific fields are missing
**Validates: Requirements 2.6**

Property 4: Previously used OPs retrieval
*For any* set of stored OP credentials, the credentials manager should return the complete list of OP entity_ids
**Validates: Requirements 3.3**

Property 5: Entity ID URL validation
*For any* string input, the validation function should accept only valid HTTPS URLs (or http://localhost for development) as entity_ids
**Validates: Requirements 3.4**

Property 6: OP selection persistence
*For any* OP selection, after storing it in the session, retrieving the session should return the same OP entity_id and metadata
**Validates: Requirements 3.6**

Property 7: Trust chain validation invocation
*For any* OP selection, the system should invoke the OPTrustChainValidator with the OP's entity_id before allowing authentication
**Validates: Requirements 4.1**

Property 8: Validation result caching
*For any* successful trust chain validation, the validation result should be cached and retrievable without re-validation
**Validates: Requirements 4.4**

Property 9: Authorization endpoint routing
*For any* selected OP with discovered metadata, the authorization request should be sent to that OP's authorization_endpoint
**Validates: Requirements 5.1**

Property 10: OP-specific credential usage
*For any* authorization request to an OP, the system should use the client credentials associated with that specific OP's entity_id
**Validates: Requirements 5.2**

Property 11: Unique authorization parameters
*For any* two authorization requests, they should have different state and nonce parameters
**Validates: Requirements 5.3, 5.4**

Property 12: State parameter verification
*For any* authorization callback, the system should verify that the received state parameter matches the stored state for that request
**Validates: Requirements 5.5**

Property 13: Credentials storage round-trip
*For any* OP entity_id and client_secret, after storing the credentials and then retrieving them, the retrieved secret should match the stored secret
**Validates: Requirements 6.1, 6.2, 6.3**

Property 14: Credentials persistence
*For any* stored credentials, after persisting to disk and reloading from disk, the credentials should be identical
**Validates: Requirements 6.4**

Property 15: Registration data transmission
*For any* dynamic registration request, the system should send the RP's entity configuration JWT to the OP's federation registration endpoint and store the returned client_secret
**Validates: Requirements 7.2, 7.3**

Property 16: Entity ID as client ID
*For any* registration or authentication operation, the system should use the RP's entity_id as the client_id parameter
**Validates: Requirements 7.5**

Property 17: Token endpoint routing
*For any* authorization code exchange, the request should be sent to the selected OP's token_endpoint
**Validates: Requirements 8.1**

Property 18: Token exchange credential usage
*For any* token exchange request, the system should use the client credentials for the selected OP
**Validates: Requirements 8.2**

Property 19: Token storage after exchange
*For any* successful token exchange, both the access_token and id_token should be stored in the user's session
**Validates: Requirements 8.3, 8.4**

Property 20: OP entity ID session storage
*For any* successful authentication, the OP's entity_id should be stored in the user's session
**Validates: Requirements 9.1**

Property 21: Session cleanup on logout
*For any* logout operation, the OP selection and authentication data should be cleared from the session
**Validates: Requirements 9.3**

## Error Handling

### Error Categories

1. **Discovery Errors**:
   - `OP_UNREACHABLE`: Cannot connect to OP's discovery endpoint
   - `INVALID_DISCOVERY_RESPONSE`: Discovery response is malformed or missing required fields
   - `DISCOVERY_TIMEOUT`: Discovery request exceeded timeout (10 seconds)

2. **Validation Errors**:
   - `INVALID_ENTITY_ID`: Entity ID is not a valid HTTPS URL
   - `TRUST_CHAIN_INVALID`: OP's trust chain validation failed
   - `OP_NOT_IN_TRUST_ANCHOR`: OP is not registered in the Trust Anchor

3. **Registration Errors**:
   - `REGISTRATION_FAILED`: Dynamic registration with OP failed
   - `CREDENTIALS_MISSING`: Client credentials not found for OP
   - `CREDENTIALS_STORAGE_FAILED`: Failed to persist credentials to disk

4. **Authorization Errors**:
   - `INVALID_STATE`: State parameter mismatch in callback
   - `TOKEN_EXCHANGE_FAILED`: Failed to exchange authorization code for tokens
   - `NO_OP_SELECTED`: User attempted login without selecting an OP

### Error Response Format

All errors should include:
```javascript
{
  error: string,              // Error code
  error_description: string,  // Human-readable description
  opEntityId?: string,        // OP entity ID if applicable
  details?: object            // Additional error details
}
```

### Error Handling Strategy

1. **Network Errors**: Retry with exponential backoff (max 3 retries)
2. **Validation Errors**: Display immediately, no retry
3. **User Input Errors**: Provide inline validation feedback
4. **System Errors**: Log detailed error, show generic message to user

### User-Facing Error Messages

- **Discovery Failed**: "Could not connect to OP at {entity_id}. Please check the URL and try again."
- **Trust Chain Invalid**: "OP {entity_id} is not trusted. It must be registered in the Trust Anchor."
- **Registration Failed**: "Failed to register with OP {entity_id}. Error: {details}"
- **No OP Selected**: "Please select an OP before attempting to log in."

## Testing Strategy

### Unit Tests

Unit tests will verify specific examples and edge cases:

1. **OP Discovery Service**:
   - Test discovery with valid OP
   - Test discovery with unreachable OP
   - Test discovery with invalid response
   - Test cache hit/miss scenarios

2. **Multi-OP Credentials Manager**:
   - Test storing credentials for single OP
   - Test storing credentials for multiple OPs
   - Test retrieving credentials
   - Test clearing credentials
   - Test persistence to disk

3. **URL Validation**:
   - Test valid HTTPS URLs
   - Test invalid URLs (HTTP, malformed, etc.)
   - Test localhost exception

4. **Session Management**:
   - Test storing OP selection in session
   - Test retrieving OP selection from session
   - Test clearing session on logout

### Property-Based Tests

Property-based tests will verify universal properties across all inputs using fast-check library. Each test will run a minimum of 100 iterations.

1. **Property Test: Discovery endpoint construction** (Property 1)
   - Generate random valid entity_ids
   - Verify discovery URL is correctly constructed
   - Tag: **Feature: rp-multi-op-selection, Property 1: Discovery endpoint construction**

2. **Property Test: Required metadata field extraction** (Property 2)
   - Generate random discovery responses with required fields
   - Verify all fields are extracted correctly
   - Tag: **Feature: rp-multi-op-selection, Property 2: Required metadata field extraction**

3. **Property Test: Missing field validation** (Property 3)
   - Generate discovery responses with missing fields
   - Verify error indicates which fields are missing
   - Tag: **Feature: rp-multi-op-selection, Property 3: Missing field validation**

4. **Property Test: Previously used OPs retrieval** (Property 4)
   - Generate random sets of OP credentials
   - Verify all entity_ids are returned
   - Tag: **Feature: rp-multi-op-selection, Property 4: Previously used OPs retrieval**

5. **Property Test: Entity ID URL validation** (Property 5)
   - Generate random strings (valid and invalid URLs)
   - Verify only valid HTTPS URLs are accepted
   - Tag: **Feature: rp-multi-op-selection, Property 5: Entity ID URL validation**

6. **Property Test: OP selection persistence** (Property 6)
   - Generate random OP selections
   - Verify round-trip through session storage
   - Tag: **Feature: rp-multi-op-selection, Property 6: OP selection persistence**

7. **Property Test: Credentials storage round-trip** (Property 13)
   - Generate random OP entity_ids and secrets
   - Verify round-trip through credentials manager
   - Tag: **Feature: rp-multi-op-selection, Property 13: Credentials storage round-trip**

8. **Property Test: Credentials persistence** (Property 14)
   - Generate random credentials
   - Verify round-trip through disk storage
   - Tag: **Feature: rp-multi-op-selection, Property 14: Credentials persistence**

9. **Property Test: Unique authorization parameters** (Property 11)
   - Generate multiple authorization requests
   - Verify all state and nonce values are unique
   - Tag: **Feature: rp-multi-op-selection, Property 11: Unique authorization parameters**

10. **Property Test: Entity ID as client ID** (Property 16)
    - Generate random registration/auth operations
    - Verify client_id always equals entity_id
    - Tag: **Feature: rp-multi-op-selection, Property 16: Entity ID as client ID**

### Integration Tests

Integration tests will verify end-to-end flows:

1. **Multi-OP Selection Flow**:
   - Start with no OPs selected
   - Discover and select OP #1
   - Authenticate with OP #1
   - Logout
   - Discover and select OP #2
   - Authenticate with OP #2
   - Verify separate credentials for each OP

2. **Backward Compatibility Flow**:
   - Set AUTHORIZATION_SERVER environment variable
   - Verify default OP is pre-selected
   - Verify existing login flow works

3. **Error Handling Flow**:
   - Attempt to discover invalid OP
   - Verify error message displayed
   - Attempt to authenticate without selecting OP
   - Verify error message displayed

### Test Configuration

- **Property tests**: Minimum 100 iterations per test
- **Timeout**: 10 seconds for discovery operations
- **Retry**: Max 3 retries for network operations
- **Test data**: Use cloudflared URLs for realistic testing

## Implementation Notes

### Backward Compatibility

The implementation must maintain backward compatibility with the existing single-OP flow:

1. **Environment Variable Support**: Continue reading `AUTHORIZATION_SERVER` from `.env`
2. **Default Selection**: If `AUTHORIZATION_SERVER` is set, pre-select that OP
3. **Existing Credentials**: Migrate existing `.client-credentials.json` to new format
4. **Existing Routes**: Maintain all existing routes and behavior

### Migration Strategy

When upgrading from single-OP to multi-OP:

1. **Credentials Migration**:
   ```javascript
   // Old format
   {
     "entityId": "https://rp1.diddc.site",
     "clientSecret": "secret123",
     "registeredAt": "2026-01-29T12:00:00.000Z"
   }
   
   // New format
   {
     "rpEntityId": "https://rp1.diddc.site",
     "ops": {
       "https://op.diddc.site": {
         "clientSecret": "secret123",
         "registeredAt": "2026-01-29T12:00:00.000Z"
       }
     }
   }
   ```

2. **Session Migration**: No migration needed (sessions are ephemeral)

3. **UI Migration**: Add new UI elements while keeping existing functionality

### Performance Considerations

1. **Caching**:
   - Cache discovered OP metadata (1 hour TTL)
   - Cache trust chain validation results (1 hour TTL)
   - Use existing OPTrustChainValidator cache

2. **Network Optimization**:
   - Parallel discovery for multiple OPs
   - Timeout for discovery requests (10 seconds)
   - Retry with exponential backoff

3. **Storage Optimization**:
   - Store only necessary metadata
   - Compress credentials file if large
   - Periodic cleanup of unused credentials

### Security Considerations

1. **Entity ID Validation**: Enforce HTTPS for all entity_ids (except localhost)
2. **State Parameter**: Use cryptographically secure random values
3. **Nonce Parameter**: Use cryptographically secure random values
4. **Credentials Storage**: Store credentials in file with restricted permissions (0600)
5. **Session Security**: Use secure session cookies with httpOnly and sameSite flags
6. **Trust Chain Validation**: Always validate before authentication
7. **Input Sanitization**: Sanitize all user inputs (entity_ids, etc.)

### Logging and Monitoring

Log the following events:

1. **OP Discovery**: Log entity_id, success/failure, duration
2. **Trust Chain Validation**: Log entity_id, validation result, errors
3. **Dynamic Registration**: Log entity_id, success/failure, errors
4. **Authorization Flow**: Log entity_id, state, success/failure
5. **Token Exchange**: Log entity_id, success/failure, errors
6. **Credentials Operations**: Log entity_id, operation type (store/retrieve/clear)

Log format:
```javascript
{
  timestamp: string,
  level: 'info' | 'warn' | 'error',
  component: string,
  operation: string,
  opEntityId?: string,
  duration?: number,
  success: boolean,
  error?: string
}
```

### Configuration

New environment variables:

- `OP_DISCOVERY_TIMEOUT`: Discovery request timeout in milliseconds (default: 10000)
- `OP_CACHE_TTL`: Cache TTL in milliseconds (default: 3600000)
- `MAX_STORED_OPS`: Maximum number of OPs to store credentials for (default: 10)

Existing environment variables (maintained for backward compatibility):

- `AUTHORIZATION_SERVER`: Default OP entity_id
- `ENTITY_ID`: RP's entity_id
- `REDIRECT_URI`: RP's redirect URI
- `TRUST_ANCHOR_ID`: Trust Anchor entity_id
- `TRUST_ANCHOR_URL`: Trust Anchor URL

## Deployment Considerations

### Development Environment

1. Run multiple OP instances on different ports (3001, 3002, 3003)
2. Use cloudflared to expose each OP with unique public URL
3. Register all OPs in Trust Anchor
4. Test RP with each OP individually and in combination

### Production Environment

1. Ensure all OPs are registered in Trust Anchor
2. Configure appropriate cache TTLs
3. Monitor discovery and validation performance
4. Set up alerts for high error rates
5. Implement rate limiting for discovery requests
6. Use HTTPS for all entity_ids

### Scaling Considerations

1. **Horizontal Scaling**: RP is stateless except for sessions (use Redis for session storage)
2. **Cache Sharing**: Share discovery and validation caches across RP instances
3. **Load Balancing**: Distribute requests across multiple RP instances
4. **Database**: Consider database for credentials storage if scaling beyond single instance
