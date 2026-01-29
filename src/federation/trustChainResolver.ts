// Trust Chain Resolver for Entity Configurations
// Implements Requirements 2.1, 2.2

import { logger } from '../utils/logger';
import { 
  EntityStatement, 
  EntityConfiguration, 
  ValidationError, 
  JWKSet 
} from './types';
import { 
  TrustChainValidator 
} from './interfaces';
import { 
  JWTUtils, 
  URLUtils, 
  ValidationUtils, 
  TimeUtils 
} from './utils';
import { FEDERATION_CONSTANTS, DEFAULT_FEDERATION_CONFIG, FEDERATION_CONTENT_TYPES } from './constants';

/**
 * Trust Chain Resolver Service
 * 
 * Handles entity configuration fetching and trust chain building
 * according to OpenID Federation 1.0 specification
 */
export class TrustChainResolver implements TrustChainValidator {
  private readonly trustAnchors: Set<string>;
  private readonly httpClient: typeof fetch;
  
  constructor(trustAnchors: string[] = [...DEFAULT_FEDERATION_CONFIG.trustAnchors]) {
    this.trustAnchors = new Set(trustAnchors);
    this.httpClient = fetch;
    
    logger.logInfo(
      'TrustChainResolver initialized',
      'TrustChainResolver',
      { 
        trustAnchors: Array.from(this.trustAnchors),
        maxChainLength: FEDERATION_CONSTANTS.MAX_TRUST_CHAIN_LENGTH
      }
    );
  }

  /**
   * Validate trust chain for an entity
   * Implements Requirements 2.1, 2.2
   */
  async validateTrustChain(entityId: string, trustChain?: EntityStatement[]): Promise<ValidationResult> {
    logger.logInfo(
      'Starting trust chain validation',
      'TrustChainResolver',
      { entityId, providedChain: !!trustChain }
    );

    try {
      // Validate entity ID format
      if (!URLUtils.isValidEntityId(entityId)) {
        return this.createValidationResult(false, [
          ValidationUtils.createValidationError(
            FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST,
            `Invalid entity ID format: ${entityId}`
          )
        ]);
      }

      // Use provided trust chain or resolve it
      const resolvedChain = trustChain || await this.resolveTrustChain(entityId);
      
      if (resolvedChain.length === 0) {
        return this.createValidationResult(false, [
          ValidationUtils.createValidationError(
            FEDERATION_CONSTANTS.ERRORS.ENTITY_NOT_FOUND,
            `No trust chain found for entity: ${entityId}`
          )
        ]);
      }

      // Validate chain length
      if (resolvedChain.length > FEDERATION_CONSTANTS.MAX_TRUST_CHAIN_LENGTH) {
        return this.createValidationResult(false, [
          ValidationUtils.createValidationError(
            FEDERATION_CONSTANTS.ERRORS.TRUST_CHAIN_VALIDATION_FAILED,
            `Trust chain exceeds maximum length: ${resolvedChain.length}`
          )
        ]);
      }

      // Validate each statement in the chain
      const validationErrors: ValidationError[] = [];
      let trustAnchor: string | undefined;

      for (let i = 0; i < resolvedChain.length; i++) {
        const statement = resolvedChain[i];
        const errors = await this.validateEntityStatement(statement, i === resolvedChain.length - 1);
        validationErrors.push(...errors);

        // Check if this is a trust anchor
        if (i === resolvedChain.length - 1 && this.trustAnchors.has(statement.payload.iss)) {
          trustAnchor = statement.payload.iss;
        }
      }

      // Ensure chain terminates at a trust anchor
      if (!trustAnchor) {
        validationErrors.push(
          ValidationUtils.createValidationError(
            FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR,
            'Trust chain does not terminate at a configured trust anchor'
          )
        );
      }

      // Extract client metadata if validation successful
      let clientMetadata;
      if (validationErrors.length === 0 && trustAnchor) {
        try {
          clientMetadata = this.extractClientMetadata(resolvedChain);
        } catch (error) {
          validationErrors.push(
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
              `Failed to extract client metadata: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        }
      }

      const isValid = validationErrors.length === 0;
      
      logger.logInfo(
        'Trust chain validation completed',
        'TrustChainResolver',
        { 
          entityId, 
          isValid, 
          trustAnchor, 
          chainLength: resolvedChain.length,
          errorCount: validationErrors.length
        }
      );

      return this.createValidationResult(isValid, validationErrors, trustAnchor, clientMetadata);

    } catch (error) {
      logger.logError({
        message: 'Trust chain validation failed with exception',
        component: 'TrustChainResolver',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: { entityId }
      });

      return this.createValidationResult(false, [
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.SERVER_ERROR,
          'Trust chain validation failed due to internal error'
        )
      ]);
    }
  }

  /**
   * Resolve trust chain by fetching entity configurations
   * Implements Requirements 2.1, 2.2
   */
  async resolveTrustChain(entityId: string): Promise<EntityStatement[]> {
    logger.logInfo(
      'Resolving trust chain',
      'TrustChainResolver',
      { entityId }
    );

    // Validate entity ID format first
    if (!URLUtils.isValidEntityId(entityId)) {
      throw new Error(`Invalid entity ID format: ${entityId}`);
    }

    const chain: EntityStatement[] = [];
    const visited = new Set<string>();
    let currentEntityId = entityId;

    try {
      while (currentEntityId && !this.trustAnchors.has(currentEntityId)) {
        // Prevent infinite loops
        if (visited.has(currentEntityId)) {
          throw new Error(`Circular reference detected in trust chain: ${currentEntityId}`);
        }
        visited.add(currentEntityId);

        // Prevent excessively long chains
        if (chain.length >= FEDERATION_CONSTANTS.MAX_TRUST_CHAIN_LENGTH) {
          throw new Error(`Trust chain exceeds maximum length: ${FEDERATION_CONSTANTS.MAX_TRUST_CHAIN_LENGTH}`);
        }

        // Fetch entity configuration
        const entityConfig = await this.fetchEntityConfiguration(currentEntityId);
        if (!entityConfig) {
          throw new Error(`Failed to fetch entity configuration for: ${currentEntityId}`);
        }

        // Create entity statement from configuration
        const statement: EntityStatement = {
          jwt: entityConfig.jwt,
          payload: entityConfig.payload
        };

        chain.push(statement);

        // Move to next entity in chain (authority hint)
        const authorityHints = entityConfig.payload.authority_hints || [];
        if (authorityHints.length === 0) {
          // No authority hints - this should be a trust anchor
          if (!this.trustAnchors.has(currentEntityId)) {
            throw new Error(`Entity ${currentEntityId} has no authority hints but is not a trust anchor`);
          }
          break;
        }

        // Use first authority hint (in real implementation, might try multiple)
        currentEntityId = authorityHints[0];
      }

      // Add trust anchor if we reached one
      if (currentEntityId && this.trustAnchors.has(currentEntityId)) {
        const trustAnchorConfig = await this.fetchEntityConfiguration(currentEntityId);
        if (trustAnchorConfig) {
          chain.push({
            jwt: trustAnchorConfig.jwt,
            payload: trustAnchorConfig.payload
          });
        }
      }

      logger.logInfo(
        'Trust chain resolved',
        'TrustChainResolver',
        { 
          entityId, 
          chainLength: chain.length,
          entities: chain.map(s => s.payload.iss)
        }
      );

      return chain;

    } catch (error) {
      logger.logError({
        message: 'Failed to resolve trust chain',
        component: 'TrustChainResolver',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: { entityId, chainLength: chain.length }
      });

      throw error;
    }
  }

  /**
   * Fetch entity configuration from /.well-known/openid_federation
   * Implements Requirement 2.1
   */
  private async fetchEntityConfiguration(entityId: string): Promise<{ jwt: string; payload: EntityConfiguration } | null> {
    try {
      const configUrl = URLUtils.buildEntityConfigurationURL(entityId);
      
      logger.logInfo(
        'Fetching entity configuration',
        'TrustChainResolver',
        { entityId, configUrl }
      );

      const response = await this.httpClient(configUrl, {
        method: 'GET',
        headers: {
          'Accept': FEDERATION_CONTENT_TYPES.JWT,
          'User-Agent': 'OpenID-Federation-Client/1.0'
        },
        // Add timeout to prevent hanging requests
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (!response.ok) {
        logger.logWarn(
          'Failed to fetch entity configuration',
          'TrustChainResolver',
          { 
            entityId, 
            configUrl, 
            status: response.status, 
            statusText: response.statusText 
          }
        );
        return null;
      }

      const jwt = await response.text();
      
      // Decode JWT to get payload (signature verification happens later)
      const decoded = JWTUtils.decodeJWT(jwt);
      
      // Basic validation of entity configuration structure
      if (!decoded.payload.iss || !decoded.payload.sub) {
        logger.logWarn(
          'Invalid entity configuration structure',
          'TrustChainResolver',
          { entityId, configUrl }
        );
        return null;
      }

      // Verify self-signed (iss === sub for entity configurations)
      if (decoded.payload.iss !== decoded.payload.sub) {
        logger.logWarn(
          'Entity configuration is not self-signed',
          'TrustChainResolver',
          { 
            entityId, 
            iss: decoded.payload.iss, 
            sub: decoded.payload.sub 
          }
        );
        return null;
      }

      logger.logInfo(
        'Entity configuration fetched successfully',
        'TrustChainResolver',
        { 
          entityId, 
          iss: decoded.payload.iss,
          exp: decoded.payload.exp,
          hasJwks: !!decoded.payload.jwks,
          hasMetadata: !!decoded.payload.metadata,
          authorityHints: decoded.payload.authority_hints?.length || 0
        }
      );

      return {
        jwt,
        payload: decoded.payload as EntityConfiguration
      };

    } catch (error) {
      logger.logError({
        message: 'Error fetching entity configuration',
        component: 'TrustChainResolver',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: { entityId }
      });

      return null;
    }
  }

  /**
   * Validate individual entity statement
   * Basic validation - signature verification happens in separate component
   */
  private async validateEntityStatement(statement: EntityStatement, isTrustAnchor: boolean): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];
    const payload = statement.payload;

    // Check required fields
    if (!payload.iss) {
      errors.push(ValidationUtils.createValidationError(
        FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
        'Entity statement missing required iss claim'
      ));
    }

    if (!payload.sub) {
      errors.push(ValidationUtils.createValidationError(
        FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
        'Entity statement missing required sub claim'
      ));
    }

    if (!payload.exp) {
      errors.push(ValidationUtils.createValidationError(
        FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
        'Entity statement missing required exp claim'
      ));
    }

    // Check expiration
    if (payload.exp && TimeUtils.isExpired(payload.exp, FEDERATION_CONSTANTS.ENTITY_STATEMENT_CLOCK_SKEW)) {
      errors.push(ValidationUtils.createValidationError(
        FEDERATION_CONSTANTS.ERRORS.ENTITY_STATEMENT_EXPIRED,
        `Entity statement expired at ${TimeUtils.formatTimestamp(payload.exp)}`
      ));
    }

    // Check not before if present
    if (payload.iat && TimeUtils.isNotYetValid(payload.iat, FEDERATION_CONSTANTS.ENTITY_STATEMENT_CLOCK_SKEW)) {
      errors.push(ValidationUtils.createValidationError(
        FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
        `Entity statement not yet valid, issued at ${TimeUtils.formatTimestamp(payload.iat)}`
      ));
    }

    // Validate JWK Set if present
    if (payload.jwks) {
      const jwksErrors = ValidationUtils.validateJWKSet(payload.jwks);
      errors.push(...jwksErrors);
    }

    // Trust anchors should not have authority hints
    if (isTrustAnchor && payload.authorityHints && payload.authorityHints.length > 0) {
      errors.push(ValidationUtils.createValidationError(
        FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR,
        'Trust anchor should not have authority hints'
      ));
    }

    // Non-trust anchors should have authority hints (unless they are leaf entities)
    if (!isTrustAnchor && (!payload.authorityHints || payload.authorityHints.length === 0)) {
      // This might be a leaf entity, which is acceptable
      logger.logInfo(
        'Entity statement has no authority hints (might be leaf entity)',
        'TrustChainResolver',
        { iss: payload.iss, sub: payload.sub }
      );
    }

    return errors;
  }

  /**
   * Extract client metadata from trust chain
   * Implements Requirements 2.4, 2.5
   */
  extractClientMetadata(trustChain: EntityStatement[]): ClientMetadata {
    if (trustChain.length === 0) {
      throw new Error('Cannot extract metadata from empty trust chain');
    }

    // Start with leaf entity metadata (first in chain)
    const leafEntity = trustChain[0];
    let clientMetadata: any = {};

    // Extract OpenID Relying Party metadata from leaf entity
    if (leafEntity.payload.metadata?.openid_relying_party) {
      clientMetadata = { ...leafEntity.payload.metadata.openid_relying_party };
    }

    // Apply metadata policies from intermediate authorities and trust anchor
    for (let i = 1; i < trustChain.length; i++) {
      const authority = trustChain[i];
      
      // In a full implementation, we would apply metadata policies here
      // For now, we just log that policies would be applied
      if (authority.payload.metadata) {
        logger.logInfo(
          'Would apply metadata policy from authority',
          'TrustChainResolver',
          { 
            authority: authority.payload.iss,
            hasPolicy: !!authority.payload.metadata
          }
        );
      }
    }

    // Validate the extracted metadata
    const validationErrors = ValidationUtils.validateClientMetadata(clientMetadata);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid client metadata: ${validationErrors.map(e => e.message).join(', ')}`);
    }

    logger.logInfo(
      'Client metadata extracted successfully',
      'TrustChainResolver',
      { 
        entityId: leafEntity.payload.iss,
        hasRedirectUris: !!clientMetadata.redirect_uris,
        hasJwks: !!clientMetadata.jwks,
        hasClientName: !!clientMetadata.client_name
      }
    );

    return clientMetadata;
  }

  /**
   * Helper method to create validation result
   */
  private createValidationResult(
    isValid: boolean, 
    errors: ValidationError[] = [], 
    trustAnchor?: string, 
    clientMetadata?: ClientMetadata
  ): ValidationResult {
    const result: ValidationResult = {
      isValid,
      ...(errors.length > 0 && { errors }),
      ...(trustAnchor && { trustAnchor }),
      ...(clientMetadata && { clientMetadata })
    };
    return result;
  }

  /**
   * Get configured trust anchors
   */
  getTrustAnchors(): string[] {
    return Array.from(this.trustAnchors);
  }

  /**
   * Check if entity ID is a configured trust anchor
   */
  isTrustAnchor(entityId: string): boolean {
    return this.trustAnchors.has(entityId);
  }
}

// Export validation result interface for compatibility
export interface ValidationResult {
  isValid: boolean;
  trustAnchor?: string;
  clientMetadata?: ClientMetadata;
  errors?: ValidationError[];
}

// Export client metadata interface for compatibility  
export interface ClientMetadata {
  redirect_uris: string[];
  response_types?: string[];
  grant_types?: string[];
  application_type?: string;
  contacts?: string[];
  client_name?: string;
  logo_uri?: string;
  client_uri?: string;
  policy_uri?: string;
  tos_uri?: string;
  jwks_uri?: string;
  jwks?: JWKSet;
  sector_identifier_uri?: string;
  subject_type?: string;
  id_token_signed_response_alg?: string;
  id_token_encrypted_response_alg?: string;
  id_token_encrypted_response_enc?: string;
  userinfo_signed_response_alg?: string;
  userinfo_encrypted_response_alg?: string;
  userinfo_encrypted_response_enc?: string;
  request_object_signing_alg?: string;
  request_object_encryption_alg?: string;
  request_object_encryption_enc?: string;
  token_endpoint_auth_method?: string;
  token_endpoint_auth_signing_alg?: string;
  default_max_age?: number;
  require_auth_time?: boolean;
  default_acr_values?: string[];
  initiate_login_uri?: string;
  request_uris?: string[];
}