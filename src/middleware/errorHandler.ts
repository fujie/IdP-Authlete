import { Request, Response, NextFunction } from 'express';
import { AuthleteApiError } from '../authlete/client';
import { logger } from '../utils/logger';

export interface OAuth2Error {
  error: string;
  error_description?: string;
  error_uri?: string;
  state?: string;
}

export interface ErrorHandlerOptions {
  includeStackTrace?: boolean;
  logErrors?: boolean;
}

/**
 * Global error handling middleware for OpenID Connect authorization server
 * Handles all unhandled errors and provides OpenID Connect compliant error responses
 */
export function createErrorHandler(options: ErrorHandlerOptions = {}): (error: any, req: Request, res: Response, next: NextFunction) => void {
  const { includeStackTrace = false, logErrors = true } = options;

  return (error: any, req: Request, res: Response, next: NextFunction): void => {
    // Skip if response already sent
    if (res.headersSent) {
      return next(error);
    }

    const requestId = logger.generateRequestId();
    const childLogger = logger.createChildLogger({ requestId });

    // Log error with detailed information
    if (logErrors) {
      childLogger.logError({
        message: 'Unhandled error in request processing',
        component: 'ErrorHandler',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack }),
          code: error?.code || error?.status || error?.statusCode
        },
        context: {
          method: req.method,
          url: req.url,
          userAgent: req.get('User-Agent'),
          clientId: req.query.client_id || req.body?.client_id,
          endpoint: getEndpointType(req.path)
        }
      });
    }

    // Determine error response based on error type and endpoint
    const errorResponse = createErrorResponse(error, req);
    const statusCode = determineStatusCode(error, req);

    // Add stack trace in development mode if requested
    if (includeStackTrace && process.env.NODE_ENV !== 'production' && error instanceof Error) {
      (errorResponse as any).stack = error.stack;
    }

    // Set appropriate headers
    res.set({
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache'
    });

    // Send error response
    res.status(statusCode).json(errorResponse);
  };
}

/**
 * Creates OpenID Connect compliant error response based on error type and endpoint
 */
function createErrorResponse(error: any, req: Request): OAuth2Error {
  const endpoint = getEndpointType(req.path);
  const state = req.query.state as string || req.body?.state;

  // Handle Authlete API errors
  if (error instanceof AuthleteApiError) {
    return createAuthleteErrorResponse(error, endpoint, state);
  }

  // Handle validation errors
  if (error.name === 'ValidationError' || error.type === 'validation') {
    return {
      error: 'invalid_request',
      error_description: error.message || 'Invalid request parameters',
      ...(state && { state })
    };
  }

  // Handle rate limiting errors
  if (error.name === 'TooManyRequestsError' || error.status === 429) {
    return {
      error: 'temporarily_unavailable',
      error_description: 'Too many requests. Please try again later.',
      ...(state && { state })
    };
  }

  // Handle authentication errors
  if (error.name === 'UnauthorizedError' || error.status === 401) {
    if (endpoint === 'introspection') {
      return {
        error: 'invalid_client',
        error_description: 'Client authentication failed'
      };
    }
    return {
      error: 'access_denied',
      error_description: 'Authentication required',
      ...(state && { state })
    };
  }

  // Handle timeout errors
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return {
      error: 'temporarily_unavailable',
      error_description: 'Service temporarily unavailable due to timeout',
      ...(state && { state })
    };
  }

  // Handle network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
    return {
      error: 'temporarily_unavailable',
      error_description: 'Service temporarily unavailable',
      ...(state && { state })
    };
  }

  // Default server error
  return {
    error: 'server_error',
    error_description: 'Internal server error',
    ...(state && { state })
  };
}

/**
 * Creates error response for Authlete API errors
 */
function createAuthleteErrorResponse(error: AuthleteApiError, endpoint: string, state?: string): OAuth2Error {
  // Try to parse Authlete response for specific error details
  if (error.authleteResponse && typeof error.authleteResponse === 'object') {
    const authleteError = error.authleteResponse;
    
    // If Authlete provides responseContent, try to parse it
    if (authleteError.responseContent) {
      try {
        const parsedResponse = JSON.parse(authleteError.responseContent);
        if (parsedResponse.error) {
          return {
            ...parsedResponse,
            ...(state && { state })
          };
        }
      } catch (parseError) {
        // Fall through to default handling
      }
    }

    // Map Authlete action to OAuth 2.0 error
    if (authleteError.action) {
      return mapAuthleteActionToError(authleteError.action, state);
    }
  }

  // Map HTTP status codes to OAuth 2.0 errors
  switch (error.statusCode) {
    case 400:
      return {
        error: 'invalid_request',
        error_description: 'Invalid request parameters',
        ...(state && { state })
      };
    case 401:
      return endpoint === 'introspection' 
        ? { error: 'invalid_client', error_description: 'Client authentication failed' }
        : { error: 'access_denied', error_description: 'Authentication failed', ...(state && { state }) };
    case 403:
      return {
        error: 'access_denied',
        error_description: 'Access denied',
        ...(state && { state })
      };
    case 404:
      return {
        error: 'invalid_request',
        error_description: 'Invalid endpoint',
        ...(state && { state })
      };
    case 429:
      return {
        error: 'temporarily_unavailable',
        error_description: 'Too many requests',
        ...(state && { state })
      };
    default:
      return {
        error: 'server_error',
        error_description: 'Authorization server error',
        ...(state && { state })
      };
  }
}

/**
 * Maps Authlete action to OAuth 2.0 error
 */
function mapAuthleteActionToError(action: string, state?: string): OAuth2Error {
  switch (action) {
    case 'BAD_REQUEST':
      return {
        error: 'invalid_request',
        error_description: 'Invalid request parameters',
        ...(state && { state })
      };
    case 'UNAUTHORIZED':
      return {
        error: 'unauthorized_client',
        error_description: 'Client not authorized',
        ...(state && { state })
      };
    case 'FORBIDDEN':
      return {
        error: 'access_denied',
        error_description: 'Access denied',
        ...(state && { state })
      };
    case 'INTERNAL_SERVER_ERROR':
      return {
        error: 'server_error',
        error_description: 'Internal server error',
        ...(state && { state })
      };
    default:
      return {
        error: 'server_error',
        error_description: 'Unknown error',
        ...(state && { state })
      };
  }
}

/**
 * Determines appropriate HTTP status code for error response
 */
function determineStatusCode(error: any, _req: Request): number {
  // Handle Authlete API errors
  if (error instanceof AuthleteApiError) {
    // Map Authlete status codes to appropriate HTTP status codes
    switch (error.statusCode) {
      case 400:
      case 401:
      case 403:
      case 404:
      case 429:
        return error.statusCode;
      default:
        return 500;
    }
  }

  // Handle specific error types
  if (error.name === 'ValidationError' || error.type === 'validation') {
    return 400;
  }

  if (error.name === 'UnauthorizedError' || error.status === 401) {
    return 401;
  }

  if (error.name === 'TooManyRequestsError' || error.status === 429) {
    return 429;
  }

  // Handle network and timeout errors
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || 
      error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || 
      error.code === 'ECONNRESET') {
    return 503; // Service Unavailable
  }

  // Default to 500 for unknown errors
  return 500;
}

/**
 * Determines the type of OAuth 2.0 endpoint based on request path
 */
function getEndpointType(path: string): string {
  if (path.includes('/authorize')) {
    return 'authorization';
  }
  if (path.includes('/token')) {
    return 'token';
  }
  if (path.includes('/introspect')) {
    return 'introspection';
  }
  if (path.includes('/login') || path.includes('/consent')) {
    return 'authentication';
  }
  return 'unknown';
}

/**
 * Express error handler for 404 Not Found errors
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  (error as any).status = 404;
  next(error);
}

/**
 * Async error wrapper for route handlers
 * Catches async errors and passes them to error handling middleware
 */
export function asyncErrorHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}