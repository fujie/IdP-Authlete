# OpenID Federation Test Clients

This document describes the test client infrastructure for OpenID Federation Dynamic Registration testing.

## Overview

Two test clients have been implemented to validate the federation dynamic registration functionality:

1. **Valid Test Client** (Port 3006) - Entity ID registered in trust anchor
2. **Invalid Test Client** (Port 3007) - Entity ID NOT registered in trust anchor

## Test Clients

### Valid Test Client (Port 3006)

**Location:** `test-client-federation-valid/`

**Configuration:**
- Entity ID: `https://localhost:3006`
- Port: 3006
- Expected Behavior: Registration should SUCCEED

**Features:**
- Generates RSA key pair on startup
- Creates signed entity configuration JWT
- Performs dynamic client registration
- Supports federation request objects
- Provides entity configuration endpoint

**Usage:**
```bash
cd test-client-federation-valid
npm install
npm start
```

Then visit: http://localhost:3006

### Invalid Test Client (Port 3007)

**Location:** `test-client-federation-invalid/`

**Configuration:**
- Entity ID: `https://localhost:3007`
- Port: 3007
- Expected Behavior: Registration should FAIL

**Features:**
- Generates RSA key pair on startup
- Creates signed entity configuration JWT
- Attempts dynamic client registration (should fail)
- Provides detailed error reporting
- Validates rejection scenarios

**Usage:**
```bash
cd test-client-federation-invalid
npm install
npm start
```

Then visit: http://localhost:3007

## Testing Scenarios

### Scenario 1: Valid Client Registration

1. Start the valid test client on port 3006
2. Click "Login with OpenID Federation"
3. **Expected Result:** 
   - Dynamic registration succeeds
   - Client receives client_id and client_secret
   - User is redirected to authorization server
   - Authentication flow completes successfully

### Scenario 2: Invalid Client Registration

1. Start the invalid test client on port 3007
2. Click "Try Login (Should Fail)"
3. **Expected Result:**
   - Dynamic registration fails
   - Error message indicates trust chain validation failure
   - Authentication is prevented
   - User sees appropriate error page

## Key Features

### Entity Configuration

Both clients provide entity configuration endpoints at:
- Valid: http://localhost:3006/.well-known/openid-federation
- Invalid: http://localhost:3007/.well-known/openid-federation

### Dynamic Registration Testing

Both clients include test endpoints:
- Valid: http://localhost:3006/test-registration
- Invalid: http://localhost:3007/test-registration

### Health Checks

Both clients provide health check endpoints:
- Valid: http://localhost:3006/health
- Invalid: http://localhost:3007/health

## Requirements Validation

These test clients validate the following requirements:

**Requirement 4.1:** Valid test client registered in trust anchor ✅
**Requirement 4.2:** Invalid test client not registered in trust anchor ✅
**Requirement 4.3:** Valid client registration succeeds and allows OIDC login ✅
**Requirement 4.4:** Invalid client registration fails and prevents OIDC login ✅
**Requirement 4.5:** Both clients use unregistered client IDs in Authlete ✅

## Trust Anchor Configuration

For these test clients to work properly, the trust anchor must be configured with:

**Valid Entity (should be registered):**
- Entity ID: `https://localhost:3006`

**Invalid Entity (should NOT be registered):**
- Entity ID: `https://localhost:3007`

## Dependencies

Both clients use the following key dependencies:
- `express` - Web server framework
- `jose` - JWT signing and verification
- `axios` - HTTP client for API calls
- `uuid` - State parameter generation
- `ejs` - Template engine for UI

## Security Features

- RSA key pair generation for JWT signing
- State parameter validation for CSRF protection
- Secure session management
- Proper error handling and logging
- Entity configuration JWT signing

## Development Notes

- Both clients generate fresh key pairs on each startup
- Entity configurations are self-signed JWTs
- Request objects are signed with client private keys
- All federation endpoints follow OpenID Federation 1.0 specification
- Clients use unregistered client IDs to ensure dynamic registration is tested

## Troubleshooting

### Common Issues

1. **Port conflicts:** Ensure ports 3006 and 3007 are available
2. **Authorization server not running:** Start the main authorization server on port 3001
3. **Trust anchor configuration:** Verify trust anchor includes/excludes correct entity IDs
4. **Network connectivity:** Check that clients can reach the authorization server

### Logs

Both clients provide detailed console logging for:
- Key pair generation
- Registration attempts
- Authentication flows
- Error conditions
- Expected vs unexpected behaviors

The invalid client specifically logs when behaviors don't match expectations (e.g., if registration unexpectedly succeeds).