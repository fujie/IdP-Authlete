import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app';

describe('Health Check Endpoint', () => {
  const app = createApp();

  it('should return healthy status on /health', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'healthy',
      version: expect.any(String),
      environment: 'test'
    });
    expect(response.body.timestamp).toBeDefined();
  });

  it('should return 404 for root endpoint since it is not implemented', async () => {
    await request(app)
      .get('/')
      .expect(404);
  });
});