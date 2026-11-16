import {
  Injectable,
  Optional,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PostingEngineService } from '../accounting/posting-engine.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  recipes,
  recipeIngredients,
  branchRecipeOverrides,
  productionBatches,
  productionConsumptions,
  wasteRecords,
  inventoryBalances,
  inventoryMovements,
  inventoryCostLayers,
  items,
  warehouses,
  branches,
  chartOfAccounts,
} from '@restaurant-cloud/database';
import {
  CreateRecipe,
  CreateProductionBatch,
  CompleteProductionBatch,
  CreateWasteRecord,
} from '@restaurant-cloud/shared-contracts';
import {
  TenantContext,
  RecipeStatus,
  ProductionBatchStatus,
  MovementType,
  MovementDirection,
  JournalType,
  CostingMethod,
  DefaultAccountMappingKey,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, desc, asc } from 'drizzle-orm';

@Injectable()
export class ProductionService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly postingEngine: PostingEngineService,
    @Optional() private readonly inventoryService?: InventoryService,
  ) {}

  /**
   * Resolves a GL account ID via PostingEngineService's AccountMapping resolution
   * (branch override -> company default -> system standard code), falling back to
   * explicit legacy COA codes only when no mapping is configured. Throws if unresolved
   * so GL postings are never silently skipped.
   */
  private async resolveMappedAccountId(
    tx: any,
    context: TenantContext,
    legalEntityId: string,
    branchId: string | null | undefined,
    mappingKeys: Array<DefaultAccountMappingKey | string>,
    fallbackAccountCodes: string[],
  ): Promise<string> {
    if (!this.postingEngine) {
      throw new BadRequestException('PostingEngineService is required for GL posting');
    }

    for (const key of mappingKeys) {
      try {
        return await this.postingEngine.resolveAccountId(
          tx,
          context,
          legalEntityId,
          { mappingKey: key, branchId: branchId ?? null, debit: '0', credit: '0' },
          branchId ?? undefined,
        );
      } catch (err) {
        if (!(err instanceof BadRequestException)) {
          throw err;
        }
      }
    }

    if (fallbackAccountCodes.length > 0) {
      const accounts = await tx
        .select({
          id: chartOfAccounts.id,
          accountCode: chartOfAccounts.accountCode,
          status: chartOfAccounts.status,
          isPostable: chartOfAccounts.isPostable,
        })
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, legalEntityId),
          ),
        );

      for (const code of fallbackAccountCodes) {
        const matched = accounts.find(
          (a: { accountCode: string; status: string | null; isPostable: boolean }) =>
            a.accountCode === code && a.isPostable && (!a.status || a.status === 'ACTIVE'),
        );
        if (matched) {
          return matched.id;
        }
      }
    }

    throw new BadRequestException(
      `لم يتم العثور على ربط محاسبي صالح للمفاتيح (${mappingKeys.join(', ')}) أو الأكواد الاحتياطية (${fallbackAccountCodes.join(', ')})`,
    );
  }

  /**
   * Transactionally consumes open inventory cost layers with FOR UPDATE row locks.
   * Uses real FIFO/WAC cost layers first; falls back to `fallbackUnitCost` ONLY for
   * uncovered quantity when zero/insufficient cost layers exist (e.g. non-tracked/initial items).
   */
  private async consumeCostLayersLocked(
    tx: any,
    params: {
      tenantId: string;
      legalEntityOwnerId: string;
      warehouseId: string;
      itemId: string;
      quantity: number;
      costingMethod: string;
      fallbackUnitCost: number;
    },
  ): Promise<{ totalCost: number; effectiveUnitCost: number }> {
    const openLayers = await tx
      .select()
      .from(inventoryCostLayers)
      .where(
        and(
          eq(inventoryCostLayers.tenantId, params.tenantId),
          eq(inventoryCostLayers.legalEntityOwnerId, params.legalEntityOwnerId),
          eq(inventoryCostLayers.warehouseId, params.warehouseId),
          eq(inventoryCostLayers.itemId, params.itemId),
          sql`CAST(${inventoryCostLayers.quantityRemaining} AS NUMERIC) > 0`,
        ),
      )
      .orderBy(asc(inventoryCostLayers.createdAt))
      .for('update');

    let totalCost = 0;
    let effectiveUnitCost = params.fallbackUnitCost;

    if (params.costingMethod === CostingMethod.WEIGHTED_AVERAGE) {
      let totalLayerVal = 0;
      let totalLayerQty = 0;
      for (const l of openLayers) {
        const lQty = parseFloat(l.quantityRemaining);
        const lCost = parseFloat(l.unitCost);
        totalLayerVal += lQty * lCost;
        totalLayerQty += lQty;
      }

      // Explicit fallback: only use defaultCost when zero cost layers exist
      effectiveUnitCost = totalLayerQty > 0 ? totalLayerVal / totalLayerQty : params.fallbackUnitCost;
      totalCost = params.quantity * effectiveUnitCost;

      let neededQty = params.quantity;
      for (const layer of openLayers) {
        if (neededQty <= 0.0001) break;
        const layerRem = parseFloat(layer.quantityRemaining);
        const takeQty = Math.min(neededQty, layerRem);
        neededQty -= takeQty;

        await tx
          .update(inventoryCostLayers)
          .set({ quantityRemaining: (layerRem - takeQty).toFixed(4) })
          .where(eq(inventoryCostLayers.id, layer.id));
      }
    } else {
      let neededQty = params.quantity;
      for (const layer of openLayers) {
        if (neededQty <= 0.0001) break;
        const layerRem = parseFloat(layer.quantityRemaining);
        const layerCost = parseFloat(layer.unitCost);
        const takeQty = Math.min(neededQty, layerRem);

        totalCost += takeQty * layerCost;
        neededQty -= takeQty;

        await tx
          .update(inventoryCostLayers)
          .set({ quantityRemaining: (layerRem - takeQty).toFixed(4) })
          .where(eq(inventoryCostLayers.id, layer.id));
      }

      // Explicit fallback: only use defaultCost for any remainder when zero/insufficient cost layers exist
      if (neededQty > 0.0001) {
        totalCost += neededQty * params.fallbackUnitCost;
      }

      effectiveUnitCost = params.quantity > 0 ? totalCost / params.quantity : params.fallbackUnitCost;
    }

    return { totalCost, effectiveUnitCost };
  }

  // ==================================================================
  // 1. Recipes & BOM
  // ==================================================================

  async createRecipe(context: TenantContext, dto: CreateRecipe) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select({ id: recipes.id })
        .from(recipes)
        .where(
          and(
            eq(recipes.tenantId, context.tenantId),
            eq(recipes.legalEntityId, dto.legalEntityId),
            eq(recipes.outputItemId, dto.outputItemId),
            eq(recipes.version, dto.version || '1.0')
          )
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(
          `Recipe version '${dto.version || '1.0'}' for this item already exists`
        );
      }

      const [recipe] = await tx
        .insert(recipes)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          outputItemId: dto.outputItemId,
          recipeCode: dto.recipeCode,
          version: dto.version || '1.0',
          status: RecipeStatus.ACTIVE,
          yieldQuantity: dto.yieldQuantity || '1.0000',
          yieldUomId: dto.yieldUomId,
          preparationTimeMinutes: dto.preparationTimeMinutes ? dto.preparationTimeMinutes.toString() : null,
          instructions: dto.instructions || null,
          isCurrent: true,
        })
        .returning();

      if (!recipe) throw new Error('Failed to create recipe');

      const createdIngredients = await tx
        .insert(recipeIngredients)
        .values(
          dto.ingredients.map((ing) => ({
            recipeId: recipe.id,
            ingredientItemId: ing.ingredientItemId,
            quantity: ing.quantity,
            uomId: ing.uomId,
            wastePercentage: ing.wastePercentage || '0.00',
            notes: ing.notes || null,
          }))
        )
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'RECIPE_CREATED',
          entityType: 'recipe',
          entityId: recipe.id,
          afterState: { recipe, ingredients: createdIngredients },
        },
        tx
      );

      return { ...recipe, ingredients: createdIngredients };
    });
  }

  async getRecipes(context: TenantContext, outputItemId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(recipes.tenantId, context.tenantId)];
      if (outputItemId) {
        conditions.push(eq(recipes.outputItemId, outputItemId));
      }

      return await tx
        .select()
        .from(recipes)
        .where(and(...conditions))
        .orderBy(desc(recipes.createdAt));
    });
  }

  async getProductionBatches(context: TenantContext, legalEntityId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(productionBatches.tenantId, context.tenantId)];
      if (legalEntityId) {
        conditions.push(eq(productionBatches.legalEntityId, legalEntityId));
      }
      return await tx
        .select()
        .from(productionBatches)
        .where(and(...conditions))
        .orderBy(desc(productionBatches.id))
        .limit(100);
    });
  }

  async getWasteRecords(context: TenantContext, legalEntityId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(wasteRecords.tenantId, context.tenantId)];
      if (legalEntityId) {
        conditions.push(eq(wasteRecords.legalEntityId, legalEntityId));
      }
      return await tx
        .select()
        .from(wasteRecords)
        .where(and(...conditions))
        .orderBy(desc(wasteRecords.id))
        .limit(100);
    });
  }

  async getRecipeCost(context: TenantContext, recipeId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [recipe] = await tx
        .select()
        .from(recipes)
        .where(and(eq(recipes.tenantId, context.tenantId), eq(recipes.id, recipeId)))
        .limit(1);

      if (!recipe) throw new NotFoundException(`Recipe '${recipeId}' not found`);

      const ingredients = await tx
        .select({
          ingredientItemId: recipeIngredients.ingredientItemId,
          quantity: recipeIngredients.quantity,
          wastePercentage: recipeIngredients.wastePercentage,
          defaultCost: items.defaultCost,
          nameAr: items.nameAr,
          sku: items.sku,
        })
        .from(recipeIngredients)
        .innerJoin(items, eq(recipeIngredients.ingredientItemId, items.id))
        .where(eq(recipeIngredients.recipeId, recipeId));

      let totalRecipeCost = 0;

      const detailedLines = [];
      for (const ing of ingredients) {
        const qty = parseFloat(ing.quantity);
        const waste = parseFloat(ing.wastePercentage || '0') / 100;
        const grossQty = qty * (1 + waste);

        // Read actual FIFO inventory cost layers first, fallback to item defaultCost
        const activeLayers = await tx
          .select({
            quantityRemaining: inventoryCostLayers.quantityRemaining,
            unitCost: inventoryCostLayers.unitCost,
          })
          .from(inventoryCostLayers)
          .where(
            and(
              eq(inventoryCostLayers.tenantId, context.tenantId),
              eq(inventoryCostLayers.legalEntityOwnerId, recipe.legalEntityId),
              eq(inventoryCostLayers.itemId, ing.ingredientItemId),
              sql`${inventoryCostLayers.quantityRemaining} > 0`,
            ),
          )
          .orderBy(asc(inventoryCostLayers.createdAt));

        let unitCost = parseFloat(ing.defaultCost);
        let costSource: 'ACTUAL_FIFO' | 'DEFAULT_COST' = 'DEFAULT_COST';
        if (activeLayers.length > 0) {
          let totalQty = 0;
          let totalVal = 0;
          for (const l of activeLayers) {
            const lq = parseFloat(l.quantityRemaining);
            totalQty += lq;
            totalVal += lq * parseFloat(l.unitCost);
          }
          if (totalQty > 0) {
            unitCost = totalVal / totalQty;
            costSource = 'ACTUAL_FIFO';
          }
        }

        const lineCost = grossQty * unitCost;
        totalRecipeCost += lineCost;

        detailedLines.push({
          ...ing,
          effectiveUnitCost: unitCost.toFixed(4),
          costSource,
          grossQuantity: grossQty.toFixed(4),
          lineCost: lineCost.toFixed(4),
        });
      }

      const yieldQty = parseFloat(recipe.yieldQuantity || '1');
      const unitServingCost = yieldQty > 0 ? totalRecipeCost / yieldQty : 0;

      return {
        recipeId: recipe.id,
        recipeCode: recipe.recipeCode,
        yieldQuantity: recipe.yieldQuantity,
        totalBatchCost: totalRecipeCost.toFixed(4),
        unitServingCost: unitServingCost.toFixed(4),
        ingredients: detailedLines,
      };
    });
  }

  // ==================================================================
  // 2. Production Batches (Kitchen Preparation Run)
  // ==================================================================

  async createProductionBatch(context: TenantContext, dto: CreateProductionBatch) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [recipe] = await tx
        .select({ id: recipes.id, legalEntityId: recipes.legalEntityId })
        .from(recipes)
        .where(and(eq(recipes.id, dto.recipeId), eq(recipes.tenantId, context.tenantId)))
        .limit(1);
      if (!recipe || recipe.legalEntityId !== dto.legalEntityId) {
        throw new NotFoundException('الوصفة غير موجودة ضمن المنشأة القانونية المحددة');
      }

      const [wh] = await tx
        .select({ id: warehouses.id, legalEntityId: warehouses.legalEntityId })
        .from(warehouses)
        .where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, context.tenantId)))
        .limit(1);
      if (!wh || wh.legalEntityId !== dto.legalEntityId) {
        throw new BadRequestException('المستودع غير صالح أو لا يتبع نفس المنشأة القانونية');
      }

      if (dto.branchId) {
        const [br] = await tx
          .select({ id: branches.id, legalEntityId: branches.legalEntityId })
          .from(branches)
          .where(and(eq(branches.id, dto.branchId), eq(branches.tenantId, context.tenantId)))
          .limit(1);
        if (!br || br.legalEntityId !== dto.legalEntityId) {
          throw new BadRequestException('الفرع لا يتبع نفس المنشأة القانونية');
        }
      }

      const [dupBatch] = await tx
        .select({ id: productionBatches.id })
        .from(productionBatches)
        .where(
          and(
            eq(productionBatches.tenantId, context.tenantId),
            eq(productionBatches.legalEntityId, dto.legalEntityId),
            eq(productionBatches.batchNumber, dto.batchNumber),
          ),
        )
        .limit(1);
      if (dupBatch) {
        throw new ConflictException(`رقم دفعة الإنتاج مستخدم مسبقاً: ${dto.batchNumber}`);
      }

      const [batch] = await tx
        .insert(productionBatches)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId || null,
          warehouseId: dto.warehouseId,
          recipeId: dto.recipeId,
          batchNumber: dto.batchNumber,
          plannedYield: dto.plannedYield,
          status: ProductionBatchStatus.IN_PROGRESS,
          producedBy: context.userId,
          notes: dto.notes || null,
        })
        .returning();

      if (batch) {
        await this.auditService.log(
          {
            tenantId: context.tenantId,
            actorId: context.userId,
            action: 'PRODUCTION_BATCH_CREATED',
            entityType: 'production_batch',
            entityId: batch.id,
            afterState: { batchNumber: batch.batchNumber, recipeId: batch.recipeId },
          },
          tx,
        );
      }

      return batch;
    });
  }

  async cancelProductionBatch(context: TenantContext, batchId: string, reason?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [batch] = await tx
        .select()
        .from(productionBatches)
        .where(and(eq(productionBatches.tenantId, context.tenantId), eq(productionBatches.id, batchId)))
        .limit(1);
      if (!batch) {
        throw new NotFoundException(`دفعة الإنتاج غير موجودة: ${batchId}`);
      }
      if (batch.status === ProductionBatchStatus.COMPLETED) {
        throw new ConflictException('لا يمكن إلغاء دفعة إنتاج مكتملة');
      }
      if (batch.status === ProductionBatchStatus.CANCELLED) {
        throw new ConflictException('دفعة الإنتاج ملغاة مسبقاً');
      }

      const [updated] = await tx
        .update(productionBatches)
        .set({
          status: ProductionBatchStatus.CANCELLED,
          notes: reason ? `${batch.notes ? batch.notes + ' | ' : ''}إلغاء: ${reason}` : batch.notes,
        })
        .where(eq(productionBatches.id, batch.id))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PRODUCTION_BATCH_CANCELLED',
          entityType: 'production_batch',
          entityId: batch.id,
          beforeState: { status: batch.status },
          afterState: { status: ProductionBatchStatus.CANCELLED, reason },
        },
        tx,
      );

      return updated;
    });
  }

  async completeProductionBatch(
    context: TenantContext,
    batchId: string,
    dto: CompleteProductionBatch
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [batch] = await tx
        .select()
        .from(productionBatches)
        .where(
          and(
            eq(productionBatches.tenantId, context.tenantId),
            eq(productionBatches.id, batchId)
          )
        )
        .for('update')
        .limit(1);

      if (!batch) throw new NotFoundException(`Batch '${batchId}' not found`);

      if (batch.status === ProductionBatchStatus.COMPLETED) {
        throw new BadRequestException('Batch is already completed');
      }
      if (batch.status === ProductionBatchStatus.CANCELLED) {
        throw new ConflictException('لا يمكن إكمال دفعة إنتاج ملغاة');
      }

      const [recipe] = await tx
        .select()
        .from(recipes)
        .where(eq(recipes.id, batch.recipeId))
        .limit(1);

      if (!recipe) throw new NotFoundException('Recipe not found');

      let totalRawMaterialCost = 0;
      const consumedLines = [];

      let linesToConsume = dto.consumedLines && dto.consumedLines.length > 0 ? dto.consumedLines : null;
      if (!linesToConsume) {
        const bomIngredients = await tx
          .select()
          .from(recipeIngredients)
          .where(eq(recipeIngredients.recipeId, recipe.id));
        const baseYield = parseFloat(recipe.yieldQuantity || '1') || 1;
        const actualYieldNum = parseFloat(dto.actualYield || batch.plannedYield || '1') || 1;
        const ratio = actualYieldNum / baseYield;
        linesToConsume = bomIngredients.map((ing) => {
          const gross = parseFloat(ing.quantity) * (1 + parseFloat(ing.wastePercentage || '0') / 100) * ratio;
          return {
            ingredientItemId: ing.ingredientItemId,
            uomId: ing.uomId,
            actualQuantity: gross.toFixed(4),
          };
        });
      }

      // 1. Deduct raw materials consumed from inventory adhering to item costing method (FIFO vs WAC)
      for (const line of linesToConsume) {
        const [rawItem] = await tx
          .select({
            defaultCost: items.defaultCost,
            costingMethod: items.costingMethod,
          })
          .from(items)
          .where(and(eq(items.tenantId, context.tenantId), eq(items.id, line.ingredientItemId)))
          .limit(1);

        const defaultUnitCost = rawItem ? parseFloat(rawItem.defaultCost) : 0;
        const actualQty = parseFloat(line.actualQuantity);
        const itemCostingMethod = rawItem?.costingMethod || CostingMethod.WEIGHTED_AVERAGE;

        // Check sufficient stock on hand with FOR UPDATE row lock
        const [rawBal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, context.tenantId),
              eq(inventoryBalances.legalEntityOwnerId, batch.legalEntityId),
              eq(inventoryBalances.warehouseId, batch.warehouseId),
              eq(inventoryBalances.itemId, line.ingredientItemId),
              sql`${inventoryBalances.lotId} IS NULL`
            )
          )
          .for('update')
          .limit(1);

        const currentOnHand = rawBal ? parseFloat(rawBal.onHandQty) : 0;
        if (currentOnHand < actualQty) {
          throw new BadRequestException(
            `Insufficient stock for raw material '${line.ingredientItemId}'. Available: ${currentOnHand}, Consumed: ${actualQty}`
          );
        }

        const { totalCost: actualLineCost, effectiveUnitCost } =
          await this.consumeCostLayersLocked(tx, {
            tenantId: context.tenantId,
            legalEntityOwnerId: batch.legalEntityId,
            warehouseId: batch.warehouseId,
            itemId: line.ingredientItemId,
            quantity: actualQty,
            costingMethod: itemCostingMethod,
            fallbackUnitCost: defaultUnitCost,
          });
        totalRawMaterialCost += actualLineCost;

        const newOnHand = (currentOnHand - actualQty).toFixed(4);

        const updatedRawRows = await tx
          .update(inventoryBalances)
          .set({
            onHandQty: newOnHand,
            version: rawBal!.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(inventoryBalances.id, rawBal!.id),
              eq(inventoryBalances.version, rawBal!.version)
            )
          )
          .returning({ id: inventoryBalances.id });

        if (updatedRawRows.length === 0) {
          throw new ConflictException(
            `Concurrent inventory modification detected for raw material '${line.ingredientItemId}'`,
          );
        }

        // Record consumption line with actual FIFO cost
        const [cLine] = await tx
          .insert(productionConsumptions)
          .values({
            batchId: batch.id,
            ingredientItemId: line.ingredientItemId,
            uomId: line.uomId,
            plannedQuantity: line.actualQuantity,
            actualQuantity: line.actualQuantity,
            unitCost: effectiveUnitCost.toFixed(4),
            totalCost: actualLineCost.toFixed(4),
          })
          .returning();

        consumedLines.push(cLine);

        // Record Raw Material OUT movement
        await tx.insert(inventoryMovements).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: batch.legalEntityId,
          warehouseId: batch.warehouseId,
          itemId: line.ingredientItemId,
          movementType: MovementType.PRODUCTION_CONSUMPTION,
          direction: MovementDirection.OUT,
          quantity: line.actualQuantity,
          unitCost: effectiveUnitCost.toFixed(4),
          sourceType: 'production_batch',
          sourceId: batch.id,
        });
      }

      // 2. Credit finished goods / output meal to inventory
      const actualYield = parseFloat(dto.actualYield);
      const unitProducedCost = actualYield > 0 ? totalRawMaterialCost / actualYield : 0;

      const [outputBal] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.legalEntityOwnerId, batch.legalEntityId),
            eq(inventoryBalances.warehouseId, batch.warehouseId),
            eq(inventoryBalances.itemId, recipe.outputItemId),
            sql`${inventoryBalances.lotId} IS NULL`
          )
        )
        .for('update')
        .limit(1);

      if (outputBal) {
        const newOnHand = (parseFloat(outputBal.onHandQty) + actualYield).toFixed(4);
        const updatedOutRows = await tx
          .update(inventoryBalances)
          .set({
            onHandQty: newOnHand,
            version: outputBal.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(inventoryBalances.id, outputBal.id),
              eq(inventoryBalances.version, outputBal.version)
            )
          )
          .returning({ id: inventoryBalances.id });

        if (updatedOutRows.length === 0) {
          throw new ConflictException(
            `Concurrent inventory modification detected for output item '${recipe.outputItemId}'`,
          );
        }
      } else {
        await tx.insert(inventoryBalances).values({
          tenantId: context.tenantId,
          legalEntityOwnerId: batch.legalEntityId,
          warehouseId: batch.warehouseId,
          itemId: recipe.outputItemId,
          onHandQty: actualYield.toFixed(4),
          reservedQty: '0.0000',
          version: 1,
        });
      }

      // Record Output Cost Layer
      await tx.insert(inventoryCostLayers).values({
        tenantId: context.tenantId,
        legalEntityOwnerId: batch.legalEntityId,
        warehouseId: batch.warehouseId,
        itemId: recipe.outputItemId,
        quantityReceived: dto.actualYield,
        quantityRemaining: dto.actualYield,
        unitCost: unitProducedCost.toFixed(4),
        sourceType: 'production_batch',
        sourceId: batch.id,
      });

      // Record Finished Goods IN movement
      await tx.insert(inventoryMovements).values({
        tenantId: context.tenantId,
        legalEntityOwnerId: batch.legalEntityId,
        warehouseId: batch.warehouseId,
        itemId: recipe.outputItemId,
        movementType: MovementType.PRODUCTION_OUTPUT,
        direction: MovementDirection.IN,
        quantity: dto.actualYield,
        unitCost: unitProducedCost.toFixed(4),
        sourceType: 'production_batch',
        sourceId: batch.id,
      });

      // Mark batch as completed
      const [completedBatch] = await tx
        .update(productionBatches)
        .set({
          status: ProductionBatchStatus.COMPLETED,
          actualYield: dto.actualYield,
          totalBatchCost: totalRawMaterialCost.toFixed(4),
          unitProducedCost: unitProducedCost.toFixed(4),
          completedAt: new Date(),
        })
        .where(eq(productionBatches.id, batch.id))
        .returning();

      // Post Production Journal Entry strictly via PostingEngineService & AccountMapping resolution
      if (totalRawMaterialCost > 0) {
        const fgAccountId = await this.resolveMappedAccountId(
          tx,
          context,
          batch.legalEntityId,
          batch.branchId,
          [DefaultAccountMappingKey.INVENTORY],
          ['1300', '1050'],
        );
        const rmAccountId = await this.resolveMappedAccountId(
          tx,
          context,
          batch.legalEntityId,
          batch.branchId,
          [DefaultAccountMappingKey.INVENTORY],
          ['1200', '1040'],
        );

        await this.postingEngine.postEntry(
          context,
          {
            legalEntityId: batch.legalEntityId,
            branchId: batch.branchId,
            journalNumber: `JV-PROD-${batch.batchNumber}`,
            journalType: JournalType.GENERAL,
            sourceType: 'production_batch',
            sourceId: batch.id,
            description: `إتمام دفعة إنتاج ${batch.batchNumber}`,
            lines: [
              {
                accountId: fgAccountId,
                branchId: batch.branchId,
                debit: totalRawMaterialCost.toFixed(4),
                credit: '0.0000',
                description: `Finished Goods Capitalization for Batch ${batch.batchNumber}`,
              },
              {
                accountId: rmAccountId,
                branchId: batch.branchId,
                debit: '0.0000',
                credit: totalRawMaterialCost.toFixed(4),
                description: `Raw Material Consumption for Batch ${batch.batchNumber}`,
              },
            ],
          },
          tx,
        );
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PRODUCTION_BATCH_COMPLETED',
          entityType: 'production_batch',
          entityId: batch.id,
          afterState: { completedBatch, consumedLines },
        },
        tx
      );

      return {
        ...completedBatch,
        consumedLines,
      };
    });
  }

  // ==================================================================
  // 3. Spoilage & Waste Tracking
  // ==================================================================

  async recordWaste(context: TenantContext, dto: CreateWasteRecord) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const qty = parseFloat(dto.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new BadRequestException('كمية الهدر يجب أن تكون أكبر من صفر');
      }

      const [wh] = await tx
        .select({ id: warehouses.id, legalEntityId: warehouses.legalEntityId, branchId: warehouses.branchId })
        .from(warehouses)
        .where(and(eq(warehouses.id, dto.warehouseId), eq(warehouses.tenantId, context.tenantId)))
        .limit(1);
      if (!wh || wh.legalEntityId !== dto.legalEntityId) {
        throw new BadRequestException('المستودع غير صالح أو لا يتبع نفس المنشأة القانونية');
      }

      // Verify stock exists and deduct with FOR UPDATE row lock
      const [bal] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.legalEntityOwnerId, dto.legalEntityId),
            eq(inventoryBalances.warehouseId, dto.warehouseId),
            eq(inventoryBalances.itemId, dto.itemId),
            sql`${inventoryBalances.lotId} IS NULL`
          )
        )
        .for('update')
        .limit(1);

      if (!bal || parseFloat(bal.onHandQty) < qty) {
        throw new BadRequestException('Insufficient stock on hand to record waste');
      }

      const [wasteItem] = await tx
        .select({ defaultCost: items.defaultCost, costingMethod: items.costingMethod })
        .from(items)
        .where(and(eq(items.tenantId, context.tenantId), eq(items.id, dto.itemId)))
        .limit(1);

      // Explicit fallback: only used when zero/insufficient cost layers exist
      const fallbackUnitCost = parseFloat(dto.unitCost || wasteItem?.defaultCost || '0');
      const { totalCost: totalWasteCost, effectiveUnitCost } =
        await this.consumeCostLayersLocked(tx, {
          tenantId: context.tenantId,
          legalEntityOwnerId: dto.legalEntityId,
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
          quantity: qty,
          costingMethod: wasteItem?.costingMethod || CostingMethod.FIFO,
          fallbackUnitCost,
        });
      const totalAmount = totalWasteCost.toFixed(4);

      const newOnHand = (parseFloat(bal.onHandQty) - qty).toFixed(4);

      const updatedWasteBalRows = await tx
        .update(inventoryBalances)
        .set({
          onHandQty: newOnHand,
          version: bal.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(inventoryBalances.id, bal.id), eq(inventoryBalances.version, bal.version))
        )
        .returning({ id: inventoryBalances.id });

      if (updatedWasteBalRows.length === 0) {
        throw new ConflictException(
          `Concurrent inventory modification detected while recording waste for item '${dto.itemId}'`,
        );
      }

      const [waste] = await tx
        .insert(wasteRecords)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
          uomId: dto.uomId,
          quantity: dto.quantity,
          unitCost: effectiveUnitCost.toFixed(4),
          totalWasteAmount: totalAmount,
          reason: dto.reason,
          reportedBy: context.userId,
          notes: dto.notes || null,
        })
        .returning();

      if (!waste) throw new Error('Failed to record waste');

      await tx.insert(inventoryMovements).values({
        tenantId: context.tenantId,
        legalEntityOwnerId: dto.legalEntityId,
        warehouseId: dto.warehouseId,
        itemId: dto.itemId,
        movementType: MovementType.WASTE_SPOILAGE,
        direction: MovementDirection.OUT,
        quantity: dto.quantity,
        unitCost: effectiveUnitCost.toFixed(4),
        sourceType: 'waste_record',
        sourceId: waste.id,
      });

      if (totalWasteCost > 0) {
        const wasteExpAccId = await this.resolveMappedAccountId(
          tx,
          context,
          dto.legalEntityId,
          wh.branchId,
          [
            DefaultAccountMappingKey.INVENTORY_DAMAGE_LOSS,
            DefaultAccountMappingKey.GENERAL_EXPENSE,
            DefaultAccountMappingKey.COGS,
          ],
          ['5105', '5100'],
        );
        const invAccId = await this.resolveMappedAccountId(
          tx,
          context,
          dto.legalEntityId,
          wh.branchId,
          [DefaultAccountMappingKey.INVENTORY],
          ['1200', '1040'],
        );

        await this.postingEngine.postEntry(
          context,
          {
            legalEntityId: dto.legalEntityId,
            branchId: wh.branchId,
            journalNumber: `JV-WST-${waste.id.slice(0, 8)}`,
            journalType: JournalType.GENERAL,
            sourceType: 'waste_record',
            sourceId: waste.id,
            description: `تسجيل هدر وتالف: ${dto.reason}`,
            lines: [
              {
                accountId: wasteExpAccId,
                branchId: wh.branchId,
                debit: totalAmount,
                credit: '0.0000',
                description: `تكلفة الهدر والتالف (${dto.reason})`,
              },
              {
                accountId: invAccId,
                branchId: wh.branchId,
                debit: '0.0000',
                credit: totalAmount,
                description: `تخفيض المخزون للهدر والتالف`,
              },
            ],
          },
          tx,
        );
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'PRODUCTION_WASTE_RECORDED',
          entityType: 'waste_record',
          entityId: waste.id,
          afterState: {
            itemId: dto.itemId,
            quantity: dto.quantity,
            totalWasteAmount: totalAmount,
            reason: dto.reason,
          },
        },
        tx,
      );

      return waste;
    });
  }

  // ==================================================================
  // 4. Theoretical Cost Calculation & Automatic Sales Consumption
  // ==================================================================

  /**
   * Computes theoretical (standard) cost of a recipe based on current raw material costs and BOM waste percentages.
   */
  async calculateTheoreticalCost(context: TenantContext, recipeId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [recipe] = await tx
        .select()
        .from(recipes)
        .where(and(eq(recipes.tenantId, context.tenantId), eq(recipes.id, recipeId)))
        .limit(1);

      if (!recipe) throw new NotFoundException(`Recipe '${recipeId}' not found`);

      const ingredients = await tx
        .select({
          ingredientItemId: recipeIngredients.ingredientItemId,
          quantity: recipeIngredients.quantity,
          wastePercentage: recipeIngredients.wastePercentage,
          defaultCost: items.defaultCost,
          itemSku: items.sku,
          itemNameAr: items.nameAr,
        })
        .from(recipeIngredients)
        .innerJoin(items, eq(recipeIngredients.ingredientItemId, items.id))
        .where(eq(recipeIngredients.recipeId, recipe.id));

      let totalRecipeCost = 0;

      const breakdown = ingredients.map((ing) => {
        const qty = parseFloat(ing.quantity);
        const waste = parseFloat(ing.wastePercentage || '0') / 100;
        const effectiveQty = qty * (1 + waste);
        const costPerUnit = parseFloat(ing.defaultCost);
        const lineCost = effectiveQty * costPerUnit;

        totalRecipeCost += lineCost;

        return {
          itemId: ing.ingredientItemId,
          sku: ing.itemSku,
          nameAr: ing.itemNameAr,
          baseQuantity: ing.quantity,
          wastePercentage: ing.wastePercentage,
          effectiveQuantity: effectiveQty.toFixed(4),
          unitCost: costPerUnit.toFixed(4),
          totalCost: lineCost.toFixed(4),
        };
      });

      const yieldQty = parseFloat(recipe.yieldQuantity || '1.0');
      const costPerYieldUnit = yieldQty > 0 ? totalRecipeCost / yieldQty : totalRecipeCost;

      return {
        recipeId: recipe.id,
        recipeCode: recipe.recipeCode,
        yieldQuantity: recipe.yieldQuantity,
        totalTheoreticalCost: totalRecipeCost.toFixed(4),
        costPerUnit: costPerYieldUnit.toFixed(4),
        ingredients: breakdown,
      };
    });
  }

  /**
   * Automatically consumes ingredients for a POS sales line within the sales transaction.
   * If the item is a prepared dish with an active recipe BOM, its raw ingredients are deducted atomically.
   * If not, the finished item itself is deducted from stock.
   */
  async consumeForSaleTx(
    tx: any,
    params: {
      tenantId: string;
      legalEntityId: string;
      warehouseId: string;
      itemId: string;
      quantitySold: number;
      orderId: string;
    }
  ): Promise<{ consumedType: 'RECIPE' | 'DIRECT'; totalCost: number }> {
    // 1. Look for active recipe for this output item
    const [recipe] = await tx
      .select()
      .from(recipes)
      .where(
        and(
          eq(recipes.tenantId, params.tenantId),
          eq(recipes.legalEntityId, params.legalEntityId),
          eq(recipes.outputItemId, params.itemId),
          eq(recipes.isCurrent, true),
          eq(recipes.status, RecipeStatus.ACTIVE)
        )
      )
      .limit(1);

    if (recipe) {
      // Prepared meal with Recipe BOM: Deduct raw materials
      const ingredients = await tx
        .select()
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, recipe.id));

      const yieldQty = parseFloat(recipe.yieldQuantity || '1.0');
      const ratio = params.quantitySold / yieldQty;
      let totalRecipeCost = 0;

      for (const ing of ingredients) {
        const rawQty = parseFloat(ing.quantity);
        const wasteFactor = 1 + parseFloat(ing.wastePercentage || '0') / 100;
        const qtyToDeduct = rawQty * ratio * wasteFactor;

        // Deduct from balance with FOR UPDATE row lock
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, params.tenantId),
              eq(inventoryBalances.legalEntityOwnerId, params.legalEntityId),
              eq(inventoryBalances.warehouseId, params.warehouseId),
              eq(inventoryBalances.itemId, ing.ingredientItemId),
              sql`${inventoryBalances.lotId} IS NULL`
            )
          )
          .for('update')
          .limit(1);

        if (bal) {
          const curOnHand = parseFloat(bal.onHandQty);
          const newOnHand = Math.max(0, curOnHand - qtyToDeduct).toFixed(4);

          const updatedRows = await tx
            .update(inventoryBalances)
            .set({
              onHandQty: newOnHand,
              version: bal.version + 1,
              updatedAt: new Date(),
            })
            .where(
              and(eq(inventoryBalances.id, bal.id), eq(inventoryBalances.version, bal.version))
            )
            .returning({ id: inventoryBalances.id });

          if (updatedRows.length === 0) {
            throw new ConflictException(
              `Concurrent inventory modification detected for ingredient '${ing.ingredientItemId}'`,
            );
          }
        }

        // Get real FIFO/WAC cost from open cost layers; fallback to items.defaultCost ONLY when zero layers exist
        const [ingItem] = await tx
          .select({ defaultCost: items.defaultCost, costingMethod: items.costingMethod })
          .from(items)
          .where(and(eq(items.tenantId, params.tenantId), eq(items.id, ing.ingredientItemId)))
          .limit(1);

        const defaultIngCost = ingItem ? parseFloat(ingItem.defaultCost) : 0;
        const { totalCost: lineCost, effectiveUnitCost } =
          await this.consumeCostLayersLocked(tx, {
            tenantId: params.tenantId,
            legalEntityOwnerId: params.legalEntityId,
            warehouseId: params.warehouseId,
            itemId: ing.ingredientItemId,
            quantity: qtyToDeduct,
            costingMethod: ingItem?.costingMethod || CostingMethod.FIFO,
            fallbackUnitCost: defaultIngCost,
          });

        totalRecipeCost += lineCost;

        // Record stock movement
        await tx.insert(inventoryMovements).values({
          tenantId: params.tenantId,
          legalEntityOwnerId: params.legalEntityId,
          warehouseId: params.warehouseId,
          itemId: ing.ingredientItemId,
          movementType: MovementType.PRODUCTION_CONSUMPTION,
          direction: MovementDirection.OUT,
          quantity: qtyToDeduct.toFixed(4),
          unitCost: effectiveUnitCost.toFixed(4),
          sourceType: 'sales_order',
          sourceId: params.orderId,
        });
      }

      return { consumedType: 'RECIPE', totalCost: totalRecipeCost };
    } else {
      // Direct stock deduction for retail or pre-packaged goods with FOR UPDATE row lock
      const [bal] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, params.tenantId),
            eq(inventoryBalances.legalEntityOwnerId, params.legalEntityId),
            eq(inventoryBalances.warehouseId, params.warehouseId),
            eq(inventoryBalances.itemId, params.itemId),
            sql`${inventoryBalances.lotId} IS NULL`
          )
        )
        .for('update')
        .limit(1);

      if (bal) {
        const curOnHand = parseFloat(bal.onHandQty);
        const newOnHand = Math.max(0, curOnHand - params.quantitySold).toFixed(4);

        const updatedRows = await tx
          .update(inventoryBalances)
          .set({
            onHandQty: newOnHand,
            version: bal.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(eq(inventoryBalances.id, bal.id), eq(inventoryBalances.version, bal.version))
          )
          .returning({ id: inventoryBalances.id });

        if (updatedRows.length === 0) {
          throw new ConflictException(
            `Concurrent inventory modification detected for item '${params.itemId}'`,
          );
        }
      }

      const [it] = await tx
        .select({ defaultCost: items.defaultCost, costingMethod: items.costingMethod })
        .from(items)
        .where(and(eq(items.tenantId, params.tenantId), eq(items.id, params.itemId)))
        .limit(1);

      const defaultUnitCost = it ? parseFloat(it.defaultCost) : 0;
      const { totalCost, effectiveUnitCost } = await this.consumeCostLayersLocked(tx, {
        tenantId: params.tenantId,
        legalEntityOwnerId: params.legalEntityId,
        warehouseId: params.warehouseId,
        itemId: params.itemId,
        quantity: params.quantitySold,
        costingMethod: it?.costingMethod || CostingMethod.FIFO,
        fallbackUnitCost: defaultUnitCost,
      });

      await tx.insert(inventoryMovements).values({
        tenantId: params.tenantId,
        legalEntityOwnerId: params.legalEntityId,
        warehouseId: params.warehouseId,
        itemId: params.itemId,
        movementType: MovementType.SALE_ISSUE,
        direction: MovementDirection.OUT,
        quantity: params.quantitySold.toFixed(4),
        unitCost: effectiveUnitCost.toFixed(4),
        sourceType: 'sales_order',
        sourceId: params.orderId,
      });

      return { consumedType: 'DIRECT', totalCost };
    }
  }

  /**
   * Restores consumed inventory from an order during refund or void,
   * strictly preserving the original movement unit cost.
   */
  async restoreForReturnTx(
    tx: any,
    params: {
      tenantId: string;
      legalEntityId: string;
      orderId: string;
      ratio?: number;
      reason?: string;
    }
  ): Promise<{ totalRestoredCost: number }> {
    const originalMovements = await tx
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, params.tenantId),
          eq(inventoryMovements.legalEntityOwnerId, params.legalEntityId),
          eq(inventoryMovements.sourceType, 'sales_order'),
          eq(inventoryMovements.sourceId, params.orderId),
          eq(inventoryMovements.direction, MovementDirection.OUT)
        )
      );

    const ratio = Math.min(1, Math.max(0, params.ratio ?? 1.0));
    let totalRestoredCost = 0;

    for (const mov of originalMovements) {
      const origQty = parseFloat(mov.quantity);
      const restoreQty = origQty * ratio;
      if (restoreQty <= 0) continue;

      const unitCost = parseFloat(mov.unitCost || '0');
      const lineCost = restoreQty * unitCost;
      totalRestoredCost += lineCost;

      // Add back to inventoryBalances with FOR UPDATE row lock
      const [bal] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, params.tenantId),
            eq(inventoryBalances.legalEntityOwnerId, params.legalEntityId),
            eq(inventoryBalances.warehouseId, mov.warehouseId),
            eq(inventoryBalances.itemId, mov.itemId),
            sql`${inventoryBalances.lotId} IS NULL`
          )
        )
        .for('update')
        .limit(1);

      if (bal) {
        const curOnHand = parseFloat(bal.onHandQty);
        const newOnHand = (curOnHand + restoreQty).toFixed(4);
        const updatedRows = await tx
          .update(inventoryBalances)
          .set({
            onHandQty: newOnHand,
            version: bal.version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(inventoryBalances.id, bal.id), eq(inventoryBalances.version, bal.version)))
          .returning({ id: inventoryBalances.id });

        if (updatedRows.length === 0) {
          throw new ConflictException(
            `Concurrent inventory modification detected while restoring item '${mov.itemId}'`,
          );
        }
      } else {
        await tx.insert(inventoryBalances).values({
          tenantId: params.tenantId,
          legalEntityOwnerId: params.legalEntityId,
          warehouseId: mov.warehouseId,
          itemId: mov.itemId,
          onHandQty: restoreQty.toFixed(4),
          reservedQty: '0.0000',
          version: 1,
        });
      }

      // Restore FIFO cost layer at original movement unitCost
      await tx.insert(inventoryCostLayers).values({
        tenantId: params.tenantId,
        legalEntityOwnerId: params.legalEntityId,
        warehouseId: mov.warehouseId,
        itemId: mov.itemId,
        quantityReceived: restoreQty.toFixed(4),
        quantityRemaining: restoreQty.toFixed(4),
        unitCost: unitCost.toFixed(4),
        sourceType: 'sales_refund',
        sourceId: params.orderId,
      });

      // Record inward return movement preserving exact original unitCost
      await tx.insert(inventoryMovements).values({
        tenantId: params.tenantId,
        legalEntityOwnerId: params.legalEntityId,
        warehouseId: mov.warehouseId,
        itemId: mov.itemId,
        movementType: MovementType.RETURN_IN,
        direction: MovementDirection.IN,
        quantity: restoreQty.toFixed(4),
        unitCost: unitCost.toFixed(4),
        sourceType: 'sales_refund',
        sourceId: params.orderId,
      });
    }

    return { totalRestoredCost };
  }
}
