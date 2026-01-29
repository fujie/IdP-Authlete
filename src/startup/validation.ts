import { AuthleteClient } from '../authlete/client';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class StartupValidator {
  constructor(private authleteClient: AuthleteClient) {}

  async validateConfiguration(): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    // Validate required configuration
    this.validateRequiredConfig(result);
    
    // Validate Authlete connectivity and credentials
    await this.validateAuthleteConnection(result);

    // Validate server configuration
    this.validateServerConfig(result);

    // Validate federation configuration
    this.validateFederationConfig(result);

    result.isValid = result.errors.length === 0;
    return result;
  }

  private validateRequiredConfig(result: ValidationResult): void {
    const requiredEnvVars = [
      'AUTHLETE_BASE_URL',
      'AUTHLETE_SERVICE_ID', 
      'AUTHLETE_SERVICE_ACCESS_TOKEN',
      'SESSION_SECRET'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        result.errors.push(`Missing required environment variable: ${envVar}`);
      }
    }

    // Validate Authlete base URL format
    if (process.env.AUTHLETE_BASE_URL) {
      try {
        const url = new URL(process.env.AUTHLETE_BASE_URL);
        if (!url.protocol.startsWith('https')) {
          result.warnings.push('Authlete base URL should use HTTPS in production');
        }
      } catch (error) {
        result.errors.push(`Invalid Authlete base URL format: ${process.env.AUTHLETE_BASE_URL}`);
      }
    }

    // Validate service ID format (should be numeric)
    if (process.env.AUTHLETE_SERVICE_ID && !/^\d+$/.test(process.env.AUTHLETE_SERVICE_ID)) {
      result.errors.push('Authlete service ID should be numeric');
    }

    // Validate session secret strength
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
      result.warnings.push('Session secret should be at least 32 characters long for security');
    }

    // Validate timeout values
    if (config.authlete.timeout < 1000) {
      result.warnings.push('HTTP timeout is very low, consider increasing for production');
    }

    if (config.authlete.retryAttempts < 1 || config.authlete.retryAttempts > 10) {
      result.warnings.push('Retry attempts should be between 1 and 10');
    }
  }

  private async validateAuthleteConnection(result: ValidationResult): Promise<void> {
    try {
      logger.logInfo('Validating Authlete API connectivity', 'StartupValidator');
      
      // Test Authlete connectivity with a simple service configuration call
      // This validates both connectivity and credentials
      const testRequest = {
        parameters: 'response_type=code&client_id=2556995098&redirect_uri=https://example.com/callback'
      };

      const response = await this.authleteClient.authorization(testRequest);
      
      // We expect INTERACTION (normal flow) or BAD_REQUEST (parameter issues), but not INTERNAL_SERVER_ERROR
      if (response.action === 'INTERNAL_SERVER_ERROR') {
        result.errors.push('Authlete API returned internal server error - check service configuration');
      } else if (response.action === 'INTERACTION' || response.action === 'BAD_REQUEST') {
        logger.logInfo('Authlete API connectivity validated successfully', 'StartupValidator', {
          action: response.action
        });
      } else {
        logger.logWarn(`Unexpected Authlete API response: ${response.action}`, 'StartupValidator');
      }

    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
          result.errors.push(`Cannot connect to Authlete API: ${error.message}`);
        } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          result.errors.push('Invalid Authlete service credentials - check service ID and access token');
        } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
          result.errors.push('Authlete service access forbidden - check service permissions');
        } else {
          result.errors.push(`Authlete API validation failed: ${error.message}`);
        }
      } else {
        result.errors.push('Unknown error during Authlete API validation');
      }
    }
  }

  private validateServerConfig(result: ValidationResult): void {
    // Validate port number
    if (config.server.port < 1 || config.server.port > 65535) {
      result.errors.push(`Invalid port number: ${config.server.port}`);
    }

    // Check for common port conflicts
    if (config.server.port < 1024 && process.getuid && process.getuid() !== 0) {
      result.warnings.push(`Port ${config.server.port} requires root privileges on Unix systems`);
    }

    // Validate environment
    const validEnvironments = ['development', 'test', 'staging', 'production'];
    if (!validEnvironments.includes(config.server.nodeEnv)) {
      result.warnings.push(`Unknown NODE_ENV: ${config.server.nodeEnv}. Expected one of: ${validEnvironments.join(', ')}`);
    }

    // Production-specific validations
    if (config.server.nodeEnv === 'production') {
      if (config.server.sessionSecret === 'your-secret-key-here' || config.server.sessionSecret.length < 32) {
        result.errors.push('Production environment requires a strong session secret (at least 32 characters)');
      }

      if (!config.authlete.baseUrl.startsWith('https://')) {
        result.errors.push('Production environment requires HTTPS for Authlete API');
      }
    }
  }

  private validateFederationConfig(result: ValidationResult): void {
    // Validate federation configuration if enabled
    if (config.federation && config.federation.enabled) {
      logger.logInfo('Federation is enabled, validating configuration', 'StartupValidator', {
        trustAnchorCount: config.federation.trustAnchors.length
      });

      // Validate trust anchors
      if (config.federation.trustAnchors.length === 0) {
        result.warnings.push('Federation is enabled but no trust anchors configured - dynamic registration will fail');
      }

      // Validate trust anchor URLs
      for (const anchor of config.federation.trustAnchors) {
        try {
          const url = new URL(anchor);
          if (!url.protocol.startsWith('https')) {
            result.warnings.push(`Trust anchor should use HTTPS: ${anchor}`);
          }
        } catch (error) {
          result.errors.push(`Invalid trust anchor URL format: ${anchor}`);
        }
      }

      logger.logInfo('Federation configuration validated', 'StartupValidator', {
        trustAnchors: config.federation.trustAnchors
      });
    } else {
      logger.logInfo('Federation is disabled', 'StartupValidator');
    }
  }
}

export async function validateStartupConfiguration(authleteClient: AuthleteClient): Promise<void> {
  const validator = new StartupValidator(authleteClient);
  const result = await validator.validateConfiguration();

  // Log warnings
  for (const warning of result.warnings) {
    logger.logWarn(warning, 'StartupValidator');
  }

  // Log and throw errors
  if (!result.isValid) {
    for (const error of result.errors) {
      logger.logError({
        message: error,
        component: 'StartupValidator',
        error: { name: 'ConfigurationError', message: error }
      });
    }

    const errorMessage = `Configuration validation failed:\n${result.errors.join('\n')}`;
    throw new Error(errorMessage);
  }

  logger.logInfo('Startup configuration validation completed successfully', 'StartupValidator', {
    warningsCount: result.warnings.length,
    environment: config.server.nodeEnv
  });
}