import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { eq, and, sql } from 'drizzle-orm';

import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import { MediaService } from '../src/modules/media/media.service';
import { MediaController } from '../src/modules/media/media.controller';
import { DeliveryController } from '../src/modules/delivery/delivery.controller';
import { InventoryController } from '../src/modules/inventory/inventory.controller';
import { PurchasingController } from '../src/modules/purchasing/purchasing.controller';
import { ProductionController } from '../src/modules/production/production.controller';
import { AccountingController } from '../src/modules/accounting/accounting.controller';
import { SalesController } from '../src/modules/sales/sales.controller';
import { TenantController } from '../src/modules/tenant/tenant.controller';
import {
  PERMISSIONS_KEY,
  ANY_PERMISSIONS_KEY,
} from '../src/common/decorators/permissions.decorator';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { FinancialResourcesService } from '../src/modules/accounting/financial-resources.service';
import { ProductionService } from '../src/modules/production/production.service';
import { SalesService } from '../src/modules/sales/sales.service';

import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
  OrderStatus,
  OrderType,
  OrderChannel,
  PaymentMethod,
  PaymentStatus,
  RecipeStatus,
} from '@restaurant-cloud/domain-kernel';
import {
  cashVaults,
  inventoryBalances,
  inventoryMovements,
  items,
  journalEntries,
  journalLines,
  payments,
  recipes,
  recipeIngredients,
  salesOrders,
  unitsOfMeasure,
  warehouses,
} from '@restaurant-cloud/database';

describe(
  'Restaurant Cloud — Security, RBAC & Financial Integrity Remediation Suite',
  { timeout: 90000 },
  () => {
    let dbService: DatabaseService;
    let auditService: AuditService;
    let tenantService: TenantService;
    let opsFramework: OperationsFrameworkService;
    let mediaService: MediaService;
    let mediaController: MediaController;
    let postingEngine: PostingEngineService;
    let accountingService: AccountingService;
    let financialResourcesService: FinancialResourcesService;
    let productionService: ProductionService;
    let salesService: SalesService;

    let tenantId: string;
    let adminUserId: string;
    let legalEntityId: string;
    let branchId: string;
    let warehouseId: string;
    let vault1Id: string;
    let vault2Id: string;
    let vaultAccountId: string;
    let deviceId: string;
    let uomPcsId: string;
    let pattyItemId: string;
    let burgerItemId: string;
    let sysCtx: TenantContext;

    const uploadedMediaIds: string[] = [];
    const tenantCode = `rem-${Date.now().toString(36).slice(-6)}`;

    beforeAll(async () => {
      const envPath = path.resolve(__dirname, '../../../.env');
      if (fs.existsSync(envPath)) {
        process.loadEnvFile(envPath);
      }

      dbService = new DatabaseService();
      await dbService.onModuleInit();

      auditService = new AuditService(dbService);
      tenantService = new TenantService(dbService, auditService);
      opsFramework = new OperationsFrameworkService(dbService, auditService);
      mediaService = new MediaService(dbService);
      mediaController = new MediaController(mediaService);
      postingEngine = new PostingEngineService(dbService, auditService);
      accountingService = new AccountingService(
        dbService,
        auditService,
        postingEngine,
        opsFramework,
      );
      financialResourcesService = new FinancialResourcesService(
        dbService,
        auditService,
        opsFramework,
      );
      productionService = new ProductionService(
        dbService,
        auditService,
        postingEngine,
      );
      salesService = new SalesService(
        dbService,
        auditService,
        productionService,
        accountingService,
        postingEngine,
        opsFramework,
      );

      // Onboard isolated Staging test tenant
      const tenantResult = await tenantService.onboardTenant({
        code: tenantCode,
        displayName: `Remediation QA Tenant ${tenantCode}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'شركة التحقق الأمني والمالي ذ.م.م',
          commercialName: 'Security & Integrity QA LLC',
          vatNumber: '310777777700003',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BR-QA-01',
          name: 'فرع الاختبار الرئيسي',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `admin-${tenantCode}@restaurant-cloud.test`,
          displayName: 'مدير الجودة والأمان',
          password: 'Password123!Secure',
        },
      });

      tenantId = tenantResult.tenant.id;
      adminUserId = tenantResult.user.id;
      legalEntityId = tenantResult.legalEntity.id;
      branchId = tenantResult.branch.id;

      sysCtx = {
        tenantId,
        legalEntityId,
        branchId,
        userId: adminUserId,
        email: `admin-${tenantCode}@restaurant-cloud.test`,
        role: 'SUPER_ADMIN',
        scopes: ['*'],
      };

      // Open Fiscal Period
      const currentYear = new Date().getFullYear();
      await accountingService.createFiscalPeriod(sysCtx, {
        legalEntityId,
        periodName: `FY-${currentYear}`,
        startDate: `${currentYear}-01-01T00:00:00.000Z`,
        endDate: `${currentYear}-12-31T23:59:59.000Z`,
      });

      // Create COA Accounts & Default Mappings
      const salesAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId,
        accountCode: '411000',
        name: 'إيراد المبيعات',
        accountType: AccountType.REVENUE,
        normalBalance: NormalBalance.CREDIT,
        isPostable: true,
      });

      const vatAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId,
        accountCode: '211200',
        name: 'ضريبة القيمة المضافة المستحقة',
        accountType: AccountType.LIABILITY,
        normalBalance: NormalBalance.CREDIT,
        isPostable: true,
      });

      const cogsAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId,
        accountCode: '511000',
        name: 'تكلفة البضاعة المباعة',
        accountType: AccountType.COGS,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });

      const invAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId,
        accountCode: '112000',
        name: 'مخزون المواد الخام',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });

      const vaultAcc = await accountingService.createAccount(sysCtx, {
        legalEntityId,
        accountCode: '111100',
        name: 'نقدية الصندوق',
        accountType: AccountType.ASSET,
        normalBalance: NormalBalance.DEBIT,
        isPostable: true,
      });
      vaultAccountId = vaultAcc.id;

      await accountingService.setAccountMapping(sysCtx, {
        legalEntityId,
        mappingKey: DefaultAccountMappingKey.SALES,
        accountId: salesAcc.id,
      });
      await accountingService.setAccountMapping(sysCtx, {
        legalEntityId,
        mappingKey: DefaultAccountMappingKey.VAT_OUTPUT,
        accountId: vatAcc.id,
      });
      await accountingService.setAccountMapping(sysCtx, {
        legalEntityId,
        mappingKey: DefaultAccountMappingKey.COGS,
        accountId: cogsAcc.id,
      });
      await accountingService.setAccountMapping(sysCtx, {
        legalEntityId,
        mappingKey: DefaultAccountMappingKey.INVENTORY,
        accountId: invAcc.id,
      });
      await accountingService.setAccountMapping(sysCtx, {
        legalEntityId,
        mappingKey: DefaultAccountMappingKey.CASH_VAULT,
        accountId: vaultAccountId,
      });

      // Create two Cash Vaults & POS Device
      const v1 = await financialResourcesService.createCashVault(sysCtx, {
        legalEntityId,
        branchId,
        code: `VLT1-${Date.now().toString().slice(-4)}`,
        nameAr: 'خزينة الكاشير الرئيسية',
        accountId: vaultAccountId,
      });
      vault1Id = v1.id;

      const v2 = await financialResourcesService.createCashVault(sysCtx, {
        legalEntityId,
        branchId,
        code: `VLT2-${Date.now().toString().slice(-4)}`,
        nameAr: 'خزينة الإدارة الاحتياطية',
        accountId: vaultAccountId,
      });
      vault2Id = v2.id;

      await dbService.withTenantContext(sysCtx, async (tx) => {
        await tx
          .update(cashVaults)
          .set({ balance: '100.0000' })
          .where(eq(cashVaults.id, vault1Id));
      });

      const dev = await financialResourcesService.createPosDevice(sysCtx, {
        legalEntityId,
        branchId,
        deviceCode: `POS-QA-${Date.now().toString().slice(-4)}`,
        name: 'جهاز نقاط البيع الرئيسي',
        deviceType: 'POS',
        cashVaultId: vault1Id,
      });
      deviceId = dev.id;

      // Seed Warehouse, UoM, Items, Recipe, and Inventory Balance
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [wh] = await tx
          .insert(warehouses)
          .values({
            tenantId,
            legalEntityId,
            branchId,
            code: `WH-QA-${Date.now().toString().slice(-4)}`,
            name: 'مستودع التشغيل الرئيسي',
            type: 'STORAGE',
          })
          .returning();
        warehouseId = wh.id;

        const [uPcs] = await tx
          .insert(unitsOfMeasure)
          .values({
            tenantId,
            code: `PCS-${Date.now().toString().slice(-4)}`,
            nameAr: 'حبة',
            nameEn: 'Piece',
            category: 'UNIT',
            isBase: true,
          })
          .returning();
        uomPcsId = uPcs.id;

        const [patty] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: legalEntityId,
            sku: `RAW-PATTY-${Date.now().toString().slice(-4)}`,
            nameAr: 'شريحة لحم برجر',
            nameEn: 'Beef Patty',
            baseUomId: uomPcsId,
            defaultCost: '10.0000',
          })
          .returning();
        pattyItemId = patty.id;

        const [burger] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: legalEntityId,
            sku: `MENU-BRG-${Date.now().toString().slice(-4)}`,
            nameAr: 'برجر كلاسيك',
            nameEn: 'Classic Burger',
            baseUomId: uomPcsId,
            defaultPrice: '50.0000',
          })
          .returning();
        burgerItemId = burger.id;

        await tx.insert(inventoryBalances).values({
          tenantId,
          legalEntityOwnerId: legalEntityId,
          warehouseId,
          itemId: pattyItemId,
          onHandQty: '20.0000',
          allocatedQty: '0.0000',
        });

        const [recipe] = await tx
          .insert(recipes)
          .values({
            tenantId,
            legalEntityId,
            recipeCode: `RCP-${Date.now().toString().slice(-5)}`,
            outputItemId: burgerItemId,
            yieldQuantity: '1.0000',
            yieldUomId: uomPcsId,
            status: RecipeStatus.ACTIVE,
            isCurrent: true,
          })
          .returning();

        await tx.insert(recipeIngredients).values({
          recipeId: recipe.id,
          ingredientItemId: pattyItemId,
          quantity: '1.0000',
          uomId: uomPcsId,
          wastePercentage: '0.0000',
        });
      });
    }, 60000);

    afterAll(async () => {
      // Clean up any uploaded test media files on disk
      for (const fileId of uploadedMediaIds) {
        try {
          await mediaService.deleteMedia(sysCtx, fileId);
        } catch {
          // ignore cleanup errors
        }
      }
      if (dbService) {
        await dbService.onModuleDestroy();
      }
    }, 30000);

    // =========================================================================
    // 1. OperationsFrameworkService.assertCanDelete — SQL Injection Guard
    // =========================================================================
    describe('1. OperationsFrameworkService.assertCanDelete UUID Validation', () => {
      it('rejects SQL injection payload in entityId cleanly without executing raw SQL', async () => {
        const sqliPayload = "'; DROP TABLE items; --";
        await expect(
          opsFramework.assertCanDelete(sysCtx, 'item', sqliPayload),
        ).rejects.toThrow(BadRequestException);

        // Verify items table is completely intact
        const countRes = await dbService.withTenantContext(sysCtx, async (tx) => {
          return await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(items)
            .where(eq(items.tenantId, tenantId));
        });
        expect(countRes[0]?.count).toBeGreaterThanOrEqual(2);
      });

      it('rejects non-UUID entityId across entity types cleanly', async () => {
        await expect(
          opsFramework.assertCanDelete(sysCtx, 'category', 'not-a-valid-uuid'),
        ).rejects.toThrow(BadRequestException);

        await expect(
          opsFramework.assertCanDelete(sysCtx, 'uom', '12345'),
        ).rejects.toThrow(BadRequestException);
      });

      it('allows valid unreferenced UUID without throwing', async () => {
        await expect(
          opsFramework.assertCanDelete(sysCtx, 'item', randomUUID()),
        ).resolves.not.toThrow();
      });
    });

    // =========================================================================
    // 2. MediaService & MediaController — SVG XSS Rejection & Safe Headers
    // =========================================================================
    describe('2. MediaService & MediaController Security', () => {
      it('rejects image/svg+xml in validateFile and uploadFile to prevent stored XSS', async () => {
        const svgBuffer = Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("XSS")</script></svg>',
          'utf-8',
        );

        expect(() =>
          mediaService.validateFile('malicious.svg', 'image/svg+xml', svgBuffer),
        ).toThrow(BadRequestException);

        await expect(
          mediaService.uploadFile(sysCtx, {
            originalName: 'malicious.svg',
            mimeType: 'image/svg+xml',
            buffer: svgBuffer,
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('serves valid image with X-Content-Type-Options: nosniff and Content-Disposition headers', async () => {
        // Minimal valid 1x1 PNG buffer
        const pngBuffer = Buffer.from(
          '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
          'hex',
        );

        const uploaded = await mediaService.uploadFile(sysCtx, {
          originalName: 'safe-burger.png',
          mimeType: 'image/png',
          buffer: pngBuffer,
          entityType: 'item',
          entityId: burgerItemId,
        });
        uploadedMediaIds.push(uploaded.id);

        const headers: Record<string, string | number> = {};
        let sentBody: Buffer | undefined;
        const mockReply = {
          header(key: string, value: string | number) {
            headers[key.toLowerCase()] = value;
            return this;
          },
          send(body: Buffer) {
            sentBody = body;
            return this;
          },
        };

        await mediaController.getFile(sysCtx, uploaded.id, mockReply);

        expect(headers['x-content-type-options']).toBe('nosniff');
        expect(headers['content-disposition']).toBeDefined();
        expect(String(headers['content-disposition'])).toMatch(
          /^(inline|attachment)/i,
        );
        expect(sentBody).toEqual(pngBuffer);
      });
    });

    // =========================================================================
    // 3. DeliveryController RBAC Metadata (Dot-Separated Permissions)
    // =========================================================================
    describe('3. DeliveryController RBAC Metadata', () => {
      it('uses only dot-separated delivery.* permissions on all endpoints', () => {
        const expectedDeliveryPerms = new Set([
          'delivery.manage',
          'delivery.view',
          'delivery.dispatch',
          'delivery.settle',
        ]);

        const proto = DeliveryController.prototype as Record<string, any>;
        const methodNames = Object.getOwnPropertyNames(proto).filter(
          (name) => name !== 'constructor' && typeof proto[name] === 'function',
        );

        expect(methodNames.length).toBeGreaterThan(0);

        for (const methodName of methodNames) {
          const handler = proto[methodName];
          const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
          if (httpMethod === undefined) continue;

          const perms = Reflect.getMetadata(PERMISSIONS_KEY, handler) as
            | string[]
            | undefined;
          const anyPerms = Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler) as
            | string[]
            | undefined;
          const combined = [...(perms ?? []), ...(anyPerms ?? [])];

          expect(
            combined.length,
            `DeliveryController.${methodName} must declare RBAC permissions`,
          ).toBeGreaterThan(0);

          for (const perm of combined) {
            expect(
              perm,
              `DeliveryController.${methodName} permission "${perm}" must not use colon separator`,
            ).not.toContain(':');
            expect(
              expectedDeliveryPerms.has(perm),
              `DeliveryController.${methodName} permission "${perm}" must be one of delivery.manage|view|dispatch|settle`,
            ).toBe(true);
          }
        }
      });
    });

    // =========================================================================
    // 4. GET Endpoint RBAC Metadata Across Core Controllers
    // =========================================================================
    describe('4. GET Endpoint RBAC Metadata Across Core Controllers', () => {
      const controllers = [
        InventoryController,
        PurchasingController,
        ProductionController,
        AccountingController,
        SalesController,
        TenantController,
      ];

      it.each(controllers.map((c) => [c.name, c]))(
        '%s: every @Get endpoint declares @RequirePermissions or @RequireAnyPermissions',
        (_name, ControllerClass) => {
          const proto = ControllerClass.prototype as Record<string, any>;
          const methodNames = Object.getOwnPropertyNames(proto).filter(
            (name) => name !== 'constructor' && typeof proto[name] === 'function',
          );

          const getEndpoints: string[] = [];
          for (const methodName of methodNames) {
            const handler = proto[methodName];
            const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
            if (httpMethod === RequestMethod.GET) {
              getEndpoints.push(methodName);
              const perms = Reflect.getMetadata(PERMISSIONS_KEY, handler) as
                | string[]
                | undefined;
              const anyPerms = Reflect.getMetadata(
                ANY_PERMISSIONS_KEY,
                handler,
              ) as string[] | undefined;

              const hasRbac =
                (Array.isArray(perms) && perms.length > 0) ||
                (Array.isArray(anyPerms) && anyPerms.length > 0);

              expect(
                hasRbac,
                `${ControllerClass.name}.${methodName} (@Get) is missing @RequirePermissions / @RequireAnyPermissions`,
              ).toBe(true);
            }
          }

          expect(getEndpoints.length).toBeGreaterThan(0);
        },
      );
    });

    // =========================================================================
    // 5. SalesController.refundOrder & SalesService.refundSalesOrder + ProductionService GL/Inventory
    // =========================================================================
    describe('5. Sales Refund Endpoint, Service & Production GL/Inventory Integration', () => {
      it('SalesController.refundSalesOrder is decorated with @Post("orders/:id/refund") and RBAC permissions', () => {
        const proto = SalesController.prototype as Record<string, any>;
        const handler = proto.refundSalesOrder || proto.refundOrder;

        expect(
          typeof handler,
          'SalesController.refundSalesOrder method must exist',
        ).toBe('function');

        const httpMethod = Reflect.getMetadata(METHOD_METADATA, handler);
        const routePath = Reflect.getMetadata(PATH_METADATA, handler);
        const perms = Reflect.getMetadata(PERMISSIONS_KEY, handler) as
          | string[]
          | undefined;
        const anyPerms = Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler) as
          | string[]
          | undefined;

        expect(httpMethod).toBe(RequestMethod.POST);
        expect(routePath).toBe('orders/:id/refund');
        expect(
          (perms?.length ?? 0) + (anyPerms?.length ?? 0),
        ).toBeGreaterThan(0);
      });

      it('SalesService.refundSalesOrder restores inventory via ProductionService, updates vault, and posts balanced GL entry', async () => {
        // 1. Open shift
        const shift = await salesService.openShift(sysCtx, {
          legalEntityId,
          branchId,
          deviceId,
          openingFloat: '100.0000',
        });
        expect(shift.id).toBeDefined();

        // 2. Create PAID order for 2 burgers (50 + 7.50 VAT = 57.50 each -> 115.00 total)
        const order = await salesService.createSalesOrder(sysCtx, {
          legalEntityId,
          branchId,
          deviceId,
          warehouseId,
          orderNumber: `ORD-REM-${Date.now().toString().slice(-6)}`,
          orderType: OrderType.TAKEAWAY,
          channel: OrderChannel.POS,
          lines: [
            {
              itemId: burgerItemId,
              uomId: uomPcsId,
              quantity: '2.0000',
              unitPrice: '50.0000',
              discountAmount: '0.0000',
            },
          ],
          payments: [
            {
              paymentMethod: PaymentMethod.CASH,
              amount: '115.0000',
            },
          ],
        });

        expect(order.status).toBe(OrderStatus.PAID);

        // Verify inventory deducted by ProductionService.consumeForSaleTx (20 -> 18)
        const [balAfterSale] = await dbService.withTenantContext(
          sysCtx,
          async (tx) =>
            await tx
              .select()
              .from(inventoryBalances)
              .where(
                and(
                  eq(inventoryBalances.tenantId, tenantId),
                  eq(inventoryBalances.warehouseId, warehouseId),
                  eq(inventoryBalances.itemId, pattyItemId),
                ),
              ),
        );
        expect(parseFloat(balAfterSale.onHandQty)).toBeCloseTo(18, 4);

        const [vaultAfterSale] = await dbService.withTenantContext(
          sysCtx,
          async (tx) =>
            await tx
              .select()
              .from(cashVaults)
              .where(eq(cashVaults.id, vault1Id)),
        );
        const vaultBalanceBeforeRefund = parseFloat(vaultAfterSale.balance);

        // 3. Execute partial refund (50% = 57.50 SAR) with restockInventory: true
        const refundResult = await salesService.refundSalesOrder(
          sysCtx,
          order.id,
          {
            refundAmount: '57.5000',
            reason: 'CUSTOMER_RETURN_TEST',
            approvedBy: adminUserId,
            paymentMethod: PaymentMethod.CASH,
            restockInventory: true,
          },
        );

        expect(refundResult.status).toBe(OrderStatus.PARTIALLY_REFUNDED);
        expect(refundResult.refundJournal).toBeDefined();

        // Verify vault balance decremented by 57.50
        const [vaultAfterRefund] = await dbService.withTenantContext(
          sysCtx,
          async (tx) =>
            await tx
              .select()
              .from(cashVaults)
              .where(eq(cashVaults.id, vault1Id)),
        );
        expect(parseFloat(vaultAfterRefund.balance)).toBeCloseTo(
          vaultBalanceBeforeRefund - 57.5,
          4,
        );

        // Verify negative refund payment record exists
        const orderPayments = await dbService.withTenantContext(
          sysCtx,
          async (tx) =>
            await tx
              .select()
              .from(payments)
              .where(
                and(
                  eq(payments.tenantId, tenantId),
                  eq(payments.orderId, order.id),
                  eq(payments.status, PaymentStatus.REFUNDED),
                ),
              ),
        );
        expect(orderPayments.length).toBeGreaterThanOrEqual(1);
        expect(parseFloat(orderPayments[0].amount)).toBeCloseTo(-57.5, 4);

        // Verify ProductionService.restoreForReturnTx restored 1 patty (18 -> 19)
        const [balAfterRefund] = await dbService.withTenantContext(
          sysCtx,
          async (tx) =>
            await tx
              .select()
              .from(inventoryBalances)
              .where(
                and(
                  eq(inventoryBalances.tenantId, tenantId),
                  eq(inventoryBalances.warehouseId, warehouseId),
                  eq(inventoryBalances.itemId, pattyItemId),
                ),
              ),
        );
        expect(parseFloat(balAfterRefund.onHandQty)).toBeCloseTo(19, 4);

        // Verify refund GL journal entry is balanced
        const jLines = await dbService.withTenantContext(sysCtx, async (tx) => {
          return await tx
            .select()
            .from(journalLines)
            .where(eq(journalLines.journalEntryId, refundResult.refundJournal.id));
        });
        const totalDebit = jLines.reduce(
          (sum, l) => sum + parseFloat(l.debit),
          0,
        );
        const totalCredit = jLines.reduce(
          (sum, l) => sum + parseFloat(l.credit),
          0,
        );
        expect(totalDebit).toBeGreaterThan(0);
        expect(totalDebit).toBeCloseTo(totalCredit, 4);
      });
    });

    // =========================================================================
    // 6. Concurrent Vault Operations — No Negative Balances or Race Conditions
    // =========================================================================
    describe('6. Concurrent Vault Operations (Promise.allSettled)', () => {
      it('prevents negative balances and race conditions under concurrent vault transfers', async () => {
        // Set known initial balances: vault1 = 100.0000, vault2 = 0.0000
        await dbService.withTenantContext(sysCtx, async (tx) => {
          await tx
            .update(cashVaults)
            .set({ balance: '100.0000' })
            .where(eq(cashVaults.id, vault1Id));
          await tx
            .update(cashVaults)
            .set({ balance: '0.0000' })
            .where(eq(cashVaults.id, vault2Id));
        });

        // Fire 5 concurrent transfers of 40.0000 SAR each (total attempted = 200.0000 > 100.0000)
        const attempts = Array.from({ length: 5 }, (_, idx) =>
          accountingService.transferBetweenVaults(sysCtx, {
            legalEntityId,
            fromVaultId: vault1Id,
            toVaultId: vault2Id,
            amount: '40.0000',
            notes: `Concurrent transfer #${idx + 1}`,
          }),
        );

        const results = await Promise.allSettled(attempts);
        const fulfilledCount = results.filter(
          (r) => r.status === 'fulfilled',
        ).length;

        // At most 2 transfers of 40 SAR can succeed from a 100 SAR vault
        expect(fulfilledCount).toBeLessThanOrEqual(2);
        expect(fulfilledCount).toBeGreaterThanOrEqual(1);

        // Verify final vault balances: never negative and total funds conserved
        const [v1Final, v2Final] = await dbService.withTenantContext(
          sysCtx,
          async (tx) => {
            const [a] = await tx
              .select()
              .from(cashVaults)
              .where(eq(cashVaults.id, vault1Id));
            const [b] = await tx
              .select()
              .from(cashVaults)
              .where(eq(cashVaults.id, vault2Id));
            return [a, b];
          },
        );

        const b1 = parseFloat(v1Final.balance);
        const b2 = parseFloat(v2Final.balance);

        expect(b1).toBeGreaterThanOrEqual(0);
        expect(b2).toBeGreaterThanOrEqual(0);
        expect(b1 + b2).toBeCloseTo(100, 4);
        expect(b1).toBeCloseTo(100 - fulfilledCount * 40, 4);
        expect(b2).toBeCloseTo(fulfilledCount * 40, 4);
      });
    });
  },
);
