# Requirements Document

## Introduction

This document specifies the requirements for adding multi-OP (OpenID Provider) selection functionality to the Relying Party (RP) test client. Currently, the RP is hardcoded to work with a single OP instance. This feature will enable the RP to discover, validate, and authenticate with multiple OP instances dynamically using OpenID Connect Discovery and OpenID Federation Trust Chain validation.

## Glossary

- **RP (Relying Party)**: The OpenID Connect client application that authenticates users (test-client-federation-valid)
- **OP (OpenID Provider)**: The authorization server that authenticates users and issues tokens
- **Entity_ID**: A unique HTTPS URL that identifies an entity in OpenID Federation
- **Trust_Anchor**: The root of trust in OpenID Federation that maintains a list of trusted entities
- **Trust_Chain**: A chain of entity statements from an entity to the Trust Anchor
- **OpenID_Connect_Discovery**: The mechanism for discovering OP metadata via `.well-known/openid-configuration`
- **OP_Metadata**: Configuration information about an OP including endpoints and capabilities
- **Dynamic_Registration**: The process of registering a client with an OP at runtime
- **Authorization_Endpoint**: The OP endpoint where users authenticate
- **Token_Endpoint**: The OP endpoint where authorization codes are exchanged for tokens
- **JWKS_URI**: The endpoint where an OP's public keys are published

## Requirements

### Requirement 1: Multiple OP Instance Support

**User Story:** As a system administrator, I want to run multiple OP instances simultaneously, so that I can test federation scenarios with multiple providers.

#### Acceptance Criteria

1. THE System SHALL support running multiple OP instances on different ports
2. WHEN an OP instance starts, THE System SHALL assign it a unique port number
3. WHEN an OP instance starts, THE System SHALL assign it a unique entity_id
4. THE System SHALL ensure each OP instance operates independently with its own configuration

### Requirement 2: OpenID Connect Discovery

**User Story:** As an RP, I want to discover OP metadata dynamically, so that I can connect to any compliant OP without hardcoded configuration.

#### Acceptance Criteria

1. WHEN a user selects an OP entity_id, THE RP SHALL fetch the OP's metadata from the `.well-known/openid-configuration` endpoint
2. WHEN fetching OP metadata, THE RP SHALL extract the authorization_endpoint from the response
3. WHEN fetching OP metadata, THE RP SHALL extract the token_endpoint from the response
4. WHEN fetching OP metadata, THE RP SHALL extract the jwks_uri from the response
5. IF the `.well-known/openid-configuration` endpoint is unreachable, THEN THE RP SHALL display an error message to the user
6. IF the OP metadata is missing required fields, THEN THE RP SHALL display an error message indicating which fields are missing

### Requirement 3: OP Selection User Interface

**User Story:** As a user, I want to select which OP to authenticate with, so that I can choose my preferred identity provider.

#### Acceptance Criteria

1. WHEN a user visits the RP home page, THE RP SHALL display an OP selection interface
2. THE OP_Selection_Interface SHALL provide an input field for entering an OP entity_id
3. THE OP_Selection_Interface SHALL display a list of previously used OPs
4. WHEN a user enters an OP entity_id, THE RP SHALL validate that it is a valid HTTPS URL
5. WHEN a user selects an OP, THE RP SHALL display the OP's metadata including name and endpoints
6. WHEN an OP is selected, THE RP SHALL store the selection in the user's session

### Requirement 4: Trust Chain Validation for Selected OP

**User Story:** As an RP, I want to validate the trust chain of a selected OP, so that I only authenticate with trusted providers.

#### Acceptance Criteria

1. WHEN a user selects an OP, THE RP SHALL validate the OP's trust chain using the existing OPTrustChainValidator
2. IF the OP's trust chain validation fails, THEN THE RP SHALL display an error message and prevent authentication
3. IF the OP is not registered in the Trust Anchor, THEN THE RP SHALL reject the OP and display an error
4. WHEN trust chain validation succeeds, THE RP SHALL cache the validation result
5. THE RP SHALL display the trust chain validation status to the user

### Requirement 5: Dynamic Authorization Flow

**User Story:** As an RP, I want to initiate authorization flows with different OPs dynamically, so that I can authenticate users with their selected provider.

#### Acceptance Criteria

1. WHEN a user initiates login, THE RP SHALL send an authorization request to the selected OP's authorization_endpoint
2. WHEN sending an authorization request, THE RP SHALL use the OP-specific client credentials
3. THE RP SHALL generate a unique state parameter for each authorization request
4. THE RP SHALL generate a unique nonce parameter for each authorization request
5. WHEN receiving an authorization callback, THE RP SHALL verify the state parameter matches the stored value

### Requirement 6: Per-OP Client Credentials Management

**User Story:** As an RP, I want to manage separate client credentials for each OP, so that I can maintain independent registrations with multiple providers.

#### Acceptance Criteria

1. THE RP SHALL store client credentials indexed by OP entity_id
2. WHEN performing dynamic registration with an OP, THE RP SHALL store the returned client_secret associated with that OP's entity_id
3. WHEN authenticating with an OP, THE RP SHALL retrieve the client credentials for that specific OP
4. THE RP SHALL persist client credentials to disk so they survive server restarts
5. IF client credentials for an OP are missing, THEN THE RP SHALL perform dynamic registration before authentication

### Requirement 7: Dynamic Registration Per OP

**User Story:** As an RP, I want to register dynamically with each selected OP, so that I can establish client credentials without manual configuration.

#### Acceptance Criteria

1. WHEN a user selects an OP for the first time, THE RP SHALL perform dynamic registration with that OP
2. WHEN performing dynamic registration, THE RP SHALL send the RP's entity configuration to the OP's federation registration endpoint
3. WHEN dynamic registration succeeds, THE RP SHALL store the client_secret for that OP
4. IF dynamic registration fails, THEN THE RP SHALL display an error message with details
5. THE RP SHALL use the RP's entity_id as the client_id for all OPs

### Requirement 8: Token Exchange with Selected OP

**User Story:** As an RP, I want to exchange authorization codes with the selected OP, so that I can obtain access tokens for the user.

#### Acceptance Criteria

1. WHEN receiving an authorization code, THE RP SHALL exchange it at the selected OP's token_endpoint
2. WHEN exchanging an authorization code, THE RP SHALL use the client credentials for the selected OP
3. WHEN token exchange succeeds, THE RP SHALL store the access_token in the user's session
4. WHEN token exchange succeeds, THE RP SHALL store the id_token in the user's session
5. IF token exchange fails, THEN THE RP SHALL display an error message

### Requirement 9: Session Management for Multi-OP

**User Story:** As an RP, I want to track which OP a user authenticated with, so that I can maintain proper session state.

#### Acceptance Criteria

1. WHEN a user authenticates, THE RP SHALL store the OP entity_id in the user's session
2. WHEN displaying user information, THE RP SHALL show which OP the user authenticated with
3. WHEN a user logs out, THE RP SHALL clear the OP selection from the session
4. THE RP SHALL maintain separate sessions for users authenticated with different OPs

### Requirement 10: Error Handling and User Feedback

**User Story:** As a user, I want clear error messages when OP selection or authentication fails, so that I can understand what went wrong.

#### Acceptance Criteria

1. WHEN OP discovery fails, THE RP SHALL display an error message indicating the OP is unreachable
2. WHEN trust chain validation fails, THE RP SHALL display the validation errors to the user
3. WHEN dynamic registration fails, THE RP SHALL display the registration error details
4. WHEN token exchange fails, THE RP SHALL display the token error details
5. THE RP SHALL provide actionable guidance in error messages (e.g., "Check that the OP entity_id is correct")

### Requirement 11: Backward Compatibility

**User Story:** As a developer, I want the existing single-OP functionality to continue working, so that I don't break existing tests.

#### Acceptance Criteria

1. THE RP SHALL continue to support the AUTHORIZATION_SERVER environment variable for default OP selection
2. WHEN AUTHORIZATION_SERVER is configured, THE RP SHALL pre-select that OP on the home page
3. THE RP SHALL maintain the existing OPTrustChainValidator functionality without modification
4. THE RP SHALL maintain the existing dynamic registration flow for the default OP

### Requirement 12: OP Metadata Display

**User Story:** As a user, I want to see the metadata of a selected OP, so that I can verify I'm connecting to the correct provider.

#### Acceptance Criteria

1. WHEN an OP is selected, THE RP SHALL display the OP's name from its metadata
2. WHEN an OP is selected, THE RP SHALL display the OP's authorization_endpoint
3. WHEN an OP is selected, THE RP SHALL display the OP's token_endpoint
4. WHEN an OP is selected, THE RP SHALL display the trust chain validation status
5. THE RP SHALL display whether the OP is registered in the Trust Anchor
