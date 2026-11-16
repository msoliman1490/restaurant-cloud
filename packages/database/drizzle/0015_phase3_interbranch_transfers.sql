-- Phase 3.4D: Inter-Branch Inventory & Financial Clearing Engine

ALTER TABLE "stock_transfers"
  ADD COLUMN IF NOT EXISTS "transfer_type" varchar(30) NOT NULL DEFAULT 'SAME_BRANCH',
  ADD COLUMN IF NOT EXISTS "source_legal_entity_id" uuid REFERENCES "legal_entities"("id"),
  ADD COLUMN IF NOT EXISTS "destination_legal_entity_id" uuid REFERENCES "legal_entities"("id"),
  ADD COLUMN IF NOT EXISTS "source_branch_id" uuid REFERENCES "branches"("id"),
  ADD COLUMN IF NOT EXISTS "destination_branch_id" uuid REFERENCES "branches"("id"),
  ADD COLUMN IF NOT EXISTS "submitted_by" uuid,
  ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cancelled_by" uuid,
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cancellation_reason" text,
  ADD COLUMN IF NOT EXISTS "total_overage_qty" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  ADD COLUMN IF NOT EXISTS "total_transfer_cost" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(128),
  ADD COLUMN IF NOT EXISTS "dispatch_idempotency_key" varchar(128),
  ADD COLUMN IF NOT EXISTS "receive_idempotency_key" varchar(128),
  ADD COLUMN IF NOT EXISTS "dispatch_journal_entry_id" uuid,
  ADD COLUMN IF NOT EXISTS "receive_journal_entry_id" uuid,
  ADD COLUMN IF NOT EXISTS "dest_journal_entry_id" uuid;

CREATE INDEX IF NOT EXISTS "idx_transfers_type_status" ON "stock_transfers" ("tenant_id", "transfer_type", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_transfers_idempotency" ON "stock_transfers" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;

ALTER TABLE "stock_transfer_lines"
  ADD COLUMN IF NOT EXISTS "base_quantity" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  ADD COLUMN IF NOT EXISTS "overage_quantity" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  ADD COLUMN IF NOT EXISTS "transfer_price" numeric(14, 4),
  ADD COLUMN IF NOT EXISTS "total_cost" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  ADD COLUMN IF NOT EXISTS "fifo_layers_json" jsonb;

CREATE TABLE IF NOT EXISTS "stock_transfer_discrepancies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "transfer_id" uuid NOT NULL REFERENCES "stock_transfers"("id"),
  "line_id" uuid NOT NULL REFERENCES "stock_transfer_lines"("id"),
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "discrepancy_type" varchar(30) NOT NULL DEFAULT 'SHORTAGE',
  "quantity" numeric(14, 4) NOT NULL,
  "unit_cost" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  "total_value" numeric(14, 4) NOT NULL DEFAULT '0.0000',
  "status" varchar(30) NOT NULL DEFAULT 'OPEN',
  "notes" text,
  "resolution_notes" text,
  "resolved_by" uuid,
  "resolved_at" timestamp with time zone,
  "journal_entry_id" uuid,
  "movement_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_transfer_discrepancies_tenant" ON "stock_transfer_discrepancies" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_transfer_discrepancies_transfer" ON "stock_transfer_discrepancies" ("transfer_id");
CREATE INDEX IF NOT EXISTS "idx_transfer_discrepancies_status" ON "stock_transfer_discrepancies" ("tenant_id", "status");

ALTER TABLE "stock_transfer_discrepancies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfer_discrepancies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_stock_transfer_discrepancies ON "stock_transfer_discrepancies";
CREATE POLICY tenant_isolation_stock_transfer_discrepancies ON "stock_transfer_discrepancies"
  FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
