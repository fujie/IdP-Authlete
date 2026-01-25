import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { logger } from '../utils/logger';

/**
 * Rate limiting middleware for OAuth 2.0 endpoints
 * Implements Requirement 6.5 for preventing abuse
 */

export interface RateLimitConfig {
  points: number;        // Number of requests
  duration: number;      // Per duration in seconds
  blockDuration: number; // Block duration in seconds
  execEvenly?: boolean;  // Spread requests evenly across duration
}

export interface RateLimitOptions {
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  onLimitReached?: (req: Request, res: Response) => void;
}

// Default rate limit configurations for different endpoint types
const RATE_LIMIT_CONFIGS = {
  // Authorization endpoint - more lenient for user-facing flows
  authorization: {
    points: 10,        // 10 requests
    duration: 60,      // per 60 seconds
    blockDuration: 300 // block for 5 minutes
  },
  
  // Token endpoint - stricter limits for automated flows
  token: {
    points: 5,         // 5 requests
    duration: 60,      // per 60 seconds
    blockDuration: 600 // block for 10 minutes
  },
  
  // Introspection endpoint - moderate limits for resource servers
  introspection: {
    points: 20,        // 20 requests
    duration: 60,      // per 60 seconds
    blockDuration: 300 // block for 5 minutes
  },
  
  // General API endpoints
  general: {
    points: 100,       // 100 requests
    duration: 60,      // per 60 seconds
    blockDuration: 60  // block for 1 minute
  }
};

/**
 * Create rate limiter instance based on configuration
 */
function createRateLimiter(rateLimitConfig: RateLimitConfig): RateLimiterMemory {
  // In production, you might want to use Redis for distributed rate limiting
  // const rateLimiter = new RateLimiterRedis({
  //   storeClient: redisClient,
  //   keyPrefix: 'oauth2_rl',
  //   ...rateLimitConfig
  // });
  
  return new RateLimiterMemory({
    keyPrefix: 'oauth2_rl',
    ...rateLimitConfig
  });
}

/**
 * Default key generator - uses IP address and user agent
 */
function defaultKeyGenerator(req: Request): string {
  const ip = req.ip || 'unknown';
  const userAgent = req.get('User-Agent') || 'unknown';
  
  // Create a simple hash of IP + User Agent for better key distribution
  const key = `${ip}:${userAgent}`;
  return Buffer.from(key).toString('base64').substring(0, 32);
}

/**
 * Enhanced key generator that includes client_id for OAuth endpoints
 */
function oauthKeyGenerator(req: Request): string {
  const baseKey = defaultKeyGenerator(req);
  const clientId = req.query.client_id || req.body.client_id || 'anonymous';
  
  return `${baseKey}:${clientId}`;
}

/**
 * Log rate limit events for monitoring
 */
function logRateLimitEvent(req: Request, remainingPoints: number, totalHits: number): void {
  logger.logInfo('Rate limit hit', 'RateLimitingMiddleware', {
    rateLimitEvent: {
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
 * Log rate limit exceeded events
 */
function logRateLimitExceeded(req: Request, retryAfter: number): void {
  logger.logWarn('Rate limit exceeded', 'RateLimitingMiddleware', {
    rateLimitEvent: {
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
 * Create rate limiting middleware
 */
export function createRateLimit(
  rateLimitConfig: RateLimitConfig,
  options: RateLimitOptions = {}
): (req: Request, res: Response, next: NextFunction) => void {
  
  const rateLimiter = createRateLimiter(rateLimitConfig);
  const keyGenerator = options.keyGenerator || defaultKeyGenerator;
  
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = keyGenerator(req);
      
      // Consume a point from the rate limiter
      const result = await rateLimiter.consume(key);
      
      // Add rate limit headers to response
      res.set({
        'X-RateLimit-Limit': rateLimitConfig.points.toString(),
        'X-RateLimit-Remaining': result.remainingPoints?.toString() || '0',
        'X-RateLimit-Reset': new Date(Date.now() + result.msBeforeNext).toISOString()
      });
      
      // Log rate limit usage
      logRateLimitEvent(req, result.remainingPoints || 0, 1);
      
      next();
      
    } catch (rateLimiterRes: any) {
      // Rate limit exceeded
      const retryAfter = Math.round(rateLimiterRes.msBeforeNext / 1000) || 1;
      
      // Log rate limit exceeded event
      logRateLimitExceeded(req, retryAfter);
      
      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': rateLimitConfig.points.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString(),
        'Retry-After': retryAfter.toString()
      });
      
      // Call custom handler if provided
      if (options.onLimitReached) {
        options.onLimitReached(req, res);
        return;
      }
      
      // Return OAuth 2.0 compliant error response
      res.status(429).json({
        error: 'temporarily_unavailable',
        error_description: 'The authorization server is temporarily overloaded or under maintenance',
        retry_after: retryAfter
      });
    }
  };
}

/**
 * Rate limiting middleware for authorization endpoint
 */
export function authorizationRateLimit() {
  return createRateLimit(RATE_LIMIT_CONFIGS.authorization, {
    keyGenerator: oauthKeyGenerator,
    onLimitReached: (req: Request, res: Response) => {
      // For authorization endpoint, we might want to redirect with error
      const redirectUri = req.query.redirect_uri as string;
      const state = req.query.state as string;
      
      if (redirectUri) {
        const errorUrl = new URL(redirectUri);
        errorUrl.searchParams.set('error', 'temporarily_unavailable');
        errorUrl.searchParams.set('error_description', 'Too many authorization requests');
        if (state) {
          errorUrl.searchParams.set('state', state);
        }
        
        res.redirect(errorUrl.toString());
      } else {
        res.status(429).json({
          error: 'temporarily_unavailable',
          error_description: 'Too many authorization requests. Please try again later.'
        });
      }
    }
  });
}

/**
 * Rate limiting middleware for token endpoint
 */
export function tokenRateLimit() {
  return createRateLimit(RATE_LIMIT_CONFIGS.token, {
    keyGenerator: oauthKeyGenerator,
    onLimitReached: (_req: Request, res: Response) => {
      res.status(429).json({
        error: 'temporarily_unavailable',
        error_description: 'Too many token requests. Please implement exponential backoff.'
      });
    }
  });
}

/**
 * Rate limiting middleware for introspection endpoint
 */
export function introspectionRateLimit() {
  return createRateLimit(RATE_LIMIT_CONFIGS.introspection, {
    keyGenerator: (req: Request) => {
      // For introspection, use client credentials or IP
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Basic ')) {
        try {
          const base64Credentials = authHeader.substring(6);
          const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
          const [clientId] = credentials.split(':');
          return `introspection:${clientId}`;
        } catch {
          // Fall back to IP-based limiting
        }
      }
      
      return `introspection:${defaultKeyGenerator(req)}`;
    },
    onLimitReached: (_req: Request, res: Response) => {
      res.status(429).json({
        error: 'temporarily_unavailable',
        error_description: 'Too many introspection requests from this resource server.'
      });
    }
  });
}

/**
 * General rate limiting middleware for other endpoints
 */
export function generalRateLimit() {
  return createRateLimit(RATE_LIMIT_CONFIGS.general, {
    keyGenerator: defaultKeyGenerator
  });
}

/**
 * Adaptive rate limiting that adjusts based on endpoint and request patterns
 */
export function adaptiveRateLimit() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Determine appropriate rate limit based on endpoint
    let rateLimitMiddleware;
    
    if (req.path === '/authorize') {
      rateLimitMiddleware = authorizationRateLimit();
    } else if (req.path === '/token') {
      rateLimitMiddleware = tokenRateLimit();
    } else if (req.path === '/introspect') {
      rateLimitMiddleware = introspectionRateLimit();
    } else {
      rateLimitMiddleware = generalRateLimit();
    }
    
    rateLimitMiddleware(req, res, next);
  };
}

/**
 * Rate limiting middleware with burst protection
 * Allows short bursts but enforces stricter long-term limits
 */
export function burstProtectedRateLimit(endpointType: keyof typeof RATE_LIMIT_CONFIGS) {
  const config = RATE_LIMIT_CONFIGS[endpointType];
  
  // Create two rate limiters: one for burst, one for sustained
  const burstLimiter = createRateLimiter({
    points: config.points * 2,  // Allow 2x burst
    duration: 10,               // Over 10 seconds
    blockDuration: 60          // Block for 1 minute
  });
  
  const sustainedLimiter = createRateLimiter(config);
  
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = oauthKeyGenerator(req);
      
      // Check both limiters
      await Promise.all([
        burstLimiter.consume(key),
        sustainedLimiter.consume(key)
      ]);
      
      next();
      
    } catch (error: any) {
      const retryAfter = Math.round(error.msBeforeNext / 1000) || 1;
      
      logRateLimitExceeded(req, retryAfter);
      
      res.set({
        'Retry-After': retryAfter.toString()
      });
      
      res.status(429).json({
        error: 'temporarily_unavailable',
        error_description: 'Rate limit exceeded. Please slow down your requests.',
        retry_after: retryAfter
      });
    }
  };
}