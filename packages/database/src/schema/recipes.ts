import { pgTable, uuid, varchar, timestamp, numeric, boolean, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches, warehouses } from './tenants.js';
import { items, unitsOfMeasure } from './catalog.js';
import { RecipeStatus, ProductionBatchStatus } from '@restaurant-cloud/domain-kernel';

// 1. Recipes Header
export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    outputItemId: uuid('output_item_id').notNull().references(() => items.id),
    recipeCode: varchar('recipe_code', { length: 50 }).notNull(),
    version: varchar('version', { length: 20 }).notNull().default('1.0'),
    status: varchar('status', { length: 30 }).notNull().default(RecipeStatus.ACTIVE),
    yieldQuantity: numeric('yield_quantity', { precision: 14, scale: 4 }).notNull().default('1.0000'),
    yieldUomId: uuid('yield_uom_id').notNull().references(() => unitsOfMeasure.id),
    preparationTimeMinutes: numeric('prep_time_minutes', { precision: 6, scale: 2 }),
    instructions: text('instructions'),
    isCurrent: boolean('is_current').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_recipes_tenant_id').on(table.tenantId),
    index('idx_recipes_output_item').on(table.outputItemId),
    uniqueIndex('idx_recipes_entity_item_version').on(table.legalEntityId, table.outputItemId, table.version),
  ]
);

// 2. Recipe Ingredients (BOM)
export const recipeIngredients = pgTable(
  'recipe_ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id').notNull().references(() => recipes.id),
    ingredientItemId: uuid('ingredient_item_id').notNull().references(() => items.id),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    uomId: uuid('uom_id').notNull().references(() => unitsOfMeasure.id),
    wastePercentage: numeric('waste_percentage', { precision: 5, scale: 2 }).notNull().default('0.00'), // e.g. 5.00% trimming waste
    notes: text('notes'),
  },
  (table) => [
    index('idx_recipe_ingredients_recipe_id').on(table.recipeId),
    index('idx_recipe_ingredients_ingredient').on(table.ingredientItemId),
  ]
);

// 3. Branch Recipe Overrides (Variations per branch/region)
export const branchRecipeOverrides = pgTable(
  'branch_recipe_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    recipeId: uuid('recipe_id').notNull().references(() => recipes.id),
    ingredientItemId: uuid('ingredient_item_id').notNull().references(() => items.id),
    alternateItemId: uuid('alternate_item_id').references(() => items.id),
    quantityOverride: numeric('quantity_override', { precision: 14, scale: 4 }),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [
    index('idx_branch_recipe_overrides_tenant').on(table.tenantId),
    uniqueIndex('idx_branch_recipe_override_unique').on(table.branchId, table.recipeId, table.ingredientItemId),
  ]
);

// 4. Production Batches
export const productionBatches = pgTable(
  'production_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').references(() => branches.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    recipeId: uuid('recipe_id').notNull().references(() => recipes.id),
    batchNumber: varchar('batch_number', { length: 50 }).notNull(),
    plannedYield: numeric('planned_yield', { precision: 14, scale: 4 }).notNull(),
    actualYield: numeric('actual_yield', { precision: 14, scale: 4 }),
    totalBatchCost: numeric('total_batch_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    unitProducedCost: numeric('unit_produced_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    status: varchar('status', { length: 30 }).notNull().default(ProductionBatchStatus.PLANNED),
    producedBy: uuid('produced_by'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (table) => [
    index('idx_prod_batches_tenant_id').on(table.tenantId),
    uniqueIndex('idx_prod_batches_entity_number').on(table.legalEntityId, table.batchNumber),
  ]
);

// 5. Production Consumption Lines (Raw materials deducted)
export const productionConsumptions = pgTable(
  'production_consumptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id').notNull().references(() => productionBatches.id),
    ingredientItemId: uuid('ingredient_item_id').notNull().references(() => items.id),
    uomId: uuid('uom_id').notNull().references(() => unitsOfMeasure.id),
    plannedQuantity: numeric('planned_quantity', { precision: 14, scale: 4 }).notNull(),
    actualQuantity: numeric('actual_quantity', { precision: 14, scale: 4 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull(),
    totalCost: numeric('total_cost', { precision: 14, scale: 4 }).notNull(),
  },
  (table) => [
    index('idx_prod_consumption_batch').on(table.batchId),
  ]
);

// 6. Kitchen & Inventory Waste Records (Spoilage, Burning, Expiry)
export const wasteRecords = pgTable(
  'waste_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    warehouseId: uuid('warehouse_id').notNull().references(() => warehouses.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    uomId: uuid('uom_id').notNull().references(() => unitsOfMeasure.id),
    quantity: numeric('quantity', { precision: 14, scale: 4 }).notNull(),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull(),
    totalWasteAmount: numeric('total_waste_amount', { precision: 14, scale: 4 }).notNull(),
    reason: varchar('reason', { length: 50 }).notNull(), // EXPIRED, SPOILED, PREPARATION_ERROR, DROPPED
    reportedBy: uuid('reported_by'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
  },
  (table) => [
    index('idx_waste_records_tenant_id').on(table.tenantId),
    index('idx_waste_records_warehouse_id').on(table.warehouseId),
  ]
);
