import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { AuthleteClientImpl } from './client';
import { AuthleteConfig } from '../config';

describe('AuthleteClient - Exponential Backoff and Rate Limiting', () => {
  let client: AuthleteClientImpl;
  let mockConfig: AuthleteConfig;

  beforeEach(() => {
    mockConfig = {
      baseUrl: 'https://api.authlete.com',
      serviceId: 'test-service',
      serviceAccessToken: 'test-token',
      timeout: 10000,
      retryAttempts: 5
    };
    client = new AuthleteClientImpl(mockConfig);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isRetryableError', () => {
    it('should return true for 429 (Rate Limit) errors', () => {
      const error = {
        isAxiosError: true,
        response: { status: 429 }
      };
      expect((client as any).isRetryableError(error)).toBe(true);
    });

    it('should return true for 5xx server errors', () => {
      const error = {
        isAxiosError: true,
        response: { status: 500 }
      };
      expect((client as any).isRetryableError(error)).toBe(true);
    });

    it('should return true for network errors (no response)', () => {
      const error = {
        isAxiosError: true,
        response: undefined
      };
      expect((client as any).isRetryableError(error)).toBe(true);
    });

    it('should return false for 4xx client errors (except 429)', () => {
      const error = {
        isAxiosError: true,
        response: { status: 400 }
      };
      expect((client as any).isRetryableError(error)).toBe(false);
    });
  });

  describe('getRetryAfterDelay', () => {
    it('should extract delay from Retry-After header (seconds)', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 429,
          headers: { 'retry-after': '5' }
        }
      };
      const delay = (client as any).getRetryAfterDelay(error);
      expect(delay).toBe(5000); // 5 seconds in milliseconds
    });

    it('should extract delay from Retry-After header (HTTP date)', () => {
      const futureDate = new Date(Date.now() + 10000); // 10 seconds from now
      const error = {
        isAxiosError: true,
        response: {
          status: 429,
          headers: { 'retry-after': futureDate.toUTCString() }
        }
      };
      const delay = (client as any).getRetryAfterDelay(error);
      expect(delay).toBeGreaterThan(9000); // Should be close to 10 seconds
      expect(delay).toBeLessThan(11000);
    });

    it('should return null if no Retry-After header', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 429,
          headers: {}
        }
      };
      const delay = (client as any).getRetryAfterDelay(error);
      expect(delay).toBeNull();
    });

    it('should return null for non-axios errors', () => {
      const error = new Error('Network error');
      const delay = (client as any).getRetryAfterDelay(error);
      expect(delay).toBeNull();
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should use Retry-After header if present', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 429,
          headers: { 'retry-after': '10' }
        }
      };
      const delay = (client as any).calculateBackoffDelay(1, error);
      expect(delay).toBe(10000); // Should use Retry-After value
    });

    it('should calculate exponential backoff without Retry-After', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 500,
          headers: {}
        }
      };
      
      // Attempt 1: ~1s (1000ms base)
      const delay1 = (client as any).calculateBackoffDelay(1, error);
      expect(delay1).toBeGreaterThan(750);
      expect(delay1).toBeLessThan(1250);
      
      // Attempt 2: ~2s (2000ms base)
      const delay2 = (client as any).calculateBackoffDelay(2, error);
      expect(delay2).toBeGreaterThan(1500);
      expect(delay2).toBeLessThan(2500);
      
      // Attempt 3: ~4s (4000ms base)
      const delay3 = (client as any).calculateBackoffDelay(3, error);
      expect(delay3).toBeGreaterThan(3000);
      expect(delay3).toBeLessThan(5000);
    });

    it('should cap delay at maximum (32 seconds)', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 500,
          headers: {}
        }
      };
      
      // Attempt 10 would be 512s without cap, should be capped at 32s
      const delay = (client as any).calculateBackoffDelay(10, error);
      expect(delay).toBeLessThan(40000); // 32s + jitter
    });

    it('should add jitter to prevent thundering herd', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 500,
          headers: {}
        }
      };
      
      // Calculate multiple delays for the same attempt
      const delays = Array.from({ length: 10 }, () => 
        (client as any).calculateBackoffDelay(2, error)
      );
      
      // All delays should be different due to jitter
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
      
      // All delays should be within reasonable range (2s ± 25%)
      delays.forEach(delay => {
        expect(delay).toBeGreaterThan(1500);
        expect(delay).toBeLessThan(2500);
      });
    });
  });

  describe('callWithRetry - Rate Limiting', () => {
    it('should retry on 429 errors with exponential backoff', async () => {
      const mockApiCall = vi.fn()
        .mockRejectedValueOnce({
          isAxiosError: true,
          response: { status: 429, headers: {} }
        })
        .mockRejectedValueOnce({
          isAxiosError: true,
          response: { status: 429, headers: {} }
        })
        .mockResolvedValueOnce({ success: true });

      // Mock delay to speed up test
      vi.spyOn(client as any, 'delay').mockResolvedValue(undefined);

      const result = await (client as any).callWithRetry(mockApiCall, 5);

      expect(result).toEqual({ success: true });
      expect(mockApiCall).toHaveBeenCalledTimes(3);
      expect((client as any).delay).toHaveBeenCalledTimes(2);
    });

    it('should respect Retry-After header for 429 errors', async () => {
      const mockApiCall = vi.fn()
        .mockRejectedValueOnce({
          isAxiosError: true,
          response: { 
            status: 429, 
            headers: { 'retry-after': '5' }
          }
        })
        .mockResolvedValueOnce({ success: true });

      const delaySpy = vi.spyOn(client as any, 'delay').mockResolvedValue(undefined);

      await (client as any).callWithRetry(mockApiCall, 5);

      // Should use Retry-After value (5 seconds = 5000ms)
      expect(delaySpy).toHaveBeenCalledWith(5000);
    });

    it('should throw error after max retries on persistent 429', async () => {
      const mockApiCall = vi.fn().mockRejectedValue({
        isAxiosError: true,
        response: { status: 429, headers: {} }
      });

      vi.spyOn(client as any, 'delay').mockResolvedValue(undefined);

      await expect(
        (client as any).callWithRetry(mockApiCall, 3)
      ).rejects.toMatchObject({
        response: { status: 429 }
      });

      expect(mockApiCall).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const mockApiCall = vi.fn().mockRejectedValue({
        isAxiosError: true,
        response: { status: 400, headers: {} }
      });

      await expect(
        (client as any).callWithRetry(mockApiCall, 5)
      ).rejects.toMatchObject({
        response: { status: 400 }
      });

      expect(mockApiCall).toHaveBeenCalledTimes(1);
    });
  });

  describe('Integration - Rate Limit Scenario', () => {
    it('should handle rate limit with increasing backoff delays', async () => {
      const delays: number[] = [];
      const mockApiCall = vi.fn()
        .mockRejectedValueOnce({
          isAxiosError: true,
          response: { status: 429, headers: {} }
        })
        .mockRejectedValueOnce({
          isAxiosError: true,
          response: { status: 429, headers: {} }
        })
        .mockRejectedValueOnce({
          isAxiosError: true,
          response: { status: 429, headers: {} }
        })
        .mockResolvedValueOnce({ success: true });

      vi.spyOn(client as any, 'delay').mockImplementation(async (ms: number) => {
        delays.push(ms);
        return Promise.resolve();
      });

      await (client as any).callWithRetry(mockApiCall, 5);

      // Verify exponential backoff pattern
      expect(delays.length).toBe(3);
      
      // First delay: ~1s
      expect(delays[0]).toBeGreaterThan(750);
      expect(delays[0]).toBeLessThan(1250);
      
      // Second delay: ~2s (should be roughly double)
      expect(delays[1]).toBeGreaterThan(1500);
      expect(delays[1]).toBeLessThan(2500);
      
      // Third delay: ~4s (should be roughly double again)
      expect(delays[2]).toBeGreaterThan(3000);
      expect(delays[2]).toBeLessThan(5000);
      
      // Each delay should be increasing
      expect(delays[1]).toBeGreaterThan(delays[0]);
      expect(delays[2]).toBeGreaterThan(delays[1]);
    });
  });
});
