-- 0031_saas_onboarding_subscriptions.sql
-- Complete SaaS Onboarding, Authentication Hardening, Subscriptions, Billing, PDPL Consents & Onboarding Progress

-- 1. Extend users for Platform Super Admin, Verification, and Brute-Force Lockout
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_platform_admin" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;

-- 2. Extend tenant_subscriptions for Billing Cycles & Lifecycle States
ALTER TABLE "tenant_subscriptions" ADD COLUMN IF NOT EXISTS "billing_cycle" varchar(20) DEFAULT 'MONTHLY' NOT NULL;
ALTER TABLE "tenant_subscriptions" ADD COLUMN IF NOT EXISTS "auto_renew" boolean DEFAULT true NOT NULL;
ALTER TABLE "tenant_subscriptions" ADD COLUMN IF NOT EXISTS "grace_period_ends_at" timestamp with time zone;
ALTER TABLE "tenant_subscriptions" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;
ALTER TABLE "tenant_subscriptions" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
ALTER TABLE "tenant_subscriptions" ADD COLUMN IF NOT EXISTS "last_payment_status" varchar(30);

-- 3. Global Subscription Plans (managed by Super Admin)
CREATE TABLE IF NOT EXISTS "subscription_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" varchar(50) NOT NULL UNIQUE,
  "name_ar" varchar(120) NOT NULL,
  "name_en" varchar(120) NOT NULL,
  "description_ar" text,
  "description_en" text,
  "monthly_price_sar" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "annual_price_sar" numeric(12, 2) DEFAULT '0.00' NOT NULL,
  "trial_days" integer DEFAULT 14 NOT NULL,
  "max_branches" integer DEFAULT 3 NOT NULL,
  "max_devices" integer DEFAULT 5 NOT NULL,
  "max_users" integer DEFAULT 10 NOT NULL,
  "features_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "is_public" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 4. Platform Policies (PDPL, E-Commerce Terms, Trial/Grace Config)
CREATE TABLE IF NOT EXISTS "saas_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "policy_key" varchar(80) NOT NULL UNIQUE,
  "title_ar" varchar(200) NOT NULL,
  "title_en" varchar(200) NOT NULL,
  "content_ar" text NOT NULL,
  "content_en" text NOT NULL,
  "config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version" varchar(30) DEFAULT '1.0' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 5. Single-use Verification & Password Reset Tokens
CREATE TABLE IF NOT EXISTS "auth_verification_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id"),
  "target" varchar(255) NOT NULL,
  "purpose" varchar(40) NOT NULL,
  "token_hash" varchar(128) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_auth_verif_target_purpose" ON "auth_verification_tokens" ("target", "purpose");
CREATE INDEX IF NOT EXISTS "idx_auth_verif_token_hash" ON "auth_verification_tokens" ("token_hash");

-- 6. Tenant-Scoped SaaS Invoices
CREATE TABLE IF NOT EXISTS "saas_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "subscription_id" uuid NOT NULL REFERENCES "tenant_subscriptions"("id"),
  "invoice_number" varchar(60) NOT NULL UNIQUE,
  "plan_code" varchar(50) NOT NULL,
  "billing_cycle" varchar(20) DEFAULT 'MONTHLY' NOT NULL,
  "subtotal_sar" numeric(12, 2) NOT NULL,
  "vat_sar" numeric(12, 2) NOT NULL,
  "total_sar" numeric(12, 2) NOT NULL,
  "currency" varchar(3) DEFAULT 'SAR' NOT NULL,
  "status" varchar(30) DEFAULT 'PENDING' NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "paid_at" timestamp with time zone,
  "idempotency_key" varchar(150),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_saas_invoices_tenant_id" ON "saas_invoices" ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_saas_invoices_tenant_idemp" ON "saas_invoices" ("tenant_id", "idempotency_key");

-- 7. Tenant-Scoped SaaS Payments (No raw card data stored)
CREATE TABLE IF NOT EXISTS "saas_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "invoice_id" uuid NOT NULL REFERENCES "saas_invoices"("id"),
  "provider" varchar(40) DEFAULT 'HOSTED_CHECKOUT' NOT NULL,
  "provider_payment_ref" varchar(150) NOT NULL,
  "provider_event_id" varchar(150),
  "amount_sar" numeric(12, 2) NOT NULL,
  "status" varchar(30) DEFAULT 'PENDING' NOT NULL,
  "failure_reason" text,
  "raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_saas_payments_tenant_id" ON "saas_payments" ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_saas_payments_provider_event" ON "saas_payments" ("provider", "provider_event_id");

-- 8. Saudi PDPL & E-Commerce Consents
CREATE TABLE IF NOT EXISTS "pdpl_consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "user_id" uuid REFERENCES "users"("id"),
  "consent_type" varchar(50) NOT NULL,
  "policy_version" varchar(30) DEFAULT '1.0' NOT NULL,
  "accepted" boolean DEFAULT true NOT NULL,
  "purpose" text,
  "ip_address" varchar(64),
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_pdpl_consents_tenant_id" ON "pdpl_consents" ("tenant_id");

-- 9. Tenant Onboarding Progress
CREATE TABLE IF NOT EXISTS "onboarding_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "current_step" varchar(50) DEFAULT 'legal_entity' NOT NULL,
  "is_completed" boolean DEFAULT false NOT NULL,
  "skipped_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_onboarding_progress_tenant_id" ON "onboarding_progress" ("tenant_id");

-- 10. RLS & FORCE RLS on Tenant-Scoped SaaS Tables
ALTER TABLE "saas_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saas_invoices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "saas_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saas_payments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pdpl_consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pdpl_consents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_progress" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saas_invoices') THEN
    CREATE POLICY "tenant_isolation_saas_invoices" ON "saas_invoices"
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saas_payments') THEN
    CREATE POLICY "tenant_isolation_saas_payments" ON "saas_payments"
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pdpl_consents') THEN
    CREATE POLICY "tenant_isolation_pdpl_consents" ON "pdpl_consents"
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'onboarding_progress') THEN
    CREATE POLICY "tenant_isolation_onboarding_progress" ON "onboarding_progress"
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;
END $$;

-- 11. Grants for rc_app_user
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "subscription_plans" TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "saas_policies" TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "auth_verification_tokens" TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "saas_invoices" TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "saas_payments" TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pdpl_consents" TO rc_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "onboarding_progress" TO rc_app_user;

-- 12. Initial Configurable Plan Templates & Saudi PDPL/E-Commerce Policy Drafts (editable by Super Admin)
INSERT INTO "subscription_plans" ("code", "name_ar", "name_en", "description_ar", "description_en", "monthly_price_sar", "annual_price_sar", "trial_days", "max_branches", "max_devices", "max_users", "features_json", "sort_order")
VALUES
  ('FREE_TRIAL', 'التجربة المجانية', 'Free Trial', 'تجربة مجانية متكاملة لتقييم المنصة قبل التفعيل التجاري', 'Full evaluation trial before commercial activation', '0.00', '0.00', 14, 3, 5, 10, '["POS","Inventory","Accounting","Purchasing"]'::jsonb, 1),
  ('STARTER', 'الباقة الأساسية', 'Starter', 'مناسبة للمطاعم والمقاهي ذات الفرع الواحد أو الفرعين', 'Ideal for single or dual-branch restaurants & cafes', '299.00', '2990.00', 14, 2, 4, 8, '["POS","Inventory","Catalog","BasicReports"]'::jsonb, 2),
  ('GROWTH', 'باقة النمو', 'Growth', 'للسلاسل النامية مع المشتريات والتصنيع والتقارير المالية', 'For growing chains with purchasing, recipes & accounting', '699.00', '6990.00', 14, 10, 20, 35, '["POS","Inventory","Purchasing","Production","Accounting","Delivery"]'::jsonb, 3),
  ('ENTERPRISE', 'باقة المؤسسات', 'Enterprise', 'سعات غير محدودة مخصصة للمجموعات الكبرى والشركات متعددة الكيانات', 'High-capacity multi-entity enterprise operations', '1499.00', '14990.00', 14, 50, 100, 200, '["ALL_MODULES","MultiEntity","PeriodClosing","ZATCA","API"]'::jsonb, 4)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "saas_policies" ("policy_key", "title_ar", "title_en", "content_ar", "content_en", "config_json", "version")
VALUES
  ('PDPL_PRIVACY', 'سياسة الخصوصية وحماية البيانات الشخصية (PDPL)', 'Personal Data Protection & Privacy Policy (PDPL)',
   'تجمع منصة Restaurant Cloud البيانات الأساسية اللازمة لتشغيل حساب المنشأة وإصدار الفواتير والامتثال الضريبي في المملكة العربية السعودية. يحق لصاحب البيانات طلب الوصول إلى بياناته أو تصحيحها أو حذفها وفق نظام حماية البيانات الشخصية ولوائحه التنفيذية. تتم معالجة المدفوعات عبر مزود دفع مرخص دون تخزين بيانات البطاقات البنكية داخل خوادمنا.',
   'Restaurant Cloud collects only necessary business and contact data required to operate your organization workspace, invoicing, and tax compliance in Saudi Arabia. Data subjects may request access, correction, or deletion under Saudi PDPL. Card payments are processed via tokenized hosted checkout; raw card details are never stored.',
   '{"retentionDays": 3650, "dataResidency": "SA_AND_AUTHORIZED_SUBPROCESSORS", "subprocessors": ["Cloudflare", "Authorized Payment Gateway"]}'::jsonb, '1.0'),
  ('ECOMMERCE_TERMS', 'شروط الاشتراك والتجديد والإلغاء (نظام التجارة الإلكترونية)', 'Subscription, Renewal & Cancellation Terms',
   'يبدأ الاشتراك بفترة تجريبية قابلة للإلغاء دون رسوم. عند الترقية أو التجديد يتم احتساب ضريبة القيمة المضافة 15% وإصدار فاتورة إلكترونية. في حال تعثر السداد يُمنح الحساب فترة سماح قبل التعليق، ويمكن إلغاء التجديد التلقائي في أي وقت.',
   'Subscriptions begin with a trial period. Paid upgrades and renewals include 15% VAT and an electronic invoice. Failed renewals enter a configurable grace period before suspension, and auto-renewal can be cancelled at any time.',
   '{"gracePeriodDays": 7, "vatRate": 0.15, "autoSuspendAfterGrace": true}'::jsonb, '1.0')
ON CONFLICT ("policy_key") DO NOTHING;
