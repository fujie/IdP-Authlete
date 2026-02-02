import { ClientInfo, ScopeInfo } from '../authlete/types';

declare module 'express-session' {
  interface SessionData {
    // OAuth/OpenID Connect session data
    userId?: string;
    authenticated?: boolean;
    authorizationTicket?: string;
    clientInfo?: ClientInfo;
    scopes?: ScopeInfo[];
    consentGiven?: boolean;
    
    // OAuth state management
    oauthState?: string;
    
    // Token storage
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    tokenType?: string;
    expiresIn?: number;
    
    // User information
    user?: {
      id: string;
      name: string;
      authenticated: boolean;
    };
    
    // Federation-specific session data
    federationClientRegistration?: {
      entityId: string;
      clientSecret: string;
    };
  }
}