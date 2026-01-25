import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { 
  Logger, 
  ChildLogger, 
  LogLevel, 
  AuthorizationLogEntry, 
  TokenLogEntry, 
  AuthenticationLogEntry, 
  ErrorLogEntry,
  IntrospectionLogEntry,
  logger 
} from './logger';

// Mock console methods to capture log output
const mockConsole = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  log: vi.fn()
};

// Property-based test generators
const safeStringArbitrary = () => fc.string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0)
  .filter(s => !/[\x00-\x1f\x7f-\x9f]/.test(s)); // Filter control characters

const clientIdArbitrary = () => fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s));

const scopesArbitrary = () => fc.array(
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_:-]+$/.test(s)),
  { minLength: 0, maxLength: 5 }
);

const outcomeArbitrary = () => fc.oneof(
  fc.constant('success' as const),
  fc.constant('error' as const),
  fc.constant('denied' as const),
  fc.constant('failure' as const)
);

const errorCodeArbitrary = () => fc.oneof(
  fc.constant('invalid_request'),
  fc.constant('invalid_client'),
  fc.constant('invalid_grant'),
  fc.constant('unauthorized_client'),
  fc.constant('access_denied'),
  fc.constant('unsupported_response_type'),
  fc.constant('invalid_scope'),
  fc.constant('server_error'),
  fc.constant('temporarily_unavailable')
);

const authorizationLogEntryArbitrary = () => fc.record({
  message: safeStringArbitrary(),
  clientId: fc.option(clientIdArbitrary(), { nil: undefined }),
  scopes: fc.option(scopesArbitrary(), { nil: undefined }),
  responseType: fc.option(fc.constant('code'), { nil: undefined }),
  redirectUri: fc.option(fc.webUrl(), { nil: undefined }),
  state: fc.option(safeStringArbitrary(), { nil: undefined }),
  outcome: outcomeArbitrary(),
  errorCode: fc.option(errorCodeArbitrary(), { nil: undefined }),
  errorDescription: fc.option(safeStringArbitrary(), { nil: undefined }),
  requestId: fc.option(safeStringArbitrary(), { nil: undefined }),
  userId: fc.option(safeStringArbitrary(), { nil: undefined })
});

const tokenLogEntryArbitrary = () => fc.record({
  message: safeStringArbitrary(),
  clientId: fc.option(clientIdArbitrary(), { nil: undefined }),
  grantType: fc.option(fc.constant('authorization_code'), { nil: undefined }),
  scopes: fc.option(scopesArbitrary(), { nil: undefined }),
  outcome: fc.oneof(fc.constant('success' as const), fc.constant('error' as const)),
  errorCode: fc.option(errorCodeArbitrary(), { nil: undefined }),
  errorDescription: fc.option(safeStringArbitrary(), { nil: undefined }),
  tokenType: fc.option(fc.constant('Bearer'), { nil: undefined }),
  expiresIn: fc.option(fc.integer({ min: 300, max: 7200 }), { nil: undefined }),
  requestId: fc.option(safeStringArbitrary(), { nil: undefined }),
  userId: fc.option(safeStringArbitrary(), { nil: undefined })
});

const authenticationLogEntryArbitrary = () => fc.record({
  message: safeStringArbitrary(),
  username: fc.option(safeStringArbitrary(), { nil: undefined }),
  outcome: fc.oneof(fc.constant('success' as const), fc.constant('failure' as const)),
  reason: fc.option(safeStringArbitrary(), { nil: undefined }),
  ipAddress: fc.option(fc.ipV4(), { nil: undefined }),
  userAgent: fc.option(safeStringArbitrary(), { nil: undefined }),
  requestId: fc.option(safeStringArbitrary(), { nil: undefined }),
  userId: fc.option(safeStringArbitrary(), { nil: undefined })
});

const errorObjectArbitrary = () => fc.record({
  name: safeStringArbitrary(),
  message: safeStringArbitrary(),
  stack: fc.option(safeStringArbitrary(), { nil: undefined }),
  code: fc.option(fc.oneof(fc.string(), fc.integer()), { nil: undefined })
});

const simpleContextArbitrary = () => fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null)
  )
);

const errorLogEntryArbitrary = () => fc.record({
  message: safeStringArbitrary(),
  component: safeStringArbitrary(),
  error: errorObjectArbitrary(),
  context: fc.option(simpleContextArbitrary(), { nil: undefined }),
  requestId: fc.option(safeStringArbitrary(), { nil: undefined }),
  userId: fc.option(safeStringArbitrary(), { nil: undefined }),
  clientId: fc.option(clientIdArbitrary(), { nil: undefined })
});

const introspectionLogEntryArbitrary = () => fc.record({
  message: safeStringArbitrary(),
  tokenActive: fc.boolean(),
  scopes: fc.option(scopesArbitrary(), { nil: undefined }),
  outcome: fc.oneof(fc.constant('success' as const), fc.constant('error' as const)),
  errorCode: fc.option(errorCodeArbitrary(), { nil: undefined }),
  errorDescription: fc.option(safeStringArbitrary(), { nil: undefined }),
  requestId: fc.option(safeStringArbitrary(), { nil: undefined }),
  userId: fc.option(safeStringArbitrary(), { nil: undefined }),
  clientId: fc.option(clientIdArbitrary(), { nil: undefined })
});

describe('Feature: oauth2-authorization-server, Property 15: Comprehensive Logging', () => {
  let loggerInstance: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock console methods
    vi.spyOn(console, 'error').mockImplementation(mockConsole.error);
    vi.spyOn(console, 'warn').mockImplementation(mockConsole.warn);
    vi.spyOn(console, 'info').mockImplementation(mockConsole.info);
    vi.spyOn(console, 'log').mockImplementation(mockConsole.log);
    
    loggerInstance = Logger.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Property 15: Comprehensive Logging
   * For any authorization request, token issuance, authentication attempt, or error, 
   * the system should log appropriate information including client_id, scopes, outcomes, 
   * success/failure status, and detailed error information with stack traces
   * Validates: Requirements 8.1, 8.2, 8.3, 8.4
   */
  it('Property 15: Authorization requests should always be logged with required information', () => {
    fc.assert(fc.property(
      authorizationLogEntryArbitrary(),
      (logEntry) => {
        mockConsole.info.mockClear();
        mockConsole.error.mockClear();

        loggerInstance.logAuthorizationRequest(logEntry);

        // Should call appropriate console method based on outcome
        if (logEntry.outcome === 'error') {
          expect(mockConsole.error).toHaveBeenCalledTimes(1);
          expect(mockConsole.info).not.toHaveBeenCalled();
        } else {
          expect(mockConsole.info).toHaveBeenCalledTimes(1);
          expect(mockConsole.error).not.toHaveBeenCalled();
        }

        // Get the logged content
        const logCall = logEntry.outcome === 'error' ? mockConsole.error.mock.calls[0] : mockConsole.info.mock.calls[0];
        expect(logCall).toBeDefined();
        
        const loggedContent = logCall[0];
        expect(typeof loggedContent).toBe('string');
        
        // Parse the JSON log entry
        const parsedLog = JSON.parse(loggedContent);
        
        // Should have required structure
        expect(parsedLog).toHaveProperty('timestamp');
        expect(parsedLog).toHaveProperty('level');
        expect(parsedLog).toHaveProperty('message', logEntry.message);
        expect(parsedLog).toHaveProperty('component', 'AuthorizationController');
        expect(parsedLog).toHaveProperty('type', 'authorization_request');
        expect(parsedLog).toHaveProperty('outcome', logEntry.outcome);
        
        // Should include client_id when provided (Requirement 8.1)
        if (logEntry.clientId) {
          expect(parsedLog).toHaveProperty('clientId', logEntry.clientId);
        }
        
        // Should include scopes when provided (Requirement 8.1)
        if (logEntry.scopes) {
          expect(parsedLog).toHaveProperty('scopes', logEntry.scopes);
        }
        
        // Should have valid timestamp
        expect(new Date(parsedLog.timestamp).getTime()).toBeGreaterThan(0);
        
        // Should have correct log level
        const expectedLevel = logEntry.outcome === 'error' ? LogLevel.ERROR : LogLevel.INFO;
        expect(parsedLog.level).toBe(expectedLevel);
      }
    ), { numRuns: 100 });
  });

  it('Property 15: Token issuance events should always be logged with client information and granted scopes', () => {
    fc.assert(fc.property(
      tokenLogEntryArbitrary(),
      (logEntry) => {
        mockConsole.info.mockClear();
        mockConsole.error.mockClear();

        loggerInstance.logTokenIssuance(logEntry);

        // Should call appropriate console method based on outcome
        if (logEntry.outcome === 'error') {
          expect(mockConsole.error).toHaveBeenCalledTimes(1);
          expect(mockConsole.info).not.toHaveBeenCalled();
        } else {
          expect(mockConsole.info).toHaveBeenCalledTimes(1);
          expect(mockConsole.error).not.toHaveBeenCalled();
        }

        // Get the logged content
        const logCall = logEntry.outcome === 'error' ? mockConsole.error.mock.calls[0] : mockConsole.info.mock.calls[0];
        expect(logCall).toBeDefined();
        
        const loggedContent = logCall[0];
        const parsedLog = JSON.parse(loggedContent);
        
        // Should have required structure (Requirement 8.2)
        expect(parsedLog).toHaveProperty('timestamp');
        expect(parsedLog).toHaveProperty('level');
        expect(parsedLog).toHaveProperty('message', logEntry.message);
        expect(parsedLog).toHaveProperty('component', 'TokenController');
        expect(parsedLog).toHaveProperty('type', 'token_issuance');
        expect(parsedLog).toHaveProperty('outcome', logEntry.outcome);
        
        // Should include client information when provided (Requirement 8.2)
        if (logEntry.clientId) {
          expect(parsedLog).toHaveProperty('clientId', logEntry.clientId);
        }
        
        // Should include granted scopes when provided (Requirement 8.2)
        if (logEntry.scopes) {
          expect(parsedLog).toHaveProperty('scopes', logEntry.scopes);
        }
        
        // Should include token type and expiration for successful issuance
        if (logEntry.outcome === 'success') {
          if (logEntry.tokenType) {
            expect(parsedLog).toHaveProperty('tokenType', logEntry.tokenType);
          }
          if (logEntry.expiresIn) {
            expect(parsedLog).toHaveProperty('expiresIn', logEntry.expiresIn);
          }
        }
        
        // Should have valid timestamp
        expect(new Date(parsedLog.timestamp).getTime()).toBeGreaterThan(0);
      }
    ), { numRuns: 100 });
  });

  it('Property 15: Authentication attempts should always be logged with success/failure status', () => {
    fc.assert(fc.property(
      authenticationLogEntryArbitrary(),
      (logEntry) => {
        mockConsole.info.mockClear();
        mockConsole.warn.mockClear();

        loggerInstance.logAuthenticationAttempt(logEntry);

        // Should call appropriate console method based on outcome
        if (logEntry.outcome === 'failure') {
          expect(mockConsole.warn).toHaveBeenCalledTimes(1);
          expect(mockConsole.info).not.toHaveBeenCalled();
        } else {
          expect(mockConsole.info).toHaveBeenCalledTimes(1);
          expect(mockConsole.warn).not.toHaveBeenCalled();
        }

        // Get the logged content
        const logCall = logEntry.outcome === 'failure' ? mockConsole.warn.mock.calls[0] : mockConsole.info.mock.calls[0];
        expect(logCall).toBeDefined();
        
        const loggedContent = logCall[0];
        const parsedLog = JSON.parse(loggedContent);
        
        // Should have required structure (Requirement 8.3)
        expect(parsedLog).toHaveProperty('timestamp');
        expect(parsedLog).toHaveProperty('level');
        expect(parsedLog).toHaveProperty('message', logEntry.message);
        expect(parsedLog).toHaveProperty('component', 'AuthController');
        expect(parsedLog).toHaveProperty('type', 'authentication_attempt');
        expect(parsedLog).toHaveProperty('outcome', logEntry.outcome);
        
        // Should include success/failure status (Requirement 8.3)
        expect(['success', 'failure']).toContain(parsedLog.outcome);
        
        // Should include username when provided
        if (logEntry.username) {
          expect(parsedLog).toHaveProperty('username', logEntry.username);
        }
        
        // Should include IP address and user agent when provided
        if (logEntry.ipAddress) {
          expect(parsedLog).toHaveProperty('ipAddress', logEntry.ipAddress);
        }
        if (logEntry.userAgent) {
          expect(parsedLog).toHaveProperty('userAgent', logEntry.userAgent);
        }
        
        // Should have correct log level
        const expectedLevel = logEntry.outcome === 'failure' ? LogLevel.WARN : LogLevel.INFO;
        expect(parsedLog.level).toBe(expectedLevel);
      }
    ), { numRuns: 100 });
  });

  it('Property 15: Errors should always be logged with detailed information and stack traces', () => {
    fc.assert(fc.property(
      errorLogEntryArbitrary(),
      (logEntry) => {
        mockConsole.error.mockClear();

        loggerInstance.logError(logEntry);

        // Should always call console.error for errors
        expect(mockConsole.error).toHaveBeenCalledTimes(1);
        
        const loggedContent = mockConsole.error.mock.calls[0][0];
        const parsedLog = JSON.parse(loggedContent);
        
        // Should have required structure (Requirement 8.4)
        expect(parsedLog).toHaveProperty('timestamp');
        expect(parsedLog).toHaveProperty('level', LogLevel.ERROR);
        expect(parsedLog).toHaveProperty('message', logEntry.message);
        expect(parsedLog).toHaveProperty('component', logEntry.component);
        expect(parsedLog).toHaveProperty('type', 'error');
        
        // Should include detailed error information (Requirement 8.4)
        expect(parsedLog).toHaveProperty('error');
        expect(parsedLog.error).toHaveProperty('name', logEntry.error.name);
        expect(parsedLog.error).toHaveProperty('message', logEntry.error.message);
        
        // Should include stack trace when provided (Requirement 8.4)
        if (logEntry.error.stack) {
          expect(parsedLog.error).toHaveProperty('stack', logEntry.error.stack);
        }
        
        // Should include error code when provided
        if (logEntry.error.code) {
          expect(parsedLog.error).toHaveProperty('code', logEntry.error.code);
        }
        
        // Should include context when provided
        if (logEntry.context && Object.keys(logEntry.context).length > 0) {
          expect(parsedLog).toHaveProperty('context');
          // Context should be serializable
          expect(() => JSON.stringify(parsedLog.context)).not.toThrow();
        }
        
        // Should have valid timestamp
        expect(new Date(parsedLog.timestamp).getTime()).toBeGreaterThan(0);
      }
    ), { numRuns: 100 });
  });

  it('Property 15: Token introspection events should always be logged with appropriate information', () => {
    fc.assert(fc.property(
      introspectionLogEntryArbitrary(),
      (logEntry) => {
        mockConsole.info.mockClear();
        mockConsole.error.mockClear();

        loggerInstance.logTokenIntrospection(logEntry);

        // Should call appropriate console method based on outcome
        if (logEntry.outcome === 'error') {
          expect(mockConsole.error).toHaveBeenCalledTimes(1);
          expect(mockConsole.info).not.toHaveBeenCalled();
        } else {
          expect(mockConsole.info).toHaveBeenCalledTimes(1);
          expect(mockConsole.error).not.toHaveBeenCalled();
        }

        // Get the logged content
        const logCall = logEntry.outcome === 'error' ? mockConsole.error.mock.calls[0] : mockConsole.info.mock.calls[0];
        expect(logCall).toBeDefined();
        
        const loggedContent = logCall[0];
        const parsedLog = JSON.parse(loggedContent);
        
        // Should have required structure
        expect(parsedLog).toHaveProperty('timestamp');
        expect(parsedLog).toHaveProperty('level');
        expect(parsedLog).toHaveProperty('message', logEntry.message);
        expect(parsedLog).toHaveProperty('component', 'IntrospectionController');
        expect(parsedLog).toHaveProperty('type', 'token_introspection');
        expect(parsedLog).toHaveProperty('outcome', logEntry.outcome);
        expect(parsedLog).toHaveProperty('tokenActive', logEntry.tokenActive);
        
        // Should include scopes when provided
        if (logEntry.scopes) {
          expect(parsedLog).toHaveProperty('scopes', logEntry.scopes);
        }
        
        // Should have valid timestamp
        expect(new Date(parsedLog.timestamp).getTime()).toBeGreaterThan(0);
      }
    ), { numRuns: 100 });
  });

  it('Property 15: Request ID generation should always produce unique identifiers', () => {
    fc.assert(fc.property(
      fc.integer({ min: 10, max: 100 }),
      (count) => {
        const requestIds = new Set<string>();
        
        // Generate multiple request IDs
        for (let i = 0; i < count; i++) {
          const requestId = loggerInstance.generateRequestId();
          
          // Should be a non-empty string
          expect(typeof requestId).toBe('string');
          expect(requestId.length).toBeGreaterThan(0);
          
          // Should follow expected format (req_timestamp_counter)
          expect(requestId).toMatch(/^req_\d+_\d+$/);
          
          // Should be unique
          expect(requestIds.has(requestId)).toBe(false);
          requestIds.add(requestId);
        }
        
        // All request IDs should be unique
        expect(requestIds.size).toBe(count);
      }
    ), { numRuns: 50 });
  });

  it('Property 15: Child logger should inherit context and maintain logging consistency', () => {
    fc.assert(fc.property(
      fc.record({
        requestId: safeStringArbitrary(),
        userId: fc.option(safeStringArbitrary(), { nil: undefined }),
        clientId: fc.option(clientIdArbitrary(), { nil: undefined })
      }),
      authorizationLogEntryArbitrary(),
      (context, logEntry) => {
        mockConsole.info.mockClear();
        mockConsole.error.mockClear();

        // Create child logger with context
        const childLogger = loggerInstance.createChildLogger(context);
        
        // Log using child logger
        childLogger.logAuthorizationRequest(logEntry);

        // Should call appropriate console method
        if (logEntry.outcome === 'error') {
          expect(mockConsole.error).toHaveBeenCalledTimes(1);
        } else {
          expect(mockConsole.info).toHaveBeenCalledTimes(1);
        }

        // Get the logged content
        const logCall = logEntry.outcome === 'error' ? mockConsole.error.mock.calls[0] : mockConsole.info.mock.calls[0];
        const loggedContent = logCall[0];
        const parsedLog = JSON.parse(loggedContent);
        
        // Should inherit context from parent
        if (context.requestId) {
          expect(parsedLog).toHaveProperty('requestId', context.requestId);
        }
        if (context.userId) {
          expect(parsedLog).toHaveProperty('userId', context.userId);
        }
        if (context.clientId) {
          expect(parsedLog).toHaveProperty('clientId', context.clientId);
        }
        
        // Should still have all required log entry properties
        expect(parsedLog).toHaveProperty('message', logEntry.message);
        expect(parsedLog).toHaveProperty('type', 'authorization_request');
        expect(parsedLog).toHaveProperty('outcome', logEntry.outcome);
      }
    ), { numRuns: 100 });
  });

  it('Property 15: Log entries should always have valid JSON structure and required fields', () => {
    fc.assert(fc.property(
      fc.oneof(
        authorizationLogEntryArbitrary(),
        tokenLogEntryArbitrary(),
        authenticationLogEntryArbitrary(),
        errorLogEntryArbitrary(),
        introspectionLogEntryArbitrary()
      ),
      (logEntry) => {
        // Clear all console mocks
        Object.values(mockConsole).forEach(mock => mock.mockClear());

        // Log based on entry type
        if ('outcome' in logEntry && 'scopes' in logEntry && 'responseType' in logEntry) {
          // Authorization log entry
          loggerInstance.logAuthorizationRequest(logEntry as any);
        } else if ('outcome' in logEntry && 'grantType' in logEntry) {
          // Token log entry
          loggerInstance.logTokenIssuance(logEntry as any);
        } else if ('outcome' in logEntry && 'username' in logEntry) {
          // Authentication log entry
          loggerInstance.logAuthenticationAttempt(logEntry as any);
        } else if ('error' in logEntry && 'component' in logEntry) {
          // Error log entry
          loggerInstance.logError(logEntry as any);
        } else if ('tokenActive' in logEntry) {
          // Introspection log entry
          loggerInstance.logTokenIntrospection(logEntry as any);
        }

        // Find which console method was called
        const consoleCalls = [
          ...mockConsole.error.mock.calls,
          ...mockConsole.warn.mock.calls,
          ...mockConsole.info.mock.calls,
          ...mockConsole.log.mock.calls
        ];

        expect(consoleCalls.length).toBeGreaterThan(0);
        
        // Get the first log call
        const loggedContent = consoleCalls[0][0];
        
        // Should be valid JSON
        expect(() => JSON.parse(loggedContent)).not.toThrow();
        
        const parsedLog = JSON.parse(loggedContent);
        
        // Should have required base fields
        expect(parsedLog).toHaveProperty('timestamp');
        expect(parsedLog).toHaveProperty('level');
        expect(parsedLog).toHaveProperty('message');
        expect(parsedLog).toHaveProperty('component');
        
        // Timestamp should be valid ISO string
        expect(new Date(parsedLog.timestamp).getTime()).toBeGreaterThan(0);
        
        // Level should be valid LogLevel
        expect(Object.values(LogLevel)).toContain(parsedLog.level);
        
        // Message should be non-empty string
        expect(typeof parsedLog.message).toBe('string');
        expect(parsedLog.message.length).toBeGreaterThan(0);
        
        // Component should be non-empty string
        expect(typeof parsedLog.component).toBe('string');
        expect(parsedLog.component.length).toBeGreaterThan(0);
      }
    ), { numRuns: 100 });
  });

  it('Property 15: Logging should be consistent across different log levels', () => {
    fc.assert(fc.property(
      safeStringArbitrary(),
      safeStringArbitrary(),
      fc.option(simpleContextArbitrary(), { nil: undefined }),
      (message, component, context) => {
        // Clear all console mocks
        Object.values(mockConsole).forEach(mock => mock.mockClear());

        // Test all log level methods
        loggerInstance.logInfo(message, component, context);
        loggerInstance.logWarn(message, component, context);
        loggerInstance.logDebug(message, component, context);

        // Should have called appropriate console methods
        expect(mockConsole.info).toHaveBeenCalledTimes(1);
        expect(mockConsole.warn).toHaveBeenCalledTimes(1);
        expect(mockConsole.log).toHaveBeenCalledTimes(1);

        // Check each log entry
        const infoLog = JSON.parse(mockConsole.info.mock.calls[0][0]);
        const warnLog = JSON.parse(mockConsole.warn.mock.calls[0][0]);
        const debugLog = JSON.parse(mockConsole.log.mock.calls[0][0]);

        // All should have consistent structure
        [infoLog, warnLog, debugLog].forEach((log, index) => {
          const expectedLevel = [LogLevel.INFO, LogLevel.WARN, LogLevel.DEBUG][index];
          
          expect(log).toHaveProperty('timestamp');
          expect(log).toHaveProperty('level', expectedLevel);
          expect(log).toHaveProperty('message', message);
          expect(log).toHaveProperty('component', component);
          
          if (context && Object.keys(context).length > 0) {
            expect(log).toHaveProperty('context');
            // Context should be serializable and not contain undefined values
            expect(() => JSON.stringify(log.context)).not.toThrow();
          }
          
          // Timestamp should be valid
          expect(new Date(log.timestamp).getTime()).toBeGreaterThan(0);
        });
      }
    ), { numRuns: 100 });
  });

  it('Property 15: Logger singleton should maintain consistency across multiple instances', () => {
    fc.assert(fc.property(
      safeStringArbitrary(),
      (message) => {
        // Get multiple logger instances
        const logger1 = Logger.getInstance();
        const logger2 = Logger.getInstance();
        
        // Should be the same instance
        expect(logger1).toBe(logger2);
        expect(logger1).toBe(loggerInstance);
        
        // Should generate unique request IDs from same instance
        const requestId1 = logger1.generateRequestId();
        const requestId2 = logger2.generateRequestId();
        
        expect(requestId1).not.toBe(requestId2);
        expect(typeof requestId1).toBe('string');
        expect(typeof requestId2).toBe('string');
        expect(requestId1.length).toBeGreaterThan(0);
        expect(requestId2.length).toBeGreaterThan(0);
      }
    ), { numRuns: 50 });
  });
});