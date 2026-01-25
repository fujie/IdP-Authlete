import { logger } from '../utils/logger';
import { TrustChain } from './types';

// Trust Anchor configuration
const TRUST_ANCHOR_ID = 'https://trust-anchor.example.com';
const TRUST_ANCHOR_JWKS = {
  keys: [
    {
      kty: 'RSA',
      use: 'sig',
      kid: 'trust-anchor-key-1',
      alg: 'RS256',
      n: 'trust-anchor-modulus-example',
      e: 'AQAB'
    }
  ]
};

// Mock Trust Chain data for testing
const MOCK_TRUST_CHAINS = new Map<string, TrustChain>();

// Initialize mock trust chains
export function initializeMockTrustChains() {
  // OP Trust Chain (always valid)
  MOCK_TRUST_CHAINS.set('http://localhost:3001', {
    chain: [
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.op-entity-statement',
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.trust-anchor-statement'
    ],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
    sub: 'http://localhost:3001',
    trust_anchor_id: TRUST_ANCHOR_ID
  });

  // Valid Client Trust Chain (client-1) - HTTPS entity identifier
  MOCK_TRUST_CHAINS.set('https://localhost:3002', {
    chain: [
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.client1-entity-statement',
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.trust-anchor-statement'
    ],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60),
    sub: 'https://localhost:3002',
    trust_anchor_id: TRUST_ANCHOR_ID
  });

  // Keep the old HTTP port 3002 for backward compatibility
  MOCK_TRUST_CHAINS.set('http://localhost:3002', {
    chain: [
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.client1-entity-statement',
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.trust-anchor-statement'
    ],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60),
    sub: 'http://localhost:3002',
    trust_anchor_id: TRUST_ANCHOR_ID
  });

  // Keep the old port 3003 for backward compatibility
  MOCK_TRUST_CHAINS.set('http://localhost:3003', {
    chain: [
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.client1-entity-statement',
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.trust-anchor-statement'
    ],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60),
    sub: 'http://localhost:3003',
    trust_anchor_id: TRUST_ANCHOR_ID
  });

  // Invalid Client Trust Chain (client-2) - not registered
  // Neither https://localhost:3004 nor http://localhost:3004 are registered - intentionally omitted

  logger.logInfo(
    'Mock Trust Chains initialized',
    'TrustChainService',
    {
      trustAnchor: TRUST_ANCHOR_ID,
      validEntities: Array.from(MOCK_TRUST_CHAINS.keys())
    }
  );
}

export interface TrustChainValidationResult {
  isValid: boolean;
  trustAnchor?: string;
  entityId: string;
  chain?: string[];
  error?: string;
}

export class TrustChainService {
  constructor() {
    initializeMockTrustChains();
  }

  /**
   * Validate Trust Chain for an entity
   */
  async validateTrustChain(entityId: string): Promise<TrustChainValidationResult> {
    logger.logInfo(
      'Validating Trust Chain',
      'TrustChainService',
      { entityId }
    );

    try {
      // Check if we have a trust chain for this entity
      const trustChain = MOCK_TRUST_CHAINS.get(entityId);
      
      if (!trustChain) {
        logger.logWarn(
          'No Trust Chain found for entity',
          'TrustChainService',
          { entityId }
        );
        
        return {
          isValid: false,
          entityId,
          error: 'No Trust Chain found'
        };
      }

      // Check if trust chain is expired
      const now = Math.floor(Date.now() / 1000);
      if (trustChain.exp < now) {
        logger.logWarn(
          'Trust Chain expired',
          'TrustChainService',
          { entityId, exp: trustChain.exp, now }
        );
        
        return {
          isValid: false,
          entityId,
          error: 'Trust Chain expired'
        };
      }

      // Validate trust anchor
      if (trustChain.trust_anchor_id !== TRUST_ANCHOR_ID) {
        logger.logWarn(
          'Invalid Trust Anchor',
          'TrustChainService',
          { 
            entityId, 
            expected: TRUST_ANCHOR_ID, 
            actual: trustChain.trust_anchor_id 
          }
        );
        
        return {
          isValid: false,
          entityId,
          error: 'Invalid Trust Anchor'
        };
      }

      // In a real implementation, we would:
      // 1. Fetch and verify each JWT in the chain
      // 2. Validate signatures using the trust anchor's public key
      // 3. Check policy compliance
      // For this demo, we simulate successful validation

      logger.logInfo(
        'Trust Chain validation successful',
        'TrustChainService',
        { 
          entityId, 
          trustAnchor: trustChain.trust_anchor_id,
          chainLength: trustChain.chain.length
        }
      );

      return {
        isValid: true,
        entityId,
        trustAnchor: trustChain.trust_anchor_id,
        chain: trustChain.chain
      };

    } catch (error) {
      logger.logError({
        message: 'Trust Chain validation error',
        component: 'TrustChainService',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: { entityId }
      });

      return {
        isValid: false,
        entityId,
        error: 'Trust Chain validation failed'
      };
    }
  }

  /**
   * Get Trust Anchor information
   */
  getTrustAnchorInfo() {
    return {
      id: TRUST_ANCHOR_ID,
      jwks: TRUST_ANCHOR_JWKS
    };
  }

  /**
   * Check if entity is in federation
   */
  isEntityInFederation(entityId: string): boolean {
    return MOCK_TRUST_CHAINS.has(entityId);
  }

  /**
   * Get all entities in federation (for testing)
   */
  getFederationEntities(): string[] {
    return Array.from(MOCK_TRUST_CHAINS.keys());
  }
}