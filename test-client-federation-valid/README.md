# OpenID Federation Test Client (Valid RP)

This is a test Relying Party (RP) client that demonstrates OpenID Federation integration with OP trust chain validation. The client validates that OpenID Providers (OPs) are registered in the Trust Anchor before initiating authentication flows.

## Features

- ✅ **OP Trust Chain Validation** - Validates OPs are registered in Trust Anchor
- ✅ **Bidirectional Trust** - Both RP and OP validate each other
- ✅ **Validation Caching** - Caches validation results for performance
- ✅ **Comprehensive Error Handling** - Clear error messages for validation failures
- ✅ **OpenID Federation 1.0** - Full compliance with federation specification

## Prerequisites

- Node.js 18+
- npm or yarn
- Running Trust Anchor server
- Running Authorization Server (OP)

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the environment configuration:
   ```bash
   cp .env.example .env
   ```

3. Configure your environment variables in `.env` (see Configuration section below)

## Configuration

### Environment Variables

The client uses the following environment variables for OP trust chain validation:

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `TRUST_ANCHOR_URL` | Trust Anchor base URL (must be HTTPS) | **Yes** | - | `https://trust-anchor.example.com` |
| `FEDERATION_AUTHORIZATION_SERVER` | OP entity ID to validate | **Yes** | - | `https://op.example.com` |
| `OP_VALIDATION_CACHE_TTL` | Cache TTL in milliseconds | No | `3600000` (1 hour) | `1800000` |
| `OP_VALIDATION_ENABLED` | Enable/disable OP validation | No | `true` | `true` |
| `PORT` | Server port | No | `3006` | `3006` |
| `SESSION_SECRET` | Session encryption secret | **Yes** | - | `your-secret-key` |

### Example Configuration

```bash
# Trust Anchor Configuration
TRUST_ANCHOR_URL=https://trust-anchor.example.com

# OP Configuration
FEDERATION_AUTHORIZATION_SERVER=https://op.example.com

# Validation Settings
OP_VALIDATION_CACHE_TTL=3600000
OP_VALIDATION_ENABLED=true

# Server Settings
PORT=3006
SESSION_SECRET=your-secure-session-secret-here
```

### Configuration Validation

The client validates configuration on startup:

- **TRUST_ANCHOR_URL** must be configured and use HTTPS protocol
- If validation fails, the server will not start and will log a configuration error
- Invalid URLs will be rejected with a clear error message

## OP Trust Chain Validation

### How It Works

1. **User initiates login** - User clicks login button on RP
2. **RP validates OP** - Before redirecting, RP validates OP's trust chain:
   - Fetches OP entity configuration from `/.well-known/openid-federation`
   - Resolves trust chain to Trust Anchor
   - Verifies JWT signatures
   - Checks cache for previous validation
3. **Validation succeeds** - RP proceeds with OIDC discovery and redirects user
4. **Validation fails** - RP returns 403 error with detailed error message

### Validation Cache

The client caches successful OP validations to improve performance:

- **Cache TTL**: 1 hour (configurable via `OP_VALIDATION_CACHE_TTL`)
- **Cache Storage**: In-memory (cleared on restart)
- **Cache Behavior**:
  - Cache hit: Uses cached result, no network requests
  - Cache miss: Performs full validation, stores result
  - Cache expired: Re-validates and updates cache
- **Cache Cleanup**: Automatic cleanup every 10 minutes

### Validation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     User Initiates Login                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Check Validation Cache                          │
└─────────────────────┬───────────────────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
    Cache Hit                 Cache Miss
    (not expired)            or Expired
         │                         │
         ▼                         ▼
┌─────────────────┐    ┌──────────────────────────────────────┐
│  Use Cached     │    │  Fetch OP Entity Configuration       │
│  Result         │    │  /.well-known/openid-federation      │
└────────┬────────┘    └──────────────┬───────────────────────┘
         │                            │
         │                            ▼
         │             ┌──────────────────────────────────────┐
         │             │  Resolve Trust Chain to Trust Anchor │
         │             └──────────────┬───────────────────────┘
         │                            │
         │                            ▼
         │             ┌──────────────────────────────────────┐
         │             │  Verify JWT Signatures               │
         │             └──────────────┬───────────────────────┘
         │                            │
         │                            ▼
         │             ┌──────────────────────────────────────┐
         │             │  Store Result in Cache               │
         │             └──────────────┬───────────────────────┘
         │                            │
         └────────────┬───────────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
    Valid OP                  Invalid OP
         │                         │
         ▼                         ▼
┌─────────────────┐    ┌──────────────────────────────────────┐
│  Proceed with   │    │  Return 403 Error                    │
│  OIDC Discovery │    │  Display Error Message               │
│  Redirect User  │    │  Log Failure Details                 │
└─────────────────┘    └──────────────────────────────────────┘
```

## Running the Client

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## API Endpoints

- **GET** `/` - Home page with login button
- **GET** `/federation-login` - Initiates federation login (validates OP first)
- **GET** `/callback` - OAuth callback endpoint
- **GET** `/error` - Error page for validation failures

## Error Handling

The client provides detailed error messages when OP trust chain validation fails. See the [Error Codes and Troubleshooting](#error-codes-and-troubleshooting) section below for detailed information on error codes and resolution steps.

## Testing

The client includes comprehensive tests:

- **Unit Tests** - Test individual components and functions
- **Property-Based Tests** - Test universal properties across all inputs
- **Integration Tests** - Test end-to-end flows

Run tests with:
```bash
npm test
```

## Security Considerations

- **HTTPS Only**: All entity IDs must use HTTPS protocol
- **Signature Verification**: All JWTs are verified before use
- **Trust Anchor Pinning**: Trust Anchor URL is configured, not discovered
- **Cache Security**: Cache entries include validation timestamps
- **Error Messages**: Error messages don't leak sensitive information

## Related Documentation

- [Trust Anchor Entity Management](../../trust-anchor/README.md)
- [Error Codes and Troubleshooting](#error-codes-and-troubleshooting)
- [OpenID Federation Specification](https://openid.net/specs/openid-federation-1_0.html)

## Error Codes and Troubleshooting

This section provides detailed information about error codes, their meanings, and troubleshooting steps for OP trust chain validation failures.

### Error Response Format

When OP trust chain validation fails, the client returns a standardized error response:

```json
{
  "error": "untrusted_op",
  "error_description": "OP https://op.example.com is not registered in Trust Anchor",
  "opEntityId": "https://op.example.com",
  "errors": [
    {
      "code": "trust_chain_invalid",
      "message": "Trust chain does not terminate at configured Trust Anchor",
      "details": {
        "opEntityId": "https://op.example.com",
        "timestamp": "2024-01-15T10:30:00.000Z"
      }
    }
  ]
}
```

### Error Codes

#### 1. `op_unreachable`

**Meaning**: The OP's entity configuration endpoint could not be reached.

**HTTP Status**: 503 Service Unavailable (or 403 Forbidden in authentication context)

**Common Causes**:
- OP server is down or unreachable
- Network connectivity issues
- Firewall blocking requests
- Invalid OP entity ID (URL)
- DNS resolution failure

**Troubleshooting Steps**:

1. **Verify OP is running**:
   ```bash
   curl https://op.example.com/.well-known/openid-federation
   ```
   - Should return a signed JWT
   - If connection refused, OP server is not running

2. **Check network connectivity**:
   ```bash
   ping op.example.com
   ```
   - Verify DNS resolves correctly
   - Check for network issues

3. **Verify OP entity ID**:
   - Ensure entity ID is a valid HTTPS URL
   - Check for typos in configuration
   - Verify URL is accessible from RP server

4. **Check firewall rules**:
   - Ensure RP can make outbound HTTPS requests
   - Verify OP allows inbound requests from RP

5. **Review RP logs**:
   ```bash
   # Look for detailed error messages
   grep "OP entity configuration" logs/app.log
   ```

**Example Error**:
```json
{
  "code": "op_unreachable",
  "message": "OP entity configuration could not be fetched: ECONNREFUSED",
  "details": {
    "opEntityId": "https://op.example.com",
    "error": "connect ECONNREFUSED 192.168.1.100:443"
  }
}
```

#### 2. `invalid_signature`

**Meaning**: JWT signature verification failed for the OP's entity configuration or a trust chain entity statement.

**HTTP Status**: 403 Forbidden

**Common Causes**:
- OP's signing key doesn't match published JWKS
- Entity statement signed with wrong key
- JWT has been tampered with
- Clock skew between servers
- Expired JWT

**Troubleshooting Steps**:

1. **Verify OP's JWKS**:
   ```bash
   # Fetch OP entity configuration
   curl https://op.example.com/.well-known/openid-federation
   
   # Decode JWT (use jwt.io or similar tool)
   # Check that 'jwks' claim contains valid keys
   ```

2. **Check JWT expiration**:
   - Decode the JWT and check `exp` claim
   - Ensure JWT is not expired
   - Check for clock skew between servers

3. **Verify signing algorithm**:
   - Ensure OP uses supported signing algorithms (RS256, ES256, etc.)
   - Check that algorithm in JWT header matches JWKS key type

4. **Test signature verification manually**:
   ```javascript
   const jose = require('jose');
   
   // Fetch and verify JWT
   const jwt = '...'; // OP entity configuration JWT
   const jwks = {...}; // OP's JWKS
   
   try {
     const result = await jose.jwtVerify(jwt, jwks);
     console.log('Signature valid:', result);
   } catch (error) {
     console.error('Signature invalid:', error);
   }
   ```

5. **Check Trust Anchor entity statements**:
   - Verify Trust Anchor is signing entity statements correctly
   - Ensure Trust Anchor's JWKS is accessible

**Example Error**:
```json
{
  "code": "invalid_signature",
  "message": "Invalid JWT signature in trust chain: signature verification failed",
  "details": {
    "opEntityId": "https://op.example.com",
    "originalError": "invalid_signature"
  }
}
```

#### 3. `missing_authority_hints`

**Meaning**: The OP's entity configuration does not contain `authority_hints`, indicating it's not part of a federation.

**HTTP Status**: 403 Forbidden

**Common Causes**:
- OP is not configured for OpenID Federation
- OP entity configuration missing `authority_hints` claim
- OP is a standalone provider (not federated)
- OP configuration error

**Troubleshooting Steps**:

1. **Check OP entity configuration**:
   ```bash
   # Fetch OP entity configuration
   curl https://op.example.com/.well-known/openid-federation
   
   # Decode JWT and check for 'authority_hints' claim
   # Should contain array of superior entity URLs
   ```

2. **Verify OP federation configuration**:
   - Ensure OP has `authority_hints` configured
   - Verify `authority_hints` points to Trust Anchor
   - Example:
     ```json
     {
       "iss": "https://op.example.com",
       "sub": "https://op.example.com",
       "authority_hints": ["https://trust-anchor.example.com"]
     }
     ```

3. **Check if OP supports federation**:
   - Not all OPs support OpenID Federation
   - Verify OP documentation for federation support
   - Consider using standard OIDC if federation not required

4. **Review OP configuration**:
   - Check OP's federation configuration file
   - Ensure Trust Anchor URL is correctly configured
   - Restart OP after configuration changes

**Example Error**:
```json
{
  "code": "missing_authority_hints",
  "message": "OP is not part of a federation or has no authority_hints",
  "details": {
    "opEntityId": "https://op.example.com",
    "originalMessage": "No authority_hints found in entity configuration"
  }
}
```

#### 4. `trust_chain_invalid`

**Meaning**: The trust chain does not terminate at the configured Trust Anchor.

**HTTP Status**: 403 Forbidden

**Common Causes**:
- OP is registered with a different Trust Anchor
- OP is not registered in the Trust Anchor
- Trust chain resolution failed
- Intermediate entity statements missing
- Trust Anchor URL mismatch

**Troubleshooting Steps**:

1. **Verify OP is registered in Trust Anchor**:
   ```bash
   # Check Trust Anchor admin UI
   # Navigate to: https://trust-anchor.example.com/admin
   # Verify OP entity ID is in the list
   ```

2. **Check Trust Anchor entity statement for OP**:
   ```bash
   curl "https://trust-anchor.example.com/.well-known/openid-federation?sub=https://op.example.com"
   
   # Should return entity statement JWT
   # If 404, OP is not registered
   ```

3. **Verify Trust Anchor URL configuration**:
   - Check RP's `.env` file:
     ```bash
     grep TRUST_ANCHOR_URL .env
     ```
   - Ensure URL matches OP's `authority_hints`
   - Verify URL is correct (no typos)

4. **Register OP in Trust Anchor**:
   - Navigate to Trust Anchor admin UI
   - Add OP entity:
     - Entity ID: `https://op.example.com`
     - Entity Type: `OpenID Provider (OP)`
   - Verify entity appears in list

5. **Test trust chain resolution manually**:
   ```bash
   # 1. Fetch OP entity configuration
   curl https://op.example.com/.well-known/openid-federation
   
   # 2. Extract authority_hints from JWT
   # 3. Fetch entity statement from Trust Anchor
   curl "https://trust-anchor.example.com/.well-known/openid-federation?sub=https://op.example.com"
   
   # 4. Verify chain is complete
   ```

6. **Check for intermediate entities**:
   - If using intermediate authorities, verify all are accessible
   - Ensure intermediate entity statements are valid

**Example Error**:
```json
{
  "code": "trust_chain_invalid",
  "message": "Trust chain does not terminate at configured Trust Anchor",
  "details": {
    "opEntityId": "https://op.example.com",
    "expectedTrustAnchor": "https://trust-anchor.example.com",
    "originalError": "invalid_trust_anchor"
  }
}
```

#### 5. `timeout`

**Meaning**: OP entity configuration fetch exceeded the 10-second timeout.

**HTTP Status**: 503 Service Unavailable (or 403 Forbidden in authentication context)

**Common Causes**:
- OP server is slow to respond
- Network latency issues
- OP server overloaded
- Large entity configuration payload
- Network congestion

**Troubleshooting Steps**:

1. **Test OP response time**:
   ```bash
   time curl https://op.example.com/.well-known/openid-federation
   
   # Should complete in < 10 seconds
   ```

2. **Check OP server performance**:
   - Monitor OP server CPU and memory usage
   - Check for high load or resource constraints
   - Review OP server logs for slow queries

3. **Verify network latency**:
   ```bash
   ping op.example.com
   traceroute op.example.com
   ```
   - High latency may cause timeouts
   - Consider network optimization

4. **Increase timeout (if appropriate)**:
   - Modify `opTrustChainValidator.js` timeout value
   - Default is 10 seconds
   - Only increase if OP legitimately needs more time

5. **Check for network issues**:
   - Verify no packet loss
   - Check for network congestion
   - Test from different network locations

**Example Error**:
```json
{
  "code": "timeout",
  "message": "OP entity configuration fetch timed out after 10 seconds",
  "details": {
    "opEntityId": "https://op.example.com",
    "timeout": "10s"
  }
}
```

#### 6. `validation_error`

**Meaning**: Generic validation error that doesn't fit other categories.

**HTTP Status**: 403 Forbidden

**Common Causes**:
- Unexpected error during validation
- Malformed entity configuration
- Invalid JWT structure
- Internal validation logic error

**Troubleshooting Steps**:

1. **Review detailed error message**:
   - Check `details` field for specific error
   - Look for stack traces in logs

2. **Verify entity configuration format**:
   ```bash
   # Fetch and decode entity configuration
   curl https://op.example.com/.well-known/openid-federation
   
   # Verify JWT structure:
   # - Valid header (alg, kid)
   # - Valid payload (iss, sub, jwks, etc.)
   # - Valid signature
   ```

3. **Check RP logs**:
   ```bash
   # Look for detailed error messages and stack traces
   tail -f logs/app.log | grep "validation failed"
   ```

4. **Test with known-good OP**:
   - Try validation with a different OP
   - If other OPs work, issue is with specific OP

5. **Report issue**:
   - If error persists, report to development team
   - Include full error details and logs

**Example Error**:
```json
{
  "code": "validation_error",
  "message": "Trust chain validation failed: Unexpected error",
  "details": {
    "opEntityId": "https://op.example.com",
    "error": "Unexpected token in JSON",
    "errorType": "SyntaxError"
  }
}
```

#### 7. `configuration_error`

**Meaning**: RP configuration is invalid or missing.

**HTTP Status**: 500 Internal Server Error

**Common Causes**:
- Missing `TRUST_ANCHOR_URL` environment variable
- Invalid Trust Anchor URL format
- Missing required configuration

**Troubleshooting Steps**:

1. **Verify environment variables**:
   ```bash
   # Check .env file
   cat .env | grep TRUST_ANCHOR_URL
   
   # Should output: TRUST_ANCHOR_URL=https://trust-anchor.example.com
   ```

2. **Validate Trust Anchor URL**:
   - Must be HTTPS (or http://localhost for development)
   - Must be a valid URL format
   - Must be accessible from RP

3. **Check configuration on startup**:
   - RP validates configuration on startup
   - Check startup logs for configuration errors
   - Server will not start if configuration invalid

4. **Fix configuration**:
   ```bash
   # Edit .env file
   nano .env
   
   # Add or fix TRUST_ANCHOR_URL
   TRUST_ANCHOR_URL=https://trust-anchor.example.com
   
   # Restart RP
   npm start
   ```

**Example Error**:
```json
{
  "code": "configuration_error",
  "message": "Trust Anchor URL is required",
  "details": {
    "configKey": "TRUST_ANCHOR_URL",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

### Common Issues and Solutions

#### Issue: "OP validation always fails even though OP is registered"

**Possible Causes**:
- Trust Anchor URL mismatch
- OP entity ID mismatch (case-sensitive)
- Cache contains stale failure result

**Solution**:
1. Verify Trust Anchor URL matches in both RP and OP configurations
2. Verify OP entity ID matches exactly (including protocol, domain, path)
3. Clear validation cache:
   ```javascript
   // In RP code or via admin endpoint
   opValidator.clearCache();
   ```
4. Restart RP to clear cache

#### Issue: "Validation succeeds but authentication still fails"

**Possible Causes**:
- OP validation succeeded but OIDC discovery failed
- OP metadata issues
- Client not registered with OP

**Solution**:
1. Check RP logs for OIDC discovery errors
2. Verify OP's OIDC metadata endpoint:
   ```bash
   curl https://op.example.com/.well-known/openid-configuration
   ```
3. Ensure RP is registered with OP (if using static registration)
4. Check OP logs for authentication errors

#### Issue: "Validation is very slow"

**Possible Causes**:
- Cache not working
- Network latency
- OP slow to respond

**Solution**:
1. Verify cache is enabled and working:
   ```javascript
   const stats = opValidator.getCacheStats();
   console.log('Cache stats:', stats);
   ```
2. Check cache TTL configuration
3. Monitor network latency to OP and Trust Anchor
4. Consider increasing cache TTL if appropriate

#### Issue: "Cache not expiring as expected"

**Possible Causes**:
- Cleanup interval not running
- System clock issues
- Cache TTL misconfigured

**Solution**:
1. Verify cache TTL configuration:
   ```bash
   grep OP_VALIDATION_CACHE_TTL .env
   ```
2. Check system clock is correct
3. Manually trigger cache cleanup:
   ```javascript
   opValidator._cleanupExpiredEntries();
   ```
4. Restart RP to reset cache

#### Issue: "Error messages not detailed enough"

**Possible Causes**:
- Log level too high
- Error details not being captured

**Solution**:
1. Lower log level to capture more details
2. Check `requestContext` is being passed to `validateOP()`
3. Review full error response including `details` field
4. Enable debug logging if available

### Debugging Tips

#### Enable Verbose Logging

Add detailed logging to track validation flow:

```javascript
// In server.js or validation middleware
const result = await opValidator.validateOP(opEntityId, {
  sessionId: req.session.id,
  userAgent: req.get('user-agent'),
  ip: req.ip
});

console.log('Validation result:', JSON.stringify(result, null, 2));
```

#### Test Validation Manually

Test OP validation outside of authentication flow:

```javascript
// Create test script: test-validation.js
const { OPTrustChainValidator } = require('./lib/opTrustChainValidator');

const validator = new OPTrustChainValidator({
  trustAnchorUrl: 'https://trust-anchor.example.com'
});

async function test() {
  const result = await validator.validateOP('https://op.example.com');
  console.log('Result:', JSON.stringify(result, null, 2));
}

test();
```

Run test:
```bash
node test-validation.js
```

#### Inspect Cache Contents

Check what's in the validation cache:

```javascript
// Add to server.js or create admin endpoint
app.get('/admin/cache', (req, res) => {
  const stats = opValidator.getCacheStats();
  const entries = [];
  
  for (const [opEntityId, entry] of opValidator.cache.entries()) {
    entries.push({
      opEntityId,
      isValid: entry.isValid,
      expiresAt: new Date(entry.expiresAt).toISOString(),
      expired: Date.now() >= entry.expiresAt
    });
  }
  
  res.json({ stats, entries });
});
```

#### Monitor Network Requests

Use network monitoring to see requests to OP and Trust Anchor:

```bash
# Monitor all HTTPS requests
tcpdump -i any -n 'tcp port 443'

# Or use a proxy like mitmproxy
mitmproxy --mode transparent
```

### Getting Help

If you're still experiencing issues after following these troubleshooting steps:

1. **Check logs**: Review RP, OP, and Trust Anchor logs for detailed error messages
2. **Verify configuration**: Double-check all environment variables and URLs
3. **Test components individually**: Test OP, Trust Anchor, and RP separately
4. **Review documentation**: Check OpenID Federation specification for requirements
5. **Report issue**: If you believe there's a bug, report it with:
   - Full error message and details
   - Configuration (sanitized)
   - Steps to reproduce
   - Logs from all components

## License

MIT
