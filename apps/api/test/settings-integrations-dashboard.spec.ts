import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { TenantController } from '../src/modules/tenant/tenant.controller';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import {
  tenants,
  legalEntities,
  branches,
  tenantSubscriptions,
  tenantIntegrations,
  salesOrders,
  inventoryCostLayers,
  warehouses,
  items,
  categories,
  unitsOfMeasure,
  auditLogs,
} from '@restaurant-cloud/database';
import { eq } from 'drizzle-orm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { TenantContext, IndustryType } from '@restaurant-cloud/domain-kernel';

describe('Restaurant Cloud — Settings, Industry Packs, Integrations, WhatsApp & Dashboard (Staging DB)', { timeout: 120000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const leAId = randomUUID();
  const leBId = randomUUID();
  const branchAId = randomUUID();
  const branchBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();

  let ctxA: TenantContext;
  let ctxB: TenantContext;

  beforeAll(async () => {
    const envPath = path.resolve(process.cwd(), '../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    dbService = new DatabaseService();
    await dbService.onModuleInit();
    auditService = new AuditService(dbService);
    tenantService = new TenantService(dbService, auditService);

    ctxA = {
      tenantId: tenantAId,
      userId: userAId,
      legalEntityId: leAId,
      branchId: branchAId,
      permissions: ['*'],
    };
    ctxB = {
      tenantId: tenantBId,
      userId: userBId,
      legalEntityId: leBId,
      branchId: branchBId,
      permissions: ['*'],
    };

    const suffix = Date.now();
    await dbService.db.insert(tenants).values([
      { id: tenantAId, code: `set-a-${suffix}`, displayName: 'Settings Tenant A', status: 'ACTIVE' },
      { id: tenantBId, code: `set-b-${suffix}`, displayName: 'Settings Tenant B', status: 'ACTIVE' },
    ]);

    await dbService.withTenantContext(ctxA, async (tx) => {
      await tx.insert(legalEntities).values({
        id: leAId,
        tenantId: tenantAId,
        legalName: 'Settings LE A',
        vatNumber: '310333333333333',
      });
      await tx.insert(branches).values({
        id: branchAId,
        tenantId: tenantAId,
        legalEntityId: leAId,
        code: `BR-SA-${suffix}`,
        name: 'Settings Branch A',
        status: 'ACTIVE',
      });
      await tx.insert(tenantSubscriptions).values({
        tenantId: tenantAId,
        planCode: 'ENTERPRISE',
        status: 'ACTIVE',
        maxBranches: 15,
        maxDevices: 30,
        maxUsers: 50,
      });
    });

    await dbService.withTenantContext(ctxB, async (tx) => {
      await tx.insert(legalEntities).values({
        id: leBId,
        tenantId: tenantBId,
        legalName: 'Settings LE B',
        vatNumber: '310444444444443',
      });
      await tx.insert(branches).values({
        id: branchBId,
        tenantId: tenantBId,
        legalEntityId: leBId,
        code: `BR-SB-${suffix}`,
        name: 'Settings Branch B',
        status: 'ACTIVE',
      });
    });
  }, 60000);

  afterAll(async () => {
    await dbService.onModuleDestroy();
  });

  it('1. Tenant Settings, Subscription & Industry Pack activation/deactivation', async () => {
    const updated = await tenantService.updateTenantSettings(ctxA, {
      displayName: 'Settings Tenant A Updated',
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
    });
    expect(updated?.displayName).toBe('Settings Tenant A Updated');

    const settings = await tenantService.getTenantSettings(ctxA);
    expect(settings.tenant?.displayName).toBe('Settings Tenant A Updated');
    expect(settings.subscription?.maxBranches).toBe(15);

    await tenantService.activateIndustryPack(ctxA, { industry: IndustryType.CAFE, isPrimary: false });
    const packsAfterAct = await tenantService.getTenantIndustryPacks(ctxA);
    expect(packsAfterAct.activeIndustries).toContain(IndustryType.CAFE);

    await tenantService.deactivateIndustryPack(ctxA, { industry: IndustryType.CAFE });
    const packsAfterDeact = await tenantService.getTenantIndustryPacks(ctxA);
    expect(packsAfterDeact.activeIndustries).not.toContain(IndustryType.CAFE);
  });

  it('2. Integrations (WhatsApp & Webhook) + Notification Dispatch + Idempotency + Pagination', async () => {
    // Dispatch while disabled -> SKIPPED_DISABLED
    const skipped = await tenantService.dispatchNotification(ctxA, {
      channel: 'WHATSAPP',
      recipient: '+966500000001',
      eventType: 'TEST_DISABLED',
      idempotencyKey: `IDEM-SKIP-${Date.now()}`,
    });
    expect(skipped?.status).toBe('SKIPPED_DISABLED');

    // Enable WhatsApp & Webhook with secrets -> verify encrypted in DB & masked in API response
    const wa = await tenantService.upsertTenantIntegration(ctxA, 'WHATSAPP', {
      provider: 'META_CLOUD_API',
      isEnabled: true,
      configJson: { phoneNumberId: '1092837465', accessToken: 'EAAG-SECRET-TOKEN-9876' },
    });
    expect(wa?.isEnabled).toBe(true);
    expect(wa?.configJson?.accessToken).toBe('****9876');

    const wh = await tenantService.upsertTenantIntegration(ctxA, 'WEBHOOK', {
      provider: 'CUSTOM_WEBHOOK',
      isEnabled: true,
      configJson: { webhookUrl: 'https://staging.example.com/hook', webhookSecret: 'whsec_test_123456' },
    });
    expect(wh?.isEnabled).toBe(true);
    expect(wh?.configJson?.webhookSecret).toBe('****3456');

    // Verify stored ciphertext in DB is encrypted (__enc:...)
    await dbService.withTenantContext(ctxA, async (tx) => {
      const rows = await tx.select().from(tenantIntegrations).where(eq(tenantIntegrations.tenantId, tenantAId));
      const rawWh = rows.find((r) => r.channel === 'WEBHOOK');
      expect(String(rawWh?.configJson?.webhookSecret || '')).toMatch(/^__enc:/);
    });

    // Dispatch Webhook -> signed with HMAC-SHA256, verify signature & reject tampered body
    const whPayload = { event: 'SALE_COMPLETED', total: 150 };
    const whLog = await tenantService.dispatchNotification(ctxA, {
      channel: 'WEBHOOK',
      recipient: 'https://staging.example.com/hook',
      eventType: 'SALE_COMPLETED',
      payload: whPayload,
      idempotencyKey: `IDEM-WH-${Date.now()}`,
    });
    expect(whLog?.status).toBe('SENT');
    expect(whLog?.signatureHeader).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    const tsPart = Number(whLog!.signatureHeader!.split(',')[0]!.split('=')[1]);
    const validCheck = await tenantService.verifyWebhookSignature(ctxA, {
      channel: 'WEBHOOK',
      timestamp: tsPart,
      rawBody: JSON.stringify(whPayload),
      signatureHeader: whLog!.signatureHeader!,
      nonce: `nonce-valid-${Date.now()}`,
    });
    expect(validCheck.valid).toBe(true);
    const tamperedCheck = await tenantService.verifyWebhookSignature(ctxA, {
      channel: 'WEBHOOK',
      timestamp: tsPart,
      rawBody: JSON.stringify({ event: 'SALE_COMPLETED', total: 999 }),
      signatureHeader: whLog!.signatureHeader!,
      nonce: `nonce-tampered-${Date.now()}`,
    });
    expect(tamperedCheck.valid).toBe(false);

    // Failed delivery -> RETRY_PENDING -> retry succeeds -> SENT
    const failedLog = await tenantService.dispatchNotification(ctxA, {
      channel: 'WEBHOOK',
      recipient: 'https://staging.example.com/hook',
      eventType: 'RETRY_TEST',
      payload: { ok: false },
      simulateFailure: true,
      idempotencyKey: `IDEM-FAIL-${Date.now()}`,
    });
    expect(failedLog?.status).toBe('RETRY_PENDING');
    const retried = await tenantService.retryPendingNotifications(ctxA, false);
    expect(retried.some((r) => r.id === failedLog?.id && r.status === 'SENT' && r.attemptCount === 2)).toBe(true);

    // Dispatch with idempotencyKey -> SENT, and repeat returns same log ID
    const idemKey = `IDEM-WA-${Date.now()}`;
    const sent1 = await tenantService.dispatchNotification(ctxA, {
      channel: 'WHATSAPP',
      recipient: '+966500000002',
      eventType: 'ORDER_RECEIPT',
      payload: { orderNumber: 'ORD-1001' },
      idempotencyKey: idemKey,
    });
    const sent2 = await tenantService.dispatchNotification(ctxA, {
      channel: 'WHATSAPP',
      recipient: '+966500000002',
      eventType: 'ORDER_RECEIPT',
      payload: { orderNumber: 'ORD-1001' },
      idempotencyKey: idemKey,
    });
    expect(sent1?.status).toBe('SENT');
    expect(sent2?.id).toBe(sent1?.id);

    const logsPage1 = await tenantService.getNotificationLogs(ctxA, 1, 0);
    expect(logsPage1.length).toBe(1);
  });

  it('3. Live Dashboard Summary returns real DB aggregates', async () => {
    const summary = await tenantService.getDashboardSummary(ctxA);
    expect(summary).toHaveProperty('salesToday');
    expect(summary).toHaveProperty('weeklySales');
    expect(summary).toHaveProperty('purchasing');
    expect(summary).toHaveProperty('inventory');
    expect(summary.inventory).toHaveProperty('totalInventoryValue');
    expect(summary).toHaveProperty('zatca');
    expect(typeof summary.salesToday.orderCount).toBe('number');
  });

  it('4. Multi-Tenant RLS Isolation & RBAC Metadata Enforcement', async () => {
    // Tenant B cannot see Tenant A integrations or notification logs
    const tenantBIntegrations = await tenantService.getTenantIntegrations(ctxB);
    const tenantBLogs = await tenantService.getNotificationLogs(ctxB, 25, 0);
    expect(tenantBIntegrations.length).toBe(0);
    expect(tenantBLogs.length).toBe(0);

    const upsertPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TenantController.prototype.upsertIntegration
    );
    const dispatchPerms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      TenantController.prototype.dispatchNotification
    );
    expect(upsertPerms).toContain('tenant.update');
    expect(dispatchPerms).toContain('tenant.update');
  });

  it('5. Subscription maxBranches & maxDevices limits enforced atomically (including concurrency)', async () => {
    // Set tenant B subscription limit to maxBranches = 2 (already has 1 branch -> 1 slot left)
    await dbService.withTenantContext(ctxB, async (tx) => {
      await tx.insert(tenantSubscriptions).values({
        tenantId: tenantBId,
        planCode: 'STARTER',
        status: 'ACTIVE',
        maxBranches: 2,
        maxDevices: 1,
        maxUsers: 5,
      });
    });

    const concBranches = await Promise.allSettled([
      tenantService.createBranch(ctxB, {
        legalEntityId: leBId,
        code: `BR-B2-${Date.now()}`,
        name: 'Branch B2',
        businessType: 'RESTAURANT',
        timezone: 'Asia/Riyadh',
      }),
      tenantService.createBranch(ctxB, {
        legalEntityId: leBId,
        code: `BR-B3-${Date.now()}`,
        name: 'Branch B3',
        businessType: 'RESTAURANT',
        timezone: 'Asia/Riyadh',
      }),
    ]);
    expect(concBranches.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(concBranches.filter((r) => r.status === 'rejected').length).toBe(1);

    // Device limit maxDevices = 1: first succeeds, second rejected
    await tenantService.registerDevice(ctxB, {
      branchId: branchBId,
      deviceCode: `POS-B1-${Date.now()}`,
      deviceType: 'POS',
    });
    await expect(
      tenantService.registerDevice(ctxB, {
        branchId: branchBId,
        deviceCode: `POS-B2-${Date.now()}`,
        deviceType: 'POS',
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('6. INTEGRATION_ENCRYPTION_KEY: mandatory on Staging, independent of JWT_SECRET, restart & key rotation', async () => {
    const origKey = process.env.INTEGRATION_ENCRYPTION_KEY!;
    const origPrev = process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;
    const origNodeEnv = process.env.NODE_ENV;
    const origJwt = process.env.JWT_SECRET;

    try {
      // Missing key on staging -> onModuleInit fails fast
      process.env.NODE_ENV = 'staging';
      delete process.env.INTEGRATION_ENCRYPTION_KEY;
      expect(() => new TenantService(dbService, auditService).onModuleInit()).toThrow();

      // Equal to JWT_SECRET -> rejected
      process.env.JWT_SECRET = 'jwt-secret-should-never-be-integration-key-123456';
      process.env.INTEGRATION_ENCRYPTION_KEY = process.env.JWT_SECRET;
      expect(() => new TenantService(dbService, auditService).onModuleInit()).toThrow();

      // Restore valid key & test simulated app restart + key rotation
      process.env.INTEGRATION_ENCRYPTION_KEY = origKey;
      const restartedSvc1 = new TenantService(dbService, auditService);
      restartedSvc1.onModuleInit();
      const maskedAfterRestart = await restartedSvc1.getTenantIntegrations(ctxA);
      const whMasked = maskedAfterRestart.find((i) => i.channel === 'WEBHOOK');
      expect(String(whMasked?.configJson?.webhookSecret || '')).toBe('****3456');
      expect(JSON.stringify(maskedAfterRestart)).not.toContain(origKey);

      // Rotate to a new key while keeping old key in INTEGRATION_ENCRYPTION_PREVIOUS_KEYS
      const rotatedNewKey = '9f'.repeat(32);
      process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = origKey;
      process.env.INTEGRATION_ENCRYPTION_KEY = rotatedNewKey;

      const restartedSvc2 = new TenantService(dbService, auditService);
      restartedSvc2.onModuleInit();

      // Verify old encrypted webhookSecret still decrypts & verifies signature
      const ts = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({ event: 'ROTATION_TEST' });
      const sig = createHmac('sha256', 'whsec_test_123456')
        .update(`${ts}.${payload}`)
        .digest('hex');
      const preRotateCheck = await restartedSvc2.verifyWebhookSignature(ctxA, {
        channel: 'WEBHOOK',
        timestamp: ts,
        rawBody: payload,
        signatureHeader: `t=${ts},v1=${sig}`,
        nonce: `nonce-rot-pre-${Date.now()}`,
      });
      expect(preRotateCheck.valid).toBe(true);

      // Re-encrypt secrets under new primary key and drop previous key
      const rotRes = await restartedSvc2.rotateIntegrationSecrets(ctxA);
      expect(rotRes.rotatedSecrets).toBeGreaterThanOrEqual(2);
      delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;

      const restartedSvc3 = new TenantService(dbService, auditService);
      const postRotateCheck = await restartedSvc3.verifyWebhookSignature(ctxA, {
        channel: 'WEBHOOK',
        timestamp: ts,
        rawBody: payload,
        signatureHeader: `t=${ts},v1=${sig}`,
        nonce: `nonce-rot-post-${Date.now()}`,
      });
      expect(postRotateCheck.valid).toBe(true);

      // Audit logs never leak raw key
      await dbService.withTenantContext(ctxA, async (tx) => {
        const logs = await tx.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantAId));
        const serialized = JSON.stringify(logs);
        expect(serialized).not.toContain(rotatedNewKey);
        expect(serialized).not.toContain('whsec_test_123456');
      });

      // Rotate back to origKey for subsequent tests
      process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = rotatedNewKey;
      process.env.INTEGRATION_ENCRYPTION_KEY = origKey;
      await new TenantService(dbService, auditService).rotateIntegrationSecrets(ctxA);
    } finally {
      process.env.INTEGRATION_ENCRYPTION_KEY = origKey;
      if (origPrev === undefined) delete process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS;
      else process.env.INTEGRATION_ENCRYPTION_PREVIOUS_KEYS = origPrev;
      if (origNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = origNodeEnv;
      if (origJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = origJwt;
    }
  });

  it('7. Webhook Replay Protection: atomic nonce, 5-min window, and concurrent replay rejection', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event: 'REPLAY_TEST', amount: 42 });
    const sig = createHmac('sha256', 'whsec_test_123456')
      .update(`${nowSec}.${body}`)
      .digest('hex');
    const header = `t=${nowSec},v1=${sig}`;

    // Missing nonce rejected
    await expect(
      tenantService.verifyWebhookSignature(ctxA, {
        channel: 'WEBHOOK',
        timestamp: nowSec,
        rawBody: body,
        signatureHeader: header,
      })
    ).rejects.toThrow(BadRequestException);

    // Expired timestamp (> 5 min) rejected
    const oldSec = nowSec - 305;
    const oldSig = createHmac('sha256', 'whsec_test_123456')
      .update(`${oldSec}.${body}`)
      .digest('hex');
    await expect(
      tenantService.verifyWebhookSignature(ctxA, {
        channel: 'WEBHOOK',
        timestamp: oldSec,
        rawBody: body,
        signatureHeader: `t=${oldSec},v1=${oldSig}`,
        nonce: `nonce-expired-${Date.now()}`,
      })
    ).rejects.toThrow(BadRequestException);

    // First valid request succeeds; replay within 5 min rejected
    const replayNonce = `nonce-replay-${Date.now()}`;
    const first = await tenantService.verifyWebhookSignature(ctxA, {
      channel: 'WEBHOOK',
      timestamp: nowSec,
      rawBody: body,
      signatureHeader: header,
      nonce: replayNonce,
    });
    expect(first.valid).toBe(true);

    await expect(
      tenantService.verifyWebhookSignature(ctxA, {
        channel: 'WEBHOOK',
        timestamp: nowSec,
        rawBody: body,
        signatureHeader: header,
        nonce: replayNonce,
      })
    ).rejects.toThrow(ConflictException);

    // 5 concurrent requests with the same nonce -> exactly 1 succeeds, 4 rejected
    const concNonce = `nonce-conc-${Date.now()}`;
    const concResults = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        tenantService.verifyWebhookSignature(ctxA, {
          channel: 'WEBHOOK',
          timestamp: nowSec,
          rawBody: body,
          signatureHeader: header,
          nonce: concNonce,
        })
      )
    );
    expect(concResults.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(concResults.filter((r) => r.status === 'rejected').length).toBe(4);
  });

  it('8. Dashboard Summary matches Sales & Inventory Cost Layers with zero multi-branch/multi-entity double counting', async () => {
    // Create 2nd legal entity & 2nd branch on Tenant A
    const le2 = await tenantService.createLegalEntity(ctxA, {
      legalName: 'Entity A2',
      vatNumber: '310000000000009',
    });
    const br2 = await tenantService.createBranch(ctxA, {
      legalEntityId: le2.id,
      code: `BR-A2-${Date.now()}`,
      name: 'Branch A2',
      businessType: 'RESTAURANT',
      timezone: 'Asia/Riyadh',
    });
    const dev1 = await tenantService.registerDevice(ctxA, {
      branchId: branchAId,
      deviceCode: `POS-A1-${Date.now()}`,
      deviceType: 'POS',
    });
    const dev2 = await tenantService.registerDevice(ctxA, {
      branchId: br2.id,
      deviceCode: `POS-A2-${Date.now()}`,
      deviceType: 'POS',
    });

    await dbService.withTenantContext(ctxA, async (tx) => {
      const [wh] = await tx
        .insert(warehouses)
        .values({
          tenantId: tenantAId,
          legalEntityId: le2.id,
          branchId: br2.id,
          code: `WH-A2-${Date.now()}`,
          name: 'Warehouse A2',
          warehouseType: 'BRANCH',
          status: 'ACTIVE',
          allowReceiving: true,
          allowIssuing: true,
        })
        .returning();
      const [uom] = await tx
        .insert(unitsOfMeasure)
        .values({
          tenantId: tenantAId,
          code: `PCS-${Date.now()}`,
          nameAr: 'قطعة',
          nameEn: 'Piece',
          category: 'COUNT',
          isBase: true,
        })
        .returning();
      const [item] = await tx
        .insert(items)
        .values({
          tenantId: tenantAId,
          legalEntityOwnerId: le2.id,
          baseUomId: uom!.id,
          sku: `SKU-${Date.now()}`,
          nameAr: 'برغر',
          nameEn: 'Burger',
          defaultCost: '15.5000',
        })
        .returning();

      await tx.insert(inventoryCostLayers).values({
        tenantId: tenantAId,
        legalEntityOwnerId: le2.id,
        warehouseId: wh!.id,
        itemId: item!.id,
        quantityReceived: '10.0000',
        quantityRemaining: '10.0000',
        unitCost: '15.5000',
        sourceType: 'OPENING_BALANCE',
        sourceId: randomUUID(),
      });

      await tx.insert(salesOrders).values([
        {
          tenantId: tenantAId,
          legalEntityId: leAId,
          branchId: branchAId,
          deviceId: dev1.id,
          orderNumber: `SO-A1-${Date.now()}`,
          channel: 'POS',
          status: 'COMPLETED',
          subtotal: '100.0000',
          taxTotal: '15.0000',
          grandTotal: '115.0000',
        },
        {
          tenantId: tenantAId,
          legalEntityId: le2.id,
          branchId: br2.id,
          deviceId: dev2.id,
          orderNumber: `SO-A2-${Date.now()}`,
          channel: 'POS',
          status: 'COMPLETED',
          subtotal: '200.0000',
          taxTotal: '30.0000',
          grandTotal: '230.0000',
        },
      ]);
    });

    const summary = await tenantService.getDashboardSummary(ctxA);
    expect(summary.salesToday.orderCount).toBe(2);
    expect(Number(summary.salesToday.totalAmount)).toBeCloseTo(345, 2);
    expect(Number(summary.inventory.totalInventoryValue)).toBeCloseTo(155, 2);
  });
});
