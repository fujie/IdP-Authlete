# Implementation Plan: RP-Side OP Trust Chain Validation

## Overview

This implementation plan breaks down the RP-side OP trust chain validation feature into discrete coding tasks. The implementation reuses existing TypeScript trust chain validation components and integrates them into the JavaScript-based RP client. The Trust Anchor is enhanced to support entity type differentiation (RP vs OP).

## Tasks

- [x] 1. Enhance Trust Anchor with Entity Type Support
  - [x] 1.1 Add entity type field to Trust Anchor entity storage
    - Modify `trust-anchor/server.js` to include `entityType` field in entity records
    - Update in-memory entity storage structure to include type
    - Add validation for entity type values ('openid_relying_party' or 'openid_provider')
    - _Requirements: 5.3_

  - [x] 1.2 Write property test for entity type persistence
    - **Property 15: Entity Type Persistence**
    - **Validates: Requirements 5.3, 5.4**

  - [x] 1.3 Update entity statement creation to include entity type metadata
    - Modify `createEntityStatement()` function to accept entity type parameter
    - Include appropriate metadata type in entity statement payload
    - Ensure RP entities get `openid_relying_party` metadata
    - Ensure OP entities get `openid_provider` metadata
    - _Requirements: 5.1, 5.2, 5.5_

  - [x] 1.4 Write property test for entity statement type consistency
    - **Property 14: Entity Statement Type Consistency**
    - **Validates: Requirements 5.1, 5.2, 5.5**

  - [x] 1.5 Update Trust Anchor admin API endpoints
    - Modify POST `/admin/entities` to accept `entityType` parameter
    - Modify GET `/admin/entities` to return entity type in results
    - Add validation for entity type in add entity endpoint
    - _Requirements: 4.3, 5.4_

  - [x] 1.6 Write unit tests for admin API entity type handling
    - Test adding RP entity with correct type
    - Test adding OP entity with correct type
    - Test entity type validation
    - _Requirements: 4.3, 4.4_

- [x] 2. Update Trust Anchor Admin UI
  - [x] 2.1 Add entity type selector to add entity form
    - Modify `trust-anchor/views/admin.ejs` to include entity type dropdown
    - Add options for 'openid_relying_party' and 'openid_provider'
    - Make entity type field required
    - _Requirements: 4.3_

  - [x] 2.2 Add entity type column to entity list table
    - Display entity type for each registered entity
    - Add visual badges for RP (blue) and OP (green)
    - Show entity type in human-readable format
    - _Requirements: 4.1, 4.2_

  - [x] 2.3 Add entity type filter functionality
    - Add filter buttons/dropdown to filter by entity type
    - Implement client-side filtering logic
    - Show count of RPs and OPs
    - _Requirements: 4.1_

  - [x] 2.4 Write integration tests for admin UI
    - Test adding OP entity through UI
    - Test entity type display
    - Test entity type filtering
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 3. Checkpoint - Verify Trust Anchor enhancements
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create OP Trust Chain Validator Service for RP
  - [x] 4.1 Create OPTrustChainValidator class structure
    - Create `test-client-federation-valid/lib/opTrustChainValidator.js`
    - Define class constructor with configuration options
    - Initialize cache storage (Map)
    - Set up trust anchor URL from config
    - _Requirements: 1.1, 9.1, 9.4_

  - [x] 4.2 Implement trust chain resolution for OPs
    - Create `validateOP(opEntityId)` method
    - Fetch OP entity configuration from `/.well-known/openid-federation`
    - Extract authority_hints from entity configuration
    - Recursively resolve trust chain to Trust Anchor
    - Reuse existing `trustChainResolver` logic
    - _Requirements: 1.1, 1.3, 1.4, 1.5_

  - [x] 4.3 Write property test for trust chain resolution
    - **Property 4: Trust Chain Resolution**
    - **Validates: Requirements 1.4**

  - [x] 4.4 Implement JWT signature verification
    - Verify OP entity configuration JWT signature
    - Verify all entity statements in trust chain
    - Reuse existing `jwtSignatureVerifier` logic
    - _Requirements: 1.2_

  - [x] 4.5 Write property test for JWT signature verification
    - **Property 2: JWT Signature Verification**
    - **Validates: Requirements 1.2**

  - [x] 4.6 Implement trust chain termination validation
    - Verify trust chain terminates at configured Trust Anchor
    - Check that final entity in chain matches Trust Anchor URL
    - Return validation error if chain doesn't reach Trust Anchor
    - _Requirements: 1.5_

  - [x] 4.7 Write property test for trust chain termination
    - **Property 5: Trust Chain Termination Validation**
    - **Validates: Requirements 1.5**

- [x] 5. Implement Validation Caching
  - [x] 5.1 Create cache entry structure
    - Define cache entry format with timestamp and expiration
    - Set cache TTL to 1 hour (3600000 ms)
    - Store validation results in Map keyed by OP entity ID
    - _Requirements: 7.1, 7.4_

  - [x] 5.2 Implement cache lookup logic
    - Check cache before performing validation
    - Return cached result if entry exists and not expired
    - Remove expired entries on access
    - _Requirements: 7.2_

  - [x] 5.3 Write property test for cache usage
    - **Property 10: Cache Usage for Valid Entries**
    - **Validates: Requirements 7.2**

  - [x] 5.4 Implement cache update logic
    - Store validation result after successful validation
    - Include timestamp and expiration time
    - Update existing cache entry if re-validating
    - _Requirements: 2.5, 7.1_

  - [x] 5.5 Write property test for validation result caching
    - **Property 9: Validation Result Caching**
    - **Validates: Requirements 2.5, 7.1**

  - [x] 5.6 Implement cache expiration and cleanup
    - Perform fresh validation when cache entry is expired
    - Update cache with new validation result
    - Add periodic cleanup to remove expired entries (every 10 minutes)
    - _Requirements: 7.3_

  - [x] 5.7 Write property test for cache expiration
    - **Property 11: Cache Expiration and Re-validation**
    - **Validates: Requirements 7.3**

  - [x] 5.8 Implement cache clearing
    - Add `clearCache()` method
    - Clear cache on RP restart (automatic with in-memory storage)
    - _Requirements: 7.5_

  - [x] 5.9 Write unit tests for cache operations
    - Test cache hit scenario
    - Test cache miss scenario
    - Test expired entry removal
    - Test cache clearing
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

- [x] 6. Checkpoint - Verify validator and cache implementation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Error Handling and Logging
  - [x] 7.1 Create error response structure
    - Define error response format with error code and description
    - Include OP entity ID in error responses
    - Include detailed error array with specific failure reasons
    - _Requirements: 3.4, 6.5_

  - [x] 7.2 Write property test for error response structure
    - **Property 12: Error Response Structure**
    - **Validates: Requirements 3.4, 6.5**

  - [x] 7.3 Implement error handling for network failures
    - Handle OP entity configuration fetch failures
    - Return appropriate error code (`op_unreachable`)
    - Include timeout handling (10 seconds)
    - _Requirements: 6.1_

  - [x] 7.4 Write unit tests for network error handling
    - Test unreachable OP
    - Test timeout scenarios
    - Test HTTP error responses
    - _Requirements: 6.1_

  - [x] 7.5 Implement error handling for validation failures
    - Handle invalid JWT signatures
    - Handle missing authority_hints
    - Handle trust chain not reaching Trust Anchor
    - Return appropriate error codes
    - _Requirements: 6.2, 6.3, 6.4_

  - [x] 7.6 Write unit tests for validation error handling
    - Test invalid signature
    - Test missing authority hints
    - Test incomplete trust chain
    - _Requirements: 6.2, 6.3, 6.4_

  - [x] 7.7 Implement comprehensive logging
    - Log all validation attempts with OP entity ID
    - Log validation failures with error details
    - Log cache hits and misses
    - Include timestamp and request context
    - _Requirements: 2.4, 6.5_

  - [x] 7.8 Write property test for error logging
    - **Property 8: Error Logging with Entity ID**
    - **Validates: Requirements 2.4, 6.5**

- [x] 8. Integrate OP Validation into RP Authentication Flow
  - [x] 8.1 Create OP validation middleware
    - Create `validateOPMiddleware` function in RP server
    - Call `opValidator.validateOP()` before authentication
    - Return 403 error if validation fails
    - Set `req.opValidated` flag if validation succeeds
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.3_

  - [x] 8.2 Write property test for authentication rejection
    - **Property 7: Authentication Rejection for Invalid Chains**
    - **Validates: Requirements 2.3, 3.1**

  - [x] 8.3 Add OP validation to `/federation-login` endpoint
    - Apply `validateOPMiddleware` before redirect
    - Ensure validation happens before OIDC discovery
    - Prevent redirect if validation fails
    - _Requirements: 2.1, 10.1_

  - [x] 8.4 Write property test for validation before OIDC discovery
    - **Property 6: Validation Before OIDC Discovery**
    - **Validates: Requirements 2.1, 2.2**

  - [x] 8.5 Write property test for no redirect on untrusted OP
    - **Property 13: No Redirect for Untrusted OPs**
    - **Validates: Requirements 3.5**

  - [x] 8.6 Add OP validation check to `/callback` endpoint
    - Verify OP was previously validated before processing callback
    - Check `req.session.opValidated` or cache
    - Return error if OP not validated
    - _Requirements: 10.2_

  - [x] 8.7 Write property test for callback validation state check
    - **Property 21: Callback Validation State Check**
    - **Validates: Requirements 10.2**

  - [x] 8.8 Add OP validation check to token exchange
    - Verify OP is validated before accepting tokens
    - Only accept tokens from validated OPs
    - Return error if OP not validated
    - _Requirements: 10.3_

  - [x] 8.9 Write property test for token exchange validation
    - **Property 20: Validation Before Token Exchange**
    - **Validates: Requirements 10.3**

- [x] 9. Add Configuration and Startup Validation
  - [x] 9.1 Add Trust Anchor URL configuration
    - Read `TRUST_ANCHOR_URL` from environment variables
    - Validate URL format (must be HTTPS)
    - Fail startup if URL not configured
    - Log configuration error with details
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 9.2 Write unit tests for configuration validation
    - Test missing Trust Anchor URL
    - Test invalid URL format
    - Test valid HTTPS URL
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 9.3 Write property test for Trust Anchor URL usage
    - **Property 19: Trust Anchor URL Usage**
    - **Validates: Requirements 9.4**

  - [x] 9.4 Initialize OPTrustChainValidator on startup
    - Create validator instance with configuration
    - Pass Trust Anchor URL to validator
    - Handle initialization errors
    - _Requirements: 9.1, 9.4_

- [x] 10. Create Error UI Templates
  - [x] 10.1 Create untrusted OP error template
    - Modify `test-client-federation-valid/views/error.ejs`
    - Display clear error message for untrusted OP
    - Show OP entity ID
    - Show specific validation failure reasons
    - _Requirements: 3.2_

  - [x] 10.2 Add error details section
    - Display detailed error array
    - Show error codes and messages
    - Format errors in user-friendly way
    - _Requirements: 3.2, 6.5_

  - [x] 10.3 Write integration tests for error UI
    - Test error page rendering
    - Test error message display
    - Test error details display
    - _Requirements: 3.2_

- [x] 11. Checkpoint - Verify complete integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Add Integration Tests
  - [x] 12.1 Write end-to-end test for valid OP authentication
    - Test complete flow with registered OP
    - Verify trust chain validation succeeds
    - Verify authentication proceeds
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2_

  - [x] 12.2 Write end-to-end test for untrusted OP rejection
    - Test flow with unregistered OP
    - Verify trust chain validation fails
    - Verify authentication is rejected
    - Verify 403 error is returned
    - _Requirements: 2.3, 3.1, 3.3, 3.4, 3.5_

  - [x] 12.3 Write integration test for cache behavior
    - Test first validation (cache miss)
    - Test second validation (cache hit)
    - Test validation after cache expiration
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 12.4 Write integration test for Trust Anchor entity management
    - Test adding OP entity via admin API
    - Test fetching entity statement for OP
    - Test removing OP entity
    - Test entity statement no longer served after removal
    - _Requirements: 4.4, 4.5_

- [x] 13. Add Documentation and Examples
  - [x] 13.1 Document OP validation configuration
    - Add configuration options to README
    - Document environment variables
    - Provide example configuration
    - _Requirements: 9.1_

  - [x] 13.2 Document Trust Anchor entity type management
    - Document how to add OP entities
    - Document entity type values
    - Provide admin UI usage guide
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 13.3 Document error codes and troubleshooting
    - List all error codes and meanings
    - Provide troubleshooting steps
    - Document common issues and solutions
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 14. Final checkpoint - Complete feature verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (minimum 100 iterations)
- Unit tests validate specific examples and edge cases
- Integration tests verify end-to-end flows
- The implementation reuses existing TypeScript trust chain validation components
- JavaScript/TypeScript interop is handled through compiled JavaScript or ts-node
