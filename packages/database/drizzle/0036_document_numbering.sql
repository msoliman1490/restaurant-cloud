-- Phase 2: Customer-Specific Document Numbering (Multi-Tenant, Multi-Entity, Optional Branch)
-- Extends existing document_sequences table and adds immutable allocation ledger.

ALTER TABLE "document_sequences" ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenants"("id");
UPDATE "document_sequences" ds
SET "tenant_id" = le."tenant_id"
FROM "legal_entities" le
WHERE ds."legal_entity_id" = le."id" AND ds."tenant_id" IS NULL;
ALTER TABLE "document_sequences" ALTER COLUMN "tenant_id" SET NOT NULL;

ALTER TABLE "document_sequences" ADD COLUMN IF NOT EXISTS "branch_id" uuid REFERENCES "branches"("id");
ALTER TABLE "document_sequences" ADD COLUMN IF NOT EXISTS "starting_number" integer NOT NULL DEFAULT 1;
ALTER TABLE "document_sequences" ADD COLUMN IF NOT EXISTS "fiscal_year_format" varchar(20) NOT NULL DEFAULT 'YYYY';
ALTER TABLE "document_sequences" ADD COLUMN IF NOT EXISTS "annual_reset_policy" varchar(20) NOT NULL DEFAULT 'ANNUAL';
ALTER TABLE "document_sequences" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
ALTER TABLE "document_sequences" ADD COLUMN IF NOT EXISTS "is_locked_by_usage" boolean NOT NULL DEFAULT false;
ALTER TABLE "document_sequences" ADD COLUMN IF NOT EXISTS "last_allocated_at" timestamp with time zone;
ALTER TABLE "document_sequences" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone NOT NULL DEFAULT now();

DROP INDEX IF EXISTS "idx_sequence_entity_type_period";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_doc_seq_tenant_entity_branch_type_period"
  ON "document_sequences" (
    "tenant_id",
    "legal_entity_id",
    COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "document_type",
    "period_key"
  );
CREATE INDEX IF NOT EXISTS "idx_document_sequences_tenant_id" ON "document_sequences" ("tenant_id");

ALTER TABLE "document_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_sequences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "document_sequences_tenant_isolation" ON "document_sequences";
CREATE POLICY "document_sequences_tenant_isolation" ON "document_sequences"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "document_sequences" TO rc_app_user;

CREATE TABLE IF NOT EXISTS "document_number_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "sequence_id" uuid NOT NULL REFERENCES "document_sequences"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "branch_id" uuid REFERENCES "branches"("id"),
  "document_type" varchar(50) NOT NULL,
  "period_key" varchar(20) NOT NULL,
  "allocated_number" integer NOT NULL,
  "formatted_number" varchar(100) NOT NULL,
  "source_type" varchar(60),
  "source_id" uuid,
  "status" varchar(30) NOT NULL DEFAULT 'ALLOCATED',
  "allocated_by" uuid,
  "allocated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_doc_alloc_seq_num"
  ON "document_number_allocations" ("sequence_id", "allocated_number");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_doc_alloc_entity_type_fmt"
  ON "document_number_allocations" ("tenant_id", "legal_entity_id", "document_type", "formatted_number");
CREATE INDEX IF NOT EXISTS "idx_doc_alloc_tenant_id"
  ON "document_number_allocations" ("tenant_id");

ALTER TABLE "document_number_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_number_allocations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "document_number_allocations_tenant_isolation" ON "document_number_allocations";
CREATE POLICY "document_number_allocations_tenant_isolation" ON "document_number_allocations"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "document_number_allocations" TO rc_app_user;
