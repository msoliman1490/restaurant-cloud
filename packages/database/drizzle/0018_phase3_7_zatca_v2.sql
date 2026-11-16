-- Phase 3.7: ZATCA V2 Production Readiness
-- Creates zatca_legal_entity_configs, zatca_egs_certificates, zatca_documents, zatca_outbox_queue, zatca_audit_logs
-- Enforces FORCE ROW LEVEL SECURITY and immutability on zatca_audit_logs

CREATE TABLE IF NOT EXISTS "zatca_legal_entity_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "v1_active" boolean NOT NULL DEFAULT true,
  "v2_enabled" boolean NOT NULL DEFAULT false,
  "environment" varchar(30) NOT NULL DEFAULT 'SANDBOX',
  "seller_vat_number" varchar(20) NOT NULL,
  "seller_name_ar" varchar(255) NOT NULL,
  "seller_name_en" varchar(255),
  "cr_number" varchar(50),
  "street_name" varchar(255),
  "building_number" varchar(20),
  "city_name" varchar(100),
  "postal_zone" varchar(20),
  "district_name" varchar(100),
  "country_code" varchar(4) NOT NULL DEFAULT 'SA',
  "industry_sector" varchar(100) NOT NULL DEFAULT 'Food & Beverage',
  "auto_submit_simplified" boolean NOT NULL DEFAULT true,
  "updated_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_zatca_le_config" ON "zatca_legal_entity_configs" ("tenant_id", "legal_entity_id");
CREATE INDEX IF NOT EXISTS "idx_zatca_le_config_tenant" ON "zatca_legal_entity_configs" ("tenant_id");

CREATE TABLE IF NOT EXISTS "zatca_egs_certificates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "egs_unit_id" uuid NOT NULL REFERENCES "egs_units"("id"),
  "device_id" uuid REFERENCES "devices"("id"),
  "environment" varchar(30) NOT NULL DEFAULT 'SANDBOX',
  "certificate_type" varchar(30) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'CSR_GENERATED',
  "otp_used_hash" varchar(128),
  "csr_pem" text NOT NULL,
  "encrypted_private_key" text NOT NULL,
  "private_key_iv" varchar(64) NOT NULL,
  "private_key_auth_tag" varchar(64) NOT NULL,
  "public_key_pem" text NOT NULL,
  "certificate_pem" text,
  "certificate_serial" varchar(128),
  "binary_security_token" text,
  "secret_token_encrypted" text,
  "secret_token_iv" varchar(64),
  "secret_token_auth_tag" varchar(64),
  "issued_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revocation_reason" text,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_zatca_certs_egs_unit" ON "zatca_egs_certificates" ("tenant_id", "egs_unit_id", "status");
CREATE INDEX IF NOT EXISTS "idx_zatca_certs_device" ON "zatca_egs_certificates" ("tenant_id", "device_id");

CREATE TABLE IF NOT EXISTS "zatca_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "egs_unit_id" uuid NOT NULL REFERENCES "egs_units"("id"),
  "device_id" uuid REFERENCES "devices"("id"),
  "certificate_id" uuid NOT NULL REFERENCES "zatca_egs_certificates"("id"),
  "source_type" varchar(40) NOT NULL,
  "source_id" uuid NOT NULL,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "document_number" varchar(80) NOT NULL,
  "uuid" varchar(100) NOT NULL,
  "icv" integer NOT NULL,
  "pih" varchar(255) NOT NULL,
  "invoice_hash" varchar(255) NOT NULL,
  "invoice_type_code" varchar(10) NOT NULL,
  "invoice_subtype" varchar(20) NOT NULL,
  "submission_type" varchar(30) NOT NULL,
  "compliance_status" varchar(40) NOT NULL DEFAULT 'SIGNED',
  "issue_timestamp" varchar(40) NOT NULL,
  "currency" varchar(3) NOT NULL DEFAULT 'SAR',
  "subtotal" numeric(14, 4) NOT NULL,
  "tax_amount" numeric(14, 4) NOT NULL,
  "grand_total" numeric(14, 4) NOT NULL,
  "original_document_uuid" varchar(100),
  "original_document_number" varchar(80),
  "zatca_reason_code" varchar(20),
  "ubl_xml" text NOT NULL,
  "signed_xml" text NOT NULL,
  "qr_code_tlv_base64" text NOT NULL,
  "signature_value" text NOT NULL,
  "zatca_request_id" varchar(120),
  "zatca_warnings_json" jsonb,
  "zatca_errors_json" jsonb,
  "cleared_xml" text,
  "submitted_at" timestamp with time zone,
  "cleared_or_reported_at" timestamp with time zone,
  "idempotency_key" varchar(255),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_zatca_doc_egs_icv" ON "zatca_documents" ("egs_unit_id", "icv");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_zatca_doc_uuid" ON "zatca_documents" ("tenant_id", "uuid");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_zatca_doc_idemp" ON "zatca_documents" ("tenant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_zatca_doc_source" ON "zatca_documents" ("tenant_id", "source_type", "source_id");
CREATE INDEX IF NOT EXISTS "idx_zatca_doc_status" ON "zatca_documents" ("tenant_id", "legal_entity_id", "compliance_status");

CREATE TABLE IF NOT EXISTS "zatca_outbox_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "egs_unit_id" uuid NOT NULL REFERENCES "egs_units"("id"),
  "zatca_document_id" uuid NOT NULL REFERENCES "zatca_documents"("id"),
  "submission_type" varchar(30) NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'PENDING',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 5,
  "next_retry_at" timestamp with time zone NOT NULL DEFAULT now(),
  "locked_by" varchar(100),
  "locked_at" timestamp with time zone,
  "last_http_status" integer,
  "last_error_code" varchar(100),
  "last_error_message" text,
  "idempotency_key" varchar(255),
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_zatca_outbox_idemp" ON "zatca_outbox_queue" ("tenant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_zatca_outbox_poll" ON "zatca_outbox_queue" ("status", "next_retry_at");
CREATE INDEX IF NOT EXISTS "idx_zatca_outbox_tenant_doc" ON "zatca_outbox_queue" ("tenant_id", "zatca_document_id");

CREATE TABLE IF NOT EXISTS "zatca_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "egs_unit_id" uuid REFERENCES "egs_units"("id"),
  "zatca_document_id" uuid REFERENCES "zatca_documents"("id"),
  "action" varchar(60) NOT NULL,
  "actor_id" uuid,
  "previous_status" varchar(40),
  "new_status" varchar(40),
  "details_json" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_zatca_audit_tenant_entity" ON "zatca_audit_logs" ("tenant_id", "legal_entity_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_zatca_audit_doc" ON "zatca_audit_logs" ("zatca_document_id");

-- Enable & Force RLS on all 5 Phase 3.7 tables
ALTER TABLE "zatca_legal_entity_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zatca_legal_entity_configs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_zatca_legal_entity_configs" ON "zatca_legal_entity_configs";
CREATE POLICY "tenant_isolation_zatca_legal_entity_configs" ON "zatca_legal_entity_configs"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "zatca_egs_certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zatca_egs_certificates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_zatca_egs_certificates" ON "zatca_egs_certificates";
CREATE POLICY "tenant_isolation_zatca_egs_certificates" ON "zatca_egs_certificates"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "zatca_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zatca_documents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_zatca_documents" ON "zatca_documents";
CREATE POLICY "tenant_isolation_zatca_documents" ON "zatca_documents"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "zatca_outbox_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zatca_outbox_queue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_zatca_outbox_queue" ON "zatca_outbox_queue";
CREATE POLICY "tenant_isolation_zatca_outbox_queue" ON "zatca_outbox_queue"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "zatca_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zatca_audit_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_zatca_audit_logs" ON "zatca_audit_logs";
CREATE POLICY "tenant_isolation_zatca_audit_logs" ON "zatca_audit_logs"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Grants & Immutability
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "zatca_legal_entity_configs" TO "rc_app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "zatca_egs_certificates" TO "rc_app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "zatca_documents" TO "rc_app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "zatca_outbox_queue" TO "rc_app_user";

REVOKE ALL ON TABLE "zatca_audit_logs" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "zatca_audit_logs" FROM "rc_app_user";
GRANT SELECT, INSERT ON TABLE "zatca_audit_logs" TO "rc_app_user";
