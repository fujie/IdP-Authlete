import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { AuthleteClientImpl } from './authlete/client';
import { validateStartupConfiguration } from './startup/validation';

async function startServer(): Promise<void> {
  try {
    // Log startup information
    logger.logInfo('Starting OAuth 2.0 Authorization Server', 'Application', {
      environment: config.server.nodeEnv,
      authleteBaseUrl: config.authlete.baseUrl,
      port: config.server.port,
      version: process.env.npm_package_version || '1.0.0'
    });

    // Initialize Authlete client for validation
    const authleteClient = new AuthleteClientImpl(config.authlete);
    
    // Validate configuration and Authlete connectivity on startup (skip if requested)
    if (process.env.SKIP_STARTUP_VALIDATION !== 'true') {
      logger.logInfo('Validating startup configuration...', 'Application');
      await validateStartupConfiguration(authleteClient);
    } else {
      logger.logWarn('Startup validation skipped (SKIP_STARTUP_VALIDATION=true)', 'Application');
    }
    
    // Create and start the Express application
    const app = createApp();
    
    const server = app.listen(config.server.port, () => {
      logger.logInfo('Server started successfully', 'Application', {
        port: config.server.port,
        healthCheckUrl: `http://localhost:${config.server.port}/health`,
        environment: config.server.nodeEnv
      });
    });

    // Graceful shutdown handlers
    const gracefulShutdown = (signal: string) => {
      logger.logInfo(`${signal} received, shutting down gracefully`, 'Application');
      server.close(() => {
        logger.logInfo('Server closed successfully', 'Application');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.logError({
          message: 'Forced shutdown after timeout',
          component: 'Application',
          error: { name: 'ShutdownTimeout', message: 'Server did not close within 10 seconds' }
        });
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.logError({
      message: 'Failed to start server',
      component: 'Application',
      error: {
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack && { stack: error.stack })
      }
    });
    process.exit(1);
  }
}

// Start the server
startServer().catch((error) => {
  logger.logError({
    message: 'Unhandled error during server startup',
    component: 'Application',
    error: {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack && { stack: error.stack })
    }
  });
  process.exit(1);
});