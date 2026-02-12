/**
 * PKCE (Proof Key for Code Exchange) Utilities
 * 
 * Implements RFC 7636 for secure authorization code flow without client secrets.
 * Used as fallback when A327605 error occurs (Entity ID already in use).
 */

import crypto from 'crypto';

/**
 * Generate a cryptographically random code verifier
 * 
 * @returns {string} Base64URL-encoded code verifier (43-128 characters)
 */
export function generateCodeVerifier() {
  // Generate 32 random bytes (256 bits)
  const buffer = crypto.randomBytes(32);
  
  // Convert to base64url encoding
  return base64URLEncode(buffer);
}

/**
 * Generate code challenge from code verifier using SHA256
 * 
 * @param {string} codeVerifier - The code verifier
 * @returns {string} Base64URL-encoded SHA256 hash of the code verifier
 */
export function generateCodeChallenge(codeVerifier) {
  // Hash the code verifier with SHA256
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  
  // Convert to base64url encoding
  return base64URLEncode(hash);
}

/**
 * Convert buffer to base64url encoding
 * 
 * @param {Buffer} buffer - Buffer to encode
 * @returns {string} Base64URL-encoded string
 */
function base64URLEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate PKCE parameters for authorization request
 * 
 * @returns {Object} Object containing codeVerifier, codeChallenge, and codeChallengeMethod
 */
export function generatePKCEParams() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256' // SHA256
  };
}
