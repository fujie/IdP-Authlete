import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Security-focused input validation and sanitization middleware
 * Implements Requirements 6.2 and 6.4 for preventing injection attacks
 */

export interface ValidationError {
  field: string;
  message: string;
  value?: string;
}

export interface SecurityEvent {
  type: 'malicious_request' | 'injection_attempt' | 'invalid_input';
  ip: string;
  userAgent: string;
  path: string;
  method: string;
  details: string;
  timestamp: Date;
}

/**
 * Log security events for monitoring and analysis
 */
function logSecurityEvent(event: SecurityEvent): void {
  logger.logWarn(`Security event detected: ${event.type}`, 'ValidationMiddleware', {
    securityEvent: event
  });
  
  // In production, this would integrate with proper logging/monitoring systems
  // such as Winston, Datadog, or CloudWatch
}

/**
 * Detect potentially malicious patterns in input
 */
function detectMaliciousPatterns(value: string): string[] {
  const patterns = [
    // SQL injection patterns
    { pattern: /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)/gi, type: 'sql_injection' },
    { pattern: /(--|\/\*|\*\/|;)/g, type: 'sql_comment' },
    { pattern: /(\bor\b|\band\b)\s*\d+\s*=\s*\d+/gi, type: 'sql_boolean' },
    
    // XSS patterns
    { pattern: /<script[^>]*>.*?<\/script>/gi, type: 'xss_script' },
    { pattern: /javascript:/gi, type: 'xss_javascript' },
    { pattern: /on\w+\s*=/gi, type: 'xss_event' },
    { pattern: /<iframe[^>]*>/gi, type: 'xss_iframe' },
    
    // Command injection patterns
    { pattern: /[;&|`$(){}[\]]/g, type: 'command_injection' },
    { pattern: /\.\.\//g, type: 'path_traversal' },
    
    // LDAP injection patterns
    { pattern: /[()&|!]/g, type: 'ldap_injection' },
    
    // NoSQL injection patterns
    { pattern: /\$\w+/g, type: 'nosql_injection' },
    
    // Template injection patterns
    { pattern: /<%.*?%>/g, type: 'template_injection' },
    { pattern: /\{\{.*?\}\}/g, type: 'template_injection' },
    { pattern: /#\{.*?\}/g, type: 'template_injection' }
  ];

  const detectedThreats: string[] = [];
  
  for (const { pattern, type } of patterns) {
    if (pattern.test(value)) {
      detectedThreats.push(type);
    }
  }
  
  return detectedThreats;
}

/**
 * Sanitize string input by removing/escaping dangerous characters
 */
function sanitizeString(value: string): string {
  if (typeof value !== 'string') {
    return String(value);
  }
  
  return value
    // Remove null bytes
    .replace(/\0/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Trim whitespace
    .trim()
    // Limit length to prevent DoS
    .substring(0, 2048);
}

/**
 * Validate OAuth 2.0 specific parameters
 */
function validateOAuthParameter(name: string, value: string): ValidationError[] {
  const errors: ValidationError[] = [];
  
  switch (name) {
    case 'response_type':
      if (!['code', 'token', 'id_token'].includes(value)) {
        errors.push({
          field: name,
          message: 'Invalid response_type. Must be code, token, or id_token',
          value
        });
      }
      break;
      
    case 'grant_type':
      if (!['authorization_code', 'refresh_token', 'client_credentials'].includes(value)) {
        errors.push({
          field: name,
          message: 'Invalid grant_type',
          value
        });
      }
      break;
      
    case 'client_id':
      // For OpenID Federation, client_id can be an entity identifier (URL)
      // Check if it's a URL format (starts with http:// or https://)
      if (value.startsWith('http://') || value.startsWith('https://')) {
        try {
          const url = new URL(value);
          if (!['http:', 'https:'].includes(url.protocol)) {
            errors.push({
              field: name,
              message: 'Entity identifier client_id must use http or https protocol',
              value
            });
          }
          // Additional validation for entity identifiers per OpenID Federation 1.0
          if (url.search || url.hash) {
            errors.push({
              field: name,
              message: 'Entity identifier client_id must not contain query parameters or fragments',
              value
            });
          }
        } catch {
          errors.push({
            field: name,
            message: 'Invalid entity identifier client_id format',
            value
          });
        }
      } else {
        // Traditional client_id format (alphanumeric)
        if (!/^[a-zA-Z0-9_-]+$/.test(value) || value.length > 255) {
          errors.push({
            field: name,
            message: 'Invalid client_id format',
            value
          });
        }
      }
      break;
      
    case 'redirect_uri':
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) {
          errors.push({
            field: name,
            message: 'redirect_uri must use http or https protocol',
            value
          });
        }
      } catch {
        errors.push({
          field: name,
          message: 'Invalid redirect_uri format',
          value
        });
      }
      break;
      
    case 'scope':
      // Scopes should be space-separated alphanumeric strings
      const scopes = value.split(' ');
      for (const scope of scopes) {
        if (!/^[a-zA-Z0-9_:-]+$/.test(scope)) {
          errors.push({
            field: name,
            message: `Invalid scope format: ${scope}`,
            value
          });
        }
      }
      break;
      
    case 'state':
      // State parameter should be URL-safe
      if (!/^[a-zA-Z0-9_.-]+$/.test(value) || value.length > 255) {
        errors.push({
          field: name,
          message: 'Invalid state parameter format',
          value
        });
      }
      break;
      
    case 'code':
      // Authorization codes should be alphanumeric
      if (!/^[a-zA-Z0-9_-]+$/.test(value) || value.length > 512) {
        errors.push({
          field: name,
          message: 'Invalid authorization code format',
          value
        });
      }
      break;
  }
  
  return errors;
}

/**
 * General input validation middleware
 */
export function validateInput() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: ValidationError[] = [];
    const securityThreats: string[] = [];
    
    // Validate and sanitize query parameters
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === 'string') {
        // Skip validation for 'request' parameter (JWT Request Object in OpenID Federation)
        // JWTs contain dots and other characters that would trigger false positives
        if (key === 'request') {
          continue;
        }
        
        const threats = detectMaliciousPatterns(value);
        if (threats.length > 0) {
          securityThreats.push(...threats);
        }
        
        // Sanitize the value
        req.query[key] = sanitizeString(value);
        
        // OAuth-specific validation
        const oauthErrors = validateOAuthParameter(key, req.query[key] as string);
        errors.push(...oauthErrors);
      }
    }
    
    // Validate and sanitize body parameters
    if (req.body && typeof req.body === 'object') {
      for (const [key, value] of Object.entries(req.body)) {
        if (typeof value === 'string') {
          // Skip validation for JWT parameters in OpenID Federation
          // These include: entity_configuration, request_object, trust_chain elements
          if (key === 'entity_configuration' || key === 'request_object' || key === 'request') {
            continue;
          }
          
          const threats = detectMaliciousPatterns(value);
          if (threats.length > 0) {
            securityThreats.push(...threats);
          }
          
          // Sanitize the value
          req.body[key] = sanitizeString(value);
          
          // OAuth-specific validation
          const oauthErrors = validateOAuthParameter(key, req.body[key] as string);
          errors.push(...oauthErrors);
        }
      }
    }
    
    // Log security events if threats detected
    if (securityThreats.length > 0) {
      const securityEvent: SecurityEvent = {
        type: 'malicious_request',
        ip: req.ip || req.connection.remoteAddress || 'unknown',
        userAgent: req.get('User-Agent') || 'unknown',
        path: req.path,
        method: req.method,
        details: `Detected threats: ${securityThreats.join(', ')}`,
        timestamp: new Date()
      };
      
      logSecurityEvent(securityEvent);
      
      // Reject obviously malicious requests
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Request contains invalid characters'
      });
      return;
    }
    
    // If validation errors exist, return them
    if (errors.length > 0) {
      const securityEvent: SecurityEvent = {
        type: 'invalid_input',
        ip: req.ip || req.connection.remoteAddress || 'unknown',
        userAgent: req.get('User-Agent') || 'unknown',
        path: req.path,
        method: req.method,
        details: `Validation errors: ${errors.map(e => `${e.field}: ${e.message}`).join(', ')}`,
        timestamp: new Date()
      };
      
      logSecurityEvent(securityEvent);
      
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Request parameters are invalid',
        validation_errors: errors
      });
      return;
    }
    
    next();
  };
}

/**
 * Middleware specifically for authorization endpoint validation
 */
export function validateAuthorizationRequest() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // OpenID Federation: If 'request' parameter is present (JWT Request Object),
    // the required parameters are inside the JWT, not in query parameters
    if (req.query.request) {
      // Skip validation - parameters will be extracted from Request Object
      next();
      return;
    }
    
    const requiredParams = ['response_type', 'client_id'];
    const errors: ValidationError[] = [];
    
    // Check required parameters
    for (const param of requiredParams) {
      if (!req.query[param]) {
        errors.push({
          field: param,
          message: `Missing required parameter: ${param}`
        });
      }
    }
    
    // Additional authorization-specific validation
    if (req.query.response_type && req.query.response_type !== 'code') {
      errors.push({
        field: 'response_type',
        message: 'Only authorization code flow (response_type=code) is supported',
        value: req.query.response_type as string
      });
    }
    
    if (errors.length > 0) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Authorization request is invalid',
        validation_errors: errors
      });
      return;
    }
    
    next();
  };
}

/**
 * Middleware specifically for token endpoint validation
 */
export function validateTokenRequest() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: ValidationError[] = [];
    
    // Check Content-Type header
    const contentType = req.get('Content-Type');
    if (!contentType || !contentType.includes('application/x-www-form-urlencoded')) {
      errors.push({
        field: 'content-type',
        message: 'Content-Type must be application/x-www-form-urlencoded'
      });
    }
    
    // Check required parameters
    if (!req.body.grant_type) {
      errors.push({
        field: 'grant_type',
        message: 'Missing required parameter: grant_type'
      });
    }
    
    if (req.body.grant_type === 'authorization_code' && !req.body.code) {
      errors.push({
        field: 'code',
        message: 'Missing required parameter: code for authorization_code grant'
      });
    }
    
    if (errors.length > 0) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Token request is invalid',
        validation_errors: errors
      });
      return;
    }
    
    next();
  };
}

/**
 * Middleware for introspection endpoint validation
 */
export function validateIntrospectionRequest() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: ValidationError[] = [];
    
    // Check required parameters
    if (!req.body.token) {
      errors.push({
        field: 'token',
        message: 'Missing required parameter: token'
      });
    }
    
    // Validate token format (should be alphanumeric with some special chars)
    if (req.body.token && !/^[a-zA-Z0-9_.-]+$/.test(req.body.token)) {
      errors.push({
        field: 'token',
        message: 'Invalid token format',
        value: req.body.token
      });
    }
    
    if (errors.length > 0) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Introspection request is invalid',
        validation_errors: errors
      });
      return;
    }
    
    next();
  };
}