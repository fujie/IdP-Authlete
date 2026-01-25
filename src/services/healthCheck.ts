import { AuthleteClient } from '../authlete/client';
import { logger } from '../utils/logger';

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  environment: string;
  uptime: number;
  checks: {
    [key: string]: {
      status: 'pass' | 'fail' | 'warn';
      message?: string;
      responseTime?: number;
      lastChecked: string;
    };
  };
}

export interface HealthCheckOptions {
  includeAuthlete?: boolean;
  timeout?: number;
}

export class HealthCheckService {
  private authleteClient: AuthleteClient | undefined;
  private startTime: number;

  constructor(authleteClient?: AuthleteClient) {
    this.authleteClient = authleteClient;
    this.startTime = Date.now();
  }

  /**
   * Performs comprehensive health checks
   */
  async performHealthCheck(options: HealthCheckOptions = {}): Promise<HealthCheckResult> {
    const { includeAuthlete = true, timeout = 5000 } = options;
    const timestamp = new Date().toISOString();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    const checks: HealthCheckResult['checks'] = {};

    // Basic system checks
    checks.system = await this.checkSystem();
    checks.memory = await this.checkMemory();
    checks.environment = await this.checkEnvironment();

    // Authlete API connectivity check
    if (includeAuthlete) {
      if (this.authleteClient) {
        checks.authlete = await this.checkAuthleteConnectivity(timeout);
      } else {
        checks.authlete = {
          status: 'fail',
          message: 'Authlete client not configured',
          lastChecked: new Date().toISOString()
        };
      }
    }

    // Determine overall status
    const overallStatus = this.determineOverallStatus(checks);

    const result: HealthCheckResult = {
      status: overallStatus,
      timestamp,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime,
      checks
    };

    // Log health check results
    logger.logInfo('Health check performed', 'HealthCheckService', {
      status: overallStatus,
      uptime,
      checksCount: Object.keys(checks).length,
      failedChecks: Object.entries(checks)
        .filter(([, check]) => check.status === 'fail')
        .map(([name]) => name)
    });

    return result;
  }

  /**
   * Performs basic system health check
   */
  private async checkSystem(): Promise<HealthCheckResult['checks'][string]> {
    try {
      const startTime = Date.now();
      
      // Check if the process is running normally
      process.memoryUsage();
      process.cpuUsage();
      
      const responseTime = Date.now() - startTime;

      return {
        status: 'pass',
        message: 'System is operational',
        responseTime,
        lastChecked: new Date().toISOString()
      };
    } catch (error) {
      logger.logError({
        message: 'System health check failed',
        component: 'HealthCheckService',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      return {
        status: 'fail',
        message: `System check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        lastChecked: new Date().toISOString()
      };
    }
  }

  /**
   * Checks memory usage
   */
  private async checkMemory(): Promise<HealthCheckResult['checks'][string]> {
    try {
      const memoryUsage = process.memoryUsage();
      const totalMemoryMB = Math.round(memoryUsage.rss / 1024 / 1024);
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
      
      // Warn if memory usage is high (over 500MB RSS or 80% heap usage)
      const isHighMemory = totalMemoryMB > 500 || (heapUsedMB / heapTotalMB) > 0.8;
      
      return {
        status: isHighMemory ? 'warn' : 'pass',
        message: `Memory usage: ${totalMemoryMB}MB RSS, ${heapUsedMB}/${heapTotalMB}MB heap`,
        lastChecked: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `Memory check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        lastChecked: new Date().toISOString()
      };
    }
  }

  /**
   * Checks environment configuration
   */
  private async checkEnvironment(): Promise<HealthCheckResult['checks'][string]> {
    try {
      const requiredEnvVars = [
        'AUTHLETE_BASE_URL',
        'AUTHLETE_SERVICE_ID',
        'AUTHLETE_SERVICE_ACCESS_TOKEN',
        'SESSION_SECRET'
      ];

      const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        return {
          status: 'fail',
          message: `Missing required environment variables: ${missingVars.join(', ')}`,
          lastChecked: new Date().toISOString()
        };
      }

      return {
        status: 'pass',
        message: 'All required environment variables are set',
        lastChecked: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `Environment check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        lastChecked: new Date().toISOString()
      };
    }
  }

  /**
   * Checks Authlete API connectivity
   */
  private async checkAuthleteConnectivity(timeout: number): Promise<HealthCheckResult['checks'][string]> {
    if (!this.authleteClient) {
      return {
        status: 'fail',
        message: 'Authlete client not configured',
        lastChecked: new Date().toISOString()
      };
    }

    try {
      const startTime = Date.now();
      
      // Create a simple test request to check connectivity
      // We'll use a minimal authorization request that should fail gracefully
      const testRequest = {
        parameters: 'response_type=code&client_id=health-check-test'
      };

      // Set up timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), timeout);
      });

      // Race between the API call and timeout
      await Promise.race([
        this.authleteClient.authorization(testRequest),
        timeoutPromise
      ]);

      const responseTime = Date.now() - startTime;

      // Any response (even error) indicates connectivity is working
      return {
        status: 'pass',
        message: 'Authlete API is reachable',
        responseTime,
        lastChecked: new Date().toISOString()
      };

    } catch (error) {
      const startTime = Date.now();
      // const responseTime = Date.now() - startTime; // Unused for now
      
      // Check if it's a timeout or connectivity issue
      if (error instanceof Error && error.message.includes('timeout')) {
        return {
          status: 'fail',
          message: `Authlete API timeout (>${timeout}ms)`,
          responseTime: timeout,
          lastChecked: new Date().toISOString()
        };
      }

      // Check if it's a network connectivity issue
      if (error instanceof Error && (
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('ECONNRESET')
      )) {
        return {
          status: 'fail',
          message: `Authlete API connectivity failed: ${error.message}`,
          lastChecked: new Date().toISOString()
        };
      }

      // If we get an Authlete API error response, that means connectivity is working
      // but the request was invalid (which is expected for our health check)
      if (error instanceof Error && error.name === 'AuthleteApiError') {
        const responseTime = Date.now() - startTime;
        return {
          status: 'pass',
          message: 'Authlete API is reachable (received expected error response)',
          responseTime,
          lastChecked: new Date().toISOString()
        };
      }

      logger.logError({
        message: 'Authlete connectivity check failed',
        component: 'HealthCheckService',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });

      return {
        status: 'fail',
        message: `Authlete API check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        lastChecked: new Date().toISOString()
      };
    }
  }

  /**
   * Determines overall health status based on individual checks
   */
  private determineOverallStatus(checks: HealthCheckResult['checks']): 'healthy' | 'unhealthy' | 'degraded' {
    const checkStatuses = Object.values(checks).map(check => check.status);
    
    // If any critical check fails, system is unhealthy
    if (checkStatuses.includes('fail')) {
      return 'unhealthy';
    }
    
    // If any check has warnings, system is degraded
    if (checkStatuses.includes('warn')) {
      return 'degraded';
    }
    
    // All checks pass
    return 'healthy';
  }

  /**
   * Simple health check for basic liveness probe
   */
  async isAlive(): Promise<boolean> {
    try {
      // Basic check - if we can execute this function, the service is alive
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Readiness check - determines if the service is ready to handle requests
   */
  async isReady(): Promise<boolean> {
    try {
      const result = await this.performHealthCheck({ includeAuthlete: true, timeout: 3000 });
      
      // Service is ready if overall status is healthy or degraded (but not unhealthy)
      return result.status !== 'unhealthy';
    } catch {
      return false;
    }
  }
}