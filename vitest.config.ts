import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html']
    },
    env: {
      AUTHLETE_BASE_URL: 'https://test.authlete.com',
      AUTHLETE_SERVICE_ID: 'test_service_id',
      AUTHLETE_SERVICE_ACCESS_TOKEN: 'test_access_token',
      PORT: '3001',
      NODE_ENV: 'test',
      SESSION_SECRET: 'test_session_secret',
      HTTP_TIMEOUT: '5000',
      HTTP_RETRY_ATTEMPTS: '2'
    }
  }
});