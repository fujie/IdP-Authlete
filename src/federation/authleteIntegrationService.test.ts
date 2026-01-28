import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthleteIntegrationServiceImpl, FederationRegistrationError } from './authleteIntegrationService';
import { AuthleteClient, AuthleteApiError } from '../authlete/client';
import { 
  AuthleteFederationRegistrationRequest, 
  AuthleteFederationRegistrationResponse,
  AuthleteFederationConfigurationResponse
} from '../authlete/types';

// Mock the logger
vi.mock('../utils/logger', () => ({
  logger: {
    logInfo: vi.fn(),
    logDebug: vi.fn(),
    logError: vi.fn()
  }
}));

describe('AuthleteIntegrationService', () => {
  let service: AuthleteIntegrationServiceImpl;
  let mockAuthleteClient: AuthleteClient;

  beforeEach(() => {
    // Create mock Authlete client
    mockAuthleteClient = {
      federationRegistration: vi.fn(),
      federationConfiguration: vi.fn()
    } as any;

    service = new AuthleteIntegrationServiceImpl(mockAuthleteClient);
  });

  describe('registerFederatedClient', () => {
    it('should successfully register a federated client', async () => {
      // Arrange
      const request: AuthleteFederationRegistrationRequest = {
        redirect_uris: ['https://client.example.com/callback'],
        client_name: 'Test Federation Client',
        entityConfiguration: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...',
        trustChain: ['eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...'],
        trustAnchorId: 'https://trust-anchor.example.com'
      };

      const expectedResponse: AuthleteFederationRegistrationResponse = {
        action: 'CREATED',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        client_id_issued_at: Date.now(),
        redirect_uris: request.redirect_uris,
        client_name: request.client_name,
        entityStatement: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...',
        trustAnchorId: request.trustAnchorId
      };

      vi.mocked(mockAuthleteClient.federationRegistration).mockResolvedValue(expectedResponse);

      // Act
      const result = await service.registerFederatedClient(request);

      // Assert
      expect(result).toEqual(expectedResponse);
      expect(mockAuthleteClient.federationRegistration).toHaveBeenCalledWith(request);
    });

    it('should handle registration errors', async () => {
      // Arrange
      const request: AuthleteFederationRegistrationRequest = {
        redirect_uris: ['https://client.example.com/callback'],
        client_name: 'Test Federation Client'
      };

      const error = new Error('Authlete API error');
      vi.mocked(mockAuthleteClient.federationRegistration).mockRejectedValue(error);

      // Act & Assert
      await expect(service.registerFederatedClient(request)).rejects.toThrow(FederationRegistrationError);
      expect(mockAuthleteClient.federationRegistration).toHaveBeenCalledWith(request);
    });

    it('should handle Authlete API errors with proper error mapping', async () => {
      // Arrange
      const request: AuthleteFederationRegistrationRequest = {
        redirect_uris: ['https://client.example.com/callback'],
        client_name: 'Test Federation Client'
      };

      const authleteError = new AuthleteApiError(
        400,
        { resultMessage: 'Invalid trust chain' },
        'Bad request'
      );
      vi.mocked(mockAuthleteClient.federationRegistration).mockRejectedValue(authleteError);

      // Act & Assert
      await expect(service.registerFederatedClient(request)).rejects.toThrow(FederationRegistrationError);
      
      try {
        await service.registerFederatedClient(request);
      } catch (error) {
        expect(error).toBeInstanceOf(FederationRegistrationError);
        const fedError = error as FederationRegistrationError;
        expect(fedError.errorCode).toBe('invalid_client_metadata');
        expect(fedError.statusCode).toBe(400);
      }
    });

    it('should handle invalid Authlete response action', async () => {
      // Arrange
      const request: AuthleteFederationRegistrationRequest = {
        redirect_uris: ['https://client.example.com/callback'],
        client_name: 'Test Federation Client'
      };

      const invalidResponse: AuthleteFederationRegistrationResponse = {
        action: 'BAD_REQUEST',
        resultMessage: 'Invalid parameters'
      };

      vi.mocked(mockAuthleteClient.federationRegistration).mockResolvedValue(invalidResponse);

      // Act & Assert
      await expect(service.registerFederatedClient(request)).rejects.toThrow(FederationRegistrationError);
      
      try {
        await service.registerFederatedClient(request);
      } catch (error) {
        expect(error).toBeInstanceOf(FederationRegistrationError);
        const fedError = error as FederationRegistrationError;
        expect(fedError.errorCode).toBe('registration_failed');
        expect(fedError.statusCode).toBe(400);
      }
    });

    it('should handle missing client_id in response', async () => {
      // Arrange
      const request: AuthleteFederationRegistrationRequest = {
        redirect_uris: ['https://client.example.com/callback'],
        client_name: 'Test Federation Client'
      };

      const invalidResponse: AuthleteFederationRegistrationResponse = {
        action: 'CREATED',
        redirect_uris: request.redirect_uris
        // Missing client_id
      };

      vi.mocked(mockAuthleteClient.federationRegistration).mockResolvedValue(invalidResponse);

      // Act & Assert
      await expect(service.registerFederatedClient(request)).rejects.toThrow(FederationRegistrationError);
      
      try {
        await service.registerFederatedClient(request);
      } catch (error) {
        expect(error).toBeInstanceOf(FederationRegistrationError);
        const fedError = error as FederationRegistrationError;
        expect(fedError.errorCode).toBe('invalid_response');
        expect(fedError.errorDescription).toContain('Missing client_id');
      }
    });
  });

  describe('getEntityConfiguration', () => {
    it('should successfully retrieve entity configuration', async () => {
      // Arrange
      const expectedResponse: AuthleteFederationConfigurationResponse = {
        action: 'OK',
        entityConfiguration: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...'
      };

      vi.mocked(mockAuthleteClient.federationConfiguration).mockResolvedValue(expectedResponse);

      // Act
      const result = await service.getEntityConfiguration();

      // Assert
      expect(result).toBe(expectedResponse.entityConfiguration);
      expect(mockAuthleteClient.federationConfiguration).toHaveBeenCalledWith({});
    });

    it('should handle missing entity configuration', async () => {
      // Arrange
      const response: AuthleteFederationConfigurationResponse = {
        action: 'OK'
        // Missing entityConfiguration
      };

      vi.mocked(mockAuthleteClient.federationConfiguration).mockResolvedValue(response);

      // Act & Assert
      await expect(service.getEntityConfiguration()).rejects.toThrow(FederationRegistrationError);
      
      try {
        await service.getEntityConfiguration();
      } catch (error) {
        expect(error).toBeInstanceOf(FederationRegistrationError);
        const fedError = error as FederationRegistrationError;
        expect(fedError.errorCode).toBe('configuration_unavailable');
      }
    });

    it('should handle API errors', async () => {
      // Arrange
      const response: AuthleteFederationConfigurationResponse = {
        action: 'BAD_REQUEST',
        resultMessage: 'Invalid request parameters'
      };

      vi.mocked(mockAuthleteClient.federationConfiguration).mockResolvedValue(response);

      // Act & Assert
      await expect(service.getEntityConfiguration()).rejects.toThrow(FederationRegistrationError);
      
      try {
        await service.getEntityConfiguration();
      } catch (error) {
        expect(error).toBeInstanceOf(FederationRegistrationError);
        const fedError = error as FederationRegistrationError;
        expect(fedError.errorCode).toBe('configuration_unavailable');
        expect(fedError.statusCode).toBe(400);
      }
    });

    it('should handle network errors', async () => {
      // Arrange
      const error = new Error('Network error');
      vi.mocked(mockAuthleteClient.federationConfiguration).mockRejectedValue(error);

      // Act & Assert
      await expect(service.getEntityConfiguration()).rejects.toThrow(FederationRegistrationError);
      
      try {
        await service.getEntityConfiguration();
      } catch (error) {
        expect(error).toBeInstanceOf(FederationRegistrationError);
        const fedError = error as FederationRegistrationError;
        expect(fedError.errorCode).toBe('server_error');
      }
    });

    it('should handle Authlete API errors', async () => {
      // Arrange
      const authleteError = new AuthleteApiError(
        500,
        { resultMessage: 'Internal server error' },
        'Server error'
      );
      vi.mocked(mockAuthleteClient.federationConfiguration).mockRejectedValue(authleteError);

      // Act & Assert
      await expect(service.getEntityConfiguration()).rejects.toThrow(FederationRegistrationError);
      
      try {
        await service.getEntityConfiguration();
      } catch (error) {
        expect(error).toBeInstanceOf(FederationRegistrationError);
        const fedError = error as FederationRegistrationError;
        expect(fedError.errorCode).toBe('configuration_unavailable');
        expect(fedError.statusCode).toBe(500);
      }
    });
  });
});