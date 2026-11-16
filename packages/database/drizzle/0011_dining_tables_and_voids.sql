-- ====================================================================
-- Migration 0011: Dining Tables, Sessions, Modifiers & Order Voids
-- Tables: dining_tables, table_sessions, order_line_modifiers, order_voids
-- ====================================================================

-- 1. Dining Tables
CREATE TABLE IF NOT EXISTS "dining_tables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "table_number" varchar(20) NOT NULL,
  "section" varchar(50) DEFAULT 'MAIN' NOT NULL,
  "capacity" integer DEFAULT 4 NOT NULL,
  "status" varchar(30) DEFAULT 'AVAILABLE' NOT NULL,
  "current_order_id" uuid REFERENCES "sales_orders"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_dining_tables_tenant_id" ON "dining_tables" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dining_tables_branch_number" ON "dining_tables" ("branch_id", "table_number");
--> statement-breakpoint

-- 2. Table Sessions
CREATE TABLE IF NOT EXISTS "table_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE CASCADE,
  "table_id" uuid NOT NULL REFERENCES "dining_tables"("id") ON DELETE CASCADE,
  "order_id" uuid REFERENCES "sales_orders"("id") ON DELETE SET NULL,
  "guest_count" integer DEFAULT 1 NOT NULL,
  "server_user_id" uuid,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_table_sessions_tenant_id" ON "table_sessions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_table_sessions_table_id" ON "table_sessions" ("table_id");
--> statement-breakpoint

-- 3. Order Line Modifiers
CREATE TABLE IF NOT EXISTS "order_line_modifiers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_line_id" uuid NOT NULL REFERENCES "order_lines"("id") ON DELETE CASCADE,
  "modifier_name_ar" varchar(100) NOT NULL,
  "modifier_name_en" varchar(100) NOT NULL,
  "price_delta" numeric(12, 4) DEFAULT '0.0000' NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_order_line_modifiers_line_id" ON "order_line_modifiers" ("order_line_id");
--> statement-breakpoint

-- 4. Order Voids and Refunds
CREATE TABLE IF NOT EXISTS "order_voids" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id") ON DELETE CASCADE,
  "order_id" uuid NOT NULL REFERENCES "sales_orders"("id") ON DELETE CASCADE,
  "order_line_id" uuid REFERENCES "order_lines"("id") ON DELETE SET NULL,
  "reason" varchar(100) NOT NULL,
  "notes" text,
  "void_amount" numeric(12, 4) NOT NULL,
  "voided_by" uuid NOT NULL,
  "approved_by" uuid NOT NULL,
  "voided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_order_voids_tenant_id" ON "order_voids" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_order_voids_order_id" ON "order_voids" ("order_id");
--> statement-breakpoint

-- 5. RLS Policies
ALTER TABLE "dining_tables" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "dining_tables" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "dining_tables_tenant_policy" ON "dining_tables";
--> statement-breakpoint
CREATE POLICY "dining_tables_tenant_policy" ON "dining_tables"
  AS PERMISSIVE FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "dining_tables_migrator" ON "dining_tables";
--> statement-breakpoint
CREATE POLICY "dining_tables_migrator" ON "dining_tables"
  AS PERMISSIVE FOR ALL TO rc_migrator
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "table_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "table_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "table_sessions_tenant_policy" ON "table_sessions";
--> statement-breakpoint
CREATE POLICY "table_sessions_tenant_policy" ON "table_sessions"
  AS PERMISSIVE FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "table_sessions_migrator" ON "table_sessions";
--> statement-breakpoint
CREATE POLICY "table_sessions_migrator" ON "table_sessions"
  AS PERMISSIVE FOR ALL TO rc_migrator
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

ALTER TABLE "order_voids" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order_voids" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "order_voids_tenant_policy" ON "order_voids";
--> statement-breakpoint
CREATE POLICY "order_voids_tenant_policy" ON "order_voids"
  AS PERMISSIVE FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "order_voids_migrator" ON "order_voids";
--> statement-breakpoint
CREATE POLICY "order_voids_migrator" ON "order_voids"
  AS PERMISSIVE FOR ALL TO rc_migrator
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

-- 6. Ownership & Grants
ALTER TABLE "dining_tables" OWNER TO rc_migrator;
--> statement-breakpoint
ALTER TABLE "table_sessions" OWNER TO rc_migrator;
--> statement-breakpoint
ALTER TABLE "order_line_modifiers" OWNER TO rc_migrator;
--> statement-breakpoint
ALTER TABLE "order_voids" OWNER TO rc_migrator;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rc_app_user;
