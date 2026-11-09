import { pgTable, uuid, varchar, timestamp, numeric, boolean, integer, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches } from './tenants.js';
import { ProductType, TrackingPolicy, CostingMethod, UomCategory } from '@restaurant-cloud/domain-kernel';

// 1. Categories (Hierarchical Parent-Child Tree)
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    parentId: uuid('parent_id'),
    code: varchar('code', { length: 50 }).notNull(),
    nameAr: varchar('name_ar', { length: 255 }).notNull(),
    nameEn: varchar('name_en', { length: 255 }).notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_categories_tenant_id').on(table.tenantId),
    index('idx_categories_parent_id').on(table.parentId),
    uniqueIndex('idx_categories_tenant_code').on(table.tenantId, table.code),
  ]
);

// 2. Units of Measure (UoM)
export const unitsOfMeasure = pgTable(
  'units_of_measure',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    code: varchar('code', { length: 20 }).notNull(), // e.g. "KG", "G", "L", "ML", "UNIT", "BOX"
    nameAr: varchar('name_ar', { length: 100 }).notNull(),
    nameEn: varchar('name_en', { length: 100 }).notNull(),
    category: varchar('category', { length: 30 }).notNull().default(UomCategory.UNIT),
    isBase: boolean('is_base').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_uom_tenant_id').on(table.tenantId),
    uniqueIndex('idx_uom_tenant_code').on(table.tenantId, table.code),
  ]
);

// 3. UoM Conversion Ratios
export const uomConversions = pgTable(
  'uom_conversions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    fromUomId: uuid('from_uom_id').notNull().references(() => unitsOfMeasure.id),
    toUomId: uuid('to_uom_id').notNull().references(() => unitsOfMeasure.id),
    multiplier: numeric('multiplier', { precision: 16, scale: 6 }).notNull(), // e.g. 1 KG = 1000 G -> multiplier = 1000.000000
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_uom_conversions_tenant_id').on(table.tenantId),
    uniqueIndex('idx_uom_conversions_pair').on(table.tenantId, table.fromUomId, table.toUomId),
  ]
);

// 4. Products / Items Catalog
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityOwnerId: uuid('legal_entity_owner_id').notNull().references(() => legalEntities.id),
    categoryId: uuid('category_id').references(() => categories.id),
    baseUomId: uuid('base_uom_id').notNull().references(() => unitsOfMeasure.id),
    sku: varchar('sku', { length: 50 }).notNull(),
    barcode: varchar('barcode', { length: 100 }),
    nameAr: varchar('name_ar', { length: 255 }).notNull(),
    nameEn: varchar('name_en', { length: 255 }).notNull(),
    productType: varchar('product_type', { length: 30 }).notNull().default(ProductType.STOCKED),
    trackingPolicy: varchar('tracking_policy', { length: 30 }).notNull().default(TrackingPolicy.NONE),
    costingMethod: varchar('costing_method', { length: 30 }).notNull().default(CostingMethod.WEIGHTED_AVERAGE),
    defaultCost: numeric('default_cost', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    defaultPrice: numeric('default_price', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    taxRate: numeric('tax_rate', { precision: 5, scale: 4 }).notNull().default('0.1500'), // 15% VAT standard in Saudi Arabia
    isSold: boolean('is_sold').notNull().default(true),
    isPurchased: boolean('is_purchased').notNull().default(true),
    isRecipeIngredient: boolean('is_recipe_ingredient').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    isArchived: boolean('is_archived').notNull().default(false),
    description: text('description'),
    minStockLevel: numeric('min_stock_level', { precision: 12, scale: 4 }).default('0.0000'),
    maxStockLevel: numeric('max_stock_level', { precision: 12, scale: 4 }),
    primaryImageUrl: text('primary_image_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_items_tenant_id').on(table.tenantId),
    index('idx_items_category_id').on(table.categoryId),
    uniqueIndex('idx_items_tenant_sku').on(table.tenantId, table.sku),
    index('idx_items_tenant_barcode').on(table.tenantId, table.barcode),
  ]
);

// 5. Item Variants
export const itemVariants = pgTable(
  'item_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    variantCode: varchar('variant_code', { length: 50 }).notNull(),
    nameAr: varchar('name_ar', { length: 255 }).notNull(),
    nameEn: varchar('name_en', { length: 255 }).notNull(),
    sku: varchar('sku', { length: 50 }),
    barcode: varchar('barcode', { length: 100 }),
    priceDelta: numeric('price_delta', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    costDelta: numeric('cost_delta', { precision: 14, scale: 4 }).notNull().default('0.0000'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_item_variants_tenant_id').on(table.tenantId),
    index('idx_item_variants_item_id').on(table.itemId),
    uniqueIndex('idx_item_variants_item_code').on(table.itemId, table.variantCode),
  ]
);

// 6. Branch Specific Price & Cost Overrides
export const branchItemPrices = pgTable(
  'branch_item_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    price: numeric('price', { precision: 14, scale: 4 }).notNull(),
    costOverride: numeric('cost_override', { precision: 14, scale: 4 }),
    isAvailable: boolean('is_available').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_branch_item_prices_tenant_id').on(table.tenantId),
    uniqueIndex('idx_branch_item_prices_branch_item').on(table.branchId, table.itemId),
  ]
);

// 7. Suppliers
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    code: varchar('code', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    vatNumber: varchar('vat_number', { length: 50 }),
    contactPerson: varchar('contact_person', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    email: varchar('email', { length: 255 }),
    address: varchar('address', { length: 500 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_suppliers_tenant_id').on(table.tenantId),
    uniqueIndex('idx_suppliers_tenant_code').on(table.tenantId, table.code),
  ]
);

// 8. Media Files (Centralized Media Storage metadata)
export const mediaFiles = pgTable(
  'media_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    entityType: varchar('entity_type', { length: 50 }).notNull(), // 'item', 'legal_entity', etc.
    entityId: uuid('entity_id').notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    fileSize: integer('file_size').notNull(),
    storagePath: text('storage_path').notNull(),
    publicUrl: text('public_url').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_media_files_tenant_id').on(table.tenantId),
    index('idx_media_files_entity').on(table.tenantId, table.entityType, table.entityId),
  ]
);

// 9. Additional Item Barcodes
export const itemBarcodes = pgTable(
  'item_barcodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    itemId: uuid('item_id').notNull().references(() => items.id),
    barcode: varchar('barcode', { length: 100 }).notNull(),
    barcodeType: varchar('barcode_type', { length: 30 }).notNull().default('CODE128'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_item_barcodes_tenant_id').on(table.tenantId),
    index('idx_item_barcodes_item_id').on(table.tenantId, table.itemId),
    uniqueIndex('idx_item_barcodes_tenant_barcode').on(table.tenantId, table.barcode),
  ]
);
