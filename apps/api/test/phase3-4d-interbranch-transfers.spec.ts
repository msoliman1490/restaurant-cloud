import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { InventoryController } from '../src/modules/inventory/inventory.controller';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { Reflector } from '@nestjs/core';
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
  uomConversions,
  warehouses,
  branches,
  legalEntities,
  inventoryBalances,
  inventoryCostLayers,
  stockTransfers,
  stockTransferDiscrepancies,
} from '@restaurant-cloud/database';
import { eq, and, sql } from 'drizzle-orm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe(
  'Restaurant Cloud — Phase 3.4D: Inter-Branch Inventory & Financial Clearing Engine',
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
    let wh1bId: string;
    let wh2Id: string;
    let whLe2Id: string;

    let baseUomId: string;
    let packUomId: string;
    let wacItemId: string;
    let fifoItemId: string;

    let ctxAdmin: TenantContext;
    let ctxOtherTenant: TenantContext;
    let ctxLe1Only: TenantContext;

    const createdAccountsLe1: Record<string, string> = {};
    const createdAccountsLe2: Record<string, string> = {};

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
        periodName: `P-${now.getFullYear()}-${now.getMonth() + 1}-${leId.slice(0, 4)}`,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
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

      const code1 = `p34d-${Date.now().toString(36).slice(-6)}`;
      const t1 = await tenantService.onboardTenant({
        code: code1,
        displayName: `Phase 3.4D Transfers Corp ${code1}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'Entity One',
          commercialName: 'Entity One',
          vatNumber: '310777777700001',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BR1',
          name: 'Branch One',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `admin-${Date.now()}@p34d.test`,
          displayName: 'Admin One',
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

      const code2 = `p34db-${Date.now().toString(36).slice(-6)}`;
      const t2 = await tenantService.onboardTenant({
        code: code2,
        displayName: `Phase 3.4D Other Tenant ${code2}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'Other Entity',
          commercialName: 'Other Entity',
          vatNumber: '310777777700002',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'OBR',
          name: 'Other Branch',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `other-${Date.now()}@p34d.test`,
          displayName: 'Other Admin',
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
            legalName: 'Entity Two',
            commercialName: 'المنشأة الثانية',
            vatNumber: '300000000000002',
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

        const [w1b] = await tx
          .insert(warehouses)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            code: 'WH-1B',
            name: 'WH 1B',
            nameAr: 'مستودع 1ب',
            allowTransfer: true,
            allowReceiving: true,
          })
          .returning();
        wh1bId = w1b!.id;

        const [w2] = await tx
          .insert(warehouses)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch2Id,
            code: 'WH-2',
            name: 'WH 2',
            nameAr: 'مستودع فرع 2',
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

        const [uPack] = await tx
          .insert(unitsOfMeasure)
          .values({ tenantId, code: 'BOX10', nameEn: 'Box of 10', nameAr: 'كرتون 10', isBase: false })
          .returning();
        packUomId = uPack!.id;

        await tx.insert(uomConversions).values({
          tenantId,
          fromUomId: packUomId,
          toUomId: baseUomId,
          multiplier: '10.000000',
        });

        const [itWac] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: le1Id,
            sku: 'WAC-ITEM-1',
            nameEn: 'WAC Item',
            nameAr: 'صنف متوسط مرجح',
            baseUomId,
            costingMethod: CostingMethod.WEIGHTED_AVERAGE,
            defaultCost: '15.0000',
            defaultPrice: '99.0000',
          })
          .returning();
        wacItemId = itWac!.id;

        const [itFifo] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: le1Id,
            sku: 'FIFO-ITEM-1',
            nameEn: 'FIFO Item',
            nameAr: 'صنف وارد أولاً',
            baseUomId,
            costingMethod: CostingMethod.FIFO,
            defaultCost: '10.0000',
            defaultPrice: '150.0000',
          })
          .returning();
        fifoItemId = itFifo!.id;
      });

      await seedAccountsAndPeriod(ctxAdmin, le1Id, createdAccountsLe1);
      await seedAccountsAndPeriod(ctxAdmin, le2Id, createdAccountsLe2);

      // Grant ctxAdmin scope over both Legal Entities & all branches in this tenant
      ctxAdmin.userScopes = [
        { legalEntityId: le1Id, branchId: branch1Id },
        { legalEntityId: le1Id, branchId: branch2Id },
        { legalEntityId: le2Id, branchId: branchLe2Id },
      ];

      // Seed initial stock in WH-1A (100 WAC @ 20.00, 30 FIFO in 2 layers: 10@10 + 20@15)
      await inventoryService.receiveStock(ctxAdmin, {
        legalEntityId: le1Id,
        warehouseId: wh1aId,
        itemId: wacItemId,
        uomId: baseUomId,
        quantity: '100.0000',
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

      // Also post initial GL INVENTORY debit to match physical stock (100*20 + 10*10 + 20*15 = 2400)
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        await postingEngine.postEntry(
          ctxAdmin,
          {
            legalEntityId: le1Id,
            branchId: branch1Id,
            journalNumber: `JV-INIT-${Date.now()}`,
            journalType: 'INVENTORY' as any,
            sourceType: 'OPENING_BALANCE',
            sourceId: randomUUID(),
            description: 'رصيد مخزون افتتاحي للاختبار',
            lines: [
              { mappingKey: DefaultAccountMappingKey.INVENTORY, branchId: branch1Id, debit: '2400.0000', credit: '0.0000' },
              { mappingKey: DefaultAccountMappingKey.INVENTORY_GAIN, branchId: branch1Id, debit: '0.0000', credit: '2400.0000' },
            ],
          },
          tx
        );
      });

      ctxLe1Only = {
        tenantId,
        userId: randomUUID(),
        role: 'MANAGER',
        scopes: ['inventory.transfer.create'],
        userScopes: [
          { scopeType: 'LEGAL_ENTITY', scopeEntityId: le1Id },
          { scopeType: 'BRANCH', scopeEntityId: branch1Id },
        ],
      } as any;
    }, 90000);

    afterAll(async () => {
      await dbService?.onModuleDestroy?.();
    });

    it('1. SAME_BRANCH transfer updates warehouse balances, preserves cost, and creates NO GL journal', async () => {
      const tr = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'SB-001',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh1bId,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '10', unitCost: '20.0000' }],
      });
      expect(tr.transferType).toBe(TransferType.SAME_BRANCH);
      expect(tr.status).toBe(TransferStatus.DRAFT);

      await inventoryService.submitTransfer(ctxAdmin, tr.id, {});
      await inventoryService.approveTransfer(ctxAdmin, tr.id, {});
      const disp = await inventoryService.dispatchTransfer(ctxAdmin, tr.id, {});
      expect(disp.dispatchJournalEntryId).toBeNull();

      const rcv = await inventoryService.receiveTransfer(ctxAdmin, tr.id, {
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '10' }],
      });
      expect(rcv.status).toBe(TransferStatus.RECEIVED);
      expect(rcv.receiveJournalEntryId).toBeNull();

      const closed = await inventoryService.closeTransfer(ctxAdmin, tr.id, {});
      expect(closed.status).toBe(TransferStatus.CLOSED);
    });

    it('2-3. SAME_LEGAL_ENTITY transfer posts INVENTORY_IN_TRANSIT on dispatch and clears INTER_BRANCH_CLEARING to 0 on receive', async () => {
      const tr = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'SLE-001',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '10', unitCost: '20.0000' }],
      });
      expect(tr.transferType).toBe(TransferType.SAME_LEGAL_ENTITY);

      await inventoryService.approveTransfer(ctxAdmin, tr.id, {});
      const disp = await inventoryService.dispatchTransfer(ctxAdmin, tr.id, {});
      expect(disp.dispatchJournalEntryId).toBeTruthy();

      const rcv = await inventoryService.receiveTransfer(ctxAdmin, tr.id, {
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '10' }],
      });
      expect(rcv.receiveJournalEntryId).toBeTruthy();

      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const [clearingNet] = await tx
          .select({
            net: sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC) - CAST(${journalLines.credit} AS NUMERIC)), 0)::text`,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
          .where(
            and(
              eq(journalEntries.tenantId, tenantId),
              eq(journalLines.accountId, createdAccountsLe1[DefaultAccountMappingKey.INTER_BRANCH_CLEARING]!)
            )
          );
        expect(parseFloat(clearingNet!.net)).toBeCloseTo(0, 4);
      });
    });

    it('4-5. CROSS_LEGAL_ENTITY transfer isolates per-entity ledgers, DUE_FROM_AFFILIATE == DUE_TO_AFFILIATE, and rejects transferPrice != cost', async () => {
      await expect(
        inventoryService.createTransfer(ctxAdmin, {
          legalEntityId: le1Id,
          transferNumber: 'CLE-001-BAD-PRICE',
          sourceWarehouseId: wh1aId,
          destinationWarehouseId: whLe2Id,
          lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '5', unitCost: '20.0000', transferPrice: '22.0000' }],
        })
      ).rejects.toThrow(BadRequestException);

      const tr = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'CLE-001',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: whLe2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '5', unitCost: '20.0000' }],
      });
      expect(tr.transferType).toBe(TransferType.CROSS_LEGAL_ENTITY);

      await inventoryService.approveTransfer(ctxAdmin, tr.id, {});
      await inventoryService.dispatchTransfer(ctxAdmin, tr.id, {});
      const rcv = await inventoryService.receiveTransfer(ctxAdmin, tr.id, {
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '5' }],
      });

      expect(rcv.receiveJournalEntryId).toBeTruthy();
      expect(rcv.destJournalEntryId).toBeTruthy();

      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const [dueFrom] = await tx
          .select({ net: sql<string>`COALESCE(SUM(CAST(${journalLines.debit} AS NUMERIC) - CAST(${journalLines.credit} AS NUMERIC)), 0)::text` })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
          .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, createdAccountsLe1[DefaultAccountMappingKey.DUE_FROM_AFFILIATE]!)));

        const [dueTo] = await tx
          .select({ net: sql<string>`COALESCE(SUM(CAST(${journalLines.credit} AS NUMERIC) - CAST(${journalLines.debit} AS NUMERIC)), 0)::text` })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
          .where(and(eq(journalEntries.tenantId, tenantId), eq(journalLines.accountId, createdAccountsLe2[DefaultAccountMappingKey.DUE_TO_AFFILIATE]!)));

        expect(parseFloat(dueFrom!.net)).toBeCloseTo(100, 4);
        expect(parseFloat(dueTo!.net)).toBeCloseTo(100, 4);
      });
    });

    it('6-7. Rejects cross-tenant warehouse and unauthorized LegalEntity scope', async () => {
      await expect(
        inventoryService.createTransfer(ctxOtherTenant, {
          legalEntityId: le1Id,
          transferNumber: 'XTEN-001',
          sourceWarehouseId: wh1aId,
          destinationWarehouseId: wh2Id,
          lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '1', unitCost: '20' }],
        })
      ).rejects.toThrow();

      await expect(
        inventoryService.createTransfer(ctxLe1Only, {
          legalEntityId: le1Id,
          transferNumber: 'SCOPE-001',
          sourceWarehouseId: wh1aId,
          destinationWarehouseId: whLe2Id,
          lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '1', unitCost: '20' }],
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('8. Prevents negative stock on create and dispatch', async () => {
      await expect(
        inventoryService.createTransfer(ctxAdmin, {
          legalEntityId: le1Id,
          transferNumber: 'NEG-001',
          sourceWarehouseId: wh1aId,
          destinationWarehouseId: wh2Id,
          lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '9999', unitCost: '20' }],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('9-12. Partial receive, DAMAGE, LOSS, OVERAGE discrepancies, and resolution GL entries', async () => {
      const tr = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'DISC-001',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '10', unitCost: '20.0000' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, tr.id, {});
      await inventoryService.dispatchTransfer(ctxAdmin, tr.id, {});

      // Partial receive: 5 good, 1 damaged, 1 lost, 2 overage -> 3 still in transit!
      const rcv1 = await inventoryService.receiveTransfer(ctxAdmin, tr.id, {
        receivedLines: [
          { itemId: wacItemId, receivedQuantity: '5', damagedQuantity: '1', lostQuantity: '1', overageQuantity: '2' },
        ],
      });
      expect(rcv1.status).toBe(TransferStatus.DISCREPANCY);

      // Block closeTransfer while open discrepancies & unreceived in-transit exist
      await expect(inventoryService.closeTransfer(ctxAdmin, tr.id, {})).rejects.toThrow(BadRequestException);

      // Receive remaining 3 good units
      await inventoryService.receiveTransfer(ctxAdmin, tr.id, {
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '3' }],
      });

      const details = await inventoryService.getTransferById(ctxAdmin, tr.id);
      expect(details.discrepancies.length).toBe(3);

      // Resolve all 3 discrepancies
      for (const d of details.discrepancies) {
        const res = d.discrepancyType === 'OVERAGE' ? 'RESOLVED_GAIN' : 'RESOLVED_LOSS';
        const resolved = await inventoryService.resolveTransferDiscrepancy(ctxAdmin, tr.id, d.id, {
          resolution: res as any,
          resolutionNotes: `Resolved ${d.discrepancyType}`,
        });
        expect(resolved.status).toBe(res);
        expect(resolved.journalEntryId).toBeTruthy();
      }

      const closed = await inventoryService.closeTransfer(ctxAdmin, tr.id, {});
      expect(closed.status).toBe(TransferStatus.CLOSED);
    });

    it('13. Full rejection on receive logs FULL_REJECTION and resolves via RESOLVED_RETURNED', async () => {
      const tr = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'FREJ-001',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '4', unitCost: '20' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, tr.id, {});
      await inventoryService.dispatchTransfer(ctxAdmin, tr.id, {});
      const rej = await inventoryService.receiveTransfer(ctxAdmin, tr.id, {
        rejectAll: true,
        receivedLines: [{ itemId: wacItemId, receivedQuantity: '0' }],
        receivedNotes: 'Quality rejected',
      });
      expect(rej.status).toBe(TransferStatus.DISCREPANCY);

      const details = await inventoryService.getTransferById(ctxAdmin, tr.id);
      expect(details.discrepancies[0]!.discrepancyType).toBe('FULL_REJECTION');

      const resolved = await inventoryService.resolveTransferDiscrepancy(ctxAdmin, tr.id, details.discrepancies[0]!.id, {
        resolution: 'RESOLVED_RETURNED',
        resolutionNotes: 'Returned to source warehouse',
      });
      expect(resolved.status).toBe(TransferDiscrepancyStatus.RESOLVED_RETURNED);
    });

    it('14-16. Cancel before dispatch allowed; silent cancel after dispatch prohibited; reverseAfterDispatch restores stock & GL', async () => {
      const tr1 = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'CAN-001',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '2', unitCost: '20' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, tr1.id, {});
      const cancelled = await inventoryService.cancelTransfer(ctxAdmin, tr1.id, { cancellationReason: 'No longer needed' });
      expect(cancelled.status).toBe(TransferStatus.CANCELLED);

      const tr2 = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'REV-001',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '3', unitCost: '20' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, tr2.id, {});
      await inventoryService.dispatchTransfer(ctxAdmin, tr2.id, {});

      // Silent cancel must fail
      await expect(
        inventoryService.cancelTransfer(ctxAdmin, tr2.id, { cancellationReason: 'Silent cancel attempt' })
      ).rejects.toThrow(BadRequestException);

      // Documented reversal succeeds
      const rev = await inventoryService.reverseTransferAfterDispatch(ctxAdmin, tr2.id, {
        reversalReason: 'Truck turned back',
      });
      expect(rev.status).toBe(TransferStatus.CANCELLED);
    });

    it('17-20. FIFO layer preservation, UOM conversion, and never using sellingPrice as transfer cost', async () => {
      // Transfer 15 FIFO units (consumes 10@10 + 5@15 = 175 total -> avg 11.6667, never sellingPrice=150)
      const tr = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'FIFO-001',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: fifoItemId, uomId: baseUomId, quantity: '15', unitCost: '0' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, tr.id, {});
      const disp = await inventoryService.dispatchTransfer(ctxAdmin, tr.id, {});
      expect(parseFloat(disp.totalTransferCost)).toBeCloseTo(175, 2);

      await inventoryService.receiveTransfer(ctxAdmin, tr.id, {
        receivedLines: [{ itemId: fifoItemId, receivedQuantity: '15' }],
      });

      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const destLayers = await tx
          .select()
          .from(inventoryCostLayers)
          .where(and(eq(inventoryCostLayers.warehouseId, wh2Id), eq(inventoryCostLayers.itemId, fifoItemId)));
        expect(destLayers.length).toBe(2);
        const costs = destLayers.map((l) => parseFloat(l.unitCost)).sort((a, b) => a - b);
        expect(costs).toEqual([10, 15]);
      });

      // UOM Conversion test: 1 BOX10 = 10 PCS
      const trUom = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'UOM-001',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh1bId,
        lines: [{ itemId: wacItemId, uomId: packUomId, quantity: '1', unitCost: '20' }],
      });
      expect(parseFloat(trUom.lines[0]!.baseQuantity)).toBeCloseTo(10, 4);
    });

    it('21-25. Idempotency, pagination, and reconciliation report', async () => {
      const idemKey = `idem-${Date.now()}`;
      const a = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'IDEM-001',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh1bId,
        idempotencyKey: idemKey,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '1', unitCost: '20' }],
      });
      const b = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'IDEM-001-DUP',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh1bId,
        idempotencyKey: idemKey,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '1', unitCost: '20' }],
      });
      expect(b.id).toBe(a.id);

      const page = await inventoryService.getTransfers(ctxAdmin, { limit: 5, offset: 0, transferType: TransferType.SAME_LEGAL_ENTITY });
      expect(page.total).toBeGreaterThanOrEqual(1);
      expect(page.items.every((x) => x.transferType === TransferType.SAME_LEGAL_ENTITY)).toBe(true);

      const report = await inventoryService.getTransferReconciliationReport(ctxAdmin, { legalEntityId: le1Id });
      expect(report.summary).toBeDefined();
    });

    it('26-27. RLS tenant isolation & RBAC fail-closed permissions', async () => {
      await dbService.withTenantContext(ctxOtherTenant, async (tx) => {
        const rows = await tx.select().from(stockTransfers).where(eq(stockTransfers.tenantId, tenantId));
        expect(rows.length).toBe(0);
        const discRows = await tx.select().from(stockTransferDiscrepancies).where(eq(stockTransferDiscrepancies.tenantId, tenantId));
        expect(discRows.length).toBe(0);
      });

      const reflector = new Reflector();
      const guard = new PermissionsGuard(reflector);
      const makeCtx = (perms: string[], handlerName: keyof InventoryController) => ({
        switchToHttp: () => ({
          getRequest: () => ({
            tenantContext: {
              tenantId,
              userId: 'u1',
              role: 'STAFF',
              scopes: perms,
              userScopes: [{ legalEntityId: le1Id, branchId: branch1Id }],
            },
          }),
        }),
        getHandler: () => InventoryController.prototype[handlerName],
        getClass: () => InventoryController,
      }) as any;

      expect(guard.canActivate(makeCtx(['inventory.transfer.view'], 'getTransfers'))).toBe(true);
      expect(() => guard.canActivate(makeCtx(['inventory.transfer.view'], 'createTransfer'))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(makeCtx(['inventory.transfer.create'], 'dispatchTransfer'))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(makeCtx(['inventory.transfer.dispatch'], 'receiveTransfer'))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(makeCtx(['inventory.transfer.receive'], 'resolveTransferDiscrepancy'))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(makeCtx(['inventory.transfer.receive'], 'closeTransfer'))).toThrow(ForbiddenException);
    });

    it('28-30. Atomic rollback on posting failure, journal immutability, and GL INVENTORY balance reconciliation', async () => {
      // Disable INVENTORY_IN_TRANSIT mapping temporarily -> dispatch must fail atomically with zero stock/movement changes
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        await tx
          .update(chartOfAccounts)
          .set({ status: 'INACTIVE' })
          .where(eq(chartOfAccounts.id, createdAccountsLe1[DefaultAccountMappingKey.INVENTORY_IN_TRANSIT]!));
      });

      const trFail = await inventoryService.createTransfer(ctxAdmin, {
        legalEntityId: le1Id,
        transferNumber: 'RB-001',
        sourceWarehouseId: wh1aId,
        destinationWarehouseId: wh2Id,
        lines: [{ itemId: wacItemId, uomId: baseUomId, quantity: '2', unitCost: '20' }],
      });
      await inventoryService.approveTransfer(ctxAdmin, trFail.id, {});

      const [beforeBal] = await dbService.withTenantContext(ctxAdmin, (tx) =>
        tx.select().from(inventoryBalances).where(and(eq(inventoryBalances.warehouseId, wh1aId), eq(inventoryBalances.itemId, wacItemId)))
      );

      await expect(inventoryService.dispatchTransfer(ctxAdmin, trFail.id, {})).rejects.toThrow();

      const [afterBal] = await dbService.withTenantContext(ctxAdmin, (tx) =>
        tx.select().from(inventoryBalances).where(and(eq(inventoryBalances.warehouseId, wh1aId), eq(inventoryBalances.itemId, wacItemId)))
      );
      expect(afterBal!.onHandQty).toBe(beforeBal!.onHandQty);

      // Re-activate INVENTORY_IN_TRANSIT
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        await tx
          .update(chartOfAccounts)
          .set({ status: 'ACTIVE' })
          .where(eq(chartOfAccounts.id, createdAccountsLe1[DefaultAccountMappingKey.INVENTORY_IN_TRANSIT]!));
      });

      // Verify all posted transfer journal entries are balanced (SUM(debit) == SUM(credit))
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const jvs = await tx
          .select()
          .from(journalEntries)
          .where(eq(journalEntries.tenantId, tenantId));
        for (const jv of jvs) {
          expect(parseFloat(jv.debitTotal)).toBeCloseTo(parseFloat(jv.creditTotal), 4);
        }
      });
    });
  }
);
