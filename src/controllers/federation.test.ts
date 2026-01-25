import { Request, Response } from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FederationControllerImpl } from './federation';
import { AuthleteClient } from '../authlete/client';
import { FederationFetchResponse, FederationListResponse, FederationResolveResponse } from '../authlete/types';

// Mock the logger
vi.mock('../utils/logger', () => ({
  logger: {
    logInfo: vi.fn(),
    logError: vi.fn(),
    logDebug: vi.fn()
  }
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
    it('should return entity configuration with proper structure', async () => {
      await controller.handleEntityConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/entity-statement+jwt');
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          iss: 'https://localhost:3001',
          sub: 'https://localhost:3001',
          iat: expect.any(Number),
          exp: expect.any(Number),
          jwks: expect.objectContaining({
            keys: expect.any(Array)
          }),
          metadata: expect.objectContaining({
            openid_provider: expect.any(Object),
            federation_entity: expect.any(Object)
          }),
          authority_hints: expect.any(Array)
        })
      );
    });

    it('should include OpenID Provider metadata', async () => {
      await controller.handleEntityConfiguration(mockRequest as Request, mockResponse as Response);

      const callArgs = (mockResponse.json as any).mock.calls[0][0];
      expect(callArgs.metadata.openid_provider).toEqual(
        expect.objectContaining({
          issuer: 'https://localhost:3001',
          authorization_endpoint: 'https://localhost:3001/authorize',
          token_endpoint: 'https://localhost:3001/token',
          userinfo_endpoint: 'https://localhost:3001/userinfo',
          jwks_uri: 'https://localhost:3001/.well-known/jwks.json',
          scopes_supported: expect.arrayContaining(['openid', 'profile', 'email']),
          response_types_supported: expect.arrayContaining(['code']),
          subject_types_supported: expect.arrayContaining(['public']),
          id_token_signing_alg_values_supported: expect.arrayContaining(['RS256'])
        })
      );
    });

    it('should include Federation Entity metadata', async () => {
      await controller.handleEntityConfiguration(mockRequest as Request, mockResponse as Response);

      const callArgs = (mockResponse.json as any).mock.calls[0][0];
      expect(callArgs.metadata.federation_entity).toEqual(
        expect.objectContaining({
          federation_fetch_endpoint: 'https://localhost:3001/federation/fetch',
          federation_list_endpoint: 'https://localhost:3001/federation/list',
          federation_resolve_endpoint: 'https://localhost:3001/federation/resolve',
          organization_name: 'OpenID Connect Authorization Server',
          homepage_uri: 'https://localhost:3001',
          contacts: expect.arrayContaining(['admin@example.com'])
        })
      );
    });

    it('should handle errors gracefully', async () => {
      // Mock an error in the get method
      (mockRequest.get as any).mockImplementation(() => {
        throw new Error('Test error');
      });

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
});