// Integrated Trust Chain Validation Service
// Combines trust chain resolution, JWT verification, and trust anchor validation
// Implements Requirements 2.1, 2.2, 2.3, 2.4, 2.5

import { logger } from '../utils/logger';
import { 
  EntityStatement, 
  ValidationError, 
  ClientMetadata 
} from './types';
import { 
  TrustChainValidator 
} from './interfaces';
import { TrustChainResolver, ValidationResult } from './trustChainResolver';
import { JWTSignatureVerifier } from './jwtSignatureVerifier';
import { TrustAnchorValidator } from './trustAnchorValidator';
import { ValidationUtils } from './utils';
import { URLUtils } from './utils';
import { FEDERATION_CONSTANTS } from './constants';

/**
 * Integrated Trust Chain Validation Service
 * 
 * Orchestrates the complete trust chain validation process:
 * 1. Resolve trust chain from entity configurations
 * 2. Verify JWT signatures for all entity statements
 * 3. Validate trust anchor termination
 * 4. Extract and combine client metadata
 */
export class IntegratedTrustChainValidator implements TrustChainValidator {
  private readonly resolver: TrustChainResolver;
  private readonly signatureVerifier: JWTSignatureVerifier;
  private readonly trustAnchorValidator: TrustAnchorValidator;

  constructor(trustAnchors?: string[]) {
    this.resolver = new TrustChainResolver(trustAnchors);
    this.signatureVerifier = new JWTSignatureVerifier();
    this.trustAnchorValidator = new TrustAnchorValidator(trustAnchors);

    logger.logInfo(
      'IntegratedTrustChainValidator initialized',
      'IntegratedTrustChainValidator',
      { 
        trustAnchors: this.trustAnchorValidator.getTrustAnchors()
      }
    );
  }

  /**
   * Complete trust chain validation
   * Implements Requirements 2.1, 2.2, 2.3, 2.4, 2.5
   */
  async validateTrustChain(entityId: string, trustChain?: EntityStatement[]): Promise<ValidationResult> {
    logger.logInfo(
      'Starting integrated trust chain validation',
      'IntegratedTrustChainValidator',
      { 
        entityId, 
        providedChain: !!trustChain 
      }
    );

    try {
      // Step 0: Validate entity ID format
      if (!URLUtils.isValidEntityId(entityId)) {
        return {
          isValid: false,
          errors: [
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.INVALID_REQUEST,
              `Invalid entity ID format: ${entityId}`
            )
          ]
        };
      }

      // Step 1: Resolve trust chain if not provided
      let resolvedChain: EntityStatement[];
      if (trustChain) {
        resolvedChain = trustChain;
        
        // Check for empty provided trust chain
        if (resolvedChain.length === 0) {
          return {
            isValid: false,
            errors: [
              ValidationUtils.createValidationError(
                FEDERATION_CONSTANTS.ERRORS.ENTITY_NOT_FOUND,
                `Empty trust chain provided for entity: ${entityId}`
              )
            ]
          };
        }
        
        logger.logInfo(
          'Using provided trust chain',
          'IntegratedTrustChainValidator',
          { entityId, chainLength: resolvedChain.length }
        );
      } else {
        logger.logInfo(
          'Resolving trust chain from entity configurations',
          'IntegratedTrustChainValidator',
          { entityId }
        );
        
        resolvedChain = await this.resolver.resolveTrustChain(entityId);
        
        if (resolvedChain.length === 0) {
          return {
            isValid: false,
            errors: [
              ValidationUtils.createValidationError(
                FEDERATION_CONSTANTS.ERRORS.ENTITY_NOT_FOUND,
                `No trust chain could be resolved for entity: ${entityId}`
              )
            ]
          };
        }
      }

      // Step 1.5: Validate trust chain length
      if (resolvedChain.length > FEDERATION_CONSTANTS.MAX_TRUST_CHAIN_LENGTH) {
        return {
          isValid: false,
          errors: [
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.TRUST_CHAIN_VALIDATION_FAILED,
              `Trust chain exceeds maximum length: ${resolvedChain.length}`
            )
          ]
        };
      }

      // Step 2: Verify JWT signatures for all statements
      logger.logInfo(
        'Verifying JWT signatures in trust chain',
        'IntegratedTrustChainValidator',
        { entityId, chainLength: resolvedChain.length }
      );

      const signatureVerificationResult = await this.signatureVerifier.verifyTrustChain(resolvedChain);
      if (!signatureVerificationResult.isValid) {
        return {
          isValid: false,
          errors: signatureVerificationResult.errors || [
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.TRUST_CHAIN_VALIDATION_FAILED,
              'JWT signature verification failed'
            )
          ]
        };
      }

      // Step 3: Validate trust anchor termination
      logger.logInfo(
        'Validating trust anchor termination',
        'IntegratedTrustChainValidator',
        { entityId }
      );

      const trustAnchorValidationResult = await this.trustAnchorValidator.validateTrustChainTermination(resolvedChain);
      if (!trustAnchorValidationResult.isValid) {
        return {
          isValid: false,
          errors: trustAnchorValidationResult.errors || [
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.INVALID_TRUST_ANCHOR,
              'Trust anchor validation failed'
            )
          ]
        };
      }

      // Step 4: Extract and validate client metadata
      logger.logInfo(
        'Extracting client metadata from trust chain',
        'IntegratedTrustChainValidator',
        { entityId }
      );

      let clientMetadata: ClientMetadata;
      try {
        clientMetadata = this.trustAnchorValidator.extractClientMetadata(resolvedChain);
      } catch (error) {
        return {
          isValid: false,
          errors: [
            ValidationUtils.createValidationError(
              FEDERATION_CONSTANTS.ERRORS.INVALID_CLIENT_METADATA,
              `Failed to extract client metadata: ${error instanceof Error ? error.message : String(error)}`
            )
          ]
        };
      }

      // Success - all validation steps passed
      logger.logInfo(
        'Integrated trust chain validation successful',
        'IntegratedTrustChainValidator',
        { 
          entityId,
          trustAnchor: trustAnchorValidationResult.trustAnchorId,
          chainLength: resolvedChain.length,
          clientName: clientMetadata.client_name,
          redirectUriCount: clientMetadata.redirect_uris.length
        }
      );

      return {
        isValid: true,
        trustAnchor: trustAnchorValidationResult.trustAnchorId!,
        clientMetadata
      };

    } catch (error) {
      logger.logError({
        message: 'Integrated trust chain validation failed with exception',
        component: 'IntegratedTrustChainValidator',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack })
        },
        context: { entityId }
      });

      return {
        isValid: false,
        errors: [
          ValidationUtils.createValidationError(
            FEDERATION_CONSTANTS.ERRORS.SERVER_ERROR,
            'Trust chain validation failed due to internal error'
          )
        ]
      };
    }
  }

  /**
   * Resolve trust chain (delegates to resolver)
   */
  async resolveTrustChain(entityId: string): Promise<EntityStatement[]> {
    return this.resolver.resolveTrustChain(entityId);
  }

  /**
   * Extract client metadata (delegates to trust anchor validator)
   */
  extractClientMetadata(trustChain: EntityStatement[]): ClientMetadata {
    return this.trustAnchorValidator.extractClientMetadata(trustChain);
  }

  /**
   * Validate individual entity statement with signature verification
   */
  async validateEntityStatement(statement: EntityStatement, publicKeys?: any): Promise<boolean> {
    try {
      if (!publicKeys && statement.payload.jwks) {
        // Self-signed statement
        const result = await this.signatureVerifier.verifyEntityStatement(
          statement.jwt,
          statement.payload.jwks,
          statement.payload.iss
        );
        return result.isValid;
      } else if (publicKeys) {
        // Statement signed by authority
        const result = await this.signatureVerifier.verifyEntityStatement(
          statement.jwt,
          publicKeys
        );
        return result.isValid;
      }
      return false;
    } catch (error) {
      logger.logError({
        message: 'Entity statement validation failed',
        component: 'IntegratedTrustChainValidator',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error)
        },
        context: { 
          iss: statement.payload.iss,
          sub: statement.payload.sub
        }
      });
      return false;
    }
  }

  /**
   * Check if entity is a trust anchor
   */
  isTrustAnchor(entityId: string): boolean {
    return this.trustAnchorValidator.isTrustedAnchorSync(entityId);
  }

  /**
   * Get configured trust anchors
   */
  getTrustAnchors(): string[] {
    // Call the synchronous version directly
    return this.trustAnchorValidator.getTrustAnchorsSync();
  }

  /**
   * Get trust anchor information
   */
  getTrustAnchorInfo(anchorId: string) {
    return this.trustAnchorValidator.getTrustAnchorInfo(anchorId);
  }

  /**
   * Validate trust chain with detailed results
   */
  async validateTrustChainDetailed(entityId: string, trustChain?: EntityStatement[]): Promise<DetailedValidationResult> {
    const startTime = Date.now();
    
    try {
      const result = await this.validateTrustChain(entityId, trustChain);
      const duration = Date.now() - startTime;

      return {
        ...result,
        validationSteps: {
          chainResolution: { completed: true, duration: 0 },
          signatureVerification: { completed: true, duration: 0 },
          trustAnchorValidation: { completed: true, duration: 0 },
          metadataExtraction: { completed: true, duration: 0 }
        },
        totalDuration: duration,
        chainLength: trustChain?.length || 0
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      return {
        isValid: false,
        errors: [
          ValidationUtils.createValidationError(
            FEDERATION_CONSTANTS.ERRORS.SERVER_ERROR,
            `Validation failed: ${error instanceof Error ? error.message : String(error)}`
          )
        ],
        validationSteps: {
          chainResolution: { completed: false, duration: 0 },
          signatureVerification: { completed: false, duration: 0 },
          trustAnchorValidation: { completed: false, duration: 0 },
          metadataExtraction: { completed: false, duration: 0 }
        },
        totalDuration: duration,
        chainLength: 0
      };
    }
  }
}

/**
 * Detailed Validation Result with step-by-step information
 */
export interface DetailedValidationResult extends ValidationResult {
  validationSteps: {
    chainResolution: ValidationStep;
    signatureVerification: ValidationStep;
    trustAnchorValidation: ValidationStep;
    metadataExtraction: ValidationStep;
  };
  totalDuration: number;
  chainLength: number;
}

/**
 * Individual validation step result
 */
export interface ValidationStep {
  completed: boolean;
  duration: number;
  errors?: ValidationError[];
}