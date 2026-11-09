import { describe, it, expect, vi } from 'vitest';
import { AppService } from '../src/app.service';
import { AppController } from '../src/app.controller';
import { DatabaseService } from '../src/database/database.service';
import { ServiceUnavailableException } from '@nestjs/common';
import { CryptoUtil } from '../src/modules/iam/crypto.util';

describe('Health & Readiness Probes & Production Security', () => {
  describe('Liveness Probe (/health/liveness)', () => {
    it('returns HTTP 200 payload with service details and timestamp', () => {
      const mockDb = { ping: vi.fn() } as unknown as DatabaseService;
      const appService = new AppService(mockDb);
      const appController = new AppController(appService);

      const liveness = appController.getLiveness();

      expect(liveness.status).toBe('ok');
      expect(liveness.service).toBe('restaurant-cloud-api');
      expect(liveness.version).toBe('1.0.0');
      expect(liveness.timestamp).toBeDefined();
      expect(new Date(liveness.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('Readiness Probe (/health/readiness & /health)', () => {
    it('returns HTTP 200 payload with database connected when ping succeeds', async () => {
      const mockDb = {
        ping: vi.fn().mockResolvedValue(true),
      } as unknown as DatabaseService;
      const appService = new AppService(mockDb);
      const appController = new AppController(appService);

      const readiness = await appController.getReadiness();

      expect(readiness.status).toBe('ok');
      expect(readiness.checks.database).toBe('connected');
      expect(mockDb.ping).toHaveBeenCalledTimes(1);

      const health = await appController.getHealth();
      expect(health.status).toBe('ok');
    });

    it('throws ServiceUnavailableException (HTTP 503) when database is unreachable', async () => {
      const mockDb = {
        ping: vi.fn().mockResolvedValue(false),
      } as unknown as DatabaseService;
      const appService = new AppService(mockDb);
      const appController = new AppController(appService);

      await expect(appController.getReadiness()).rejects.toThrow(
        ServiceUnavailableException
      );

      try {
        await appController.getReadiness();
      } catch (err: unknown) {
        const error = err as ServiceUnavailableException;
        expect(error.getStatus()).toBe(503);
        const response = error.getResponse() as Record<string, unknown>;
        expect(response.status).toBe('unhealthy');
        expect(response.checks).toEqual({ database: 'disconnected' });
        // Ensure zero SQL details or credentials leak in the response
        expect(JSON.stringify(response)).not.toMatch(/password|select|postgres|sql/i);
      }
    });

    it('handles unexpected database ping error gracefully without leaking stack trace', async () => {
      const mockDb = {
        ping: vi.fn().mockRejectedValue(new Error('Connection terminated unexpectedly')),
      } as unknown as DatabaseService;
      const appService = new AppService(mockDb);

      await expect(appService.getReadiness()).rejects.toThrow(
        ServiceUnavailableException
      );
    });
  });

  describe('Production JWT Secret Security Enforcement', () => {
    it('throws fatal security error in production if JWT_SECRET is missing or default dev key', () => {
      const prevEnv = process.env.NODE_ENV;
      const prevSecret = process.env.JWT_SECRET;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.JWT_SECRET;

        expect(() => {
          CryptoUtil.signToken({ userId: 'u-1', tenantId: 't-1' });
        }).toThrow(/FATAL SECURITY ERROR.*Mandatory JWT_SECRET/);

        process.env.JWT_SECRET = 'restaurant_cloud_secure_dev_jwt_key_2026_min_32_chars';
        expect(() => {
          CryptoUtil.signToken({ userId: 'u-1', tenantId: 't-1' });
        }).toThrow(/FATAL SECURITY ERROR.*Mandatory JWT_SECRET/);
      } finally {
        process.env.NODE_ENV = prevEnv;
        process.env.JWT_SECRET = prevSecret;
      }
    });

    it('accepts valid production secret with >= 32 characters', () => {
      const prevEnv = process.env.NODE_ENV;
      const prevSecret = process.env.JWT_SECRET;

      try {
        process.env.NODE_ENV = 'production';
        process.env.JWT_SECRET = 'super_secure_production_secret_key_minimum_32_chars!';

        const token = CryptoUtil.signToken({ userId: 'u-1', tenantId: 't-1' });
        expect(token).toBeDefined();
        const claims = CryptoUtil.verifyToken(token);
        expect(claims?.userId).toBe('u-1');
        expect(claims?.tenantId).toBe('t-1');
      } finally {
        process.env.NODE_ENV = prevEnv;
        process.env.JWT_SECRET = prevSecret;
      }
    });
  });
});
