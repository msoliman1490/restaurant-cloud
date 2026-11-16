import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { ProductionService } from '../src/modules/production/production.service';
import { ProductionController } from '../src/modules/production/production.controller';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import {
  tenants,
  legalEntities,
  branches,
  warehouses,
  unitsOfMeasure,
  items,
  inventoryBalances,
  inventoryCostLayers,
  chartOfAccounts,
  fiscalYears,
  fiscalPeriods,
  journalEntries,
  recipes,
  recipeIngredients,
  productionBatches,
  productionConsumptions,
  wasteRecords,
} from '@restaurant-cloud/database';
import { TenantContext, AccountType } from '@restaurant-cloud/domain-kernel';

describe('Restaurant Cloud — Production & Recipes Full Lifecycle', { timeout: 120000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let postingEngine: PostingEngineService;
  let productionService: ProductionService;

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const leA1Id = randomUUID();
  const leA2Id = randomUUID();
  const leB1Id = randomUUID();
  const branchA1Id = randomUUID();
  const branchB1Id = randomUUID();
  const whA1Id = randomUUID();
  const whA2Id = randomUUID();
  const whB1Id = randomUUID();
  const uomKgId = randomUUID();
  const uomPcsId = randomUUID();
  const rawItemId = randomUUID();
  const finishedItemId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();

  let ctxA: TenantContext;
  let ctxB: TenantContext;
  let createdRecipeId: string;

  beforeAll(async () => {
    const envPath = path.resolve(process.cwd(), '../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    dbService = new DatabaseService();
    await dbService.onModuleInit();
    auditService = new AuditService(dbService);
    postingEngine = new PostingEngineService(dbService, auditService);
    productionService = new ProductionService(dbService, auditService, postingEngine);

    ctxA = {
      tenantId: tenantAId,
      userId: userAId,
      legalEntityId: leA1Id,
      branchId: branchA1Id,
      permissions: ['*'],
    };
    ctxB = {
      tenantId: tenantBId,
      userId: userBId,
      legalEntityId: leB1Id,
      branchId: branchB1Id,
      permissions: ['*'],
    };

    const suffix = Date.now();
    await dbService.db.insert(tenants).values([
      { id: tenantAId, code: `prod-a-${suffix}`, displayName: 'Production Tenant A', status: 'ACTIVE' },
      { id: tenantBId, code: `prod-b-${suffix}`, displayName: 'Production Tenant B', status: 'ACTIVE' },
    ]);

    await dbService.withTenantContext(ctxA, async (tx) => {
      await tx.insert(legalEntities).values([
        { id: leA1Id, tenantId: tenantAId, legalName: 'Prod Entity A1', vatNumber: '310666666666663' },
        { id: leA2Id, tenantId: tenantAId, legalName: 'Prod Entity A2', vatNumber: '310777777777773' },
      ]);
      await tx.insert(branches).values({
        id: branchA1Id,
        tenantId: tenantAId,
        legalEntityId: leA1Id,
        code: 'PROD-BR-A1',
        name: 'Prod Branch A1',
      });
      await tx.insert(warehouses).values([
        { id: whA1Id, tenantId: tenantAId, legalEntityId: leA1Id, branchId: branchA1Id, code: 'WH-A1', name: 'Central Kitchen WH' },
        { id: whA2Id, tenantId: tenantAId, legalEntityId: leA2Id, code: 'WH-A2', name: 'Other Entity WH' },
      ]);

      const fyId = randomUUID();
      const now = new Date();
      await tx.insert(fiscalYears).values({
        id: fyId,
        tenantId: tenantAId,
        legalEntityId: leA1Id,
        yearCode: String(now.getUTCFullYear()),
        yearName: String(now.getUTCFullYear()),
        startDate: new Date(now.getUTCFullYear(), 0, 1),
        endDate: new Date(now.getUTCFullYear(), 11, 31, 23, 59, 59),
        status: 'OPEN',
      });
      await tx.insert(fiscalPeriods).values({
        tenantId: tenantAId,
        legalEntityId: leA1Id,
        fiscalYearId: fyId,
        periodNumber: now.getUTCMonth() + 1,
        periodName: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
        startDate: new Date(now.getUTCFullYear(), now.getUTCMonth(), 1),
        endDate: new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
        status: 'OPEN',
      });

      await tx.insert(chartOfAccounts).values([
        { id: randomUUID(), tenantId: tenantAId, legalEntityId: leA1Id, accountCode: '1200', name: 'Raw Materials', nameAr: 'المواد الخام', accountType: AccountType.ASSET, isPostable: true, status: 'ACTIVE' },
        { id: randomUUID(), tenantId: tenantAId, legalEntityId: leA1Id, accountCode: '1300', name: 'Finished Goods', nameAr: 'المنتجات التامة', accountType: AccountType.ASSET, isPostable: true, status: 'ACTIVE' },
        { id: randomUUID(), tenantId: tenantAId, legalEntityId: leA1Id, accountCode: '5105', name: 'Waste & Spoilage', nameAr: 'الهدر والتالف', accountType: AccountType.EXPENSE, isPostable: true, status: 'ACTIVE' },
      ]);

      await tx.insert(unitsOfMeasure).values([
        { id: uomKgId, tenantId: tenantAId, code: `KG-${suffix}`, nameAr: 'كجم', nameEn: 'KG', category: 'MASS', isBase: true },
        { id: uomPcsId, tenantId: tenantAId, code: `PCS-${suffix}`, nameAr: 'حبة', nameEn: 'PCS', category: 'UNIT', isBase: true },
      ]);

      await tx.insert(items).values([
        { id: rawItemId, tenantId: tenantAId, legalEntityOwnerId: leA1Id, sku: `RAW-FLOUR-${suffix}`, nameAr: 'دقيق فاخر', nameEn: 'Flour', baseUomId: uomKgId, defaultCost: '5.0000' },
        { id: finishedItemId, tenantId: tenantAId, legalEntityOwnerId: leA1Id, sku: `FG-DOUGH-${suffix}`, nameAr: 'عجينة بيتزا جاهزة', nameEn: 'Pizza Dough', baseUomId: uomPcsId, defaultCost: '0.0000' },
      ]);

      // Seed 20 KG raw flour in whA1 at actual FIFO cost 8.0000 SAR/kg
      await tx.insert(inventoryBalances).values({
        tenantId: tenantAId,
        legalEntityOwnerId: leA1Id,
        warehouseId: whA1Id,
        itemId: rawItemId,
        onHandQty: '20.0000',
        reservedQty: '0.0000',
      });
      await tx.insert(inventoryCostLayers).values({
        tenantId: tenantAId,
        legalEntityOwnerId: leA1Id,
        warehouseId: whA1Id,
        itemId: rawItemId,
        quantityReceived: '20.0000',
        quantityRemaining: '20.0000',
        unitCost: '8.0000',
        sourceType: 'opening_balance',
        sourceId: randomUUID(),
      });
    });

    await dbService.withTenantContext(ctxB, async (tx) => {
      await tx.insert(legalEntities).values({ id: leB1Id, tenantId: tenantBId, legalName: 'Prod Entity B1', vatNumber: '310888888888883' });
      await tx.insert(branches).values({ id: branchB1Id, tenantId: tenantBId, legalEntityId: leB1Id, code: 'PROD-BR-B1', name: 'Prod Branch B1' });
      await tx.insert(warehouses).values({ id: whB1Id, tenantId: tenantBId, legalEntityId: leB1Id, branchId: branchB1Id, code: 'WH-B1', name: 'Tenant B WH' });
    });
  }, 30000);

  afterAll(async () => {
    try {
      await dbService.withTenantContext(ctxA, async (tx) => {
        await tx.delete(wasteRecords).where(eq(wasteRecords.tenantId, tenantAId));
        await tx.delete(productionConsumptions).where(eq(productionConsumptions.tenantId, tenantAId));
        await tx.delete(productionBatches).where(eq(productionBatches.tenantId, tenantAId));
        await tx.delete(recipeIngredients).where(eq(recipeIngredients.tenantId, tenantAId));
        await tx.delete(recipes).where(eq(recipes.tenantId, tenantAId));
      });
    } catch {
      // Immutable ledger/audit entries remain protected in Staging
    }
    await dbService.onModuleDestroy();
  }, 30000);

  it('1. Creates recipe with BOM ingredients and calculates cost from actual FIFO inventory layers', async () => {
    const recipe = await productionService.createRecipe(ctxA, {
      legalEntityId: leA1Id,
      outputItemId: finishedItemId,
      yieldUomId: uomPcsId,
      recipeCode: 'BOM-DOUGH-01',
      version: '1.0',
      yieldQuantity: '10.0000',
      ingredients: [
        {
          ingredientItemId: rawItemId,
          uomId: uomKgId,
          quantity: '5.0000',
          wastePercentage: '0',
        },
      ],
    });
    createdRecipeId = recipe.id;

    const cost = await productionService.getRecipeCost(ctxA, recipe.id);
    // 5 KG * 8.0000 SAR/kg (actual FIFO layer, not defaultCost 5.00) = 40.0000 SAR / 10 pcs = 4.0000 SAR/pc
    expect(Number(cost.totalBatchCost)).toBe(40);
    expect(Number(cost.unitServingCost)).toBe(4);
    expect(cost.ingredients[0]?.costSource).toBe('ACTUAL_FIFO');
  });

  it('2. Creates and completes production batch: deducts raw FIFO, adds finished goods, posts via PostingEngine, prevents duplicates', async () => {
    // Reject cross-entity warehouse
    await expect(
      productionService.createProductionBatch(ctxA, {
        legalEntityId: leA1Id,
        branchId: branchA1Id,
        warehouseId: whA2Id,
        recipeId: createdRecipeId,
        batchNumber: 'BATCH-CROSS-FAIL',
        plannedYield: '10.0000',
      }),
    ).rejects.toThrow(BadRequestException);

    const batch = await productionService.createProductionBatch(ctxA, {
      legalEntityId: leA1Id,
      branchId: branchA1Id,
      warehouseId: whA1Id,
      recipeId: createdRecipeId,
      batchNumber: 'BATCH-001',
      plannedYield: '10.0000',
    });

    // Duplicate batchNumber rejected
    await expect(
      productionService.createProductionBatch(ctxA, {
        legalEntityId: leA1Id,
        branchId: branchA1Id,
        warehouseId: whA1Id,
        recipeId: createdRecipeId,
        batchNumber: 'BATCH-001',
        plannedYield: '10.0000',
      }),
    ).rejects.toThrow(ConflictException);

    const completed = await productionService.completeProductionBatch(ctxA, batch.id, {
      actualYield: '10.0000',
    });
    expect(completed.status).toBe('COMPLETED');
    expect(Number(completed.totalBatchCost)).toBe(40);
    expect(Number(completed.unitProducedCost)).toBe(4);

    // Duplicate completion blocked
    await expect(
      productionService.completeProductionBatch(ctxA, batch.id, { actualYield: '10.0000' }),
    ).rejects.toThrow(BadRequestException);

    // Verify raw material balance reduced (20 - 5 = 15), finished goods added (10), and JV posted via PostingEngine
    await dbService.withTenantContext(ctxA, async (tx) => {
      const [rawBal] = await tx
        .select()
        .from(inventoryBalances)
        .where(and(eq(inventoryBalances.warehouseId, whA1Id), eq(inventoryBalances.itemId, rawItemId)));
      expect(Number(rawBal?.onHandQty)).toBe(15);

      const [fgBal] = await tx
        .select()
        .from(inventoryBalances)
        .where(and(eq(inventoryBalances.warehouseId, whA1Id), eq(inventoryBalances.itemId, finishedItemId)));
      expect(Number(fgBal?.onHandQty)).toBe(10);

      const [jv] = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.tenantId, tenantAId), eq(journalEntries.sourceId, batch.id)));
      expect(jv).toBeTruthy();
      expect(Number(jv?.debitTotal)).toBe(40);
    });
  });

  it('3. Blocks completion on insufficient raw stock and handles batch cancellation', async () => {
    const bigBatch = await productionService.createProductionBatch(ctxA, {
      legalEntityId: leA1Id,
      branchId: branchA1Id,
      warehouseId: whA1Id,
      recipeId: createdRecipeId,
      batchNumber: 'BATCH-BIG-02',
      plannedYield: '100.0000', // Requires 50 KG, only 15 KG on hand
    });

    await expect(
      productionService.completeProductionBatch(ctxA, bigBatch.id, { actualYield: '100.0000' }),
    ).rejects.toThrow(BadRequestException);

    const cancelled = await productionService.cancelProductionBatch(ctxA, bigBatch.id, 'نقص خامات');
    expect(cancelled?.status).toBe('CANCELLED');

    await expect(
      productionService.completeProductionBatch(ctxA, bigBatch.id, { actualYield: '10.0000' }),
    ).rejects.toThrow(ConflictException);
  });

  it('4. Records waste/spoilage with FIFO deduction, PostingEngine GL entry, and RLS/RBAC enforcement', async () => {
    const waste = await productionService.recordWaste(ctxA, {
      legalEntityId: leA1Id,
      warehouseId: whA1Id,
      itemId: rawItemId,
      uomId: uomKgId,
      quantity: '2.0000',
      unitCost: '8.0000',
      reason: 'تلف تبريد',
    });
    expect(Number(waste.totalWasteAmount)).toBe(16);

    await dbService.withTenantContext(ctxA, async (tx) => {
      const [rawBal] = await tx
        .select()
        .from(inventoryBalances)
        .where(and(eq(inventoryBalances.warehouseId, whA1Id), eq(inventoryBalances.itemId, rawItemId)));
      expect(Number(rawBal?.onHandQty)).toBe(13);

      const [jv] = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.tenantId, tenantAId), eq(journalEntries.sourceId, waste.id)));
      expect(jv).toBeTruthy();
      expect(Number(jv?.debitTotal)).toBe(16);
    });

    // Tenant B RLS isolation
    const tenantBRecipes = await productionService.getRecipes(ctxB);
    expect(tenantBRecipes.length).toBe(0);

    const cancelPerms = Reflect.getMetadata(PERMISSIONS_KEY, ProductionController.prototype.cancelBatch);
    expect(cancelPerms).toContain('production.batch.cancel');
  });

  it('5. Serializes concurrent completeProductionBatch calls with FOR UPDATE row lock (no double deduction or double GL)', async () => {
    const concurrentBatch = await productionService.createProductionBatch(ctxA, {
      legalEntityId: leA1Id,
      branchId: branchA1Id,
      warehouseId: whA1Id,
      recipeId: createdRecipeId,
      batchNumber: 'BATCH-CONC-05',
      plannedYield: '10.0000',
    });

    const results = await Promise.allSettled([
      productionService.completeProductionBatch(ctxA, concurrentBatch.id, { actualYield: '10.0000' }),
      productionService.completeProductionBatch(ctxA, concurrentBatch.id, { actualYield: '10.0000' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    await dbService.withTenantContext(ctxA, async (tx) => {
      // Raw balance was 13 before test 5; batch consumes 5 -> must be 8 (not 3)
      const [rawBal] = await tx
        .select()
        .from(inventoryBalances)
        .where(and(eq(inventoryBalances.warehouseId, whA1Id), eq(inventoryBalances.itemId, rawItemId)));
      expect(Number(rawBal?.onHandQty)).toBe(8);

      // Finished goods was 10 before test 5; batch yields 10 -> must be 20 (not 30)
      const [fgBal] = await tx
        .select()
        .from(inventoryBalances)
        .where(and(eq(inventoryBalances.warehouseId, whA1Id), eq(inventoryBalances.itemId, finishedItemId)));
      expect(Number(fgBal?.onHandQty)).toBe(20);

      const jvs = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.tenantId, tenantAId), eq(journalEntries.sourceId, concurrentBatch.id)));
      expect(jvs.length).toBe(1);
    });
  });
});
