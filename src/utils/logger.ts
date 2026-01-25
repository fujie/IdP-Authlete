/**
 * Structured logging utility for OpenID Connect Authorization Server
 * Provides comprehensive logging for all operations as required by Requirements 8.1-8.4
 */

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

export interface BaseLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  component: string;
  requestId?: string;
  userId?: string;
  clientId?: string | number;
}

export interface AuthorizationLogEntry extends BaseLogEntry {
  type: 'authorization_request';
  scopes?: string[];
  responseType?: string;
  redirectUri?: string;
  state?: string;
  outcome: 'success' | 'error' | 'denied';
  errorCode?: string;
  errorDescription?: string;
  requestObjectUsed?: boolean;
  clientRegistered?: boolean;
}

export interface TokenLogEntry extends BaseLogEntry {
  type: 'token_issuance';
  grantType?: string;
  scopes?: string[];
  outcome: 'success' | 'error';
  errorCode?: string;
  errorDescription?: string;
  tokenType?: string;
  expiresIn?: number;
}

export interface AuthenticationLogEntry extends BaseLogEntry {
  type: 'authentication_attempt';
  username?: string;
  outcome: 'success' | 'failure';
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ErrorLogEntry extends BaseLogEntry {
  type: 'error';
  error: {
    name: string;
    message: string;
    stack?: string | undefined;
    code?: string | number;
  };
  context?: Record<string, any>;
}

export interface IntrospectionLogEntry extends BaseLogEntry {
  type: 'token_introspection';
  tokenActive: boolean;
  scopes?: string[];
  outcome: 'success' | 'error';
  errorCode?: string;
  errorDescription?: string;
}

export type LogEntry = AuthorizationLogEntry | TokenLogEntry | AuthenticationLogEntry | ErrorLogEntry | IntrospectionLogEntry;

export class Logger {
  private static instance: Logger;
  private requestIdCounter = 0;

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Generate a unique request ID for tracking requests across components
   */
  public generateRequestId(): string {
    return `req_${Date.now()}_${++this.requestIdCounter}`;
  }

  /**
   * Log authorization request events
   * Validates Requirements 8.1: Log authorization requests with client_id, scopes, and outcomes
   */
  public logAuthorizationRequest(entry: Omit<AuthorizationLogEntry, 'timestamp' | 'level' | 'component' | 'type'>): void {
    const logEntry: AuthorizationLogEntry = {
      ...entry,
      type: 'authorization_request',
      timestamp: new Date().toISOString(),
      level: entry.outcome === 'error' ? LogLevel.ERROR : LogLevel.INFO,
      component: 'AuthorizationController'
    };

    this.writeLog(logEntry);
  }

  /**
   * Log token issuance events
   * Validates Requirements 8.2: Log token issuance events with client information and granted scopes
   */
  public logTokenIssuance(entry: Omit<TokenLogEntry, 'timestamp' | 'level' | 'component' | 'type'>): void {
    const logEntry: TokenLogEntry = {
      ...entry,
      type: 'token_issuance',
      timestamp: new Date().toISOString(),
      level: entry.outcome === 'error' ? LogLevel.ERROR : LogLevel.INFO,
      component: 'TokenController'
    };

    this.writeLog(logEntry);
  }

  /**
   * Log authentication attempts
   * Validates Requirements 8.3: Log authentication attempts with success/failure status
   */
  public logAuthenticationAttempt(entry: Omit<AuthenticationLogEntry, 'timestamp' | 'level' | 'component' | 'type'>): void {
    const logEntry: AuthenticationLogEntry = {
      ...entry,
      type: 'authentication_attempt',
      timestamp: new Date().toISOString(),
      level: entry.outcome === 'failure' ? LogLevel.WARN : LogLevel.INFO,
      component: 'AuthController'
    };

    this.writeLog(logEntry);
  }

  /**
   * Log token introspection events
   */
  public logTokenIntrospection(entry: Omit<IntrospectionLogEntry, 'timestamp' | 'level' | 'component' | 'type'>): void {
    const logEntry: IntrospectionLogEntry = {
      ...entry,
      type: 'token_introspection',
      timestamp: new Date().toISOString(),
      level: entry.outcome === 'error' ? LogLevel.ERROR : LogLevel.INFO,
      component: 'IntrospectionController'
    };

    this.writeLog(logEntry);
  }

  /**
   * Log errors with detailed information and stack traces
   * Validates Requirements 8.4: Log errors with detailed information and stack traces
   */
  public logError(entry: Omit<ErrorLogEntry, 'timestamp' | 'level' | 'type'>): void {
    const logEntry: ErrorLogEntry = {
      ...entry,
      type: 'error',
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR
    };

    this.writeLog(logEntry);
  }

  /**
   * Log general information
   */
  public logInfo(message: string, component: string, context?: Record<string, any>): void {
    const logEntry: BaseLogEntry & { context?: Record<string, any> } = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message,
      component,
      ...(context && { context })
    };

    this.writeLog(logEntry);
  }

  /**
   * Log warnings
   */
  public logWarn(message: string, component: string, context?: Record<string, any>): void {
    const logEntry: BaseLogEntry & { context?: Record<string, any> } = {
      timestamp: new Date().toISOString(),
      level: LogLevel.WARN,
      message,
      component,
      ...(context && { context })
    };

    this.writeLog(logEntry);
  }

  /**
   * Log debug information
   */
  public logDebug(message: string, component: string, context?: Record<string, any>): void {
    const logEntry: BaseLogEntry & { context?: Record<string, any> } = {
      timestamp: new Date().toISOString(),
      level: LogLevel.DEBUG,
      message,
      component,
      ...(context && { context })
    };

    this.writeLog(logEntry);
  }

  /**
   * Write log entry to output
   * In production, this would integrate with proper logging systems like Winston, Bunyan, or cloud logging
   */
  private writeLog(entry: LogEntry | (BaseLogEntry & { context?: Record<string, any> })): void {
    // Format log entry as structured JSON
    const logOutput = JSON.stringify(entry, null, 2);

    // Output to appropriate stream based on log level
    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(logOutput);
        break;
      case LogLevel.WARN:
        console.warn(logOutput);
        break;
      case LogLevel.INFO:
        console.info(logOutput);
        break;
      case LogLevel.DEBUG:
        console.log(logOutput);
        break;
      default:
        console.log(logOutput);
    }
  }

  /**
   * Create a child logger with common context (e.g., requestId, userId)
   */
  public createChildLogger(context: Partial<BaseLogEntry>): ChildLogger {
    return new ChildLogger(this, context);
  }
}

/**
 * Child logger that inherits context from parent logger
 */
export class ChildLogger {
  constructor(
    private parent: Logger,
    private context: Partial<BaseLogEntry>
  ) {}

  public logAuthorizationRequest(entry: Omit<AuthorizationLogEntry, 'timestamp' | 'level' | 'component' | 'type'>): void {
    this.parent.logAuthorizationRequest({ ...entry, ...this.context });
  }

  public logTokenIssuance(entry: Omit<TokenLogEntry, 'timestamp' | 'level' | 'component' | 'type'>): void {
    this.parent.logTokenIssuance({ ...entry, ...this.context });
  }

  public logAuthenticationAttempt(entry: Omit<AuthenticationLogEntry, 'timestamp' | 'level' | 'component' | 'type'>): void {
    this.parent.logAuthenticationAttempt({ ...entry, ...this.context });
  }

  public logTokenIntrospection(entry: Omit<IntrospectionLogEntry, 'timestamp' | 'level' | 'component' | 'type'>): void {
    this.parent.logTokenIntrospection({ ...entry, ...this.context });
  }

  public logError(entry: Omit<ErrorLogEntry, 'timestamp' | 'level' | 'type'>): void {
    this.parent.logError({ ...entry, ...this.context });
  }

  public logInfo(message: string, component: string, context?: Record<string, any>): void {
    this.parent.logInfo(message, component, { ...context, ...this.context });
  }

  public logWarn(message: string, component: string, context?: Record<string, any>): void {
    this.parent.logWarn(message, component, { ...context, ...this.context });
  }

  public logDebug(message: string, component: string, context?: Record<string, any>): void {
    this.parent.logDebug(message, component, { ...context, ...this.context });
  }
}

// Export singleton instance
export const logger = Logger.getInstance();