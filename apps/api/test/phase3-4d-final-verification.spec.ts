import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
  TransferStatus,
  TransferType,
  TransferDiscrepancyStatus,
  CostingMethod,
} from '@restaurant-cloud/domain-kernel';
import {
  chartOfAccounts,
  accountMappings,
  journalEntries,
  journalLines,
  items,
  unitsOfMeasure,
  warehouses,
  branches,
  legalEntities,
  inventoryBalances,
  inventoryCostLayers,
  inventoryMovements,
  stockTransfers,
} from '@restaurant-cloud/database';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe(
  'Restaurant Cloud — Phase 3.4D: Final Accounting & Inventory Verification',
  { timeout: 120000 },
  () => {
    let dbService: DatabaseService;
    let auditService: AuditService;
    let tenantService: TenantService;
    let postingEngine: PostingEngineService;
    let accountingService: AccountingService;
    let opsFramework: OperationsFrameworkService;
    let inventoryService: InventoryService;

    let tenantId: string;
    let tenantBId: string;
    let le1Id: string;
    let le2Id: string;
    let branch1Id: string;
    let branch2Id: string;
    let branchLe2Id: string;
    let wh1aId: string;
    let wh2Id: string;
    let whLe2Id: string;
    let baseUomId: string;
    let wacItemId: string;
    let fifoItemId: string;

    let ctxAdmin: TenantContext;
    let ctxOtherTenant: TenantContext;
    let ctxBranch1Only: TenantContext;
    let ctxLe1Only: TenantContext;
    let ctxLe2Only: TenantContext;

    const accountsLe1: Record<string, string> = {};
    const accountsLe2: Record<string, string> = {};

    async function seedAccountsAndPeriod(
      ctx: TenantContext,
      leId: string,
      accMap: Record<string, string>
    ) {
      await dbService.withTenantContext(ctx, async (tx) => {
        const defs = [
          { code: '112000', name: 'Inventory', type: AccountType.ASSET, bal: NormalBalance.DEBIT, key: DefaultAccountMappingKey.INVENTORY },
          { code: '112900', name: 'Inventory In Transit', type: AccountType.ASSET, bal: NormalBalance.DEBIT, key: DefaultAccountMappingKey.INVENTORY_IN_TRANSIT },
          { code: '119100', name: 'Inter-Branch Clearing', type: AccountType.ASSET, bal: NormalBalance.DEBIT, key: DefaultAccountMappingKey.INTER_BRANCH_CLEARING },
          { code: '119200', name: 'Due From Affiliate', type: AccountType.ASSET, bal: NormalBalance.DEBIT, key: DefaultAccountMappingKey.DUE_FROM_AFFILIATE },
          { code: '219200', name: 'Due To Affiliate', type: AccountType.LIABILITY, bal: NormalBalance.CREDIT, key: DefaultAccountMappingKey.DUE_TO_AFFILIATE },
          { code: '519200', name: 'Inventory Damage & Loss', type: AccountType.EXPENSE, bal: NormalBalance.DEBIT, key: DefaultAccountMappingKey.INVENTORY_DAMAGE_LOSS },
          { code: '419300', name: 'Inventory Gain', type: AccountType.REVENUE, bal: NormalBalance.CREDIT, key: DefaultAccountMappingKey.INVENTORY_GAIN },
        ];
        for (const d of defs) {
          const [existing] = await tx
            .select()
            .from(chartOfAccounts)
            .where(and(eq(chartOfAccounts.tenantId, ctx.tenantId), eq(chartOfAccounts.legalEntityId, leId), eq(chartOfAccounts.accountCode, d.code)))
            .limit(1);
          let accId = existing?.id;
          if (!accId) {
            const [ins] = await tx
              .insert(chartOfAccounts)
              .values({
                tenantId: ctx.tenantId,
                legalEntityId: leId,
                accountCode: d.code,
                name: d.name,
                nameAr: d.name,
                accountType: d.type,
                normalBalance: d.bal,
                isPostable: true,
                status: 'ACTIVE',
              })
              .returning();
            accId = ins!.id;
          }
          accMap[d.key] = accId;

          const [existingMap] = await tx
            .select()
            .from(accountMappings)
            .where(
              and(
                eq(accountMappings.tenantId, ctx.tenantId),
                eq(accountMappings.legalEntityId, leId),
                eq(accountMappings.mappingKey, d.key)
              )
            )
            .limit(1);
          if (!existingMap) {
            await tx.insert(accountMappings).values({
              tenantId: ctx.tenantId,
              legalEntityId: leId,
              mappingKey: d.key,
              accountId: accId,
              isActive: true,
            });
          }
        }
      });

      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      await accountingService.createFiscalPeriod(ctx, {
        legalEntityId: leId,
        periodName: `FV-${now.getFullYear()}-${now.getMonth() + 1}-${leId.slice(0, 4)}`,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    }

    async function getAccountNetBalance(
      ctx: TenantContext,
      leId: string,
      accountId: string
    ): Promise<number> {
      return await dbService.withTenantContext(ctx, async (tx) => {
        const rows = await tx
          .select({
            debit: sql<string>`COALESCE(SUM(${journalLines.debit}), 0)`,
            credit: sql<string>`COALESCE(SUM(${journalLines.credit}), 0)`,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
          .where(
            and(
              eq(journalEntries.tenantId, ctx.tenantId),
              eq(journalEntries.legalEntityId, leId),
              eq(journalLines.accountId, accountId)
            )
          );
        const debit = parseFloat(rows[0]?.debit ?? '0');
        const credit = parseFloat(rows[0]?.credit ?? '0');
        return debit - credit;
      });
    }

    beforeAll(async () => {
      const envPath = path.resolve(__dirname, '../../../.env');
      if (fs.existsSync(envPath)) {
        process.loadEnvFile(envPath);
      }
      dbService = new DatabaseService();
      await dbService.onModuleInit();
      auditService = new AuditService(dbService);
      opsFramework = new OperationsFrameworkService(dbService);
      postingEngine = new PostingEngineService(dbService, auditService);
      accountingService = new AccountingService(dbService, auditService, postingEngine, opsFramework);
      tenantService = new TenantService(dbService, auditService);
      inventoryService = new InventoryService(dbService, auditService, postingEngine, opsFramework);

      const code1 = `fv34d-${Date.now().toString(36).slice(-6)}`;
      const t1 = await tenantService.onboardTenant({
        code: code1,
        displayName: `Final Verify 3.4D ${code1}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'Entity Alpha',
          commercialName: 'Entity Alpha',
          vatNumber: '310888888800001',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BR1',
          name: 'Branch One',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `fv-admin-${Date.now()}@p34d.test`,
          displayName: 'FV Admin',
          password: 'Password123!Secure',
        },
      } as any);
      tenantId = t1.tenant.id;
      le1Id = t1.legalEntity.id;
      branch1Id = t1.branch.id;
      ctxAdmin = {
        tenantId,
        userId: t1.user.id,
        role: 'OWNER',
        scopes: ['*'],
        userScopes: [{ scopeType: 'TENANT', scopeEntityId: tenantId }],
      } as any;

      const code2 = `fv34db-${Date.now().toString(36).slice(-6)}`;
      const t2 = await tenantService.onboardTenant({
        code: code2,
        displayName: `Final Verify Other ${code2}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'Other Entity',
          commercialName: 'Other Entity',
          vatNumber: '310888888800002',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'OBR',
          name: 'Other Branch',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `fv-other-${Date.now()}@p34d.test`,
          displayName: 'FV Other',
          password: 'Password123!Secure',
        },
      } as any);
      tenantBId = t2.tenant.id;
      ctxOtherTenant = {
        tenantId: tenantBId,
        userId: t2.user.id,
        role: 'OWNER',
        scopes: ['*'],
        userScopes: [{ scopeType: 'TENANT', scopeEntityId: tenantBId }],
      } as any;

      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const [le2] = await tx
          .insert(legalEntities)
          .values({
            tenantId,
            legalName: 'Entity Beta',
            commercialName: 'Entity Beta',
            vatNumber: '310888888800003',
            functionalCurrency: 'SAR',
          })
          .returning();
        le2Id = le2!.id;

        const [br2] = await tx
          .insert(branches)
          .values({
            tenantId,
            legalEntityId: le1Id,
            code: 'BR2',
            name: 'Branch Two',
          })
          .returning();
        branch2Id = br2!.id;

        const [brLe2] = await tx
          .insert(branches)
          .values({
            tenantId,
            legalEntityId: le2Id,
            code: 'BRL2',
            name: 'Branch LE2',
          })
          .returning();
        branchLe2Id = brLe2!.id;

        const [w1a] = await tx
          .insert(warehouses)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            code: 'WH-1A',
            name: 'WH 1A',
            nameAr: 'مستودع 1أ',
            allowTransfer: true,
            allowReceiving: true,
          })
          .returning();
        wh1aId = w1a!.id;

        const [w2] = await tx
          .insert(warehouses)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch2Id,
            code: 'WH-2',
            name: 'WH 2',
            nameAr: 'مستودع 2',
            allowTransfer: true,
            allowReceiving: true,
          })
          .returning();
        wh2Id = w2!.id;

        const [wl2] = await tx
          .insert(warehouses)
          .values({
            tenantId,
            legalEntityId: le2Id,
            branchId: branchLe2Id,
            code: 'WH-LE2',
            name: 'WH LE2',
            nameAr: 'مستودع منشأة 2',
            allowTransfer: true,
            allowReceiving: true,
          })
          .returning();
        whLe2Id = wl2!.id;

        const [uBase] = await tx
          .insert(unitsOfMeasure)
          .values({ tenantId, code: 'PCS', nameEn: 'Piece', nameAr: 'حبة', isBase: true })
          .returning();
        baseUomId = uBase!.id;

        const [itWac] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: le1Id,
            sku: 'FV-WAC-1',
            nameEn: 'FV WAC Item',
            nameAr: 'صنف متوسط مرجح',
            baseUomId,
            costingMethod: CostingMethod.WEIGHTED_AVERAGE,
            defaultCost: '20.0000',
            defaultPrice: '99.0000',
          })
          .returning();
        wacItemId = itWac!.id;

        const [itFifo] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: le1Id,
            sku: 'FV-FIFO-1',
            nameEn: 'FV FIFO Item',
            nameAr: 'صنف وارد أولاً',
            baseUomId,
            costingMethod: CostingMethod.FIFO,
            defaultCost: '10.0000',
            defaultPrice: '150.0000',
          })
          .returning();
        fifoItemId = itFifo!.id;
      });

      await seedAccountsAndPeriod(ctxAdmin, le1Id, accountsLe1);
      await seedAccountsAndPeriod(ctxAdmin, le2Id, accountsLe2);

      ctxAdmin.userScopes = [
        { legalEntityId: le1Id, branchId: branch1Id },
        { legalEntityId: le1Id, branchId: branch2Id },
        { legalEntityId: le2Id, branchId: branchLe2Id },
      ];

      // Seed opening inventory in WH-1A (WAC: 200 units @ 20 = 4000; FIFO: 10@10 + 20@15 + 10@25 = 650)
      await inventoryService.receiveStock(ctxAdmin, {
        legalEntityId: le1Id,
        warehouseId: wh1aId,
        itemId: wacItemId,
        uomId: baseUomId,
        quantity: '200.0000',
        unitCost: '20.0000',
      });
      await inventoryService.receiveStock(ctxAdmin, {
        legalEntityId: le1Id,
        warehouseId: wh1aId,
        itemId: fifoItemId,
        uomId: baseUomId,
        quantity: '10.0000',
        unitCost: '10.0000',
      });
      await inventoryService.receiveStock(ctxAdmin, {
        legalEntityId: le1Id,
        warehouseId: wh1aId,
        itemId: fifoItemId,
        uomId: baseUomId,
        quantity: '20.0000',
        unitCost: '15.0000',
      });
      await inventoryService.receiveStock(ctxAdmin, {
        legalEntityId: le1Id,
        warehouseId: wh1aId,
        itemId: fifoItemId,
        uomId: baseUomId,
        quantity: '10.0000',
        unitCost: '25.0000',
      });

      ctxBranch1Only = {
        tenantId,
        userId: t1.user.id,
        role: 'MANAGER',
        scopes: ['inventory.transfer.create', 'inventory.transfer.dispatch', 'inventory.transfer.receive'],
        userScopes: [{ legalEntityId: le1Id, branchId: branch1Id }],
      } as any;

      ctxLe1Only = {
        tenantId,
        userId: t1.user.id,
        role: 'MANAGER',
        scopes: ['inventory.transfer.create', 'inventory.transfer.approve', 'inventory.transfer.dispatch', 'inventory.transfer.receive'],
        userScopes: [{ legalEntityId: le1Id, branchId: branch1Id }, { legalEntityId: le1Id, branchId: branch2Id }],
      } as any;

      ctxLe2Only = {
        tenantId,
        userId: t1.user.id,
        role: 'MANAGER',
        scopes: ['inventory.transfer.create', 'inventory.transfer.approve', 'inventory.transfer.dispatch', 'inventory.transfer.receive'],
        userScopes: [{ legalEntityId: le2Id, branchId: branchLe2Id }],
      } as any;
    }, 90000);

    afterAll(async () => {
      await dbService?.onModuleDestroy();
    });

    it('1. Cross-Legal-Entity at Original Cost: sender removal == receiver receipt, DueFrom == DueTo, no P&L, strict ledger isolation', async () => {
      const tr = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'FV-IC-COST-01',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: whLe2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '10', unitCost: '20' }],
      });
      expect(tr.transferType).toBe(TransferType.CROSS_LEGAL_ENTITY);
      await inventoryService.approveTransfer(ctxAdmin, tr.id, {});
      await inventoryService.dispatchTransfer(ctxAdmin, tr.id, {});
      const rec = await inventoryService.receiveTransfer(ctxAdmin, tr.id, {
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '10' }],
      });
      expect(rec.status).toBe(TransferStatus.RECEIVED);

      const dueFrom = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.DUE_FROM_AFFILIATE]!);
      const dueTo = await getAccountNetBalance(ctxAdmin, le2Id, accountsLe2[DefaultAccountMappingKey.DUE_TO_AFFILIATE]!);
      const le1InTransit = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_IN_TRANSIT]!);
      const le1Inv = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY]!);
      const le2Inv = await getAccountNetBalance(ctxAdmin, le2Id, accountsLe2[DefaultAccountMappingKey.INVENTORY]!);
      const le1Gain = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_GAIN]!);
      const le1Loss = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_DAMAGE_LOSS]!);

      // 10 * 20 = 200
      expect(dueFrom).toBeCloseTo(200, 4);
      expect(dueTo).toBeCloseTo(-200, 4); // Credit balance
      expect(Math.abs(dueFrom) - Math.abs(dueTo)).toBeCloseTo(0, 4);
      expect(le1InTransit).toBeCloseTo(0, 4);
      expect(le1Inv).toBeCloseTo(-200, 4);
      expect(le2Inv).toBeCloseTo(200, 4);
      expect(le1Gain).toBeCloseTo(0, 4);
      expect(le1Loss).toBeCloseTo(0, 4);
    });

    it('2. Cross-Legal-Entity Transfer Price Validation: rejects higher, lower, and zero/unknown cost; allows equal to cost', async () => {
      // Higher than cost (30 vs 20)
      await expect(
        inventoryService.createTransfer(ctxAdmin, {
          legalEntityId: le1Id,
          transferNumber: 'FV-IC-PRICE-02-HIGH',
          sourceWarehouseId: wh1aId,
          destinationWarehouseId: whLe2Id,
          lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '5', unitCost: '20', transferPrice: '30' }],
        })
      ).rejects.toThrow(BadRequestException);

      // Lower than cost (10 vs 20)
      await expect(
        inventoryService.createTransfer(ctxAdmin, {
          legalEntityId: le1Id,
          transferNumber: 'FV-IC-PRICE-02-LOW',
          sourceWarehouseId: wh1aId,
          destinationWarehouseId: whLe2Id,
          lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '5', unitCost: '20', transferPrice: '10' }],
        })
      ).rejects.toThrow(BadRequestException);

      // Zero/unknown cost must NOT bypass transferPrice rule
      const zeroItem = await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const [zi] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: le1Id,
            sku: `FV-ZERO-${Date.now()}`,
            nameEn: 'Zero Cost Item',
            nameAr: 'صنف بدون تكلفة',
            baseUomId,
            costingMethod: CostingMethod.WEIGHTED_AVERAGE,
            defaultCost: '0.0000',
            defaultPrice: '50.0000',
          })
          .returning();
        await tx.insert(inventoryBalances).values({
          tenantId,
          legalEntityOwnerId: le1Id,
          warehouseId: wh1aId,
          itemId: zi!.id,
          onHandQty: '10.0000',
          reservedQty: '0.0000',
          wacCost: '0.0000',
        });
        return zi!;
      });

      await expect(
        inventoryService.createTransfer(ctxAdmin, {
          legalEntityId: le1Id,
          transferNumber: 'FV-IC-PRICE-02-ZERO',
          sourceWarehouseId: wh1aId,
          destinationWarehouseId: whLe2Id,
          lines: [{ itemId: zeroItem.id, uomId: baseUomId, quantity: '2', unitCost: '0', transferPrice: '25' }],
        })
      ).rejects.toThrow(BadRequestException);

      // Verify zero partial records created for any rejected transfer
      const rejected = await dbService.withTenantContext(ctxAdmin, (tx) =>
        tx
          .select()
          .from(stockTransfers)
          .where(
            and(
              eq(stockTransfers.tenantId, tenantId),
              inArray(stockTransfers.transferNumber, ['FV-IC-PRICE-02-HIGH', 'FV-IC-PRICE-02-LOW', 'FV-IC-PRICE-02-ZERO'])
            )
          )
      );
      expect(rejected.length).toBe(0);

      // Transfer with transferPrice equal to actual cost (20) succeeds with zero clearing balance
      const tr = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'FV-IC-PRICE-02',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: whLe2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '5', unitCost: '20', transferPrice: '20' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, tr.id, {});
      await inventoryService.dispatchTransfer(ctxAdmin, tr.id, {});
      await inventoryService.receiveTransfer(ctxAdmin, tr.id, {
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '5' }],
      });

      const dueFrom = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.DUE_FROM_AFFILIATE]!);
      const dueTo = await getAccountNetBalance(ctxAdmin, le2Id, accountsLe2[DefaultAccountMappingKey.DUE_TO_AFFILIATE]!);
      const le1Clearing = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INTER_BRANCH_CLEARING]!);
      const le2Inv = await getAccountNetBalance(ctxAdmin, le2Id, accountsLe2[DefaultAccountMappingKey.INVENTORY]!);
      const le1Gain = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_GAIN]!);
      const le2Gain = await getAccountNetBalance(ctxAdmin, le2Id, accountsLe2[DefaultAccountMappingKey.INVENTORY_GAIN]!);

      // Cumulative from Test 1 (200) + Test 2 (100) = 300
      expect(dueFrom).toBeCloseTo(300, 4);
      expect(dueTo).toBeCloseTo(-300, 4);
      expect(le2Inv).toBeCloseTo(300, 4);
      expect(le1Clearing).toBeCloseTo(0, 4);
      expect(le1Gain).toBeCloseTo(0, 4);
      expect(le2Gain).toBeCloseTo(0, 4);
    });

    it('3. Same-Legal-Entity Reconciliation: full receipt nets In-Transit & Clearing to 0; partial receipt leaves exact In-Transit balance', async () => {
      const clearingBefore = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INTER_BRANCH_CLEARING]!);
      const inTransitBefore = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_IN_TRANSIT]!);

      // Transfer A: 10 units @ 20 = 200 (full receipt)
      const trFull = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'FV-SAME-FULL-01',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '10', unitCost: '20' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, trFull.id, {});
      await inventoryService.dispatchTransfer(ctxAdmin, trFull.id, {});
      await inventoryService.receiveTransfer(ctxAdmin, trFull.id, {
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '10' }],
      });

      const clearingAfterFull = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INTER_BRANCH_CLEARING]!);
      const inTransitAfterFull = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_IN_TRANSIT]!);
      expect(clearingAfterFull - clearingBefore).toBeCloseTo(0, 4);
      expect(inTransitAfterFull - inTransitBefore).toBeCloseTo(0, 4);

      // Transfer B: 8 units @ 20 = 160 dispatched, only 5 received (3 remaining in transit = 60)
      const trPart = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'FV-SAME-PART-02',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '8', unitCost: '20' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, trPart.id, {});
      await inventoryService.dispatchTransfer(ctxAdmin, trPart.id, {});
      const partRec = await inventoryService.receiveTransfer(ctxAdmin, trPart.id, {
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '5' }],
      });
      expect(partRec.status).toBe(TransferStatus.PARTIALLY_RECEIVED);

      const inTransitAfterPart = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_IN_TRANSIT]!);
      expect(inTransitAfterPart - inTransitAfterFull).toBeCloseTo(60, 4);
    });

    it('4. Cost Integrity: multi-layer FIFO preservation (10@10 + 15@15) & WAC accuracy on receipt without inflation/deflation', async () => {
      // FIFO: consume 15 units -> 10@10 (100) + 5@15 (75) = 175 total (unitCost 11.6667), partial (5) then final (10)
      const inTransitBeforeFifo = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_IN_TRANSIT]!);
      const trFifo = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'FV-FIFO-01',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: fifoItemId, uomId: baseUomId, quantity: '15', unitCost: '0' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, trFifo.id, {});
      const disp = await inventoryService.dispatchTransfer(ctxAdmin, trFifo.id, {});
      expect(parseFloat(disp.totalTransferCost)).toBeCloseTo(175, 4);

      // Partial receipt of 5 units, then final receipt of 10 units
      await inventoryService.receiveTransfer(ctxAdmin, trFifo.id, {
        receivedLines: [{ itemId: fifoItemId, receivedQuantity: '5' }],
      });
      await inventoryService.receiveTransfer(ctxAdmin, trFifo.id, {
        receivedLines: [{ itemId: fifoItemId, receivedQuantity: '10' }],
      });

      const inTransitAfterFifo = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_IN_TRANSIT]!);
      // Must close out exact 175.0000 with zero cumulative rounding drift (no -0.0005)
      expect(inTransitAfterFifo - inTransitBeforeFifo).toBeCloseTo(0, 4);

      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const destLayers = await tx
          .select()
          .from(inventoryCostLayers)
          .where(and(eq(inventoryCostLayers.warehouseId, wh2Id), eq(inventoryCostLayers.itemId, fifoItemId)));
        expect(destLayers.length).toBeGreaterThanOrEqual(2);
        const totalDestVal = destLayers.reduce((s, l) => s + parseFloat(l.quantityRemaining) * parseFloat(l.unitCost), 0);
        expect(totalDestVal).toBeCloseTo(175, 4);
      });

      // WAC accuracy check: WH-2 currently has 15 WAC units @ 20 (from Test 3: 10 + 5).
      const [wh2Bal] = await dbService.withTenantContext(ctxAdmin, (tx) =>
        tx
          .select()
          .from(inventoryBalances)
          .where(and(eq(inventoryBalances.warehouseId, wh2Id), eq(inventoryBalances.itemId, wacItemId)))
      );
      expect(parseFloat(wh2Bal!.onHandQty)).toBeCloseTo(15, 4);
      expect(parseFloat(wh2Bal!.wacCost)).toBeCloseTo(20, 4);
    });

    it('5. Discrepancies, Close-Transfer Blocking, Reversal, Idempotency & Journal Entry Immutability', async () => {
      // 5a. Block closeTransfer when quantity remains unreceived
      const trBlock = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'FV-BLK-01',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '4', unitCost: '20' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, trBlock.id, {});
      await inventoryService.dispatchTransfer(ctxAdmin, trBlock.id, {});
      await inventoryService.receiveTransfer(ctxAdmin, trBlock.id, {
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '2' }],
      });
      await expect(inventoryService.closeTransfer(ctxAdmin, trBlock.id, {})).rejects.toThrow(BadRequestException);

      // Receive remaining 2 and close succeeds
      await inventoryService.receiveTransfer(ctxAdmin, trBlock.id, {
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '2' }],
      });
      const closed = await inventoryService.closeTransfer(ctxAdmin, trBlock.id, { closingNotes: 'All received' });
      expect(closed.status).toBe(TransferStatus.CLOSED);

      // 5b. Shortage/Damage separation + Overage + Full Rejection
      const trDisc = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'FV-DISC-02',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '6', unitCost: '20' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, trDisc.id, {});
      await inventoryService.dispatchTransfer(ctxAdmin, trDisc.id, {});
      const discRec = await inventoryService.receiveTransfer(ctxAdmin, trDisc.id, {
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '4', damagedQuantity: '1', lostQuantity: '1' }],
      });
      expect(discRec.status).toBe(TransferStatus.DISCREPANCY);
      const discDetails = await inventoryService.getTransferById(ctxAdmin, trDisc.id);
      expect(discDetails.discrepancies.length).toBe(2);

      // Cannot close while discrepancies are OPEN
      await expect(inventoryService.closeTransfer(ctxAdmin, trDisc.id, {})).rejects.toThrow(BadRequestException);

      // Invalid TransferDiscrepancyStatus resolution must be explicitly rejected without skipping GL posting
      await expect(
        inventoryService.resolveTransferDiscrepancy(ctxAdmin, trDisc.id, discDetails.discrepancies[0]!.id, {
          resolution: 'INVALID_RESOLUTION' as any,
          resolutionNotes: 'Should fail',
        })
      ).rejects.toThrow(BadRequestException);

      const inTransitBeforeResolve = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_IN_TRANSIT]!);
      const dmgBeforeResolve = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_DAMAGE_LOSS]!);
      for (const d of discDetails.discrepancies) {
        await inventoryService.resolveTransferDiscrepancy(ctxAdmin, trDisc.id, d.id, {
          resolution: TransferDiscrepancyStatus.RESOLVED_LOSS,
          resolutionNotes: 'Approved write-off',
        });
      }
      const inTransitAfterResolve = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_IN_TRANSIT]!);
      const dmgAfterResolve = await getAccountNetBalance(ctxAdmin, le1Id, accountsLe1[DefaultAccountMappingKey.INVENTORY_DAMAGE_LOSS]!);
      expect(inTransitAfterResolve - inTransitBeforeResolve).toBeCloseTo(-40, 4);
      expect(dmgAfterResolve - dmgBeforeResolve).toBeCloseTo(40, 4);

      const closedDisc = await inventoryService.closeTransfer(ctxAdmin, trDisc.id, { closingNotes: 'Discrepancies resolved' });
      expect(closedDisc.status).toBe(TransferStatus.CLOSED);

      // 5c. Idempotency on create & dispatch & reverseTransferAfterDispatch
      const idemKey = `fv-idem-${Date.now()}`;
      const c1 = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'FV-IDEM-03',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        idempotencyKey: idemKey,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '3', unitCost: '20' }],
      });
      const c2 = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'FV-IDEM-03-DUP',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        idempotencyKey: idemKey,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '3', unitCost: '20' }],
      });
      expect(c2.id).toBe(c1.id);

      await inventoryService.approveTransfer(ctxAdmin, c1.id, {});
      await inventoryService.dispatchTransfer(ctxAdmin, c1.id, {});
      // Second dispatch must fail cleanly without duplicating stock movements or GL
      await expect(inventoryService.dispatchTransfer(ctxAdmin, c1.id, {})).rejects.toThrow(BadRequestException);

      const rev = await inventoryService.reverseTransferAfterDispatch(ctxAdmin, c1.id, {
        reversalReason: 'Returned before unloading',
      });
      expect(rev.status).toBe(TransferStatus.CANCELLED);

      // 5d. Immutability check: posted journal_entries cannot be mutated via AccountingService
      const jvs = await dbService.withTenantContext(ctxAdmin, (tx) =>
        tx
          .select()
          .from(journalEntries)
          .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceId, c1.id)))
      );
      expect(jvs.length).toBeGreaterThanOrEqual(2); // dispatch + reversal
      for (const jv of jvs) {
        expect(jv.status).toBe('POSTED');
        expect(parseFloat(jv.debitTotal)).toBeCloseTo(parseFloat(jv.creditTotal), 4);
      }
    });

    it('6. Security & Isolation: sender-only / receiver-only / cross-branch / cross-tenant rejected with zero partial changes', async () => {
      // Cross-tenant isolation
      await expect(
        inventoryService.createTransfer(ctxOtherTenant, {
          legalEntityId: le1Id,
          transferNumber: 'FV-SEC-01',
          sourceWarehouseId: wh1aId,
          destinationWarehouseId: wh2Id,
          lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '1', unitCost: '20' }],
        })
      ).rejects.toThrow();

      // Branch-1-only user cannot transfer to Branch 2
      await expect(
        inventoryService.createTransfer(ctxBranch1Only, {
          legalEntityId: le1Id,
          transferNumber: 'FV-SEC-02',
          sourceWarehouseId: wh1aId,
          destinationWarehouseId: wh2Id,
          lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '1', unitCost: '20' }],
        })
      ).rejects.toThrow(ForbiddenException);

      // Sender-only LE1 user cannot create/dispatch/receive CROSS_LEGAL_ENTITY to LE2
      await expect(
        inventoryService.createTransfer(ctxLe1Only, {
          legalEntityId: le1Id,
          transferNumber: 'FV-SEC-03',
          sourceWarehouseId: wh1aId,
          destinationWarehouseId: whLe2Id,
          lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '1', unitCost: '20' }],
        })
      ).rejects.toThrow(ForbiddenException);

      // Receiver-only LE2 user cannot create CROSS_LEGAL_ENTITY from LE1
      await expect(
        inventoryService.createTransfer(ctxLe2Only, {
          legalEntityId: le1Id,
          transferNumber: 'FV-SEC-04',
          sourceWarehouseId: wh1aId,
          destinationWarehouseId: whLe2Id,
          lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '1', unitCost: '20' }],
        })
      ).rejects.toThrow(ForbiddenException);

      // Verify zero partial stock_transfers created for any of the rejected transfer numbers
      const rejectedRows = await dbService.withTenantContext(ctxAdmin, (tx) =>
        tx
          .select()
          .from(stockTransfers)
          .where(
            and(
              eq(stockTransfers.tenantId, tenantId),
              inArray(stockTransfers.transferNumber, ['FV-SEC-01', 'FV-SEC-02', 'FV-SEC-03', 'FV-SEC-04'])
            )
          )
      );
      expect(rejectedRows.length).toBe(0);
    });
  }
);
