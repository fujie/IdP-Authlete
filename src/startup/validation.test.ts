import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StartupValidator, validateStartupConfiguration } from './validation';
import { AuthleteClient } from '../authlete/client';
import { AuthorizationResponse } from '../authlete/types';

// Mock the config module
vi.mock('../config', () => ({
  config: {
    authlete: {
      baseUrl: 'https://us.authlete.com',
      serviceId: '12345',
      serviceAccessToken: 'test-token',
      timeout: 10000,
      retryAttempts: 3
    },
    server: {
      port: 3000,
      nodeEnv: 'test',
      sessionSecret: 'test-secret-key-that-is-long-enough-for-validation'
    }
  }
}));

// Mock the logger
vi.mock('../utils/logger', () => ({
  logger: {
    logInfo: vi.fn(),
    logWarning: vi.fn(),
    logError: vi.fn()
  }
}));

describe('StartupValidator', () => {
  let mockAuthleteClient: AuthleteClient;
  let validator: StartupValidator;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set up test environment variables
    process.env.AUTHLETE_BASE_URL = 'https://us.authlete.com';
    process.env.AUTHLETE_SERVICE_ID = '12345';
    process.env.AUTHLETE_SERVICE_ACCESS_TOKEN = 'test-token';
    process.env.SESSION_SECRET = 'test-secret-key-that-is-long-enough-for-validation';

    mockAuthleteClient = {
      authorization: vi.fn(),
      authorizationIssue: vi.fn(),
      authorizationFail: vi.fn(),
      token: vi.fn(),
      introspection: vi.fn()
    };

    validator = new StartupValidator(mockAuthleteClient);
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('validateConfiguration', () => {
    it('should pass validation with valid configuration', async () => {
      const mockResponse: AuthorizationResponse = {
        action: 'BAD_REQUEST',
        ticket: 'test-ticket',
        client: { clientId: 1, clientName: 'test' },
        service: { serviceId: 1, serviceName: 'test' }
      };

      vi.mocked(mockAuthleteClient.authorization).mockResolvedValue(mockResponse);

      const result = await validator.validateConfiguration();

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(mockAuthleteClient.authorization).toHaveBeenCalledWith({
        parameters: 'response_type=code&client_id=2556995098&redirect_uri=https://example.com/callback'
      });
    });

    it('should fail validation with missing environment variables', async () => {
      delete process.env.AUTHLETE_BASE_URL;
      delete process.env.SESSION_SECRET;

      const result = await validator.validateConfiguration();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required environment variable: AUTHLETE_BASE_URL');
      expect(result.errors).toContain('Missing required environment variable: SESSION_SECRET');
    });

    it('should fail validation with invalid Authlete base URL', async () => {
      process.env.AUTHLETE_BASE_URL = 'invalid-url';

      const result = await validator.validateConfiguration();

      expect(result.isValid).toBe(false);
      expect(result.errors.some(error => error.includes('Invalid Authlete base URL format'))).toBe(true);
    });

    it('should fail validation with non-numeric service ID', async () => {
      process.env.AUTHLETE_SERVICE_ID = 'invalid-id';

      const result = await validator.validateConfiguration();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Authlete service ID should be numeric');
    });

    it('should add warning for short session secret', async () => {
      process.env.SESSION_SECRET = 'short';

      const mockResponse: AuthorizationResponse = {
        action: 'BAD_REQUEST',
        ticket: 'test-ticket',
        client: { clientId: 1, clientName: 'test' },
        service: { serviceId: 1, serviceName: 'test' }
      };

      vi.mocked(mockAuthleteClient.authorization).mockResolvedValue(mockResponse);

      const result = await validator.validateConfiguration();

      expect(result.warnings).toContain('Session secret should be at least 32 characters long for security');
    });

    it('should fail validation when Authlete API is unreachable', async () => {
      const networkError = new Error('ENOTFOUND us.authlete.com');
      vi.mocked(mockAuthleteClient.authorization).mockRejectedValue(networkError);

      const result = await validator.validateConfiguration();

      expect(result.isValid).toBe(false);
      expect(result.errors.some(error => error.includes('Cannot connect to Authlete API'))).toBe(true);
    });

    it('should fail validation with invalid Authlete credentials', async () => {
      const authError = new Error('401 Unauthorized');
      vi.mocked(mockAuthleteClient.authorization).mockRejectedValue(authError);

      const result = await validator.validateConfiguration();

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid Authlete service credentials - check service ID and access token');
    });

  });

  describe('validateStartupConfiguration', () => {
    it('should complete successfully with valid configuration', async () => {
      const mockResponse: AuthorizationResponse = {
        action: 'BAD_REQUEST',
        ticket: 'test-ticket',
        client: { clientId: 1, clientName: 'test' },
        service: { serviceId: 1, serviceName: 'test' }
      };

      vi.mocked(mockAuthleteClient.authorization).mockResolvedValue(mockResponse);

      await expect(validateStartupConfiguration(mockAuthleteClient)).resolves.not.toThrow();
    });

    it('should throw error with invalid configuration', async () => {
      delete process.env.AUTHLETE_BASE_URL;

      await expect(validateStartupConfiguration(mockAuthleteClient))
        .rejects.toThrow('Configuration validation failed');
    });
  });
});