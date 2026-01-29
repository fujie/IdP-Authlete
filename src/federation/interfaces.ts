// Core Federation Interfaces from Design Document

import { 
  EntityStatement, 
  ValidationResult, 
  ClientMetadata, 
  RequestObjectValidation, 
  RegistrationParameters,
  FederationRegistrationRequest,
  FederationRegistrationResponse,
  JWKSet
} from './types';
import { 
  AuthleteFederationRegistrationRequest, 
  AuthleteFederationRegistrationResponse 
} from '../authlete/types';

/**
 * Federation Registration Endpoint Interface
 * 
 * Purpose: Handles dynamic client registration requests from federated entities
 */
export interface FederationRegistrationEndpoint {
  // POST /federation/registration
  registerClient(request: FederationRegistrationRequest): Promise<FederationRegistrationResponse>;
}

/**
 * Trust Chain Validator Interface
 * 
 * Purpose: Validates federation trust chains against configured trust anchors
 */
export interface TrustChainValidator {
  validateTrustChain(entityId: string, trustChain?: EntityStatement[]): Promise<ValidationResult>;
  resolveTrustChain(entityId: string): Promise<EntityStatement[]>;
  extractClientMetadata(trustChain: EntityStatement[]): ClientMetadata;
}

/**
 * Federation Request Object Handler Interface
 * 
 * Purpose: Processes signed federation request objects
 */
export interface FederationRequestObjectHandler {
  validateRequestObject(requestObject: string, clientJwks: JWKSet): Promise<RequestObjectValidation>;
  extractRegistrationParameters(requestObject: string): RegistrationParameters;
}

/**
 * Authlete Integration Service Interface
 * 
 * Purpose: Interfaces with Authlete federation APIs
 */
export interface AuthleteIntegrationService {
  registerFederatedClient(request: AuthleteFederationRegistrationRequest): Promise<AuthleteFederationRegistrationResponse>;
  getEntityConfiguration(): Promise<string>;
}

/**
 * Entity Configuration Service Interface
 * 
 * Purpose: Manages entity configuration publishing and retrieval
 */
export interface EntityConfigurationService {
  getEntityConfiguration(): Promise<string>;
  publishEntityConfiguration(configuration: string): Promise<void>;
  validateEntityConfiguration(configuration: string): Promise<boolean>;
}

/**
 * Trust Anchor Registry Interface
 * 
 * Purpose: Manages trust anchor configurations and validation
 */
export interface TrustAnchorRegistry {
  getTrustAnchors(): Promise<string[]>;
  isTrustedAnchor(anchorId: string): Promise<boolean>;
  getTrustAnchorPublicKeys(anchorId: string): Promise<JWKSet>;
}

/**
 * Federation Metadata Service Interface
 * 
 * Purpose: Handles federation metadata extraction and policy application
 */
export interface FederationMetadataService {
  extractMetadata(entityStatement: EntityStatement): ClientMetadata;
  applyMetadataPolicy(metadata: ClientMetadata, policy: any): ClientMetadata;
  combineMetadata(statements: EntityStatement[]): ClientMetadata;
}

/**
 * Federation Error Handler Interface
 * 
 * Purpose: Standardizes error handling across federation components
 */
export interface FederationErrorHandler {
  handleTrustChainError(error: Error, entityId: string): FederationError;
  handleRegistrationError(error: Error, request: FederationRegistrationRequest): FederationError;
  handleRequestObjectError(error: Error, requestObject: string): FederationError;
}

/**
 * Federation Error Type
 */
export interface FederationError {
  error: string;
  error_description: string;
  error_uri?: string;
  statusCode: number;
}

/**
 * Federation Configuration Interface
 * 
 * Purpose: Manages federation-specific configuration settings
 */
export interface FederationConfig {
  trustAnchors: string[];
  entityId: string;
  privateKey: string;
  publicKeys: JWKSet;
  federationEndpoints: {
    registration: string;
    entityConfiguration: string;
  };
  security: {
    maxTrustChainLength: number;
    trustChainCacheTtl: number;
    requestObjectMaxAge: number;
  };
}

/**
 * Federation Cache Interface
 * 
 * Purpose: Caches trust chains and entity configurations for performance
 */
export interface FederationCache {
  getTrustChain(entityId: string): Promise<EntityStatement[] | null>;
  setTrustChain(entityId: string, trustChain: EntityStatement[], ttl: number): Promise<void>;
  getEntityConfiguration(entityId: string): Promise<string | null>;
  setEntityConfiguration(entityId: string, configuration: string, ttl: number): Promise<void>;
  invalidate(entityId: string): Promise<void>;
}

/**
 * Federation Metrics Interface
 * 
 * Purpose: Tracks federation operation metrics and performance
 */
export interface FederationMetrics {
  recordRegistrationAttempt(entityId: string, success: boolean): void;
  recordTrustChainValidation(entityId: string, duration: number, success: boolean): void;
  recordRequestObjectProcessing(duration: number, success: boolean): void;
  getMetrics(): FederationMetricsData;
}

export interface FederationMetricsData {
  registrations: {
    total: number;
    successful: number;
    failed: number;
  };
  trustChainValidations: {
    total: number;
    successful: number;
    failed: number;
    averageDuration: number;
  };
  requestObjectProcessing: {
    total: number;
    successful: number;
    failed: number;
    averageDuration: number;
  };
}