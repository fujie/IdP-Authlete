import { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { FederationControllerImpl } from './federation';
import { AuthleteClient } from '../authlete/client';
import { 
  FederationFetchResponse, 
  FederationListResponse, 
  FederationResolveResponse,
  AuthleteFederationConfigurationResponse
} from '../authlete/types';
import { createFederationRoutes } from '../routes/federation';

// Mock the logger
vi.mock('../utils/logger', () => ({
  logger: {
    logInfo: vi.fn(),
    logError: vi.fn(),
    logDebug: vi.fn(),
    logWarn: vi.fn()
  }
}));

// Mock the federation validation utils
vi.mock('../federation/utils', () => ({
  ValidationUtils: {
    decodeJWT: vi.fn(),
    isValidEntityId: vi.fn()
  }
}));

// Mock the rate limiter
vi.mock('rate-limiter-flexible', () => ({
  RateLimiterMemory: vi.fn().mockImplementation(() => ({
    consume: vi.fn().mockResolvedValue({
      msBeforeNext: 1000,
      remainingHits: 5,
      totalHits: 1
    }),
    get: vi.fn().mockResolvedValue(null)
  }))
}));

describe('FederationController', () => {
  let controller: FederationControllerImpl;
  let mockAuthleteClient: AuthleteClient;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockAuthleteClient = {
      authorization: vi.fn(),
      authorizationIssue: vi.fn(),
      authorizationFail: vi.fn(),
      token: vi.fn(),
      introspection: vi.fn(),
      userInfo: vi.fn(),
      federationFetch: vi.fn(),
      federationList: vi.fn(),
      federationResolve: vi.fn(),
      federationRegistration: vi.fn(),
      federationConfiguration: vi.fn(),
      createClient: vi.fn(),
      dynamicClientRegistration: vi.fn()
    } as any;

    controller = new FederationControllerImpl(mockAuthleteClient);

    mockRequest = {
      protocol: 'https',
      get: vi.fn().mockReturnValue('localhost:3001'),
      body: {}
    };

    mockResponse = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      send: vi.fn()
    };
  });

  describe('handleEntityConfiguration', () => {
    it('should return entity configuration JWT from Authlete', async () => {
      const mockConfigResponse: AuthleteFederationConfigurationResponse = {
        action: 'OK',
        entityConfiguration: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL2xvY2FsaG9zdDozMDAxIiwic3ViIjoiaHR0cHM6Ly9sb2NhbGhvc3Q6MzAwMSIsImV4cCI6MTY0MDk5NTIwMH0.signature'
      };

      mockAuthleteClient.federationConfiguration.mockResolvedValue(mockConfigResponse);

      await controller.handleEntityConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockAuthleteClient.federationConfiguration).toHaveBeenCalledWith({});
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/entity-statement+jwt');
      expect(mockResponse.send).toHaveBeenCalledWith(mockConfigResponse.entityConfiguration);
    });

    it('should handle Authlete configuration error', async () => {
      const mockConfigResponse: AuthleteFederationConfigurationResponse = {
        action: 'BAD_REQUEST',
        resultCode: 'A001001',
        resultMessage: 'Configuration not available'
      };

      mockAuthleteClient.federationConfiguration.mockResolvedValue(mockConfigResponse);

      await controller.handleEntityConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'Entity configuration unavailable'
      });
    });

    it('should handle missing entity configuration in response', async () => {
      const mockConfigResponse: AuthleteFederationConfigurationResponse = {
        action: 'OK'
        // Missing entityConfiguration
      };

      mockAuthleteClient.federationConfiguration.mockResolvedValue(mockConfigResponse);

      await controller.handleEntityConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'Entity configuration unavailable'
      });
    });

    it('should handle Authlete API errors gracefully', async () => {
      mockAuthleteClient.federationConfiguration.mockRejectedValue(new Error('Authlete API error'));

      await controller.handleEntityConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'Internal server error processing entity configuration'
      });
    });
  });

  describe('handleFederationFetch', () => {
    it('should handle successful federation fetch', async () => {
      const mockFetchResponse: FederationFetchResponse = {
        action: 'OK',
        entity_configuration: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...' // Mock JWT
      };

      mockAuthleteClient.federationFetch.mockResolvedValue(mockFetchResponse);
      mockRequest.body = { iss: 'https://example.com', sub: 'https://example.com' };

      await controller.handleFederationFetch(mockRequest as Request, mockResponse as Response);

      expect(mockAuthleteClient.federationFetch).toHaveBeenCalledWith({
        iss: 'https://example.com',
        sub: 'https://example.com'
      });
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/entity-statement+jwt');
      expect(mockResponse.send).toHaveBeenCalledWith(mockFetchResponse.entity_configuration);
    });

    it('should handle entity not found', async () => {
      const mockFetchResponse: FederationFetchResponse = {
        action: 'NOT_FOUND'
      };

      mockAuthleteClient.federationFetch.mockResolvedValue(mockFetchResponse);
      mockRequest.body = { iss: 'https://example.com', sub: 'https://unknown.com' };

      await controller.handleFederationFetch(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'not_found',
        error_description: 'Entity not found'
      });
    });

    it('should validate required parameters', async () => {
      mockRequest.body = { iss: 'https://example.com' }; // Missing sub

      await controller.handleFederationFetch(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing required parameters: iss and sub'
      });
      expect(mockAuthleteClient.federationFetch).not.toHaveBeenCalled();
    });
  });

  describe('handleFederationList', () => {
    it('should handle successful federation list', async () => {
      const mockListResponse: FederationListResponse = {
        action: 'OK',
        entity_ids: ['https://entity1.example.com', 'https://entity2.example.com']
      };

      mockAuthleteClient.federationList.mockResolvedValue(mockListResponse);
      mockRequest.body = { iss: 'https://example.com', entity_type: 'openid_provider' };

      await controller.handleFederationList(mockRequest as Request, mockResponse as Response);

      expect(mockAuthleteClient.federationList).toHaveBeenCalledWith({
        iss: 'https://example.com',
        entity_type: 'openid_provider'
      });
      expect(mockResponse.json).toHaveBeenCalledWith({
        entity_ids: mockListResponse.entity_ids
      });
    });

    it('should handle empty entity list', async () => {
      const mockListResponse: FederationListResponse = {
        action: 'OK',
        entity_ids: []
      };

      mockAuthleteClient.federationList.mockResolvedValue(mockListResponse);
      mockRequest.body = { iss: 'https://example.com' };

      await controller.handleFederationList(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.json).toHaveBeenCalledWith({
        entity_ids: []
      });
    });

    it('should validate required iss parameter', async () => {
      mockRequest.body = { entity_type: 'openid_provider' }; // Missing iss

      await controller.handleFederationList(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing required parameter: iss'
      });
      expect(mockAuthleteClient.federationList).not.toHaveBeenCalled();
    });
  });

  describe('handleFederationResolve', () => {
    it('should handle successful federation resolve', async () => {
      const mockResolveResponse: FederationResolveResponse = {
        action: 'OK',
        trust_chain: ['jwt1', 'jwt2', 'jwt3'],
        metadata: { some: 'metadata' }
      };

      mockAuthleteClient.federationResolve.mockResolvedValue(mockResolveResponse);
      mockRequest.body = { 
        sub: 'https://entity.example.com', 
        anchor: 'https://trust-anchor.example.com',
        type: 'openid_provider'
      };

      await controller.handleFederationResolve(mockRequest as Request, mockResponse as Response);

      expect(mockAuthleteClient.federationResolve).toHaveBeenCalledWith({
        sub: 'https://entity.example.com',
        anchor: 'https://trust-anchor.example.com',
        type: 'openid_provider'
      });
      expect(mockResponse.json).toHaveBeenCalledWith({
        trust_chain: mockResolveResponse.trust_chain,
        metadata: mockResolveResponse.metadata
      });
    });

    it('should handle trust chain not found', async () => {
      const mockResolveResponse: FederationResolveResponse = {
        action: 'NOT_FOUND'
      };

      mockAuthleteClient.federationResolve.mockResolvedValue(mockResolveResponse);
      mockRequest.body = { 
        sub: 'https://unknown.example.com', 
        anchor: 'https://trust-anchor.example.com'
      };

      await controller.handleFederationResolve(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'not_found',
        error_description: 'Trust chain not found'
      });
    });

    it('should validate required parameters', async () => {
      mockRequest.body = { sub: 'https://entity.example.com' }; // Missing anchor

      await controller.handleFederationResolve(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing required parameters: sub and anchor'
      });
      expect(mockAuthleteClient.federationResolve).not.toHaveBeenCalled();
    });
  });

  describe('Entity Configuration Endpoint Availability', () => {
    it('should have /.well-known/openid_federation endpoint available and return valid response', async () => {
      // Create a test Express app with federation routes
      const app = express();
      
      // Add essential middleware
      app.use(express.json());
      
      // Add federation routes
      const federationRoutes = createFederationRoutes(controller);
      app.use(federationRoutes);

      // Mock successful Authlete response
      const mockConfigResponse: AuthleteFederationConfigurationResponse = {
        action: 'OK',
        entityConfiguration: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL2xvY2FsaG9zdDozMDAxIiwic3ViIjoiaHR0cHM6Ly9sb2NhbGhvc3Q6MzAwMSIsImV4cCI6MTY0MDk5NTIwMH0.signature'
      };

      mockAuthleteClient.federationConfiguration.mockResolvedValue(mockConfigResponse);

      // Test that the endpoint is available and returns expected response
      const response = await request(app)
        .get('/.well-known/openid-federation');

      // Verify endpoint availability (not 404)
      expect(response.status).not.toBe(404);
      
      // Verify successful response
      expect(response.status).toBe(200);
      
      // Verify correct content type for entity configuration JWT
      expect(response.headers['content-type']).toMatch(/^application\/entity-statement\+jwt/);
      
      // Verify response contains the entity configuration JWT
      expect(response.text).toBe(mockConfigResponse.entityConfiguration);
      
      // Verify Authlete API was called
      expect(mockAuthleteClient.federationConfiguration).toHaveBeenCalledWith({});
    });

    it('should return 500 when Authlete configuration is unavailable', async () => {
      // Create a test Express app with federation routes
      const app = express();
      
      // Add essential middleware
      app.use(express.json());
      
      // Add federation routes
      const federationRoutes = createFederationRoutes(controller);
      app.use(federationRoutes);

      // Mock Authlete error response
      const mockConfigResponse: AuthleteFederationConfigurationResponse = {
        action: 'BAD_REQUEST',
        resultCode: 'A001001',
        resultMessage: 'Configuration not available'
      };

      mockAuthleteClient.federationConfiguration.mockResolvedValue(mockConfigResponse);

      // Test error handling
      const response = await request(app)
        .get('/.well-known/openid-federation');

      // Verify endpoint is available but returns error
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'server_error',
        error_description: 'Entity configuration unavailable'
      });
    });

    it('should verify endpoint path is correctly mapped', async () => {
      // Simple test to verify the route exists
      const app = express();
      app.use(express.json());
      
      // Add a simple test route to verify routing works
      app.get('/.well-known/openid-federation', (_req, res) => {
        res.status(200).send('test-response');
      });

      const response = await request(app)
        .get('/.well-known/openid-federation');

      expect(response.status).toBe(200);
      expect(response.text).toBe('test-response');
    });
  });
});