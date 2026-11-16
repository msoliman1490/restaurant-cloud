CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "template_key" varchar(80) NOT NULL,
  "name_ar" varchar(160) NOT NULL,
  "name_en" varchar(160) NOT NULL,
  "meta_template_name" varchar(120) NOT NULL,
  "language_code" varchar(10) NOT NULL DEFAULT 'ar',
  "category" varchar(30) NOT NULL DEFAULT 'UTILITY',
  "header_text" text,
  "body_text" text NOT NULL,
  "footer_text" text,
  "variables_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_whatsapp_templates_tenant_key_lang"
  ON "whatsapp_templates" ("tenant_id", "template_key", "language_code");
CREATE INDEX IF NOT EXISTS "idx_whatsapp_templates_tenant_id"
  ON "whatsapp_templates" ("tenant_id");

ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "whatsapp_templates" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_templates_tenant_isolation" ON "whatsapp_templates";
CREATE POLICY "whatsapp_templates_tenant_isolation" ON "whatsapp_templates"
  USING ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "whatsapp_templates" TO rc_app_user;
