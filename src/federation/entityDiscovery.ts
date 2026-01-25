import { logger } from '../utils/logger';
import axios from 'axios';

export interface EntityConfiguration {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  jwks: {
    keys: any[];
  };
  metadata?: {
    openid_relying_party?: {
      client_name?: string;
      redirect_uris: string[];
      response_types?: string[];
      grant_types?: string[];
      application_type?: string;
      subject_type?: string;
      id_token_signed_response_alg?: string;
      token_endpoint_auth_method?: string;
      scope?: string;
      client_uri?: string;
      contacts?: string[];
      tos_uri?: string;
      policy_uri?: string;
      jwks_uri?: string;
      jwks?: {
        keys: any[];
      };
    };
  };
  authority_hints?: string[];
  trust_anchor_id?: string;
}

export interface EntityDiscoveryResult {
  success: boolean;
  entityConfiguration?: EntityConfiguration;
  error?: string;
  errorDescription?: string;
}

export class EntityDiscoveryService {
  /**
   * Discover Federation Entity Configuration
   * For localhost, converts HTTPS to HTTP for actual fetch
   */
  async discoverEntityConfiguration(entityId: string): Promise<EntityDiscoveryResult> {
    try {
      logger.logInfo(
        'Starting Federation Entity Discovery',
        'EntityDiscoveryService',
        { entityId }
      );

      // Validate entity identifier format
      if (!entityId.startsWith('https://')) {
        return {
          success: false,
          error: 'invalid_entity_id',
          errorDescription: 'Entity identifier must use HTTPS scheme'
        };
      }

      // Build discovery URL
      const discoveryUrl = this.buildDiscoveryUrl(entityId);
      
      logger.logInfo(
        'Fetching Entity Configuration',
        'EntityDiscoveryService',
        { 
          entityId,
          discoveryUrl,
          isLocalhost: this.isLocalhost(entityId)
        }
      );

      // Fetch Entity Configuration
      const response = await axios.get(discoveryUrl, {
        headers: {
          'Accept': 'application/entity-statement+jwt, application/jwt, */*'
        },
        timeout: 10000, // 10 second timeout
        validateStatus: (status) => status === 200
      });

      logger.logInfo(
        'Entity Configuration fetched successfully',
        'EntityDiscoveryService',
        {
          entityId,
          discoveryUrl,
          responseStatus: response.status,
          responseSize: response.data?.length || 0,
          contentType: response.headers['content-type']
        }
      );

      // Parse Entity Configuration (JWT)
      const entityStatement = response.data;
      const entityConfiguration = this.parseEntityStatement(entityStatement);

      if (!entityConfiguration) {
        return {
          success: false,
          error: 'invalid_entity_statement',
          errorDescription: 'Failed to parse Entity Configuration'
        };
      }

      // Validate Entity Configuration
      const validationResult = this.validateEntityConfiguration(entityConfiguration, entityId);
      if (!validationResult.success) {
        return validationResult;
      }

      logger.logInfo(
        'Entity Configuration discovered successfully',
        'EntityDiscoveryService',
        {
          entityId,
          issuer: entityConfiguration.iss,
          hasMetadata: !!entityConfiguration.metadata,
          hasRelyingPartyMetadata: !!entityConfiguration.metadata?.openid_relying_party
        }
      );

      return {
        success: true,
        entityConfiguration
      };

    } catch (error) {
      logger.logError({
        message: 'Federation Entity Discovery failed',
        component: 'EntityDiscoveryService',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack && { stack: error.stack }),
          ...(axios.isAxiosError(error) && {
            status: error.response?.status,
            statusText: error.response?.statusText,
            url: error.config?.url
          })
        },
        context: { entityId }
      });

      return {
        success: false,
        error: 'discovery_failed',
        errorDescription: `Failed to discover Entity Configuration: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Build discovery URL for Entity Configuration
   * For localhost, converts HTTPS to HTTP
   */
  private buildDiscoveryUrl(entityId: string): string {
    let baseUrl = entityId;
    
    // For localhost, convert HTTPS to HTTP for actual fetch
    if (this.isLocalhost(entityId)) {
      baseUrl = entityId.replace('https://', 'http://');
      logger.logInfo(
        'Converting localhost HTTPS to HTTP for discovery',
        'EntityDiscoveryService',
        { 
          originalEntityId: entityId,
          fetchUrl: baseUrl
        }
      );
    }

    // Ensure no trailing slash
    baseUrl = baseUrl.replace(/\/$/, '');
    
    return `${baseUrl}/.well-known/openid-federation`;
  }

  /**
   * Check if entity identifier is localhost
   */
  private isLocalhost(entityId: string): boolean {
    try {
      const url = new URL(entityId);
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }

  /**
   * Parse Entity Statement JWT (simplified for development)
   * In production, this would verify JWT signature
   */
  private parseEntityStatement(entityStatement: string): EntityConfiguration | null {
    try {
      // For development, we assume the entity statement is a JWT
      // In production, this would verify the JWT signature
      
      if (typeof entityStatement !== 'string') {
        return null;
      }

      // Check if it's a JWT format
      const parts = entityStatement.split('.');
      if (parts.length === 3) {
        // Decode JWT payload
        const payload = this.decodeBase64Url(parts[1]);
        return JSON.parse(payload);
      }

      // If not JWT, try to parse as JSON (for development)
      return JSON.parse(entityStatement);

    } catch (error) {
      logger.logWarn(
        'Failed to parse Entity Statement',
        'EntityDiscoveryService',
        {
          error: error instanceof Error ? error.message : String(error),
          entityStatementPrefix: typeof entityStatement === 'string' ? entityStatement.substring(0, 100) : 'not-string'
        }
      );
      return null;
    }
  }

  /**
   * Validate Entity Configuration
   */
  private validateEntityConfiguration(config: EntityConfiguration, expectedEntityId: string): EntityDiscoveryResult {
    // Validate required claims
    if (!config.iss) {
      return {
        success: false,
        error: 'invalid_entity_configuration',
        errorDescription: 'Entity Configuration must contain iss claim'
      };
    }

    if (!config.sub) {
      return {
        success: false,
        error: 'invalid_entity_configuration',
        errorDescription: 'Entity Configuration must contain sub claim'
      };
    }

    if (!config.jwks || !config.jwks.keys || !Array.isArray(config.jwks.keys)) {
      return {
        success: false,
        error: 'invalid_entity_configuration',
        errorDescription: 'Entity Configuration must contain valid jwks'
      };
    }

    // Validate that iss and sub match the entity identifier
    if (config.iss !== expectedEntityId || config.sub !== expectedEntityId) {
      return {
        success: false,
        error: 'invalid_entity_configuration',
        errorDescription: 'Entity Configuration iss and sub must match entity identifier'
      };
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (config.exp && config.exp <= now) {
      return {
        success: false,
        error: 'expired_entity_configuration',
        errorDescription: 'Entity Configuration has expired'
      };
    }

    // Check not before (if present)
    if (config.iat && config.iat > now + 300) { // Allow 5 minutes clock skew
      return {
        success: false,
        error: 'invalid_entity_configuration',
        errorDescription: 'Entity Configuration is not yet valid'
      };
    }

    return { success: true };
  }

  /**
   * Decode Base64URL
   */
  private decodeBase64Url(str: string): string {
    // Add padding if needed
    const padding = '='.repeat((4 - (str.length % 4)) % 4);
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + padding;
    
    return Buffer.from(base64, 'base64').toString('utf-8');
  }

  /**
   * Extract client metadata from Entity Configuration
   */
  extractClientMetadata(entityConfiguration: EntityConfiguration): any {
    const relyingPartyMetadata = entityConfiguration.metadata?.openid_relying_party;
    
    if (!relyingPartyMetadata) {
      return null;
    }

    return {
      client_name: relyingPartyMetadata.client_name,
      redirect_uris: relyingPartyMetadata.redirect_uris || [],
      response_types: relyingPartyMetadata.response_types || ['code'],
      grant_types: relyingPartyMetadata.grant_types || ['authorization_code', 'refresh_token'],
      application_type: relyingPartyMetadata.application_type || 'web',
      subject_type: relyingPartyMetadata.subject_type || 'public',
      id_token_signed_response_alg: relyingPartyMetadata.id_token_signed_response_alg || 'RS256',
      token_endpoint_auth_method: relyingPartyMetadata.token_endpoint_auth_method || 'client_secret_basic',
      client_uri: relyingPartyMetadata.client_uri,
      contacts: relyingPartyMetadata.contacts,
      tos_uri: relyingPartyMetadata.tos_uri,
      policy_uri: relyingPartyMetadata.policy_uri,
      jwks_uri: relyingPartyMetadata.jwks_uri,
      jwks: relyingPartyMetadata.jwks
    };
  }
}