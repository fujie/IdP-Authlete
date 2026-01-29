// Federation module exports

// Core types
export * from './types';

// Core interfaces
export * from './interfaces';

// Constants and configuration
export * from './constants';

// Utility functions
export * from './utils';

// Existing implementations
export { DynamicRegistrationService, DynamicRegistrationRequest, DynamicRegistrationResponse, DynamicRegistrationError } from './dynamicRegistration';
export { TrustChainService, initializeMockTrustChains } from './trustChain';
export { RequestObjectProcessor } from './requestObject';
export { EntityDiscoveryService } from './entityDiscovery';
export * from './metadata';
export * from './preRegisteredClients';

// New trust chain validation components
export { TrustChainResolver, ValidationResult, ClientMetadata } from './trustChainResolver';
export { JWTSignatureVerifier, EntityStatementVerificationResult, TrustChainVerificationResult } from './jwtSignatureVerifier';
export { TrustAnchorValidator, TrustAnchorValidationResult, TrustAnchorInfo } from './trustAnchorValidator';
export { IntegratedTrustChainValidator, DetailedValidationResult, ValidationStep } from './integratedTrustChainValidator';

// Federation request object handler
export { FederationRequestObjectHandler } from './federationRequestObjectHandler';

// Authlete integration service
export { 
  AuthleteIntegrationServiceImpl, 
  FederationRegistrationError, 
  ProcessedRegistrationResponse 
} from './authleteIntegrationService';