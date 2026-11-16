-- ====================================================================
-- Migration 0010: Recipes, BOM & Kitchen Production Engine
-- Tables: recipes, recipe_ingredients, branch_recipe_overrides, 
--         production_batches, production_consumptions, waste_records
-- ====================================================================

-- 1. Recipes Header
CREATE TABLE IF NOT EXISTS "recipes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id") ON DELETE CASCADE,
  "output_item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "recipe_code" varchar(50) NOT NULL,
  "version" varchar(20) DEFAULT '1.0' NOT NULL,
  "status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
  "yield_quantity" numeric(14, 4) DEFAULT '1.0000' NOT NULL,
  "yield_uom_id" uuid NOT NULL REFERENCES "units_of_measure"("id"),
  "prep_time_minutes" numeric(6, 2),
  "instructions" text,
  "is_current" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_recipes_tenant_id" ON "recipes" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_recipes_output_item" ON "recipes" ("output_item_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_recipes_entity_item_version" ON "recipes" ("legal_entity_id", "output_item_id", "version");
--> statement-breakpoint

-- 2. Recipe Ingredients (BOM)
CREATE TABLE IF NOT EXISTS "recipe_ingredients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipe_id" uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
  "ingredient_item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "quantity" numeric(14, 4) NOT NULL,
  "uom_id" uuid NOT NULL REFERENCES "units_of_measure"("id"),
  "waste_percentage" numeric(5, 2) DEFAULT '0.00' NOT NULL,
  "notes" text
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_recipe_ingredients_recipe_id" ON "recipe_ingredients" ("recipe_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_recipe_ingredients_ingredient" ON "recipe_ingredients" ("ingredient_item_id");
--> statement-breakpoint

-- 3. Branch Recipe Overrides
CREATE TABLE IF NOT EXISTS "branch_recipe_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "recipe_id" uuid NOT NULL REFERENCES "recipes"("id") ON DELETE CASCADE,
  "ingredient_item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "alternate_item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "quantity_override" numeric(14, 4),
  "is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_branch_recipe_overrides_tenant" ON "branch_recipe_overrides" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_branch_recipe_override_unique" ON "branch_recipe_overrides" ("branch_id", "recipe_id", "ingredient_item_id");
--> statement-breakpoint

-- 4. Production Batches
CREATE TABLE IF NOT EXISTS "production_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id") ON DELETE CASCADE,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "recipe_id" uuid NOT NULL REFERENCES "recipes"("id") ON DELETE RESTRICT,
  "batch_number" varchar(50) NOT NULL,
  "planned_yield" numeric(14, 4) NOT NULL,
  "actual_yield" numeric(14, 4),
  "total_batch_cost" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "unit_produced_cost" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "status" varchar(30) DEFAULT 'PLANNED' NOT NULL,
  "produced_by" uuid,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "notes" text
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_prod_batches_tenant_id" ON "production_batches" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_prod_batches_entity_number" ON "production_batches" ("legal_entity_id", "batch_number");
--> statement-breakpoint

-- 5. Production Consumption Lines
CREATE TABLE IF NOT EXISTS "production_consumptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL REFERENCES "production_batches"("id") ON DELETE CASCADE,
  "ingredient_item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "uom_id" uuid NOT NULL REFERENCES "units_of_measure"("id"),
  "planned_quantity" numeric(14, 4) NOT NULL,
  "actual_quantity" numeric(14, 4) NOT NULL,
  "unit_cost" numeric(14, 4) NOT NULL,
  "total_cost" numeric(14, 4) NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_prod_consumption_batch" ON "production_consumptions" ("batch_id");
--> statement-breakpoint

-- 6. Waste Records
CREATE TABLE IF NOT EXISTS "waste_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id") ON DELETE CASCADE,
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "uom_id" uuid NOT NULL REFERENCES "units_of_measure"("id"),
  "quantity" numeric(14, 4) NOT NULL,
  "unit_cost" numeric(14, 4) NOT NULL,
  "total_waste_amount" numeric(14, 4) NOT NULL,
  "reason" varchar(50) NOT NULL,
  "reported_by" uuid,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_waste_records_tenant_id" ON "waste_records" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_waste_records_warehouse_id" ON "waste_records" ("warehouse_id");
--> statement-breakpoint

-- 7. Security: RLS Policies for Tenant-Scoped Tables
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recipes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "recipes_tenant_isolation_policy" ON "recipes";
--> statement-breakpoint
CREATE POLICY "recipes_tenant_isolation_policy" ON "recipes"
  AS PERMISSIVE FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "recipes_migrator_admin_policy" ON "recipes";
--> statement-breakpoint
CREATE POLICY "recipes_migrator_admin_policy" ON "recipes"
  AS PERMISSIVE FOR ALL TO rc_migrator
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "branch_recipe_overrides" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "branch_recipe_overrides" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "branch_recipe_overrides_policy" ON "branch_recipe_overrides";
--> statement-breakpoint
CREATE POLICY "branch_recipe_overrides_policy" ON "branch_recipe_overrides"
  AS PERMISSIVE FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "branch_recipe_overrides_migrator" ON "branch_recipe_overrides";
--> statement-breakpoint
CREATE POLICY "branch_recipe_overrides_migrator" ON "branch_recipe_overrides"
  AS PERMISSIVE FOR ALL TO rc_migrator
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "production_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_batches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "production_batches_policy" ON "production_batches";
--> statement-breakpoint
CREATE POLICY "production_batches_policy" ON "production_batches"
  AS PERMISSIVE FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "production_batches_migrator" ON "production_batches";
--> statement-breakpoint
CREATE POLICY "production_batches_migrator" ON "production_batches"
  AS PERMISSIVE FOR ALL TO rc_migrator
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "waste_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "waste_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "waste_records_policy" ON "waste_records";
--> statement-breakpoint
CREATE POLICY "waste_records_policy" ON "waste_records"
  AS PERMISSIVE FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "waste_records_migrator" ON "waste_records";
--> statement-breakpoint
CREATE POLICY "waste_records_migrator" ON "waste_records"
  AS PERMISSIVE FOR ALL TO rc_migrator
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

-- 8. Ownership and Grants
ALTER TABLE "recipes" OWNER TO rc_migrator;
--> statement-breakpoint
ALTER TABLE "recipe_ingredients" OWNER TO rc_migrator;
--> statement-breakpoint
ALTER TABLE "branch_recipe_overrides" OWNER TO rc_migrator;
--> statement-breakpoint
ALTER TABLE "production_batches" OWNER TO rc_migrator;
--> statement-breakpoint
ALTER TABLE "production_consumptions" OWNER TO rc_migrator;
--> statement-breakpoint
ALTER TABLE "waste_records" OWNER TO rc_migrator;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rc_app_user;
