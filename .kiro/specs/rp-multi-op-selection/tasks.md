# Implementation Plan: RP Multi-OP Selection

## Overview

This implementation plan breaks down the RP multi-OP selection feature into discrete, incremental coding tasks. Each task builds on previous work and includes testing to validate functionality early. The implementation extends the existing `test-client-federation-valid` RP to support dynamic selection and authentication with multiple OP instances.

## Tasks

- [x] 1. Create OP Discovery Service
  - Implement `test-client-federation-valid/lib/opDiscoveryService.js`
  - Fetch `.well-known/openid-configuration` from OP entity_id
  - Parse and validate OIDC discovery response
  - Extract required fields (authorization_endpoint, token_endpoint, jwks_uri)
  - Implement metadata caching with TTL
  - Handle network errors and timeouts
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 1.1 Write property test for discovery endpoint construction
  - **Property 1: Discovery endpoint construction**
  - **Validates: Requirements 2.1**

- [x] 1.2 Write property test for required metadata field extraction
  - **Property 2: Required metadata field extraction**
  - **Validates: Requirements 2.2, 2.3, 2.4**

- [x] 1.3 Write property test for missing field validation
  - **Property 3: Missing field validation**
  - **Validates: Requirements 2.6**

- [x] 1.4 Write unit tests for discovery service edge cases
  - Test unreachable OP endpoint
  - Test malformed discovery response
  - Test timeout handling
  - _Requirements: 2.5, 2.6_

- [x] 2. Create Multi-OP Credentials Manager
  - Implement `test-client-federation-valid/lib/multiOPCredentialsManager.js`
  - Store credentials indexed by OP entity_id
  - Persist credentials to `.op-credentials.json`
  - Load credentials from disk on startup
  - Implement credential retrieval by OP entity_id
  - Implement credential clearing
  - Implement migration from old single-OP format
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 2.1 Write property test for credentials storage round-trip
  - **Property 13: Credentials storage round-trip**
  - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 2.2 Write property test for credentials persistence
  - **Property 14: Credentials persistence**
  - **Validates: Requirements 6.4**

- [x] 2.3 Write property test for previously used OPs retrieval
  - **Property 4: Previously used OPs retrieval**
  - **Validates: Requirements 3.3**

- [x] 2.4 Write unit tests for credentials manager
  - Test storing multiple OP credentials
  - Test clearing specific OP credentials
  - Test migration from old format
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 3. Implement Entity ID validation utility
  - Create validation function for entity_id URLs
  - Accept HTTPS URLs and http://localhost
  - Reject HTTP URLs (except localhost)
  - Reject malformed URLs
  - Return validation errors with details
  - _Requirements: 3.4_

- [x] 3.1 Write property test for entity ID URL validation
  - **Property 5: Entity ID URL validation**
  - **Validates: Requirements 3.4**

- [x] 4. Update RP server to support OP selection
  - Modify `test-client-federation-valid/server.js`
  - Initialize OPDiscoveryService and MultiOPCredentialsManager
  - Add session field for selected OP
  - Maintain backward compatibility with AUTHORIZATION_SERVER env var
  - Load default OP from env var if set
  - _Requirements: 11.1, 11.2_

- [x] 4.1 Write unit tests for backward compatibility
  - Test default OP selection from env var
  - Test existing single-OP flow
  - _Requirements: 11.1, 11.2_

- [x] 5. Add OP selection routes
  - Add `POST /select-op` route to select an OP
  - Validate entity_id input
  - Discover OP metadata
  - Validate OP trust chain
  - Store selection in session
  - Return OP metadata and validation status
  - Add `GET /discover-op` route for AJAX discovery
  - Add `GET /list-ops` route to list previously used OPs
  - Add `POST /clear-op` route to clear OP credentials
  - _Requirements: 3.4, 3.6, 4.1, 4.4_

- [x] 5.1 Write property test for OP selection persistence
  - **Property 6: OP selection persistence**
  - **Validates: Requirements 3.6**

- [x] 5.2 Write property test for trust chain validation invocation
  - **Property 7: Trust chain validation invocation**
  - **Validates: Requirements 4.1**

- [x] 5.3 Write property test for validation result caching
  - **Property 8: Validation result caching**
  - **Validates: Requirements 4.4**

- [x] 5.4 Write unit tests for OP selection routes
  - Test selecting valid OP
  - Test selecting invalid entity_id
  - Test selecting OP not in Trust Anchor
  - Test listing previously used OPs
  - _Requirements: 3.4, 3.6, 4.1, 4.2, 4.3_

- [x] 6. Update OP selection UI
  - Modify `test-client-federation-valid/views/index.ejs`
  - Add OP selection form with entity_id input
  - Add validation feedback for entity_id input
  - Display list of previously used OPs
  - Show selected OP metadata (name, endpoints)
  - Show trust chain validation status
  - Add "Login with this OP" button
  - Show default OP if AUTHORIZATION_SERVER is set
  - Add error display for discovery/validation failures
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.5, 10.1, 10.2, 11.2, 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 7. Checkpoint - Test OP selection and discovery
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Modify federation login flow for selected OP
  - Update `/federation-login` route
  - Read selected OP from session instead of env var
  - Verify OP is selected before proceeding
  - Use selected OP's metadata for endpoints
  - Retrieve OP-specific credentials from credentials manager
  - Perform dynamic registration if credentials missing
  - Store credentials for selected OP after registration
  - Generate unique state and nonce for each request
  - Build authorization request with selected OP's authorization_endpoint
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.3, 6.5, 7.1, 7.2, 7.3, 7.5_

- [x] 8.1 Write property test for authorization endpoint routing
  - **Property 9: Authorization endpoint routing**
  - **Validates: Requirements 5.1**

- [x] 8.2 Write property test for OP-specific credential usage
  - **Property 10: OP-specific credential usage**
  - **Validates: Requirements 5.2**

- [x] 8.3 Write property test for unique authorization parameters
  - **Property 11: Unique authorization parameters**
  - **Validates: Requirements 5.3, 5.4**

- [x] 8.4 Write property test for entity ID as client ID
  - **Property 16: Entity ID as client ID**
  - **Validates: Requirements 7.5**

- [x] 8.5 Write property test for registration data transmission
  - **Property 15: Registration data transmission**
  - **Validates: Requirements 7.2, 7.3**

- [x] 8.6 Write unit tests for federation login flow
  - Test login with selected OP
  - Test login without OP selection (error case)
  - Test login with missing credentials (triggers registration)
  - Test login with invalid OP (error case)
  - _Requirements: 5.1, 5.2, 6.5, 7.1, 10.3_

- [x] 9. Modify callback handler for selected OP
  - Update `/callback` route
  - Read selected OP from session
  - Verify state parameter matches stored value
  - Use selected OP's token_endpoint for code exchange
  - Use OP-specific credentials for token exchange
  - Store access_token and id_token in session
  - Store OP entity_id in session after successful auth
  - Handle token exchange errors with details
  - _Requirements: 5.5, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1_

- [x] 9.1 Write property test for state parameter verification
  - **Property 12: State parameter verification**
  - **Validates: Requirements 5.5**

- [x] 9.2 Write property test for token endpoint routing
  - **Property 17: Token endpoint routing**
  - **Validates: Requirements 8.1**

- [x] 9.3 Write property test for token exchange credential usage
  - **Property 18: Token exchange credential usage**
  - **Validates: Requirements 8.2**

- [x] 9.4 Write property test for token storage after exchange
  - **Property 19: Token storage after exchange**
  - **Validates: Requirements 8.3, 8.4**

- [x] 9.5 Write property test for OP entity ID session storage
  - **Property 20: OP entity ID session storage**
  - **Validates: Requirements 9.1**

- [x] 9.6 Write unit tests for callback handler
  - Test callback with valid state
  - Test callback with invalid state (error case)
  - Test callback with token exchange failure (error case)
  - _Requirements: 5.5, 8.5, 10.4_

- [x] 10. Update logout flow
  - Modify `/logout` route
  - Clear OP selection from session
  - Clear authentication data from session
  - Maintain credentials in storage (don't clear)
  - _Requirements: 9.3_

- [x] 10.1 Write property test for session cleanup on logout
  - **Property 21: Session cleanup on logout**
  - **Validates: Requirements 9.3**

- [x] 11. Update home page to display authenticated OP
  - Modify `test-client-federation-valid/views/index.ejs`
  - Show which OP the user authenticated with
  - Display OP entity_id in user info section
  - _Requirements: 9.2_

- [x] 12. Add error handling and user feedback
  - Implement error display in UI
  - Show discovery errors with actionable guidance
  - Show trust chain validation errors with details
  - Show registration errors with details
  - Show token exchange errors with details
  - Show "No OP selected" error when attempting login without selection
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 13. Checkpoint - Test complete multi-OP flow
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Add integration tests for multi-OP scenarios
  - Test discovering and authenticating with OP #1
  - Test logging out and authenticating with OP #2
  - Verify separate credentials for each OP
  - Test backward compatibility with AUTHORIZATION_SERVER
  - Test error scenarios (invalid OP, missing credentials, etc.)
  - _Requirements: All_

- [x] 15. Update documentation
  - Update README with multi-OP selection instructions
  - Document new environment variables
  - Document new API routes
  - Document credentials file format
  - Document migration from single-OP to multi-OP
  - Add troubleshooting section for multi-OP issues

- [x] 16. Final checkpoint - Complete testing and validation
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The implementation maintains backward compatibility with existing single-OP flow
- All new code should follow existing code style and patterns in the RP
