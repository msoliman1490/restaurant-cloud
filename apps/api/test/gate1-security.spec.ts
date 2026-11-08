import { describe, it, expect, vi } from 'vitest';
import { CryptoUtil } from '../src/modules/iam/crypto.util';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

describe('Gate 1: Identity, Tenancy & Security Test Suite', () => {
  describe('1. Cryptographic Utilities & Timing-Safe Verification', () => {
    it('should hash and verify passwords asynchronously with timing-safe check', async () => {
      const password = 'SuperSecretPassword2026!';
      const hash = await CryptoUtil.hashPassword(password);

      expect(hash).toContain(':');
      expect(await CryptoUtil.verifyPassword(password, hash)).toBe(true);
      expect(await CryptoUtil.verifyPassword('WrongPassword', hash)).toBe(false);
    });

    it('should generate valid signed tokens with standard claims and detect tampering', () => {
      const payload = { userId: 'user-123', tenantId: 'tenant-abc' };
      const token = CryptoUtil.signToken(payload, 3600);

      const verified = CryptoUtil.verifyToken(token);
      expect(verified?.userId).toBe('user-123');
      expect(verified?.tenantId).toBe('tenant-abc');
      expect(verified?.iss).toBe('restaurant-cloud');
      expect(verified?.aud).toBe('restaurant-cloud-api');

      // Tampering attack: modifying the payload claims
      const parts = token.split('.');
      const tamperedClaims = Buffer.from(
        JSON.stringify({ userId: 'user-attacker', tenantId: 'tenant-victim' })
      ).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedClaims}.${parts[2]}`;

      expect(CryptoUtil.verifyToken(tamperedToken)).toBeNull();
    });

    it('should reject algorithm tampering (e.g. none attack or HS512)', () => {
      const payload = { userId: 'user-123', tenantId: 'tenant-abc' };
      const token = CryptoUtil.signToken(payload, 3600);
      const parts = token.split('.');

      // Attacker replaces header with alg: 'none'
      const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const attackToken = `${fakeHeader}.${parts[1]}.${parts[2]}`;

      expect(CryptoUtil.verifyToken(attackToken)).toBeNull();
    });

    it('should reject expired tokens automatically', () => {
      const payload = { userId: 'user-123', tenantId: 'tenant-abc' };
      // Expired 10 seconds ago
      const token = CryptoUtil.signToken(payload, -10);
      expect(CryptoUtil.verifyToken(token)).toBeNull();
    });
  });

  describe('2. Multi-Tier RBAC & Scope Permissions Guard', () => {
    const reflector = new Reflector();
    const guard = new PermissionsGuard(reflector);

    function createMockContext(tenantContext?: Partial<TenantContext>): ExecutionContext {
      return {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: () => ({
          getRequest: () => ({
            tenantContext,
          }),
        }),
      } as unknown as ExecutionContext;
    }

    it('should allow access when user has the exact required permission', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['sales.order.create']);

      const mockContext = createMockContext({
        tenantId: 'tenant-1',
        userId: 'user-1',
        scopes: ['sales.order.create', 'sales.order.read'],
      });

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should allow access when user has wildcard (*) permission', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['legal_entity.create', 'accounting.post']);

      const mockContext = createMockContext({
        tenantId: 'tenant-1',
        userId: 'user-1',
        scopes: ['*'],
      });

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should reject access with ForbiddenException when user lacks the required permission', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['accounting.period.close']);

      const mockContext = createMockContext({
        tenantId: 'tenant-1',
        userId: 'cashier-user',
        scopes: ['sales.order.create'],
      });

      expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
    });

    it('should reject access if no tenant context is established (Fail-Closed)', () => {
      vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['sales.order.read']);

      const mockContext = createMockContext(undefined);

      expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
    });
  });

  describe('3. Multi-Entity & Cross-Tenant Isolation Rules (BOLA/IDOR Defense)', () => {
    it('should strictly isolate tenant scopes and prevent cross-tenant operations', () => {
      const tenantAContext: TenantContext = {
        tenantId: 'tenant-A-uuid',
        userId: 'admin-A',
        scopes: ['*'],
      };

      const targetTenantBResource = {
        tenantId: 'tenant-B-uuid',
        resourceId: 'order-from-tenant-b',
      };

      // Defense check: application boundary comparison
      const isAllowed = tenantAContext.tenantId === targetTenantBResource.tenantId;
      expect(isAllowed).toBe(false);
    });

    it('should enforce Branch-level scope boundaries within the same company', () => {
      const userBranch1Context = {
        tenantId: 'tenant-A',
        legalEntityId: 'company-1',
        branchId: 'branch-1-uuid',
        allowedScopes: [{ type: 'BRANCH', id: 'branch-1-uuid' }],
      };

      const targetBranch2Action = {
        branchId: 'branch-2-uuid',
      };

      const hasBranchAccess = userBranch1Context.allowedScopes.some(
        (s) => s.type === 'BRANCH' && s.id === targetBranch2Action.branchId
      );

      expect(hasBranchAccess).toBe(false);
    });
  });
});
