/**
 * Entity ID Validator
 * 
 * Validates entity_id URLs according to OpenID Federation requirements.
 * Entity IDs must be HTTPS URLs (except localhost for development).
 */

/**
 * Validate an entity_id URL
 * @param {string} entityId - Entity ID to validate
 * @returns {Object} Validation result with isValid and errors
 */
function validateEntityId(entityId) {
  const errors = [];

  // Check if entityId is provided
  if (!entityId || typeof entityId !== 'string') {
    errors.push({
      code: 'MISSING_ENTITY_ID',
      message: 'Entity ID is required and must be a string'
    });
    return { isValid: false, errors };
  }

  // Check if entityId is empty or only whitespace
  if (entityId.trim().length === 0) {
    errors.push({
      code: 'EMPTY_ENTITY_ID',
      message: 'Entity ID cannot be empty'
    });
    return { isValid: false, errors };
  }

  // Try to parse as URL
  let url;
  try {
    url = new URL(entityId);
  } catch (error) {
    errors.push({
      code: 'INVALID_URL_FORMAT',
      message: `Entity ID must be a valid URL: ${error.message}`
    });
    return { isValid: false, errors };
  }

  // Check protocol (must be HTTPS, except for localhost)
  const isLocalhost = url.hostname === 'localhost' || 
                      url.hostname === '127.0.0.1' || 
                      url.hostname === '[::1]';

  if (url.protocol === 'http:' && !isLocalhost) {
    errors.push({
      code: 'INSECURE_PROTOCOL',
      message: 'Entity ID must use HTTPS protocol (HTTP is only allowed for localhost)'
    });
  } else if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    errors.push({
      code: 'INVALID_PROTOCOL',
      message: `Entity ID must use HTTPS protocol, got: ${url.protocol}`
    });
  }

  // Check for fragment (not allowed in entity IDs)
  if (url.hash) {
    errors.push({
      code: 'FRAGMENT_NOT_ALLOWED',
      message: 'Entity ID must not contain URL fragments (#)'
    });
  }

  return {
    isValid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    entityId: entityId,
    parsed: {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname
    }
  };
}

/**
 * Check if an entity_id is valid (simple boolean check)
 * @param {string} entityId - Entity ID to validate
 * @returns {boolean} True if valid
 */
function isValidEntityId(entityId) {
  const result = validateEntityId(entityId);
  return result.isValid;
}

export { validateEntityId, isValidEntityId };
