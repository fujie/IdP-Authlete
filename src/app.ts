import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { config } from './config';
import { AuthleteClientImpl } from './authlete/client';
import { AuthorizationControllerImpl } from './controllers/authorization';
import { AuthControllerImpl } from './controllers/auth';
import { TokenControllerImpl } from './controllers/token';
import { IntrospectionControllerImpl } from './controllers/introspection';
import { createAuthorizationRoutes } from './routes/authorization';
import { createAuthRoutes } from './routes/auth';
import { createTokenRoutes } from './routes/token';
import { createIntrospectionRoutes } from './routes/introspection';
import { validateInput } from './middleware/validation';
import { generalRateLimit } from './middleware/rateLimiting';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { HealthCheckService } from './services/healthCheck';
import './types/session'; // Import session type extensions

export function createApp(): express.Application {
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));

  // General rate limiting for all endpoints
  app.use(generalRateLimit());

  // Input validation and sanitization
  app.use(validateInput());

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Session middleware
  app.use(session({
    secret: config.server.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.server.nodeEnv === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // Initialize Authlete client and controllers
  const authleteClient = new AuthleteClientImpl(config.authlete);
  const authorizationController = new AuthorizationControllerImpl(authleteClient);
  const authController = new AuthControllerImpl(authleteClient);
  const tokenController = new TokenControllerImpl(authleteClient);
  const introspectionController = new IntrospectionControllerImpl(authleteClient);

  // Initialize health check service
  const healthCheckService = new HealthCheckService(authleteClient);

  // Mount routes with specific rate limiting and validation
  app.use('/', createAuthorizationRoutes(authorizationController));
  app.use('/', createAuthRoutes(authController));
  app.use('/', createTokenRoutes(tokenController));
  app.use('/', createIntrospectionRoutes(introspectionController));

  // Health check endpoints
  app.get('/health', async (_req, res) => {
    try {
      const result = await healthCheckService.performHealthCheck();
      const statusCode = result.status === 'healthy' ? 200 : 
                        result.status === 'degraded' ? 200 : 503;
      
      res.status(statusCode).json(result);
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: config.server.nodeEnv,
        uptime: 0,
        checks: {
          error: {
            status: 'fail',
            message: error instanceof Error ? error.message : 'Health check failed',
            lastChecked: new Date().toISOString()
          }
        }
      });
    }
  });

  // Liveness probe endpoint (simple check)
  app.get('/health/live', async (_req, res) => {
    const isAlive = await healthCheckService.isAlive();
    res.status(isAlive ? 200 : 503).json({
      status: isAlive ? 'alive' : 'dead',
      timestamp: new Date().toISOString()
    });
  });

  // Readiness probe endpoint (comprehensive check)
  app.get('/health/ready', async (_req, res) => {
    const isReady = await healthCheckService.isReady();
    res.status(isReady ? 200 : 503).json({
      status: isReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString()
    });
  });

  // 404 handler for unknown routes
  app.use(notFoundHandler);

  // Global error handling middleware (must be last)
  app.use(createErrorHandler({
    includeStackTrace: config.server.nodeEnv === 'development',
    logErrors: true
  }));

  return app;
}