import { Request, Response, NextFunction } from 'express';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createErrorHandler, notFoundHandler, asyncErrorHandler, OAuth2Error } from './errorHandler';
import { AuthleteApiError } from '../authlete/client';

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    generateRequestId: vi.fn(() => 'test-request-id'),
    createChildLogger: vi.fn(() => ({
      logError: vi.fn()
    }))
  }
}));

describe('ErrorHandler Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let mockJson: any;
  let mockStatus: any;
  let mockSet: any;

  beforeEach(() => {
    mockJson = vi.fn();
    mockStatus = vi.fn(() => ({ json: mockJson }));
    mockSet = vi.fn();

    mockReq = {
      method: 'GET',
      url: '/authorize',
      path: '/authorize',
      query: {},
      body: {},
      get: vi.fn()
    };

    mockRes = {
      status: mockStatus,
      json: mockJson,
      set: mockSet,
      headersSent: false
    };

    mockNext = vi.fn();
  });

  describe('createErrorHandler', () => {
    it('should handle AuthleteApiError with proper OAuth 2.0 response', () => {
      const errorHandler = createErrorHandler();
      const authleteError = new AuthleteApiError(400, { action: 'BAD_REQUEST' }, 'Bad request');

      errorHandler(authleteError, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Invalid request parameters'
      });
      expect(mockSet).toHaveBeenCalledWith({
        'Cache-Control': 'no-store',
        'Pragma': 'no-cache'
      });
    });

    it('should handle AuthleteApiError with responseContent', () => {
      const errorHandler = createErrorHandler();
      const responseContent = JSON.stringify({
        error: 'invalid_client',
        error_description: 'Client not found'
      });
      const authleteError = new AuthleteApiError(401, { responseContent }, 'Unauthorized');

      errorHandler(authleteError, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'invalid_client',
        error_description: 'Client not found'
      });
    });

    it('should preserve state parameter in error response', () => {
      const errorHandler = createErrorHandler();
      mockReq.query = { state: 'test-state' };
      const error = new Error('Test error');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockJson).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'Internal server error',
        state: 'test-state'
      });
    });

    it('should handle validation errors', () => {
      const errorHandler = createErrorHandler();
      const validationError = new Error('Invalid parameter');
      validationError.name = 'ValidationError';

      errorHandler(validationError, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(400);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Invalid parameter'
      });
    });

    it('should handle rate limiting errors', () => {
      const errorHandler = createErrorHandler();
      const rateLimitError = new Error('Too many requests');
      rateLimitError.name = 'TooManyRequestsError';

      errorHandler(rateLimitError, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(429);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'temporarily_unavailable',
        error_description: 'Too many requests. Please try again later.'
      });
    });

    it('should handle network timeout errors', () => {
      const errorHandler = createErrorHandler();
      const timeoutError = new Error('Request timeout');
      (timeoutError as any).code = 'ECONNABORTED';

      errorHandler(timeoutError, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(503);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'temporarily_unavailable',
        error_description: 'Service temporarily unavailable due to timeout'
      });
    });

    it('should handle introspection endpoint authentication errors differently', () => {
      const errorHandler = createErrorHandler();
      mockReq.path = '/introspect';
      const authError = new Error('Unauthorized');
      authError.name = 'UnauthorizedError';

      errorHandler(authError, mockReq as Request, mockRes as Response, mockNext);

      expect(mockStatus).toHaveBeenCalledWith(401);
      expect(mockJson).toHaveBeenCalledWith({
        error: 'invalid_client',
        error_description: 'Client authentication failed'
      });
    });

    it('should include stack trace in development mode when requested', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      const errorHandler = createErrorHandler({ includeStackTrace: true });
      const error = new Error('Test error');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockJson).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: expect.any(String)
        })
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should not include stack trace in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      const errorHandler = createErrorHandler({ includeStackTrace: true });
      const error = new Error('Test error');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockJson).toHaveBeenCalledWith(
        expect.not.objectContaining({
          stack: expect.any(String)
        })
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should skip error handling if response already sent', () => {
      const errorHandler = createErrorHandler();
      mockRes.headersSent = true;
      const error = new Error('Test error');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(error);
      expect(mockStatus).not.toHaveBeenCalled();
      expect(mockJson).not.toHaveBeenCalled();
    });

    it('should disable logging when logErrors is false', async () => {
      const { logger } = await vi.importMock('../utils/logger') as any;
      const errorHandler = createErrorHandler({ logErrors: false });
      const error = new Error('Test error');

      errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

      expect(logger.createChildLogger).not.toHaveBeenCalled();
    });
  });

  describe('notFoundHandler', () => {
    it('should create 404 error and pass to next middleware', () => {
      mockReq.originalUrl = '/nonexistent';

      notFoundHandler(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Not Found - /nonexistent',
          status: 404
        })
      );
    });
  });

  describe('asyncErrorHandler', () => {
    it('should catch async errors and pass to next middleware', async () => {
      const asyncError = new Error('Async error');
      const asyncHandler = vi.fn().mockRejectedValue(asyncError);
      const wrappedHandler = asyncErrorHandler(asyncHandler);

      await wrappedHandler(mockReq as Request, mockRes as Response, mockNext);
      
      // Wait for the promise to resolve/reject
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(asyncHandler).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith(asyncError);
    });

    it('should handle successful async operations', async () => {
      const asyncHandler = vi.fn().mockResolvedValue('success');
      const wrappedHandler = asyncErrorHandler(asyncHandler);

      await wrappedHandler(mockReq as Request, mockRes as Response, mockNext);

      expect(asyncHandler).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle sync operations that return promises', async () => {
      const syncHandler = vi.fn(() => Promise.resolve('success'));
      const wrappedHandler = asyncErrorHandler(syncHandler);

      await wrappedHandler(mockReq as Request, mockRes as Response, mockNext);

      expect(syncHandler).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('Error Response Mapping', () => {
    it('should map different Authlete actions correctly', () => {
      const errorHandler = createErrorHandler();
      const testCases = [
        { action: 'BAD_REQUEST', expectedError: 'invalid_request', expectedStatus: 400 },
        { action: 'UNAUTHORIZED', expectedError: 'unauthorized_client', expectedStatus: 401 },
        { action: 'FORBIDDEN', expectedError: 'access_denied', expectedStatus: 403 },
        { action: 'INTERNAL_SERVER_ERROR', expectedError: 'server_error', expectedStatus: 500 }
      ];

      testCases.forEach(({ action, expectedError, expectedStatus }) => {
        const authleteError = new AuthleteApiError(expectedStatus, { action }, 'Test error');
        
        errorHandler(authleteError, mockReq as Request, mockRes as Response, mockNext);

        expect(mockStatus).toHaveBeenCalledWith(expectedStatus);
        expect(mockJson).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expectedError
          })
        );
      });
    });

    it('should handle different endpoint types correctly', () => {
      const errorHandler = createErrorHandler();
      const endpoints = [
        { path: '/authorize', type: 'authorization' },
        { path: '/token', type: 'token' },
        { path: '/introspect', type: 'introspection' },
        { path: '/login', type: 'authentication' }
      ];

      endpoints.forEach(({ path }) => {
        mockReq.path = path;
        const error = new Error('Test error');

        errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

        expect(mockStatus).toHaveBeenCalledWith(500);
        expect(mockJson).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'server_error'
          })
        );
      });
    });
  });
});