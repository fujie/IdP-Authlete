import { ClientInfo, ScopeInfo } from '../authlete/types';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    authorizationTicket?: string;
    clientInfo?: ClientInfo;
    scopes?: ScopeInfo[];
    authenticated?: boolean;
    consentGiven?: boolean;
  }
}