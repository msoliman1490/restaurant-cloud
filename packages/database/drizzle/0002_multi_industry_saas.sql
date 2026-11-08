CREATE TABLE IF NOT EXISTS "tenant_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_code" varchar(50) DEFAULT 'FREE_TRIAL' NOT NULL,
	"status" varchar(30) DEFAULT 'TRIAL' NOT NULL,
	"max_branches" integer DEFAULT 3 NOT NULL,
	"max_devices" integer DEFAULT 5 NOT NULL,
	"max_users" integer DEFAULT 10 NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tenant_industry_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"industry" varchar(50) NOT NULL,
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"settings" text,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "tenant_industry_packs" ADD CONSTRAINT "tenant_industry_packs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_tenant_subscriptions_tenant_id" ON "tenant_subscriptions" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_tenant_subscriptions_status" ON "tenant_subscriptions" USING btree ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tenant_industry_packs_tenant_ind" ON "tenant_industry_packs" USING btree ("tenant_id","industry");
CREATE INDEX IF NOT EXISTS "idx_tenant_industry_packs_tenant_status" ON "tenant_industry_packs" USING btree ("tenant_id","status");
