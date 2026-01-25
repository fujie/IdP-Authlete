import { Request, Response } from 'express';
import { AuthleteClient } from '../authlete/client';
import { AuthorizationIssueRequest, AuthorizationFailRequest } from '../authlete/types';
import { logger } from '../utils/logger';

export interface AuthController {
  showLoginForm(req: Request, res: Response): Promise<void>;
  handleLogin(req: Request, res: Response): Promise<void>;
  showConsentForm(req: Request, res: Response): Promise<void>;
  handleConsent(req: Request, res: Response): Promise<void>;
}

export class AuthControllerImpl implements AuthController {
  constructor(private authleteClient: AuthleteClient) {}

  async showLoginForm(req: Request, res: Response): Promise<void> {
    const requestId = logger.generateRequestId();
    const childLogger = logger.createChildLogger({ requestId });

    try {
      // Check if user is already authenticated
      if (req.session.userId) {
        childLogger.logInfo('User already authenticated, redirecting to consent', 'AuthController', {
          userId: req.session.userId
        });
        res.redirect('/consent');
        return;
      }

      // Render login form
      const loginHtml = this.generateLoginForm(req.query.error as string);
      res.status(200).send(loginHtml);
    } catch (error) {
      childLogger.logError({
        message: 'Error showing login form',
        component: 'AuthController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });
      res.status(500).json({ error: 'server_error', error_description: 'Internal server error' });
    }
  }

  async handleLogin(req: Request, res: Response): Promise<void> {
    const requestId = logger.generateRequestId();
    const childLogger = logger.createChildLogger({ requestId });

    try {
      const { username, password } = req.body;
      const ipAddress = req.ip || 'unknown';
      const userAgent = req.get ? req.get('User-Agent') || 'unknown' : 'unknown';

      // Validate credentials (simple validation for demo)
      const isValid = await this.validateCredentials(username, password);

      if (isValid) {
        // Log successful authentication
        childLogger.logAuthenticationAttempt({
          message: 'User authentication successful',
          username: username,
          outcome: 'success',
          ipAddress: ipAddress,
          userAgent: userAgent
        });

        // Set user session
        req.session.userId = username;
        req.session.authenticated = true;

        // Redirect to consent
        res.redirect('/consent');
      } else {
        // Log failed authentication
        childLogger.logAuthenticationAttempt({
          message: 'User authentication failed',
          username: username,
          outcome: 'failure',
          reason: 'invalid_credentials',
          ipAddress: ipAddress,
          userAgent: userAgent
        });

        // Redirect back to login with error
        res.redirect('/login?error=invalid_credentials');
      }
    } catch (error) {
      // Log authentication error
      childLogger.logError({
        message: 'Login processing error',
        component: 'AuthController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: {
          username: req.body?.username,
          ipAddress: req.ip || 'unknown'
        }
      });

      // Log failed authentication attempt due to server error
      childLogger.logAuthenticationAttempt({
        message: 'User authentication failed due to server error',
        username: req.body?.username,
        outcome: 'failure',
        reason: 'server_error',
        ipAddress: req.ip || 'unknown',
        userAgent: req.get ? req.get('User-Agent') || 'unknown' : 'unknown'
      });

      res.redirect('/login?error=server_error');
    }
  }

  async showConsentForm(req: Request, res: Response): Promise<void> {
    const requestId = logger.generateRequestId();
    const childLogger = logger.createChildLogger({ 
      requestId, 
      ...(req.session.userId && { userId: req.session.userId })
    });

    try {
      // Debug: Log session state
      childLogger.logInfo('Consent form requested', 'AuthController', {
        userId: req.session.userId,
        authenticated: req.session.authenticated,
        hasAuthorizationTicket: !!req.session.authorizationTicket,
        hasClientInfo: !!req.session.clientInfo,
        hasScopes: !!req.session.scopes
      });

      // Check if user is authenticated
      if (!req.session.userId || !req.session.authenticated) {
        childLogger.logWarn('Unauthenticated user attempted to access consent form', 'AuthController');
        res.redirect('/login');
        return;
      }

      // Check if we have authorization ticket
      if (!req.session.authorizationTicket) {
        childLogger.logWarn('Missing authorization context for consent form', 'AuthController', {
          sessionKeys: Object.keys(req.session)
        });
        res.status(400).json({ error: 'invalid_request', error_description: 'Missing authorization context' });
        return;
      }

      childLogger.logInfo('Displaying consent form', 'AuthController', {
        clientInfo: req.session.clientInfo?.clientName,
        scopes: req.session.scopes?.map(s => s.name)
      });

      // Render consent form
      const consentHtml = this.generateConsentForm(
        req.session.clientInfo,
        req.session.scopes || []
      );
      res.status(200).send(consentHtml);
    } catch (error) {
      childLogger.logError({
        message: 'Error showing consent form',
        component: 'AuthController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        }
      });
      res.status(500).json({ error: 'server_error', error_description: 'Internal server error' });
    }
  }

  async handleConsent(req: Request, res: Response): Promise<void> {
    const requestId = logger.generateRequestId();
    const childLogger = logger.createChildLogger({ 
      requestId, 
      ...(req.session.userId && { userId: req.session.userId })
    });

    try {
      const { consent } = req.body;

      // Check if user is authenticated
      if (!req.session.userId || !req.session.authenticated) {
        childLogger.logWarn('Unauthenticated user attempted consent action', 'AuthController');
        res.redirect('/login');
        return;
      }

      // Check if we have authorization ticket
      if (!req.session.authorizationTicket) {
        childLogger.logWarn('Missing authorization context for consent handling', 'AuthController');
        res.status(400).json({ error: 'invalid_request', error_description: 'Missing authorization context' });
        return;
      }

      if (consent === 'approve') {
        childLogger.logInfo('User approved authorization request', 'AuthController', {
          clientId: req.session.clientInfo?.clientId?.toString(),
          scopes: req.session.scopes?.map(s => s.name)
        });
        // User approved - issue authorization code
        await this.issueAuthorizationCode(req, res);
      } else {
        childLogger.logInfo('User denied authorization request', 'AuthController', {
          clientId: req.session.clientInfo?.clientId?.toString(),
          scopes: req.session.scopes?.map(s => s.name)
        });
        // User denied - return access_denied error
        await this.denyAuthorization(req, res);
      }
    } catch (error) {
      childLogger.logError({
        message: 'Consent handling error',
        component: 'AuthController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: {
          consent: req.body?.consent,
          clientId: req.session.clientInfo?.clientId?.toString()
        }
      });
      res.status(500).json({ error: 'server_error', error_description: 'Internal server error' });
    }
  }

  private async validateCredentials(username: string, password: string): Promise<boolean> {
    // Simple credential validation for demo purposes
    // In production, this would validate against a user database
    if (!username || !password) {
      return false;
    }

    // Demo users - in production, use proper password hashing
    const validUsers = {
      'demo': 'password',
      'user1': 'pass123',
      'testuser': 'test123'
    };

    return validUsers[username as keyof typeof validUsers] === password;
  }

  private async issueAuthorizationCode(req: Request, res: Response): Promise<void> {
    const childLogger = logger.createChildLogger({ 
      ...(req.session.userId && { userId: req.session.userId })
    });

    try {
      const issueRequest: AuthorizationIssueRequest = {
        ticket: req.session.authorizationTicket!,
        subject: req.session.userId!
      };

      const issueResponse = await this.authleteClient.authorizationIssue(issueRequest);

      if (issueResponse.action === 'LOCATION' && issueResponse.responseContent) {
        // Log successful authorization code issuance
        childLogger.logAuthorizationRequest({
          message: 'Authorization code issued successfully',
          ...(req.session.clientInfo?.clientId && { clientId: req.session.clientInfo.clientId }),
          scopes: req.session.scopes?.map(s => s.name) || [],
          outcome: 'success'
        });

        // Clear session data
        delete req.session.authorizationTicket;
        delete req.session.clientInfo;
        delete req.session.scopes;
        
        // Redirect to client with authorization code
        res.redirect(issueResponse.responseContent);
      } else {
        // Log failed authorization code issuance
        childLogger.logAuthorizationRequest({
          message: 'Authorization code issuance failed',
          ...(req.session.clientInfo?.clientId && { clientId: req.session.clientInfo.clientId }),
          scopes: req.session.scopes?.map(s => s.name) || [],
          outcome: 'error',
          errorCode: issueResponse.action,
          errorDescription: 'Failed to issue authorization code'
        });

        res.status(500).json({ error: 'server_error', error_description: 'Failed to issue authorization code' });
      }
    } catch (error) {
      childLogger.logError({
        message: 'Authorization code issuance error',
        component: 'AuthController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: {
          clientId: req.session.clientInfo?.clientId?.toString(),
          ticket: req.session.authorizationTicket
        }
      });

      // Log failed authorization code issuance
      childLogger.logAuthorizationRequest({
        message: 'Authorization code issuance failed due to error',
        ...(req.session.clientInfo?.clientId && { clientId: req.session.clientInfo.clientId }),
        scopes: req.session.scopes?.map(s => s.name) || [],
        outcome: 'error',
        errorCode: 'server_error',
        errorDescription: error instanceof Error ? error.message : 'Internal server error'
      });

      res.status(500).json({ error: 'server_error', error_description: 'Failed to issue authorization code' });
    }
  }

  private async denyAuthorization(req: Request, res: Response): Promise<void> {
    const childLogger = logger.createChildLogger({ 
      ...(req.session.userId && { userId: req.session.userId })
    });

    try {
      const failRequest: AuthorizationFailRequest = {
        ticket: req.session.authorizationTicket!,
        reason: 'ACCESS_DENIED'
      };

      const failResponse = await this.authleteClient.authorizationFail(failRequest);

      if (failResponse.action === 'LOCATION' && failResponse.responseContent) {
        // Log authorization denial
        childLogger.logAuthorizationRequest({
          message: 'Authorization denied by user',
          ...(req.session.clientInfo?.clientId && { clientId: req.session.clientInfo.clientId }),
          scopes: req.session.scopes?.map(s => s.name) || [],
          outcome: 'denied',
          errorCode: 'access_denied',
          errorDescription: 'User denied authorization'
        });

        // Clear session data
        delete req.session.authorizationTicket;
        delete req.session.clientInfo;
        delete req.session.scopes;
        
        // Redirect to client with error
        res.redirect(failResponse.responseContent);
      } else {
        childLogger.logError({
          message: 'Failed to process authorization denial',
          component: 'AuthController',
          error: {
            name: 'AuthorizationDenialError',
            message: 'Authlete API returned unexpected response',
            code: failResponse.action
          },
          context: {
            clientId: req.session.clientInfo?.clientId?.toString(),
            ticket: req.session.authorizationTicket
          }
        });

        res.status(500).json({ error: 'server_error', error_description: 'Failed to process authorization denial' });
      }
    } catch (error) {
      childLogger.logError({
        message: 'Authorization denial error',
        component: 'AuthController',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: {
          clientId: req.session.clientInfo?.clientId?.toString(),
          ticket: req.session.authorizationTicket
        }
      });

      res.status(500).json({ error: 'server_error', error_description: 'Failed to process authorization denial' });
    }
  }

  private generateLoginForm(error?: string): string {
    const errorMessage = error ? this.getErrorMessage(error) : '';
    
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Login - OpenID Connect Authorization Server</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input[type="text"], input[type="password"] { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
        button { background-color: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; width: 100%; }
        button:hover { background-color: #0056b3; }
        .error { color: red; margin-bottom: 15px; padding: 10px; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; }
        .demo-info { background-color: #d1ecf1; border: 1px solid #bee5eb; border-radius: 4px; padding: 10px; margin-bottom: 15px; font-size: 14px; }
    </style>
</head>
<body>
    <h2>Login</h2>
    <p>Please sign in to authorize the application.</p>
    
    ${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}
    
    <div class="demo-info">
        <strong>Demo Credentials:</strong><br>
        Username: demo, Password: password<br>
        Username: user1, Password: pass123<br>
        Username: testuser, Password: test123
    </div>
    
    <form method="POST" action="/login">
        <div class="form-group">
            <label for="username">Username:</label>
            <input type="text" id="username" name="username" required>
        </div>
        <div class="form-group">
            <label for="password">Password:</label>
            <input type="password" id="password" name="password" required>
        </div>
        <button type="submit">Sign In</button>
    </form>
</body>
</html>`;
  }

  private generateConsentForm(clientInfo: any, scopes: any[]): string {
    const scopeList = scopes.map(scope => 
      `<li><strong>${scope.name}</strong>${scope.description ? `: ${scope.description}` : ''}</li>`
    ).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <title>Consent - OpenID Connect Authorization Server</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; max-width: 500px; margin: 50px auto; padding: 20px; }
        .client-info { background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; padding: 15px; margin-bottom: 20px; }
        .scopes { background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; padding: 15px; margin-bottom: 20px; }
        .scopes ul { margin: 10px 0; padding-left: 20px; }
        .buttons { display: flex; gap: 10px; }
        .btn { padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; flex: 1; font-size: 16px; }
        .btn-approve { background-color: #28a745; color: white; }
        .btn-approve:hover { background-color: #218838; }
        .btn-deny { background-color: #dc3545; color: white; }
        .btn-deny:hover { background-color: #c82333; }
    </style>
</head>
<body>
    <h2>Authorization Request</h2>
    
    <div class="client-info">
        <h3>Application Details</h3>
        <p><strong>Application:</strong> ${clientInfo?.clientName || 'Unknown Application'}</p>
        ${clientInfo?.description ? `<p><strong>Description:</strong> ${clientInfo.description}</p>` : ''}
    </div>
    
    <div class="scopes">
        <h3>Requested Permissions</h3>
        <p>This application is requesting access to:</p>
        <ul>
            ${scopeList || '<li>No specific permissions requested</li>'}
        </ul>
    </div>
    
    <p>Do you want to authorize this application?</p>
    
    <form method="POST" action="/consent">
        <div class="buttons">
            <button type="submit" name="consent" value="approve" class="btn btn-approve">Authorize</button>
            <button type="submit" name="consent" value="deny" class="btn btn-deny">Deny</button>
        </div>
    </form>
</body>
</html>`;
  }

  private getErrorMessage(error: string): string {
    switch (error) {
      case 'invalid_credentials':
        return 'Invalid username or password. Please try again.';
      case 'server_error':
        return 'A server error occurred. Please try again later.';
      default:
        return 'An error occurred. Please try again.';
    }
  }
}