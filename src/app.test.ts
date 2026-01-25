import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from './app';

// Mock the config module
vi.mock('./config', () => ({
  config: {
    server: {
      sessionSecret: 'test-secret',
      nodeEnv: 'test'
    },
    authlete: {
      baseUrl: 'https://test.authlete.com',
      serviceId: 'test-service',
      serviceAccessToken: 'test-token',
      timeout: 5000,
      retryAttempts: 3
    }
  }
}));

// Mock the AuthleteClient
vi.mock('./authlete/client', () => ({
  AuthleteClientImpl: vi.fn().mockImplementation(() => ({
    authorization: vi.fn(),
    authorizationIssue: vi.fn(),
    authorizationFail: vi.fn(),
    token: vi.fn(),
    introspection: vi.fn().mockResolvedValue({
      action: 'OK',
      responseContent: JSON.stringify({
        active: false
      }),
      active: false
    })
  }))
}));

describe('App Integration', () => {
  let app: any;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('should have introspection endpoint available', async () => {
    const response = await request(app)
      .post('/introspect')
      .send({
        token: 'test-token',
        client_id: 'test-client',
        client_secret: 'test-secret'
      });

    // Should not return 404 (endpoint exists)
    expect(response.status).not.toBe(404);
    
    // Should return 200 with active: false for this mock
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      active: false
    });
  });

  it('should return 401 for introspection without authentication', async () => {
    const response = await request(app)
      .post('/introspect')
      .send({
        token: 'test-token'
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'unauthorized',
      error_description: 'Resource server authentication required'
    });
  });
});