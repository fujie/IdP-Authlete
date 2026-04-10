import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HealthCheckService, HealthCheckResult } from './healthCheck';
import { AuthleteClient, AuthleteApiError } from '../authlete/client';

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    logInfo: vi.fn(),
    logError: vi.fn()
  }
}));

// Mock process.env
const originalEnv = process.env;

describe('HealthCheckService', () => {
  let healthCheckService: HealthCheckService;
  let mockAuthleteClient: Partial<AuthleteClient>;

  beforeEach(() => {
    // Reset environment variables
    process.env = {
      ...originalEnv,
      AUTHLETE_BASE_URL: 'https://api.authlete.com',
      AUTHLETE_SERVICE_ID: 'test-service-id',
      AUTHLETE_SERVICE_ACCESS_TOKEN: 'test-token',
      SESSION_SECRET: 'test-secret',
      NODE_ENV: 'test',
      npm_package_version: '1.0.0'
    };

    mockAuthleteClient = {
      authorization: vi.fn()
    };

    healthCheckService = new HealthCheckService(mockAuthleteClient as AuthleteClient);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  describe('performHealthCheck', () => {
    it('should return healthy status when all checks pass', async () => {
      vi.mocked(mockAuthleteClient.authorization!).mockResolvedValue({
        action: 'BAD_REQUEST'
      } as any);

      const result = await healthCheckService.performHealthCheck();

      // Status can be 'healthy' or 'degraded' depending on memory usage
      expect(['healthy', 'degraded']).toContain(result.status);
      expect(result.timestamp).toBeDefined();
      expect(result.version).toBe('1.0.0');
      expect(result.environment).toBe('test');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.checks).toHaveProperty('system');
      expect(result.checks).toHaveProperty('memory');
      expect(result.checks).toHaveProperty('environment');
      expect(result.checks).toHaveProperty('authlete');
      
      // Verify no checks have failed
      const failedChecks = Object.values(result.checks).filter(check => check.status === 'fail');
      expect(failedChecks).toHaveLength(0);
    });

    it('should return unhealthy status when environment check fails', async () => {
      delete process.env.AUTHLETE_BASE_URL;

      const result = await healthCheckService.performHealthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.environment.status).toBe('fail');
      expect(result.checks.environment.message).toContain('Missing required environment variables');
    });

    it('should return unhealthy status when Authlete connectivity fails', async () => {
      vi.mocked(mockAuthleteClient.authorization!).mockRejectedValue(
        new Error('ECONNREFUSED')
      );

      const result = await healthCheckService.performHealthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.authlete.status).toBe('fail');
      expect(result.checks.authlete.message).toContain('connectivity failed');
    });

    it('should return healthy status when Authlete returns API error (connectivity working)', async () => {
      vi.mocked(mockAuthleteClient.authorization!).mockRejectedValue(
        new AuthleteApiError(400, { action: 'BAD_REQUEST' }, 'Bad request')
      );

      const result = await healthCheckService.performHealthCheck();

      // Status can be 'healthy' or 'degraded' depending on memory usage
      expect(['healthy', 'degraded']).toContain(result.status);
      expect(result.checks.authlete.status).toBe('pass');
      expect(result.checks.authlete.message).toContain('reachable');
    });

    it('should handle Authlete timeout', async () => {
      vi.mocked(mockAuthleteClient.authorization!).mockImplementation(
        () => new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Health check timeout')), 100);
        })
      );

      const result = await healthCheckService.performHealthCheck({ timeout: 50 });

      expect(result.status).toBe('unhealthy');
      expect(result.checks.authlete.status).toBe('fail');
      expect(result.checks.authlete.message).toContain('timeout');
    });

    it('should skip Authlete check when includeAuthlete is false', async () => {
      const result = await healthCheckService.performHealthCheck({ includeAuthlete: false });

      expect(result.checks).not.toHaveProperty('authlete');
      expect(result.checks).toHaveProperty('system');
      expect(result.checks).toHaveProperty('memory');
      expect(result.checks).toHaveProperty('environment');
    });

    it('should return degraded status when memory usage is high', async () => {
      // Mock high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 600 * 1024 * 1024, // 600MB
        heapUsed: 400 * 1024 * 1024, // 400MB
        heapTotal: 450 * 1024 * 1024, // 450MB (89% usage)
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      const result = await healthCheckService.performHealthCheck({ includeAuthlete: false });

      expect(result.status).toBe('degraded');
      expect(result.checks.memory.status).toBe('warn');
      expect(result.checks.memory.message).toContain('Memory usage');

      process.memoryUsage = originalMemoryUsage;
    });
  });

  describe('isAlive', () => {
    it('should return true for basic liveness check', async () => {
      const result = await healthCheckService.isAlive();
      expect(result).toBe(true);
    });
  });

  describe('isReady', () => {
    it('should return true when service is healthy', async () => {
      vi.mocked(mockAuthleteClient.authorization!).mockResolvedValue({
        action: 'BAD_REQUEST'
      } as any);

      const result = await healthCheckService.isReady();
      expect(result).toBe(true);
    });

    it('should return true when service is degraded', async () => {
      // Mock high memory usage to trigger degraded status
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 600 * 1024 * 1024, // High memory usage
        heapUsed: 400 * 1024 * 1024,
        heapTotal: 450 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      const result = await healthCheckService.isReady();
      expect(result).toBe(true);

      process.memoryUsage = originalMemoryUsage;
    });

    it('should return false when service is unhealthy', async () => {
      delete process.env.AUTHLETE_BASE_URL;

      const result = await healthCheckService.isReady();
      expect(result).toBe(false);
    });

    it('should return false when health check throws error', async () => {
      const healthCheckService = new HealthCheckService();
      
      // Mock performHealthCheck to throw
      vi.spyOn(healthCheckService, 'performHealthCheck').mockRejectedValue(
        new Error('Health check failed')
      );

      const result = await healthCheckService.isReady();
      expect(result).toBe(false);
    });
  });

  describe('without Authlete client', () => {
    it('should handle missing Authlete client gracefully', async () => {
      const healthCheckService = new HealthCheckService();
      
      const result = await healthCheckService.performHealthCheck();

      expect(result.checks.authlete.status).toBe('fail');
      expect(result.checks.authlete.message).toBe('Authlete client not configured');
    });
  });

  describe('error handling', () => {
    it('should handle system check errors gracefully', async () => {
      // Mock process.memoryUsage to throw
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockImplementation(() => {
        throw new Error('Memory access failed');
      });

      const result = await healthCheckService.performHealthCheck({ includeAuthlete: false });

      expect(result.checks.system.status).toBe('fail');
      expect(result.checks.system.message).toContain('System check failed');

      process.memoryUsage = originalMemoryUsage;
    });

    it('should handle memory check errors gracefully', async () => {
      // Mock process.memoryUsage to throw
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockImplementation(() => {
        throw new Error('Memory access failed');
      });

      const result = await healthCheckService.performHealthCheck({ includeAuthlete: false });

      expect(result.checks.memory.status).toBe('fail');
      expect(result.checks.memory.message).toContain('Memory check failed');

      process.memoryUsage = originalMemoryUsage;
    });
  });

  describe('status determination', () => {
    it('should prioritize fail status over warn status', async () => {
      delete process.env.AUTHLETE_BASE_URL; // This will cause environment check to fail
      
      // Mock high memory usage to trigger warning
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = vi.fn().mockReturnValue({
        rss: 600 * 1024 * 1024, // High memory usage
        heapUsed: 400 * 1024 * 1024,
        heapTotal: 450 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024
      });

      const result = await healthCheckService.performHealthCheck({ includeAuthlete: false });

      expect(result.status).toBe('unhealthy'); // Fail takes precedence over warn
      expect(result.checks.environment.status).toBe('fail');
      expect(result.checks.memory.status).toBe('warn');

      process.memoryUsage = originalMemoryUsage;
    });
  });
});