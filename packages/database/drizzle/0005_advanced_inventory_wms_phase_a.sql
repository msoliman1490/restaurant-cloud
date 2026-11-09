-- 1. Warehouses (Multi-Company, Multi-Type, Permissions)
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "legal_entity_id" uuid REFERENCES "legal_entities"("id");
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "name_ar" varchar(255);
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "name_en" varchar(255);
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "warehouse_type" varchar(50) DEFAULT 'BRANCH' NOT NULL;
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "manager_id" uuid;
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "address" text;
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "status" varchar(30) DEFAULT 'ACTIVE' NOT NULL;
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "allow_receiving" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "allow_issuing" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "allow_transfer" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_warehouses_legal_entity_id" ON "warehouses" ("legal_entity_id");
--> statement-breakpoint

-- 2. Inventory Balances (WMS Stock Levels & WAC)
ALTER TABLE "inventory_balances" ADD COLUMN IF NOT EXISTS "in_transit_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN IF NOT EXISTS "damaged_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN IF NOT EXISTS "under_inspection_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN IF NOT EXISTS "wac_cost" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN IF NOT EXISTS "min_stock" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN IF NOT EXISTS "max_stock" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN IF NOT EXISTS "reorder_point" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_balances_warehouse_id" ON "inventory_balances" ("warehouse_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_balances_item_id" ON "inventory_balances" ("item_id");
--> statement-breakpoint

-- 3. Inventory Movements (Central Transaction Ledger)
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "movement_number" varchar(50);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "uom_id" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "total_cost" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "source_warehouse_id" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "destination_warehouse_id" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "branch_id" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "batch_number" varchar(100);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "source_document_number" varchar(100);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "performed_by" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "approved_by" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "status" varchar(30) DEFAULT 'COMPLETED' NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "is_reversed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "reversal_of_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inventory_movements_movement_num" ON "inventory_movements" ("movement_number");
--> statement-breakpoint

-- Grant rc_app_user permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rc_app_user;
