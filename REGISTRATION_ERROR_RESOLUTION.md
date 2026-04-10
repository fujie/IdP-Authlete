# OpenID Federation Registration Error Resolution Guide

## Overview

This document explains how to resolve common registration errors in the OpenID Federation implementation, particularly the A327605 "Entity ID already in use" error.

## Error: A327605 - Entity ID Already in Use

### Symptoms

When attempting to register a client, you receive an error:
```
Authlete registration failed: BAD_REQUEST - [A327605] Entity ID already in use
```

Or:
```
ENTITY_ID_CONFLICT: A client with this entity ID already exists in Authlete
```

### Root Cause

This error occurs when:
1. A client with the same Entity ID already exists in the Authlete service
2. The client was registered in a previous session but local credentials were lost
3. There is a database inconsistency in Authlete (rare)

### Resolution Steps

#### Step 1: Verify Client Exists in Authlete

1. Log in to Authlete dashboard: https://ap1.authlete.com/
2. Navigate to **Services** → **Your Service** → **Clients**
3. Search for the client using the Entity ID (e.g., `https://rp-test.example.com`)
4. Check if a client with this Entity ID exists

#### Step 2: Delete the Existing Client

If the client exists in Authlete:

1. Click on the client in the Authlete dashboard
2. Click the **Delete** button
3. Confirm the deletion
4. Wait a few seconds for the deletion to propagate

#### Step 3: Clear Local Credentials

On the RP side, clear the local credentials:

```bash
# For single-OP setup
curl http://localhost:3006/clear-registration

# For multi-OP setup
curl -X POST http://localhost:3006/clear-op \
  -H "Content-Type: application/json" \
  -d '{"entity_id": "https://op.example.com"}'
```

Or manually delete the credentials file:
```bash
rm test-client-federation-valid/.op-credentials.json
```

#### Step 4: Retry Registration

1. Restart the RP application
2. Navigate to the RP homepage
3. Click "Login with OpenID Federation"
4. The registration should now succeed

### If Client Does NOT Exist in Authlete

If you cannot find the client in Authlete dashboard but still get the A327605 error, this indicates a potential Authlete cache or database issue:

1. **Contact Authlete Support**: Report the issue with:
   - Service ID
   - Entity ID
   - Timestamp of the error
   - Error message details

2. **Temporary Workaround**: Use a different Entity ID for testing:
   ```bash
   # In .env file
   ENTITY_ID=https://rp-test.example.com
   ```

## Error: A206201 - Dynamic Client Registration Not Supported

### Symptoms

```
Authlete registration failed: BAD_REQUEST - [A206201] Service does not support dynamic client registration
```

Or:
```
REGISTRATION_NOT_SUPPORTED: Dynamic Client Registration is not enabled for this service
```

### Resolution Steps

1. Log in to Authlete dashboard: https://ap1.authlete.com/
2. Navigate to **Services** → **Your Service** → **Settings**
3. Find the **Dynamic Client Registration** section
4. Enable the checkbox for "Dynamic Client Registration"
5. Click **Save** at the bottom of the page
6. Wait a few seconds for the settings to propagate
7. Retry the registration

## Error: A203302 - Client Metadata Was Empty

### Symptoms

```
Authlete registration failed: BAD_REQUEST - [A203302] Client metadata was empty
```

### Root Cause

This error typically occurs when:
1. The registration request is missing required metadata fields
2. The Entity Configuration JWT is malformed or missing metadata
3. The Trust Chain is invalid or incomplete

### Resolution Steps

1. **Verify Entity Configuration**: Check that your RP's entity configuration includes all required metadata:
   ```javascript
   metadata: {
     openid_relying_party: {
       client_name: "Your Client Name",
       redirect_uris: ["https://your-rp.example.com/callback"],
       response_types: ["code"],
       grant_types: ["authorization_code"],
       // ... other required fields
     }
   }
   ```

2. **Check Trust Chain**: Ensure the Trust Chain is properly constructed and includes:
   - RP's Entity Statement
   - Intermediate Entity Statements (if any)
   - Trust Anchor's Entity Statement

3. **Verify JWT Signature**: Ensure all JWTs in the Trust Chain are properly signed and can be verified

## Prevention Best Practices

### 1. Persistent Credentials Storage

Always use persistent storage for client credentials:

```javascript
// Multi-OP setup
const multiOPCredentialsManager = new MultiOPCredentialsManager({
  rpEntityId: FEDERATION_CONFIG.entityId,
  storageFile: path.join(__dirname, '.op-credentials.json')
});
```

### 2. Graceful Error Handling

Implement proper error handling in your registration flow:

```javascript
try {
  const registration = await performDynamicRegistration();
  // Success
} catch (error) {
  if (error.message.includes('ENTITY_ID_CONFLICT')) {
    // Guide user to delete existing client
  } else if (error.message.includes('REGISTRATION_NOT_SUPPORTED')) {
    // Guide user to enable dynamic registration
  } else {
    // Handle other errors
  }
}
```

### 3. Clear Registration Endpoint

Provide a clear registration endpoint for testing and debugging:

```javascript
app.get('/clear-registration', (req, res) => {
  multiOPCredentialsManager.clearAll();
  clearPersistedCredentials();
  res.json({ success: true, message: 'All registrations cleared' });
});
```

### 4. Validation Before Registration

Validate the OP's trust chain before attempting registration:

```javascript
// Validate OP trust chain first
const trustValidation = await opValidator.validateOP(opEntityId);
if (!trustValidation.isValid) {
  throw new Error('OP is not trusted');
}

// Then proceed with registration
const registration = await performDynamicRegistration();
```

## Implementation Changes (February 2026)

### Removed Fallback Logic

Previously, the implementation attempted to fall back to the standard Dynamic Client Registration API when the Federation Registration API failed. This has been removed because:

1. **Different Semantics**: Federation registration and standard registration have different requirements and behaviors
2. **Error Masking**: The fallback masked the real issue (A327605) and caused confusing A203302 errors
3. **Incorrect Approach**: A327605 indicates a real conflict that requires manual resolution, not automatic fallback

### Improved Error Messages

Error messages now provide clear, actionable guidance:

```
ENTITY_ID_CONFLICT: A client with this entity ID already exists in Authlete.
Please delete the existing client from the Authlete dashboard (Entity ID: https://rp-test.example.com)
and try again. See console for detailed resolution steps.
```

### Better Error Codes

The error mapping now distinguishes between:
- `entity_id_conflict` (A327605): Client already exists
- `registration_not_supported` (A206201): Dynamic registration not enabled
- `invalid_client_metadata` (A203302): Metadata missing or invalid

## Testing

After making changes, test the registration flow:

```bash
# Run unit tests
npm test -- src/federation/authleteIntegrationService.test.ts
npm test -- src/federation/federationRegistrationEndpoint.test.ts

# Run integration tests
cd test-client-federation-valid
npm test
```

## Support

If you continue to experience issues:

1. Check the console logs for detailed error information
2. Verify your Authlete service configuration
3. Review the Trust Anchor configuration
4. Contact Authlete support if the issue persists

## Related Documentation

- [OpenID Federation Specification](https://openid.net/specs/openid-federation-1_0.html)
- [Authlete API Documentation](https://docs.authlete.com/)
- [OP Setup Guide](./OP2_SETUP.md)
- [Federation README](./FEDERATION_README.md)
