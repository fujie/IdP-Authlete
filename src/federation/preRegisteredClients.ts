// Pre-registered clients for Federation entities
// These clients should be manually created in Authlete service

export interface PreRegisteredClient {
  entityId: string;
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  clientName: string;
}

// Pre-registered clients mapping
export const PRE_REGISTERED_CLIENTS: PreRegisteredClient[] = [
  {
    entityId: 'https://localhost:3002',
    clientId: '2556995098', // Actual Authlete client ID
    clientSecret: 'ZLampwyr3zjKv9HhewOrgl81wgcTUE2Dk8xScZHYpMh0-aE8DhRpTI2guknlI946Wl9HutUSELPgtvWE1JzOag', // Actual client secret
    redirectUris: ['http://localhost:3002/callback'], // Updated to HTTP for testing
    clientName: 'Federation Test Client 1 (Valid)'
  },
  // Keep HTTP version for backward compatibility
  {
    entityId: 'http://localhost:3002',
    clientId: '2556995098', // Same Authlete client ID
    clientSecret: 'ZLampwyr3zjKv9HhewOrgl81wgcTUE2Dk8xScZHYpMh0-aE8DhRpTI2guknlI946Wl9HutUSELPgtvWE1JzOag', // Same client secret
    redirectUris: ['http://localhost:3002/callback'], // Keep HTTP for backward compatibility
    clientName: 'Federation Test Client 1 (Valid)'
  }
  // Add more pre-registered clients as needed
];

/**
 * Find pre-registered client by entity ID
 */
export function findPreRegisteredClient(entityId: string): PreRegisteredClient | null {
  return PRE_REGISTERED_CLIENTS.find(client => client.entityId === entityId) || null;
}

/**
 * Check if entity has a pre-registered client
 */
export function hasPreRegisteredClient(entityId: string): boolean {
  return PRE_REGISTERED_CLIENTS.some(client => client.entityId === entityId);
}