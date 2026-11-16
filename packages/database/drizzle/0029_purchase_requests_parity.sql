-- 0029_purchase_requests_parity.sql
-- Ensure purchase_requests and purchase_request_lines exist with indexes, RLS, and app grants.

CREATE TABLE IF NOT EXISTS "purchase_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
  "request_number" varchar(50) NOT NULL,
  "status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
  "requested_by" uuid,
  "approved_by" uuid,
  "needed_by_date" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_purchase_requests_tenant_id" ON "purchase_requests" ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_purchase_requests_entity_number" ON "purchase_requests" ("legal_entity_id", "request_number");

CREATE TABLE IF NOT EXISTS "purchase_request_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id"),
  "request_id" uuid NOT NULL REFERENCES "purchase_requests"("id"),
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "uom_id" uuid NOT NULL REFERENCES "units_of_measure"("id"),
  "requested_qty" numeric(14, 4) NOT NULL,
  "estimated_unit_cost" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "notes" text
);

CREATE INDEX IF NOT EXISTS "idx_purchase_req_lines_request_id" ON "purchase_request_lines" ("request_id");

ALTER TABLE "purchase_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "purchase_request_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_request_lines" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'purchase_requests'
  ) THEN
    CREATE POLICY "tenant_isolation_purchase_requests" ON "purchase_requests"
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'purchase_request_lines'
  ) THEN
    CREATE POLICY "tenant_isolation_purchase_request_lines" ON "purchase_request_lines"
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "purchase_requests" TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "purchase_request_lines" TO rc_app_user;
