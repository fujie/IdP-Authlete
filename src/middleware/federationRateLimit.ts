// Federation Registration Rate Limiting Middleware
// Implements Requirement 6.5

import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { logger } from '../utils/logger';
import { ValidationUtils } from '../federation/utils';

/**
 * Federation Rate Limit Configuration
 */
export interface FederationRateLimitConfig {
  points: number;        // Number of requests
  duration: number;      // Per duration in seconds
  blockDuration: number; // Block duration in seconds
  execEvenly?: boolean;  // Spread requests evenly across duration
}

/**
 * Federation Rate Limit Options
 */
export interface FederationRateLimitOptions {
  keyGenerator?: (req: Request) => string;
  onLimitReached?: (req: Request, res: Response) => void;
}

/**
 * Default rate limit configurations for federation endpoints
 */
const FEDERATION_RATE_LIMIT_CONFIGS = {
  // Federation registration endpoint - strict limits to prevent abuse
  registration: {
    points: 5,         // 5 registration attempts
    duration: 300,     // per 5 minutes
    blockDuration: 900 // block for 15 minutes
  },
  
  // Entity configuration endpoint - more lenient for discovery
  entityConfiguration: {
    points: 50,        // 50 requests
    duration: 60,      // per 60 seconds
    blockDuration: 300 // block for 5 minutes
  },
  
  // Federation fetch/resolve endpoints - moderate limits
  federationApi: {
    points: 20,        // 20 requests
    duration: 60,      // per 60 seconds
    blockDuration: 300 // block for 5 minutes
  }
};

/**
 * Create federation rate limiter instance
 */
function createFederationRateLimiter(config: FederationRateLimitConfig): RateLimiterMemory {
  return new RateLimiterMemory({
    keyPrefix: 'federation_rl',
    ...config
  });
}

/**
 * Generate rate limiting key for federation registration
 * Uses entity ID if available, falls back to IP + User Agent
 */
function federationRegistrationKeyGenerator(req: Request): string {
  try {
    // Try to extract entity ID from request body
    let entityId: string | null = null;
    
    if (req.body) {
      // From entity_configuration
      if (req.body.entity_configuration) {
        try {
          const decoded = ValidationUtils.decodeJWT(req.body.entity_configuration);
          entityId = decoded.payload.sub || decoded.payload.iss;
        } catch {
          // Ignore decode errors, will fall back to IP-based limiting
        }
      }
      
      // From trust_chain
      if (!entityId && req.body.trust_chain && Array.isArray(req.body.trust_chain) && req.body.trust_chain.length > 0) {
        try {
          const leafStatement = req.body.trust_chain[0];
          if (leafStatement && leafStatement.payload) {
            entityId = leafStatement.payload.sub;
          }
        } catch {
          // Ignore errors, will fall back to IP-based limiting
        }
      }
      
      // From request_object
      if (!entityId && req.body.request_object) {
        try {
          const decoded = ValidationUtils.decodeJWT(req.body.request_object);
          entityId = decoded.payload.iss;
        } catch {
          // Ignore decode errors, will fall back to IP-based limiting
        }
      }
    }
    
    // Use entity ID if available, otherwise use IP + User Agent
    if (entityId) {
      return `entity:${entityId}`;
    } else {
      const ip = req.ip || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';
      const key = `${ip}:${userAgent}`;
      return `ip:${Buffer.from(key).toString('base64').substring(0, 32)}`;
    }
    
  } catch (error) {
    // Fallback to IP-based limiting on any error
    const ip = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    const key = `${ip}:${userAgent}`;
    return `fallback:${Buffer.from(key).toString('base64').substring(0, 32)}`;
  }
}

/**
 * Generate rate limiting key for general federation endpoints
 */
function federationApiKeyGenerator(req: Request): string {
  const ip = req.ip || 'unknown';
  const userAgent = req.get('User-Agent') || 'unknown';
  const key = `${ip}:${userAgent}`;
  return Buffer.from(key).toString('base64').substring(0, 32);
}

/**
 * Log federation rate limit events
 */
function logFederationRateLimitEvent(req: Request, remainingPoints: number, totalHits: number): void {
  logger.logInfo('Federation rate limit hit', 'FederationRateLimitMiddleware', {
    federationRateLimitEvent: {
      type: 'rate_limit_hit',
      ip: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      path: req.path,
      method: req.method,
      remainingPoints,
      totalHits,
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Log federation rate limit exceeded events
 */
function logFederationRateLimitExceeded(req: Request, retryAfter: number): void {
  logger.logWarn('Federation rate limit exceeded', 'FederationRateLimitMiddleware', {
    federationRateLimitEvent: {
      type: 'rate_limit_exceeded',
      ip: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      path: req.path,
      method: req.method,
      retryAfter,
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Create federation rate limiting middleware
 */
export function createFederationRateLimit(
  config: FederationRateLimitConfig,
  options: FederationRateLimitOptions = {}
): (req: Request, res: Response, next: NextFunction) => void {
  
  const rateLimiter = createFederationRateLimiter(config);
  const keyGenerator = options.keyGenerator || federationApiKeyGenerator;
  
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = keyGenerator(req);
      
      // Consume a point from the rate limiter
      const result = await rateLimiter.consume(key);
      
      // Add rate limit headers to response
      res.set({
        'X-RateLimit-Limit': config.points.toString(),
        'X-RateLimit-Remaining': result.remainingPoints?.toString() || '0',
        'X-RateLimit-Reset': new Date(Date.now() + result.msBeforeNext).toISOString(),
        'X-RateLimit-Policy': 'federation'
      });
      
      // Log rate limit usage
      logFederationRateLimitEvent(req, result.remainingPoints || 0, 1);
      
      next();
      
    } catch (rateLimiterRes: any) {
      // Rate limit exceeded
      const retryAfter = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
      
      // Log rate limit exceeded event
      logFederationRateLimitExceeded(req, retryAfter);
      
      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': config.points.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString(),
        'X-RateLimit-Policy': 'federation',
        'Retry-After': retryAfter.toString()
      });
      
      // Call custom handler if provided
      if (options.onLimitReached) {
        options.onLimitReached(req, res);
        return;
      }
      
      // Return federation-compliant error response
      res.status(429).json({
        error: 'temporarily_unavailable',
        error_description: 'The federation registration service is temporarily overloaded. Please implement exponential backoff and retry later.',
        retry_after: retryAfter
      });
    }
  };
}

/**
 * Rate limiting middleware for federation registration endpoint
 * Implements Requirement 6.5
 */
export function federationRegistrationRateLimit() {
  return createFederationRateLimit(
    FEDERATION_RATE_LIMIT_CONFIGS.registration,
    {
      keyGenerator: federationRegistrationKeyGenerator,
      onLimitReached: (req: Request, res: Response) => {
        logger.logWarn(
          'Federation registration rate limit exceeded',
          'FederationRateLimitMiddleware',
          {
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            path: req.path
          }
        );
        
        res.status(429).json({
          error: 'temporarily_unavailable',
          error_description: 'Too many registration attempts. Federation entities should implement exponential backoff before retrying.',
          retry_after: Math.round(FEDERATION_RATE_LIMIT_CONFIGS.registration.blockDuration / 60) // in minutes
        });
      }
    }
  );
}

/**
 * Rate limiting middleware for entity configuration endpoint
 */
export function federationEntityConfigurationRateLimit() {
  return createFederationRateLimit(
    FEDERATION_RATE_LIMIT_CONFIGS.entityConfiguration,
    {
      keyGenerator: federationApiKeyGenerator,
      onLimitReached: (_req: Request, res: Response) => {
        res.status(429).json({
          error: 'temporarily_unavailable',
          error_description: 'Too many entity configuration requests. Please cache the response and retry later.',
          retry_after: Math.round(FEDERATION_RATE_LIMIT_CONFIGS.entityConfiguration.blockDuration / 60)
        });
      }
    }
  );
}

/**
 * Rate limiting middleware for federation API endpoints (fetch, list, resolve)
 */
export function federationApiRateLimit() {
  return createFederationRateLimit(
    FEDERATION_RATE_LIMIT_CONFIGS.federationApi,
    {
      keyGenerator: federationApiKeyGenerator,
      onLimitReached: (_req: Request, res: Response) => {
        res.status(429).json({
          error: 'temporarily_unavailable',
          error_description: 'Too many federation API requests. Please implement proper caching and retry with exponential backoff.',
          retry_after: Math.round(FEDERATION_RATE_LIMIT_CONFIGS.federationApi.blockDuration / 60)
        });
      }
    }
  );
}

/**
 * Adaptive federation rate limiting based on endpoint
 */
export function adaptiveFederationRateLimit() {
  return (req: Request, res: Response, next: NextFunction): void => {
    let rateLimitMiddleware;
    
    if (req.path === '/federation/registration') {
      rateLimitMiddleware = federationRegistrationRateLimit();
    } else if (req.path === '/.well-known/openid-federation') {
      rateLimitMiddleware = federationEntityConfigurationRateLimit();
    } else if (req.path.startsWith('/federation/')) {
      rateLimitMiddleware = federationApiRateLimit();
    } else {
      // No rate limiting for non-federation endpoints
      next();
      return;
    }
    
    rateLimitMiddleware(req, res, next);
  };
}

/**
 * Burst protection for federation registration
 * Allows short bursts but enforces stricter long-term limits
 */
export function burstProtectedFederationRegistrationRateLimit() {
  const config = FEDERATION_RATE_LIMIT_CONFIGS.registration;
  
  // Create two rate limiters: one for burst, one for sustained
  const burstLimiter = createFederationRateLimiter({
    points: config.points * 2,  // Allow 2x burst (10 requests)
    duration: 60,               // Over 1 minute
    blockDuration: 300         // Block for 5 minutes
  });
  
  const sustainedLimiter = createFederationRateLimiter(config);
  
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = federationRegistrationKeyGenerator(req);
      
      // Check both limiters
      const [burstResult, sustainedResult] = await Promise.all([
        burstLimiter.consume(key),
        sustainedLimiter.consume(key)
      ]);
      
      // Add headers based on the more restrictive limit
      const remainingPoints = Math.min(
        burstResult.remainingPoints || 0,
        sustainedResult.remainingPoints || 0
      );
      
      res.set({
        'X-RateLimit-Limit': config.points.toString(),
        'X-RateLimit-Remaining': remainingPoints.toString(),
        'X-RateLimit-Policy': 'federation-burst-protected'
      });
      
      next();
      
    } catch (error: any) {
      const retryAfter = Math.round(error.msBeforeNext / 1000) || 1;
      
      logFederationRateLimitExceeded(req, retryAfter);
      
      res.set({
        'X-RateLimit-Limit': config.points.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Policy': 'federation-burst-protected',
        'Retry-After': retryAfter.toString()
      });
      
      res.status(429).json({
        error: 'temporarily_unavailable',
        error_description: 'Federation registration rate limit exceeded. Please implement exponential backoff.',
        retry_after: retryAfter
      });
    }
  };
}