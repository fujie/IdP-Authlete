// Federation Registration Validation Middleware
// Implements Requirements 6.1, 6.2, 6.4

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ValidationUtils } from '../federation/utils';
import { FEDERATION_CONSTANTS } from '../federation/constants';

/**
 * Federation Validation Error
 */
export interface FederationValidationError {
  field: string;
  message: string;
  value?: string;
}

/**
 * Federation Security Event
 */
export interface FederationSecurityEvent {
  type: 'malicious_request' | 'invalid_federation_request' | 'rate_limit_exceeded';
  ip: string;
  userAgent: string;
  path: string;
  method: string;
  details: string;
  timestamp: Date;
}

/**
 * Log federation security events
 */
function logFederationSecurityEvent(event: FederationSecurityEvent): void {
  logger.logWarn(`Federation security event: ${event.type}`, 'FederationValidationMiddleware', {
    federationSecurityEvent: event
  });
}

/**
 * Validate federation registration request parameters
 * Implements Requirements 6.1, 6.4
 */
export function validateFederationRegistrationRequest() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: FederationValidationError[] = [];
    
    try {
      logger.logInfo(
        'Validating federation registration request',
        'FederationValidationMiddleware',
        {
          method: req.method,
          contentType: req.get('content-type'),
          hasBody: !!req.body,
          bodyKeys: req.body ? Object.keys(req.body) : []
        }
      );

      // Validate HTTP method
      if (req.method !== 'POST') {
        errors.push({
          field: 'method',
          message: 'Federation registration requires POST method',
          value: req.method
        });
      }

      // Validate Content-Type header
      const contentType = req.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        errors.push({
          field: 'content-type',
          message: 'Content-Type must be application/json',
          value: contentType || 'missing'
        });
      }

      // Validate request body exists
      if (!req.body || typeof req.body !== 'object') {
        errors.push({
          field: 'body',
          message: 'Request body is required and must be valid JSON'
        });
        
        // Return early if no body to validate
        if (errors.length > 0) {
          logValidationErrors(req, errors);
          res.status(400).json({
            error: 'invalid_request',
            error_description: 'Federation registration request is invalid',
            validation_errors: errors
          });
          return;
        }
      }

      // Validate that at least one federation parameter is provided
      const hasEntityConfiguration = !!req.body.entity_configuration;
      const hasTrustChain = !!req.body.trust_chain;
      const hasRequestObject = !!req.body.request_object;

      if (!hasEntityConfiguration && !hasTrustChain && !hasRequestObject) {
        errors.push({
          field: 'federation_parameters',
          message: 'At least one of entity_configuration, trust_chain, or request_object must be provided'
        });
      }

      // Validate entity_configuration if provided
      if (hasEntityConfiguration) {
        const entityConfigErrors = validateEntityConfiguration(req.body.entity_configuration);
        errors.push(...entityConfigErrors);
      }

      // Validate trust_chain if provided
      if (hasTrustChain) {
        const trustChainErrors = validateTrustChain(req.body.trust_chain);
        errors.push(...trustChainErrors);
      }

      // Validate request_object if provided
      if (hasRequestObject) {
        const requestObjectErrors = validateRequestObject(req.body.request_object);
        errors.push(...requestObjectErrors);
      }

      // Validate additional parameters
      const additionalErrors = validateAdditionalParameters(req.body);
      errors.push(...additionalErrors);

      // Check for security threats in all string values
      const securityThreats = detectFederationSecurityThreats(req.body);
      if (securityThreats.length > 0) {
        const securityEvent: FederationSecurityEvent = {
          type: 'malicious_request',
          ip: req.ip || 'unknown',
          userAgent: req.get('User-Agent') || 'unknown',
          path: req.path,
          method: req.method,
          details: `Detected threats: ${securityThreats.join(', ')}`,
          timestamp: new Date()
        };
        
        logFederationSecurityEvent(securityEvent);
        
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Request contains invalid or malicious content'
        });
        return;
      }

      // If validation errors exist, return them
      if (errors.length > 0) {
        logValidationErrors(req, errors);
        
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Federation registration request parameters are invalid',
          validation_errors: errors
        });
        return;
      }

      logger.logInfo(
        'Federation registration request validation passed',
        'FederationValidationMiddleware',
        {
          hasEntityConfiguration,
          hasTrustChain,
          hasRequestObject
        }
      );

      next();

    } catch (error) {
      logger.logError({
        message: 'Federation validation middleware error',
        component: 'FederationValidationMiddleware',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error during request validation'
      });
    }
  };
}

/**
 * Validate entity configuration JWT format
 */
function validateEntityConfiguration(entityConfiguration: any): FederationValidationError[] {
  const errors: FederationValidationError[] = [];

  if (typeof entityConfiguration !== 'string') {
    errors.push({
      field: 'entity_configuration',
      message: 'entity_configuration must be a string (JWT)',
      value: typeof entityConfiguration
    });
    return errors;
  }

  // Validate JWT format (3 parts separated by dots)
  const parts = entityConfiguration.split('.');
  if (parts.length !== 3) {
    errors.push({
      field: 'entity_configuration',
      message: 'entity_configuration must be a valid JWT with 3 parts',
      value: `${parts.length} parts`
    });
    return errors;
  }

  // Validate JWT can be decoded
  try {
    const decoded = ValidationUtils.decodeJWT(entityConfiguration);
    
    // Validate required claims
    if (!decoded.payload.iss) {
      errors.push({
        field: 'entity_configuration.iss',
        message: 'entity_configuration missing required iss claim'
      });
    }

    if (!decoded.payload.sub) {
      errors.push({
        field: 'entity_configuration.sub',
        message: 'entity_configuration missing required sub claim'
      });
    }

    if (!decoded.payload.exp) {
      errors.push({
        field: 'entity_configuration.exp',
        message: 'entity_configuration missing required exp claim'
      });
    }

    // Validate entity ID format
    if (decoded.payload.iss && !ValidationUtils.isValidEntityId(decoded.payload.iss)) {
      errors.push({
        field: 'entity_configuration.iss',
        message: 'entity_configuration iss must be a valid entity identifier (URL)',
        value: decoded.payload.iss
      });
    }

  } catch (error) {
    errors.push({
      field: 'entity_configuration',
      message: `Invalid JWT format: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }

  return errors;
}

/**
 * Validate trust chain format
 */
function validateTrustChain(trustChain: any): FederationValidationError[] {
  const errors: FederationValidationError[] = [];

  if (!Array.isArray(trustChain)) {
    errors.push({
      field: 'trust_chain',
      message: 'trust_chain must be an array of entity statements',
      value: typeof trustChain
    });
    return errors;
  }

  if (trustChain.length === 0) {
    errors.push({
      field: 'trust_chain',
      message: 'trust_chain cannot be empty'
    });
    return errors;
  }

  if (trustChain.length > FEDERATION_CONSTANTS.MAX_TRUST_CHAIN_LENGTH) {
    errors.push({
      field: 'trust_chain',
      message: `trust_chain exceeds maximum length of ${FEDERATION_CONSTANTS.MAX_TRUST_CHAIN_LENGTH}`,
      value: trustChain.length.toString()
    });
  }

  // Validate each entity statement in the chain
  trustChain.forEach((statement: any, index: number) => {
    if (typeof statement !== 'object' || !statement.jwt) {
      errors.push({
        field: `trust_chain[${index}]`,
        message: 'Each trust chain entry must be an object with a jwt property'
      });
      return;
    }

    // Validate JWT format
    const parts = statement.jwt.split('.');
    if (parts.length !== 3) {
      errors.push({
        field: `trust_chain[${index}].jwt`,
        message: 'Entity statement must be a valid JWT with 3 parts',
        value: `${parts.length} parts`
      });
    }
  });

  return errors;
}

/**
 * Validate request object format
 */
function validateRequestObject(requestObject: any): FederationValidationError[] {
  const errors: FederationValidationError[] = [];

  if (typeof requestObject !== 'string') {
    errors.push({
      field: 'request_object',
      message: 'request_object must be a string (JWT)',
      value: typeof requestObject
    });
    return errors;
  }

  // Validate JWT format
  const parts = requestObject.split('.');
  if (parts.length !== 3) {
    errors.push({
      field: 'request_object',
      message: 'request_object must be a valid JWT with 3 parts',
      value: `${parts.length} parts`
    });
    return errors;
  }

  // Validate JWT can be decoded
  try {
    const decoded = ValidationUtils.decodeJWT(requestObject);
    
    // Validate required claims for request objects
    if (!decoded.payload.iss) {
      errors.push({
        field: 'request_object.iss',
        message: 'request_object missing required iss claim'
      });
    }

    if (!decoded.payload.aud) {
      errors.push({
        field: 'request_object.aud',
        message: 'request_object missing required aud claim'
      });
    }

    if (!decoded.payload.exp) {
      errors.push({
        field: 'request_object.exp',
        message: 'request_object missing required exp claim'
      });
    }

  } catch (error) {
    errors.push({
      field: 'request_object',
      message: `Invalid JWT format: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }

  return errors;
}

/**
 * Validate additional federation parameters
 */
function validateAdditionalParameters(body: any): FederationValidationError[] {
  const errors: FederationValidationError[] = [];

  // Validate any additional client metadata parameters
  if (body.redirect_uris) {
    if (!Array.isArray(body.redirect_uris)) {
      errors.push({
        field: 'redirect_uris',
        message: 'redirect_uris must be an array',
        value: typeof body.redirect_uris
      });
    } else {
      body.redirect_uris.forEach((uri: any, index: number) => {
        if (typeof uri !== 'string') {
          errors.push({
            field: `redirect_uris[${index}]`,
            message: 'Each redirect URI must be a string',
            value: typeof uri
          });
        } else {
          try {
            const url = new URL(uri);
            if (!['http:', 'https:'].includes(url.protocol)) {
              errors.push({
                field: `redirect_uris[${index}]`,
                message: 'Redirect URI must use http or https protocol',
                value: uri
              });
            }
          } catch {
            errors.push({
              field: `redirect_uris[${index}]`,
              message: 'Invalid redirect URI format',
              value: uri
            });
          }
        }
      });
    }
  }

  // Validate client_name if provided
  if (body.client_name && typeof body.client_name !== 'string') {
    errors.push({
      field: 'client_name',
      message: 'client_name must be a string',
      value: typeof body.client_name
    });
  }

  // Validate URIs if provided
  const uriFields = ['client_uri', 'logo_uri', 'tos_uri', 'policy_uri', 'jwks_uri'];
  uriFields.forEach(field => {
    if (body[field]) {
      if (typeof body[field] !== 'string') {
        errors.push({
          field,
          message: `${field} must be a string`,
          value: typeof body[field]
        });
      } else {
        try {
          new URL(body[field]);
        } catch {
          errors.push({
            field,
            message: `Invalid ${field} format`,
            value: body[field]
          });
        }
      }
    }
  });

  return errors;
}

/**
 * Detect security threats in federation request
 */
function detectFederationSecurityThreats(body: any): string[] {
  const threats: string[] = [];
  
  // JWT field names that should skip content validation (they are Base64-encoded JWTs)
  const JWT_FIELDS = ['entity_configuration', 'trust_chain', 'request_object'];
  
  // Check for common injection patterns in string values
  const checkValue = (value: any, path: string) => {
    // Skip validation for JWT fields (they are Base64-encoded and may contain patterns that look like injections)
    if (JWT_FIELDS.includes(path)) {
      return;
    }
    
    if (typeof value === 'string') {
      // Check for script injection
      if (/<script[^>]*>.*?<\/script>/gi.test(value)) {
        threats.push(`script_injection_in_${path}`);
      }
      
      // Check for SQL injection patterns
      if (/(\b(union|select|insert|update|delete|drop)\b|--|\/\*|\*\/)/gi.test(value)) {
        threats.push(`sql_injection_in_${path}`);
      }
      
      // Check for command injection
      if (/[;&|`$(){}[\]]/g.test(value)) {
        threats.push(`command_injection_in_${path}`);
      }
      
      // Check for path traversal
      if (/\.\.\//g.test(value)) {
        threats.push(`path_traversal_in_${path}`);
      }
    } else if (typeof value === 'object' && value !== null) {
      Object.entries(value).forEach(([key, val]) => {
        checkValue(val, `${path}.${key}`);
      });
    }
  };

  Object.entries(body).forEach(([key, value]) => {
    checkValue(value, key);
  });

  return threats;
}

/**
 * Log validation errors for monitoring
 */
function logValidationErrors(req: Request, errors: FederationValidationError[]): void {
  const securityEvent: FederationSecurityEvent = {
    type: 'invalid_federation_request',
    ip: req.ip || 'unknown',
    userAgent: req.get('User-Agent') || 'unknown',
    path: req.path,
    method: req.method,
    details: `Validation errors: ${errors.map(e => `${e.field}: ${e.message}`).join(', ')}`,
    timestamp: new Date()
  };
  
  logFederationSecurityEvent(securityEvent);
}

/**
 * Middleware for federation-specific security headers
 * Implements Requirement 6.2
 */
export function addFederationSecurityHeaders() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    // Add security headers specific to federation endpoints
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    
    // Federation-specific headers
    res.setHeader('X-Federation-Version', '1.0');
    res.setHeader('X-Registration-Endpoint', 'federation');
    
    next();
  };
}

/**
 * Middleware for request size limiting
 * Implements Requirement 6.2
 */
export function limitFederationRequestSize() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const maxSize = FEDERATION_CONSTANTS.MAX_REQUEST_SIZE || 1024 * 1024; // 1MB default
    
    if (req.get('content-length')) {
      const contentLength = parseInt(req.get('content-length') || '0', 10);
      if (contentLength > maxSize) {
        logger.logWarn(
          'Federation request size limit exceeded',
          'FederationValidationMiddleware',
          {
            contentLength,
            maxSize,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          }
        );
        
        res.status(413).json({
          error: 'invalid_request',
          error_description: 'Request entity too large'
        });
        return;
      }
    }
    
    next();
  };
}