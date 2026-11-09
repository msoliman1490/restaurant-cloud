-- 1. Enhance stock_transfers (Approval, Rejection, Closing, Totals)
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "approved_by" uuid;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "rejected_by" uuid;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "closed_by" uuid;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "total_shipped_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "total_received_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "total_damaged_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN IF NOT EXISTS "total_lost_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint

-- 2. Enhance stock_transfer_lines (Dispatched, Damaged, Lost, Variance Notes)
ALTER TABLE "stock_transfer_lines" ADD COLUMN IF NOT EXISTS "dispatched_quantity" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD COLUMN IF NOT EXISTS "damaged_quantity" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD COLUMN IF NOT EXISTS "lost_quantity" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD COLUMN IF NOT EXISTS "variance_notes" text;
--> statement-breakpoint

-- 3. Create stocktake_orders
CREATE TABLE IF NOT EXISTS "stocktake_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
  "order_number" varchar(50) NOT NULL,
  "stocktake_type" varchar(30) DEFAULT 'FULL' NOT NULL,
  "count_frequency" varchar(30) DEFAULT 'PERIODIC' NOT NULL,
  "status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
  "freeze_movements" boolean DEFAULT false NOT NULL,
  "notes" text,
  "created_by" uuid,
  "started_by" uuid,
  "started_at" timestamp with time zone,
  "counted_by" uuid,
  "counted_at" timestamp with time zone,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "rejected_by" uuid,
  "rejected_at" timestamp with time zone,
  "rejection_reason" text,
  "adjustment_id" uuid REFERENCES "stock_adjustments"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stocktake_orders_tenant_id" ON "stocktake_orders" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stocktake_orders_warehouse_id" ON "stocktake_orders" ("warehouse_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_stocktake_orders_entity_number" ON "stocktake_orders" ("legal_entity_id", "order_number");
--> statement-breakpoint

-- 4. Create stocktake_lines
CREATE TABLE IF NOT EXISTS "stocktake_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "stocktake_id" uuid NOT NULL REFERENCES "stocktake_orders"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "uom_id" uuid NOT NULL REFERENCES "units_of_measure"("id"),
  "system_quantity" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "counted_quantity" numeric(14, 4),
  "difference_quantity" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "unit_cost" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "variance_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stocktake_lines_tenant_id" ON "stocktake_lines" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stocktake_lines_stocktake_id" ON "stocktake_lines" ("stocktake_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_stocktake_lines_item_id" ON "stocktake_lines" ("item_id");
--> statement-breakpoint

-- 5. Grant rc_app_user permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rc_app_user;
