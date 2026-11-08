CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"deployment_mode" varchar(30) DEFAULT 'SHARED' NOT NULL,
	"primary_locale" varchar(10) DEFAULT 'ar-SA' NOT NULL,
	"timezone" varchar(50) DEFAULT 'Asia/Riyadh' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"reporting_currency" varchar(3) DEFAULT 'SAR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid,
	"legal_name" varchar(255) NOT NULL,
	"commercial_name" varchar(255),
	"cr_number" varchar(50),
	"vat_number" varchar(50) NOT NULL,
	"functional_currency" varchar(3) DEFAULT 'SAR' NOT NULL,
	"timezone" varchar(50) DEFAULT 'Asia/Riyadh' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"business_type" varchar(30) DEFAULT 'RESTAURANT' NOT NULL,
	"timezone" varchar(50) DEFAULT 'Asia/Riyadh' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_code" varchar(50) NOT NULL,
	"device_type" varchar(30) DEFAULT 'POS' NOT NULL,
	"device_epoch" uuid DEFAULT gen_random_uuid() NOT NULL,
	"public_key_fingerprint" text,
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(30),
	"display_name" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"mfa_required" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_system_role" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"resource" varchar(50) NOT NULL,
	"action" varchar(50) NOT NULL,
	"description" text,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "user_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"scope_type" varchar(30) DEFAULT 'BRANCH' NOT NULL,
	"scope_id" uuid NOT NULL,
	"access_mode" varchar(10) DEFAULT 'ALLOW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" varchar(50) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status" varchar(30) DEFAULT 'PROCESSING' NOT NULL,
	"response_snapshot" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"document_type" varchar(50) NOT NULL,
	"period_key" varchar(20) NOT NULL,
	"prefix" varchar(20) NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"padding" integer DEFAULT 6 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" uuid NOT NULL,
	"before_state" text,
	"after_state" text,
	"correlation_id" varchar(100),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"cashier_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"opening_cash" numeric(12, 4) DEFAULT '0.0000' NOT NULL,
	"expected_cash" numeric(12, 4),
	"counted_cash" numeric(12, 4),
	"variance" numeric(12, 4),
	"status" varchar(30) DEFAULT 'OPEN' NOT NULL,
	"close_journal_entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"shift_id" uuid,
	"order_number" varchar(50) NOT NULL,
	"order_type" varchar(30) DEFAULT 'TAKEAWAY' NOT NULL,
	"channel" varchar(30) DEFAULT 'POS' NOT NULL,
	"status" varchar(30) DEFAULT 'CONFIRMED' NOT NULL,
	"currency" varchar(3) DEFAULT 'SAR' NOT NULL,
	"subtotal" numeric(12, 4) DEFAULT '0.0000' NOT NULL,
	"discount_total" numeric(12, 4) DEFAULT '0.0000' NOT NULL,
	"tax_total" numeric(12, 4) DEFAULT '0.0000' NOT NULL,
	"grand_total" numeric(12, 4) DEFAULT '0.0000' NOT NULL,
	"idempotency_key" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"uom_id" uuid NOT NULL,
	"unit_price" numeric(12, 4) NOT NULL,
	"discount_amount" numeric(12, 4) DEFAULT '0.0000' NOT NULL,
	"tax_amount" numeric(12, 4) DEFAULT '0.0000' NOT NULL,
	"line_total" numeric(12, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_method" varchar(30) DEFAULT 'CASH' NOT NULL,
	"amount" numeric(12, 4) NOT NULL,
	"currency" varchar(3) DEFAULT 'SAR' NOT NULL,
	"provider_code" varchar(50),
	"provider_transaction_ref" varchar(100),
	"status" varchar(30) DEFAULT 'CAPTURED' NOT NULL,
	"idempotency_key" varchar(255),
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "egs_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"branch_id" uuid,
	"unit_identifier" varchar(100) NOT NULL,
	"device_asset_code" varchar(100),
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL,
	"csid_reference" varchar(255),
	"icv_current" integer DEFAULT 0 NOT NULL,
	"last_hash" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "egs_units_unit_identifier_unique" UNIQUE("unit_identifier")
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"account_code" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"account_type" varchar(30) DEFAULT 'ASSET' NOT NULL,
	"normal_balance" varchar(10) DEFAULT 'DEBIT' NOT NULL,
	"parent_id" uuid,
	"is_postable" boolean DEFAULT true NOT NULL,
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"journal_number" varchar(50) NOT NULL,
	"journal_type" varchar(30) DEFAULT 'GENERAL' NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"source_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'POSTED' NOT NULL,
	"debit_total" numeric(14, 4) NOT NULL,
	"credit_total" numeric(14, 4) NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"branch_id" uuid,
	"debit" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"credit" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"currency" varchar(3) DEFAULT 'SAR' NOT NULL,
	"description" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_owner_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_id" uuid,
	"on_hand_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"reserved_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_owner_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"movement_type" varchar(50) DEFAULT 'SALE_ISSUE' NOT NULL,
	"direction" varchar(10) DEFAULT 'OUT' NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"source_type" varchar(50) NOT NULL,
	"source_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offline_quota_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_epoch" uuid NOT NULL,
	"allocated_qty" numeric(14, 4) NOT NULL,
	"consumed_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
	"last_received_seq" integer DEFAULT 0 NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"signature" varchar(512) NOT NULL,
	"status" varchar(30) DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memberships" ADD CONSTRAINT "user_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memberships" ADD CONSTRAINT "user_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memberships" ADD CONSTRAINT "user_memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_scopes" ADD CONSTRAINT "membership_scopes_membership_id_user_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."user_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_shift_id_pos_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "egs_units" ADD CONSTRAINT "egs_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "egs_units" ADD CONSTRAINT "egs_units_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "egs_units" ADD CONSTRAINT "egs_units_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_chart_of_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_legal_entity_owner_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_owner_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_legal_entity_owner_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_owner_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_quota_leases" ADD CONSTRAINT "offline_quota_leases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_quota_leases" ADD CONSTRAINT "offline_quota_leases_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_quota_leases" ADD CONSTRAINT "offline_quota_leases_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_quota_leases" ADD CONSTRAINT "offline_quota_leases_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_groups_tenant_id" ON "groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_legal_entities_tenant_id" ON "legal_entities" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_legal_entities_tenant_vat" ON "legal_entities" USING btree ("tenant_id","vat_number");--> statement-breakpoint
CREATE INDEX "idx_branches_tenant_id" ON "branches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_branches_legal_entity_id" ON "branches" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_branches_entity_code" ON "branches" USING btree ("tenant_id","legal_entity_id","code");--> statement-breakpoint
CREATE INDEX "idx_warehouses_tenant_id" ON "warehouses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_warehouses_branch_id" ON "warehouses" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_warehouses_tenant_code" ON "warehouses" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "idx_devices_tenant_id" ON "devices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_devices_branch_id" ON "devices" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_devices_branch_code" ON "devices" USING btree ("tenant_id","branch_id","device_code");--> statement-breakpoint
CREATE INDEX "idx_roles_tenant_id" ON "roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_membership_tenant_user_role" ON "user_memberships" USING btree ("tenant_id","user_id","role_id");--> statement-breakpoint
CREATE INDEX "idx_user_memberships_tenant_id" ON "user_memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_user_memberships_user_id" ON "user_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_membership_scopes_membership_id" ON "membership_scopes" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_idempotency_tenant_scope_key" ON "idempotency_keys" USING btree ("tenant_id","scope","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_idempotency_tenant_id" ON "idempotency_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sequence_entity_type_period" ON "document_sequences" USING btree ("legal_entity_id","document_type","period_key");--> statement-breakpoint
CREATE INDEX "idx_document_sequences_legal_entity_id" ON "document_sequences" USING btree ("legal_entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant_time" ON "audit_logs" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant_entity" ON "audit_logs" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_pos_shifts_tenant_id" ON "pos_shifts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_pos_shifts_branch_device" ON "pos_shifts" USING btree ("tenant_id","branch_id","device_id","status");--> statement-breakpoint
CREATE INDEX "idx_sales_orders_tenant_id" ON "sales_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sales_orders_entity_number" ON "sales_orders" USING btree ("tenant_id","legal_entity_id","order_number");--> statement-breakpoint
CREATE INDEX "idx_sales_orders_branch_created" ON "sales_orders" USING btree ("tenant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_order_lines_order_id" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_payments_tenant_id" ON "payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_payments_order_id" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_egs_units_tenant_id" ON "egs_units" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_egs_units_branch_id" ON "egs_units" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "idx_coa_tenant_id" ON "chart_of_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_coa_entity_account_code" ON "chart_of_accounts" USING btree ("legal_entity_id","account_code");--> statement-breakpoint
CREATE INDEX "idx_journal_entries_tenant_id" ON "journal_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_journal_entries_entity_number" ON "journal_entries" USING btree ("legal_entity_id","journal_number");--> statement-breakpoint
CREATE INDEX "idx_journal_lines_entry_id" ON "journal_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "idx_journal_lines_account_id" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_balances_tenant_id" ON "inventory_balances" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_inventory_balances_wh_item_lot" ON "inventory_balances" USING btree ("warehouse_id","item_id","lot_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_movements_tenant_id" ON "inventory_movements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_inventory_movements_wh_item_time" ON "inventory_movements" USING btree ("warehouse_id","item_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_offline_quota_tenant_id" ON "offline_quota_leases" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_offline_quota_device_item_epoch" ON "offline_quota_leases" USING btree ("device_id","warehouse_id","item_id","device_epoch","status");