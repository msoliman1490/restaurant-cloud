import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
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
  chartOfAccounts,
  journalEntries,
  journalLines,
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
  JournalStatus,
  CostingMethod,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, sql, desc, asc } from 'drizzle-orm';

@Injectable()
export class ProductionService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

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

      const detailedLines = ingredients.map((ing) => {
        const qty = parseFloat(ing.quantity);
        const waste = parseFloat(ing.wastePercentage || '0') / 100;
        const grossQty = qty * (1 + waste);
        const cost = parseFloat(ing.defaultCost);
        const lineCost = grossQty * cost;

        totalRecipeCost += lineCost;

        return {
          ...ing,
          grossQuantity: grossQty.toFixed(4),
          lineCost: lineCost.toFixed(4),
        };
      });

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

      return batch;
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
        .limit(1);

      if (!batch) throw new NotFoundException(`Batch '${batchId}' not found`);

      if (batch.status === ProductionBatchStatus.COMPLETED) {
        throw new BadRequestException('Batch is already completed');
      }

      const [recipe] = await tx
        .select()
        .from(recipes)
        .where(eq(recipes.id, batch.recipeId))
        .limit(1);

      if (!recipe) throw new NotFoundException('Recipe not found');

      let totalRawMaterialCost = 0;
      const consumedLines = [];

      // 1. Deduct raw materials consumed from inventory adhering to item costing method (FIFO vs WAC)
      for (const line of dto.consumedLines) {
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

        // Check sufficient stock on hand
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
          .limit(1);

        const currentOnHand = rawBal ? parseFloat(rawBal.onHandQty) : 0;
        if (currentOnHand < actualQty) {
          throw new BadRequestException(
            `Insufficient stock for raw material '${line.ingredientItemId}'. Available: ${currentOnHand}, Consumed: ${actualQty}`
          );
        }

        // Query available open cost layers
        const openLayers = await tx
          .select()
          .from(inventoryCostLayers)
          .where(
            and(
              eq(inventoryCostLayers.tenantId, context.tenantId),
              eq(inventoryCostLayers.legalEntityOwnerId, batch.legalEntityId),
              eq(inventoryCostLayers.warehouseId, batch.warehouseId),
              eq(inventoryCostLayers.itemId, line.ingredientItemId),
              sql`CAST(${inventoryCostLayers.quantityRemaining} AS NUMERIC) > 0`
            )
          )
          .orderBy(asc(inventoryCostLayers.createdAt));

        let actualLineCost = 0;
        let effectiveUnitCost = defaultUnitCost;

        if (itemCostingMethod === CostingMethod.WEIGHTED_AVERAGE) {
          // Weighted Average Costing (WAC): compute average cost across all available units
          let totalLayerVal = 0;
          let totalLayerQty = 0;
          for (const l of openLayers) {
            const lQty = parseFloat(l.quantityRemaining);
            const lCost = parseFloat(l.unitCost);
            totalLayerVal += lQty * lCost;
            totalLayerQty += lQty;
          }

          effectiveUnitCost = totalLayerQty > 0 ? (totalLayerVal / totalLayerQty) : defaultUnitCost;
          actualLineCost = actualQty * effectiveUnitCost;

          // Consume quantity from open layers tracking physical depletion
          let neededQty = actualQty;
          for (const layer of openLayers) {
            if (neededQty <= 0) break;
            const layerRem = parseFloat(layer.quantityRemaining);
            const takeQty = Math.min(neededQty, layerRem);
            neededQty -= takeQty;

            await tx
              .update(inventoryCostLayers)
              .set({
                quantityRemaining: (layerRem - takeQty).toFixed(4),
              })
              .where(eq(inventoryCostLayers.id, layer.id));
          }
        } else {
          // First-In, First-Out (FIFO): strictly consume layers in chronological order
          let neededQty = actualQty;

          if (openLayers && openLayers.length > 0) {
            for (const layer of openLayers) {
              if (neededQty <= 0) break;
              const layerRem = parseFloat(layer.quantityRemaining);
              const layerCost = parseFloat(layer.unitCost);
              const takeQty = Math.min(neededQty, layerRem);

              actualLineCost += takeQty * layerCost;
              neededQty -= takeQty;

              await tx
                .update(inventoryCostLayers)
                .set({
                  quantityRemaining: (layerRem - takeQty).toFixed(4),
                })
                .where(eq(inventoryCostLayers.id, layer.id));
            }
          }

          // If layers did not cover entire quantity, fall back to default cost
          if (neededQty > 0) {
            actualLineCost += neededQty * defaultUnitCost;
          }

          effectiveUnitCost = actualQty > 0 ? actualLineCost / actualQty : defaultUnitCost;
        }
        totalRawMaterialCost += actualLineCost;

        const newOnHand = (currentOnHand - actualQty).toFixed(4);

        await tx
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
          );

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
        .limit(1);

      if (outputBal) {
        const newOnHand = (parseFloat(outputBal.onHandQty) + actualYield).toFixed(4);
        await tx
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
          );
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

      // Post Production Journal Entry (Dr Finished Goods 1300, Cr Raw Materials 1200)
      const accounts = await tx
        .select()
        .from(chartOfAccounts)
        .where(
          and(
            eq(chartOfAccounts.tenantId, context.tenantId),
            eq(chartOfAccounts.legalEntityId, batch.legalEntityId)
          )
        );

      const fgAccount = accounts.find((a) => a.accountCode === '1300' || a.accountCode === '1050');
      const rmAccount = accounts.find((a) => a.accountCode === '1200' || a.accountCode === '1040');

      if (fgAccount && rmAccount && totalRawMaterialCost > 0) {
        const jNumber = `JV-PROD-${batch.batchNumber}`;
        const [existingJV] = await tx
          .select({ id: journalEntries.id })
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.tenantId, context.tenantId),
              eq(journalEntries.journalNumber, jNumber)
            )
          )
          .limit(1);

        if (!existingJV) {
          const [je] = await tx
            .insert(journalEntries)
            .values({
              tenantId: context.tenantId,
              legalEntityId: batch.legalEntityId,
              journalNumber: jNumber,
              journalType: JournalType.GENERAL,
              status: JournalStatus.POSTED,
              sourceType: 'production_batch',
              sourceId: batch.id,
              debitTotal: totalRawMaterialCost.toFixed(4),
              creditTotal: totalRawMaterialCost.toFixed(4),
              postedAt: new Date(),
              postedBy: context.userId,
            })
            .returning();

          if (je) {
            // Debit Finished Goods
            await tx.insert(journalLines).values({
              journalEntryId: je.id,
              accountId: fgAccount.id,
              debit: totalRawMaterialCost.toFixed(4),
              credit: '0.0000',
              currency: 'SAR',
              description: `Finished Goods Capitalization for Batch ${batch.batchNumber}`,
            });

            // Credit Raw Materials
            await tx.insert(journalLines).values({
              journalEntryId: je.id,
              accountId: rmAccount.id,
              debit: '0.0000',
              credit: totalRawMaterialCost.toFixed(4),
              currency: 'SAR',
              description: `Raw Material Consumption for Batch ${batch.batchNumber}`,
            });
          }
        }
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
      const cost = parseFloat(dto.unitCost);
      const totalAmount = (qty * cost).toFixed(4);

      // Verify stock exists and deduct
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
        .limit(1);

      if (!bal || parseFloat(bal.onHandQty) < qty) {
        throw new BadRequestException('Insufficient stock on hand to record waste');
      }

      const newOnHand = (parseFloat(bal.onHandQty) - qty).toFixed(4);

      await tx
        .update(inventoryBalances)
        .set({
          onHandQty: newOnHand,
          version: bal.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(inventoryBalances.id, bal.id), eq(inventoryBalances.version, bal.version))
        );

      const [waste] = await tx
        .insert(wasteRecords)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
          uomId: dto.uomId,
          quantity: dto.quantity,
          unitCost: dto.unitCost,
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
        unitCost: dto.unitCost,
        sourceType: 'waste_record',
        sourceId: waste.id,
      });

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

        // Deduct from balance
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
          .limit(1);

        if (bal) {
          const curOnHand = parseFloat(bal.onHandQty);
          const newOnHand = Math.max(0, curOnHand - qtyToDeduct).toFixed(4);

          await tx
            .update(inventoryBalances)
            .set({
              onHandQty: newOnHand,
              version: bal.version + 1,
              updatedAt: new Date(),
            })
            .where(
              and(eq(inventoryBalances.id, bal.id), eq(inventoryBalances.version, bal.version))
            );
        }

        // Get cost for ledger
        const [ingItem] = await tx
          .select({ defaultCost: items.defaultCost })
          .from(items)
          .where(and(eq(items.tenantId, params.tenantId), eq(items.id, ing.ingredientItemId)))
          .limit(1);

        const ingCost = ingItem ? parseFloat(ingItem.defaultCost) : 0;
        totalRecipeCost += qtyToDeduct * ingCost;

        // Record stock movement
        await tx.insert(inventoryMovements).values({
          tenantId: params.tenantId,
          legalEntityOwnerId: params.legalEntityId,
          warehouseId: params.warehouseId,
          itemId: ing.ingredientItemId,
          movementType: MovementType.PRODUCTION_CONSUMPTION,
          direction: MovementDirection.OUT,
          quantity: qtyToDeduct.toFixed(4),
          unitCost: ingCost.toFixed(4),
          sourceType: 'sales_order',
          sourceId: params.orderId,
        });
      }

      return { consumedType: 'RECIPE', totalCost: totalRecipeCost };
    } else {
      // Direct stock deduction for retail or pre-packaged goods
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
        .limit(1);

      let unitCost = 0;
      if (bal) {
        const curOnHand = parseFloat(bal.onHandQty);
        const newOnHand = Math.max(0, curOnHand - params.quantitySold).toFixed(4);

        await tx
          .update(inventoryBalances)
          .set({
            onHandQty: newOnHand,
            version: bal.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(eq(inventoryBalances.id, bal.id), eq(inventoryBalances.version, bal.version))
          );
      }

      const [it] = await tx
        .select({ defaultCost: items.defaultCost })
        .from(items)
        .where(and(eq(items.tenantId, params.tenantId), eq(items.id, params.itemId)))
        .limit(1);

      if (it) unitCost = parseFloat(it.defaultCost);
      const totalCost = params.quantitySold * unitCost;

      await tx.insert(inventoryMovements).values({
        tenantId: params.tenantId,
        legalEntityOwnerId: params.legalEntityId,
        warehouseId: params.warehouseId,
        itemId: params.itemId,
        movementType: MovementType.SALE_ISSUE,
        direction: MovementDirection.OUT,
        quantity: params.quantitySold.toFixed(4),
        unitCost: unitCost.toFixed(4),
        sourceType: 'sales_order',
        sourceId: params.orderId,
      });

      return { consumedType: 'DIRECT', totalCost };
    }
  }
}
