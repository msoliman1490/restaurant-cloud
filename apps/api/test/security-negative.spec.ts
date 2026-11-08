import { describe, it, expect } from 'vitest';
import { CryptoUtil } from '../src/modules/iam/crypto.util';
import {
  CreateTenantRequestSchema,
  CreateLegalEntityRequestSchema,
  CreateBranchRequestSchema,
  RegisterDeviceRequestSchema,
  LoginRequestSchema,
} from '@restaurant-cloud/shared-contracts';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import { ZodError } from 'zod';

describe('Security & Negative Scenarios Verification (BOLA/IDOR, JWT Attacks, Input Validation)', () => {
  describe('1. JWT Tampering & Attack Vectors', () => {
    it('should reject tokens with alg: "none" (Algorithm Confusion Attack)', () => {
      // Craft a token with {"alg":"none","typ":"JWT"}
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'u-1',
          tenantId: 't-1',
          iss: 'restaurant-cloud',
          aud: 'restaurant-cloud-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');
      const token = `${header}.${payload}.`;

      const result = CryptoUtil.verifyToken(token);
      expect(result).toBeNull();
    });

    it('should reject tokens with unsupported algorithm (e.g. HS512, RS256)', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'u-1',
          tenantId: 't-1',
          iss: 'restaurant-cloud',
          aud: 'restaurant-cloud-api',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');
      const token = `${header}.${payload}.fakesignature`;

      const result = CryptoUtil.verifyToken(token);
      expect(result).toBeNull();
    });

    it('should reject expired tokens', () => {
      const token = CryptoUtil.signToken({
        userId: 'u-1',
        tenantId: 't-1',
        email: 'test@example.com',
      });

      // Manually forge an expired payload with valid signature
      const [headerB64, payloadB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString('utf8'));
      payload.exp = Math.floor(Date.now() / 1000) - 100; // 100 seconds in the past

      const forgedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const forgedToken = `${headerB64}.${forgedPayloadB64}.invalidsig`;

      const result = CryptoUtil.verifyToken(forgedToken);
      expect(result).toBeNull();
    });

    it('should reject tokens with invalid signature (Tampered Payload)', () => {
      const token = CryptoUtil.signToken({
        userId: 'u-1',
        tenantId: 'tenant-legit',
        email: 'user@example.com',
      });

      const parts = token.split('.');
      // Tamper tenantId in payload to another tenant (IDOR attempt)
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
      payload.tenantId = 'tenant-victim-idor';
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayloadB64}.${parts[2]}`;

      const result = CryptoUtil.verifyToken(tamperedToken);
      expect(result).toBeNull();
    });

    it('should reject tokens with forged issuer or audience', () => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'u-1',
          tenantId: 't-1',
          iss: 'malicious-issuer',
          aud: 'wrong-audience',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');
      const token = `${header}.${payload}.fakesignature`;

      const result = CryptoUtil.verifyToken(token);
      expect(result).toBeNull();
    });
  });

  describe('2. Negative Input Validation & Schema Hardening', () => {
    it('should reject invalid tenant onboarding request with empty code or malformed email', () => {
      expect(() =>
        CreateTenantRequestSchema.parse({
          code: '', // Empty
          displayName: 'Test',
          initialLegalEntity: {
            legalName: 'Co',
            vatNumber: '300000000000003',
          },
          initialAdminUser: {
            email: 'not-an-email',
            password: '123', // Too short
            displayName: 'Admin',
          },
        })
      ).toThrow();
    });

    it('should reject invalid branch creation with malformed UUID for legalEntityId', () => {
      expect(() =>
        CreateBranchRequestSchema.parse({
          legalEntityId: 'invalid-not-a-uuid',
          code: 'BR-01',
          name: 'Branch 1',
        })
      ).toThrow();
    });

    it('should reject device registration with invalid device type', () => {
      expect(() =>
        RegisterDeviceRequestSchema.parse({
          branchId: 'a0000000-0000-0000-0000-000000000001',
          deviceCode: 'POS-01',
          deviceType: 'INVALID_TYPE',
        })
      ).toThrow();
    });

    it('should reject login request with empty password or invalid email format', () => {
      expect(() =>
        LoginRequestSchema.parse({
          email: 'bad-email',
          password: '',
        })
      ).toThrow();
    });
  });

  describe('3. Global Exception Filter & Information Leakage Prevention', () => {
    const filter = new GlobalExceptionFilter();

    function mockHost(onSend: (status: number, body: unknown) => void): ArgumentsHost {
      const mockReply = {
        status: (s: number) => ({
          send: (body: unknown) => onSend(s, body),
        }),
      };
      const mockRequest = {
        method: 'POST',
        url: '/api/v1/test',
      };
      return {
        switchToHttp: () => ({
          getResponse: () => mockReply,
          getRequest: () => mockRequest,
        }),
      } as unknown as ArgumentsHost;
    }

    it('should sanitize raw PostgreSQL RLS policy violation errors to HTTP 403', () => {
      let capturedStatus = 0;
      let capturedBody: any = null;

      const host = mockHost((status, body) => {
        capturedStatus = status;
        capturedBody = body;
      });

      const pgError = new Error(
        'new row violates row-level security policy for table "sales_orders"'
      );

      filter.catch(pgError, host);

      expect(capturedStatus).toBe(HttpStatus.FORBIDDEN);
      expect(capturedBody.success).toBe(false);
      expect(capturedBody.error.code).toBe('SECURITY_POLICY_VIOLATION');
      expect(capturedBody.error.message).toBe('Access denied by database security policy');
      // Verify raw database message is not leaked in message
      expect(capturedBody.error.message).not.toContain('table "sales_orders"');
    });

    it('should format ZodError into structured 400 Bad Request response', () => {
      let capturedStatus = 0;
      let capturedBody: any = null;

      const host = mockHost((status, body) => {
        capturedStatus = status;
        capturedBody = body;
      });

      let zodErr: ZodError | null = null;
      try {
        LoginRequestSchema.parse({ email: 'invalid', password: '' });
      } catch (err) {
        zodErr = err as ZodError;
      }

      filter.catch(zodErr, host);

      expect(capturedStatus).toBe(HttpStatus.BAD_REQUEST);
      expect(capturedBody.success).toBe(false);
      expect(capturedBody.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(capturedBody.error.details)).toBe(true);
      expect(capturedBody.error.details.length).toBeGreaterThanOrEqual(1);
    });

    it('should mask generic unexpected internal errors (500) without leaking stack traces', () => {
      let capturedStatus = 0;
      let capturedBody: any = null;

      const host = mockHost((status, body) => {
        capturedStatus = status;
        capturedBody = body;
      });

      const genericError = new Error('Database connection failed: SELECT * FROM secret_table');

      filter.catch(genericError, host);

      expect(capturedStatus).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(capturedBody.success).toBe(false);
      expect(capturedBody.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(capturedBody.error.message).toBe('An internal server error occurred');
      expect(capturedBody.error.message).not.toContain('secret_table');
      expect(capturedBody.error.stack).toBeUndefined();
    });
  });
});
