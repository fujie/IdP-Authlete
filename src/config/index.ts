import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface AuthleteConfig {
  baseUrl: string;
  serviceId: string;
  serviceAccessToken: string;
  timeout: number;
  retryAttempts: number;
}

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  sessionSecret: string;
}

export interface FederationConfig {
  enabled: boolean;
  trustAnchors: string[];
}

export interface AppConfig {
  authlete: AuthleteConfig;
  server: ServerConfig;
  federation: FederationConfig;
}

function validateRequiredEnvVar(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export { validateRequiredEnvVar };

function loadConfig(): AppConfig {
  return {
    authlete: {
      baseUrl: validateRequiredEnvVar('AUTHLETE_BASE_URL', process.env.AUTHLETE_BASE_URL),
      serviceId: validateRequiredEnvVar('AUTHLETE_SERVICE_ID', process.env.AUTHLETE_SERVICE_ID),
      serviceAccessToken: validateRequiredEnvVar('AUTHLETE_SERVICE_ACCESS_TOKEN', process.env.AUTHLETE_SERVICE_ACCESS_TOKEN),
      timeout: parseInt(process.env.HTTP_TIMEOUT || '10000', 10),
      retryAttempts: parseInt(process.env.HTTP_RETRY_ATTEMPTS || '3', 10)
    },
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      nodeEnv: process.env.NODE_ENV || 'development',
      sessionSecret: validateRequiredEnvVar('SESSION_SECRET', process.env.SESSION_SECRET)
    },
    federation: {
      enabled: process.env.FEDERATION_ENABLED === 'true',
      trustAnchors: process.env.FEDERATION_TRUST_ANCHORS 
        ? process.env.FEDERATION_TRUST_ANCHORS.split(',').map(anchor => anchor.trim())
        : []
    }
  };
}

export const config = loadConfig();