// Trust Anchor Validation and Metadata Extraction
// Implements Requirements 2.2, 2.4, 2.5

import { logger } from '../utils/logger';
import { 
  EntityStatement, 
  ValidationError, 
  ClientMetadata, 
  JWKSet
} from './types';
import { 
  TrustAnchorRegistry,
  FederationMetadataService
} from './interfaces';
import { 
  ValidationUtils, 
  TimeUtils 
} from './utils';
import { FEDERATION_CONSTANTS, DEFAULT_FEDERATION_CONFIG } from './constants';
import { JWTSignatureVerifier } from './jwtSignatureVerifier';

/**
 * Trust Anchor Validator Service
 * 
 * Handles trust anchor validation and metadata extraction/combination
 * according to OpenID Federation 1.0 specification
 */
export class TrustAnchorValidator implements TrustAnchorRegistry, FederationMetadataService {
  private readonly trustAnchors: Map<string, TrustAnchorInfo>;
  private readonly signatureVerifier: JWTSignatureVerifier;
  
  constructor(trustAnchors: string[] = [...DEFAULT_FEDERATION_CONFIG.trustAnchors]) {
    this.trustAnchors = new Map();
    this.signatureVerifier = new JWTSignatureVerifier();
    
    // Initialize trust anchors with default configuration
    this.initializeTrustAnchors(trustAnchors);
    
    logger.logInfo(
      'TrustAnchorValidator initialized',
      'TrustAnchorValidator',
      { 
        trustAnchorCount: this.trustAnchors.size,
        trustAnchors: Array.from(this.trustAnchors.keys())
      }
    );
  }

  /**
   * Validate trust chain termination at trust anchors
   * Implements Requirements 2.2, 2.4
   */
  async validateTrustChainTermination(trustChain: EntityStatement[]): Promise<TrustAnchorValidationResult> {
    logger.logInfo(
      'Validating trust chain termination',
      'TrustAnchorValidator',
      { chainLength: trustChain.length }
    );

    try {
      if (trustChain.length === 0) {
        return {
          isValid: false,
          errors: [
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.TRUST_CHAIN_VALIDATION_FAILED,
              'Empty trust chain cannot be validated'
            )
          ]
        };
      }

      // The last entity in the chain should be a trust anchor
      const trustAnchorStatement = trustChain[trustChain.length - 1];
      const trustAnchorId = trustAnchorStatement.payload.iss;

      // Check if this is a configured trust anchor
      if (!this.isTrustedAnchor(trustAnchorId)) {
        return {
          isValid: false,
          errors: [
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR,
              `Entity ${trustAnchorId} is not a configured trust anchor`
            )
          ]
        };
      }

      // Validate trust anchor statement structure
      const structureErrors = this.validateTrustAnchorStructure(trustAnchorStatement);
      if (structureErrors.length > 0) {
        return {
          isValid: false,
          errors: structureErrors
        };
      }

      // Verify trust anchor signature (self-signed)
      if (!trustAnchorStatement.payload.jwks) {
        return {
          isValid: false,
          errors: [
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR,
              `Trust anchor ${trustAnchorId} missing public keys`
            )
          ]
        };
      }

      const verificationResult = await this.signatureVerifier.verifyEntityStatement(
        trustAnchorStatement.jwt,
        trustAnchorStatement.payload.jwks,
        trustAnchorId
      );

      if (!verificationResult.isValid) {
        return {
          isValid: false,
          errors: verificationResult.errors || [
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR,
              `Trust anchor signature verification failed`
            )
          ]
        };
      }

      // Validate chain continuity (each entity should be authorized by the next)
      const continuityErrors = await this.validateChainContinuity(trustChain);
      if (continuityErrors.length > 0) {
        return {
          isValid: false,
          errors: continuityErrors
        };
      }

      logger.logInfo(
        'Trust chain termination validation successful',
        'TrustAnchorValidator',
        { 
          trustAnchorId,
          chainLength: trustChain.length
        }
      );

      const anchorInfo = this.trustAnchors.get(trustAnchorId);
      const result: TrustAnchorValidationResult = {
        isValid: true,
        trustAnchorId
      };
      if (anchorInfo) {
        result.trustAnchorInfo = anchorInfo;
      }
      return result;

    } catch (error) {
      logger.logError({
        message: 'Trust anchor validation failed with exception',
        component: 'TrustAnchorValidator',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: { chainLength: trustChain.length }
      });

      return {
        isValid: false,
        errors: [
          ValidationUtils.createValidationError(
            FEDERATION_CONSTANTS.ERRORS.SERVER_ERROR,
            'Trust anchor validation failed due to internal error'
          )
        ]
      };
    }
  }

  /**
   * Extract and combine client metadata from trust chain
   * Implements Requirements 2.4, 2.5
   */
  extractClientMetadata(trustChain: EntityStatement[]): ClientMetadata {
    logger.logInfo(
      'Extracting client metadata from trust chain',
      'TrustAnchorValidator',
      { chainLength: trustChain.length }
    );

    if (trustChain.length === 0) {
      throw new Error('Cannot extract metadata from empty trust chain');
    }

    try {
      // Start with leaf entity metadata (first in chain)
      const leafEntity = trustChain[0];
      let clientMetadata: Partial<ClientMetadata> = {};

      // Extract base metadata from leaf entity
      if (leafEntity.payload.metadata?.openid_relying_party) {
        clientMetadata = { ...leafEntity.payload.metadata.openid_relying_party };
      }

      // Apply metadata policies from authorities in the chain
      for (let i = 1; i < trustChain.length; i++) {
        const authority = trustChain[i];
        clientMetadata = this.applyMetadataPolicyInternal(clientMetadata, authority);
      }

      // Ensure required fields are present
      this.ensureRequiredMetadata(clientMetadata);

      // Validate the final metadata
      const validationErrors = ValidationUtils.validateClientMetadata(clientMetadata);
      if (validationErrors.length > 0) {
        throw new Error(`Invalid client metadata: ${validationErrors.map(e => e.message).join(', ')}`);
      }

      logger.logInfo(
        'Client metadata extracted successfully',
        'TrustAnchorValidator',
        { 
          leafEntityId: leafEntity.payload.iss,
          hasRedirectUris: !!clientMetadata.redirect_uris,
          redirectUriCount: clientMetadata.redirect_uris?.length || 0,
          hasJwks: !!clientMetadata.jwks,
          hasClientName: !!clientMetadata.client_name,
          responseTypes: clientMetadata.response_types?.length || 0,
          grantTypes: clientMetadata.grant_types?.length || 0
        }
      );

      return clientMetadata as ClientMetadata;

    } catch (error) {
      logger.logError({
        message: 'Failed to extract client metadata',
        component: 'TrustAnchorValidator',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: { 
          chainLength: trustChain.length,
          leafEntityId: trustChain[0]?.payload?.iss
        }
      });

      throw error;
    }
  }

  /**
   * Apply metadata policy from authority (interface implementation)
   */
  applyMetadataPolicy(metadata: ClientMetadata, policy: any): ClientMetadata {
    // Convert to partial for internal processing
    const partialMetadata: Partial<ClientMetadata> = { ...metadata };
    
    // Apply policy (simplified implementation)
    const result = this.applyMetadataPolicyInternal(partialMetadata, policy);
    
    // Ensure required fields and return as ClientMetadata
    this.ensureRequiredMetadata(result);
    return result as ClientMetadata;
  }

  /**
   * Apply metadata policy from authority (internal implementation)
   * Implements Requirement 2.5
   */
  private applyMetadataPolicyInternal(metadata: Partial<ClientMetadata>, authority: EntityStatement | any): Partial<ClientMetadata> {
    // In a full implementation, this would apply complex metadata policies
    // For now, we implement basic policy application
    
    const authorityMetadata = authority.payload?.metadata || authority.metadata;
    if (!authorityMetadata) {
      return metadata;
    }

    // Apply federation entity policies if present
    if (authorityMetadata.federation_entity) {
      logger.logInfo(
        'Applying federation entity policy',
        'TrustAnchorValidator',
        { 
          authority: authority.payload?.iss || 'unknown',
          hasPolicy: true
        }
      );
      
      // Example policy applications (would be more complex in real implementation):
      // - Restrict allowed redirect URIs
      // - Set default values for missing fields
      // - Override certain metadata values
    }

    // Apply OpenID Provider policies if present (for cross-federation scenarios)
    if (authorityMetadata.openid_provider) {
      logger.logInfo(
        'Authority has OpenID Provider metadata',
        'TrustAnchorValidator',
        { authority: authority.payload?.iss || 'unknown' }
      );
    }

    // Set default values if not present
    if (!metadata.response_types) {
      metadata.response_types = ['code'];
    }

    if (!metadata.grant_types) {
      metadata.grant_types = ['authorization_code'];
    }

    if (!metadata.application_type) {
      metadata.application_type = 'web';
    }

    if (!metadata.token_endpoint_auth_method) {
      metadata.token_endpoint_auth_method = 'client_secret_basic';
    }

    return metadata;
  }

  /**
   * Combine metadata from multiple statements
   * Implements Requirement 2.5
   */
  combineMetadata(statements: EntityStatement[]): ClientMetadata {
    return this.extractClientMetadata(statements);
  }

  /**
   * Validate trust anchor structure
   */
  private validateTrustAnchorStructure(trustAnchor: EntityStatement): ValidationError[] {
    const errors: ValidationError[] = [];
    const payload = trustAnchor.payload;

    // Trust anchor should be self-signed (iss === sub)
    if (payload.iss !== payload.sub) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR,
          `Trust anchor is not self-signed: iss=${payload.iss}, sub=${payload.sub}`
        )
      );
    }

    // Trust anchor should not have authority hints
    if (payload.authorityHints && payload.authorityHints.length > 0) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR,
          'Trust anchor should not have authority hints'
        )
      );
    }

    // Trust anchor should have public keys
    if (!payload.jwks || !payload.jwks.keys || payload.jwks.keys.length === 0) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR,
          'Trust anchor missing public keys'
        )
      );
    }

    // Check expiration
    if (payload.exp && TimeUtils.isExpired(payload.exp, FEDERATION_CONSTANTS.ENTITY_STATEMENT_CLOCK_SKEW)) {
      errors.push(
        ValidationUtils.createValidationError(
          FEDERATION_CONSTANTS.ERRORS.ENTITY_STATEMENT_EXPIRED,
          `Trust anchor statement expired at ${TimeUtils.formatTimestamp(payload.exp)}`
        )
      );
    }

    return errors;
  }

  /**
   * Validate chain continuity
   */
  private async validateChainContinuity(trustChain: EntityStatement[]): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    // Each entity (except the last) should have authority hints pointing to the next entity
    for (let i = 0; i < trustChain.length - 1; i++) {
      const currentEntity = trustChain[i];
      const nextEntity = trustChain[i + 1];

      // Check if current entity has authority hints
      if (!currentEntity.payload.authorityHints || currentEntity.payload.authorityHints.length === 0) {
        errors.push(
          ValidationUtils.createValidationError(
            FEDERATION_CONSTANTS.ERRORS.TRUST_CHAIN_VALIDATION_FAILED,
            `Entity ${currentEntity.payload.iss} missing authority hints`
          )
        );
        continue;
      }

      // Check if next entity is in authority hints
      if (!currentEntity.payload.authorityHints.includes(nextEntity.payload.iss)) {
        errors.push(
          ValidationUtils.createValidationError(
            FEDERATION_CONSTANTS.ERRORS.TRUST_CHAIN_VALIDATION_FAILED,
            `Entity ${currentEntity.payload.iss} does not list ${nextEntity.payload.iss} as authority`
          )
        );
      }

      // Verify signature of current entity using next entity's public keys
      if (nextEntity.payload.jwks) {
        try {
          const verificationResult = await this.signatureVerifier.verifyEntityStatement(
            currentEntity.jwt,
            nextEntity.payload.jwks,
            nextEntity.payload.iss
          );

          if (!verificationResult.isValid) {
            errors.push(
              ValidationUtils.createValidationError(
                FEDERATION_CONSTANTS.ERRORS.TRUST_CHAIN_VALIDATION_FAILED,
                `Failed to verify ${currentEntity.payload.iss} signature using ${nextEntity.payload.iss} keys`
              )
            );
          }
        } catch (error) {
          errors.push(
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.TRUST_CHAIN_VALIDATION_FAILED,
              `Error verifying ${currentEntity.payload.iss} signature: ${error instanceof Error ? error.message : String(error)}`
            )
          );
        }
      }
    }

    return errors;
  }

  /**
   * Ensure required metadata fields are present
   */
  private ensureRequiredMetadata(metadata: Partial<ClientMetadata>): void {
    // redirect_uris is required
    if (!metadata.redirect_uris || metadata.redirect_uris.length === 0) {
      throw new Error('Client metadata missing required redirect_uris');
    }

    // Set defaults for optional fields
    if (!metadata.response_types) {
      metadata.response_types = ['code'];
    }

    if (!metadata.grant_types) {
      metadata.grant_types = ['authorization_code'];
    }

    if (!metadata.application_type) {
      metadata.application_type = 'web';
    }

    if (!metadata.token_endpoint_auth_method) {
      metadata.token_endpoint_auth_method = 'client_secret_basic';
    }
  }

  /**
   * Initialize trust anchors with configuration
   */
  private initializeTrustAnchors(trustAnchorIds: string[]): void {
    for (const anchorId of trustAnchorIds) {
      this.trustAnchors.set(anchorId, {
        id: anchorId,
        name: `Trust Anchor ${anchorId}`,
        description: `Configured trust anchor for ${anchorId}`,
        publicKeys: this.getDefaultTrustAnchorKeys(anchorId)
      });
    }
  }

  /**
   * Get default trust anchor public keys (for development)
   */
  private getDefaultTrustAnchorKeys(anchorId: string): JWKSet {
    // In production, these would be loaded from configuration or fetched from the trust anchor
    return {
      keys: [
        {
          kty: 'RSA',
          use: 'sig',
          kid: `${anchorId}-key-1`,
          alg: 'RS256',
          n: 'trust-anchor-modulus-example',
          e: 'AQAB'
        }
      ]
    };
  }

  // TrustAnchorRegistry interface implementation
  async getTrustAnchors(): Promise<string[]> {
    return Array.from(this.trustAnchors.keys());
  }

  async isTrustedAnchor(anchorId: string): Promise<boolean> {
    return this.trustAnchors.has(anchorId);
  }

  async getTrustAnchorPublicKeys(anchorId: string): Promise<JWKSet> {
    const anchorInfo = this.trustAnchors.get(anchorId);
    if (!anchorInfo) {
      throw new Error(`Trust anchor not found: ${anchorId}`);
    }
    return anchorInfo.publicKeys;
  }

  /**
   * Extract metadata from entity statement (interface implementation)
   */
  extractMetadata(entityStatement: EntityStatement): ClientMetadata {
    return this.extractClientMetadata([entityStatement]);
  }

  // Synchronous versions for compatibility
  isTrustedAnchorSync(anchorId: string): boolean {
    return this.trustAnchors.has(anchorId);
  }

  getTrustAnchorInfo(anchorId: string): TrustAnchorInfo | undefined {
    return this.trustAnchors.get(anchorId);
  }

  getTrustAnchorsSync(): string[] {
    return Array.from(this.trustAnchors.keys());
  }
}

/**
 * Trust Anchor Validation Result
 */
export interface TrustAnchorValidationResult {
  isValid: boolean;
  trustAnchorId?: string;
  trustAnchorInfo?: TrustAnchorInfo;
  errors?: ValidationError[];
}

/**
 * Trust Anchor Information
 */
export interface TrustAnchorInfo {
  id: string;
  name: string;
  description: string;
  publicKeys: JWKSet;
}