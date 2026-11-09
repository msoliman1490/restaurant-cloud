-- 1. Business Partners (سجل الأطراف الموحد)
CREATE TABLE IF NOT EXISTS "business_partners" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE RESTRICT,
  "partner_number" varchar(50) NOT NULL,
  "partner_type" varchar(20) DEFAULT 'CORPORATE' NOT NULL,
  "legal_name_ar" varchar(255) NOT NULL,
  "legal_name_en" varchar(255),
  "trade_name_ar" varchar(255),
  "trade_name_en" varchar(255),
  "tax_identification_number" varchar(15),
  "commercial_registration_number" varchar(10),
  "national_id_or_iqama" varchar(20),
  "primary_email" varchar(255),
  "primary_phone" varchar(50),
  "website" varchar(255),
  "is_active" boolean DEFAULT true NOT NULL,
  "is_on_hold" boolean DEFAULT false NOT NULL,
  "hold_reason" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  CONSTRAINT "uq_bp_tenant_id" UNIQUE ("id", "tenant_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bp_tenant_id" ON "business_partners" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bp_tenant_number" ON "business_partners" ("tenant_id", "partner_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bp_tenant_tax_id" ON "business_partners" ("tenant_id", "tax_identification_number") 
  WHERE tax_identification_number IS NOT NULL AND tax_identification_number <> '';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bp_tenant_crn" ON "business_partners" ("tenant_id", "commercial_registration_number") 
  WHERE commercial_registration_number IS NOT NULL AND commercial_registration_number <> '';
--> statement-breakpoint

-- 2. Partner Roles (أدوار الأطراف)
CREATE TABLE IF NOT EXISTS "partner_roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "partner_id" uuid NOT NULL REFERENCES "business_partners"("id") ON DELETE CASCADE,
  "role_type" varchar(30) NOT NULL,
  "status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
  "effective_from" date DEFAULT CURRENT_DATE NOT NULL,
  "effective_to" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_partner_role_unique" UNIQUE ("partner_id", "role_type")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_partner_roles_lookup" ON "partner_roles" ("tenant_id", "role_type", "status");
--> statement-breakpoint

-- 3. Partner Addresses (العناوين الوطنية والتجارية)
CREATE TABLE IF NOT EXISTS "partner_addresses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "partner_id" uuid NOT NULL REFERENCES "business_partners"("id") ON DELETE CASCADE,
  "address_type" varchar(30) DEFAULT 'NATIONAL_ADDRESS' NOT NULL,
  "building_number" varchar(10) NOT NULL,
  "street_name" varchar(255) NOT NULL,
  "district_name" varchar(100) NOT NULL,
  "city" varchar(100) NOT NULL,
  "postal_code" varchar(20) NOT NULL,
  "additional_number" varchar(10),
  "country_code" varchar(3) DEFAULT 'SA' NOT NULL,
  "short_address" varchar(20),
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_partner_addresses_partner" ON "partner_addresses" ("partner_id");
--> statement-breakpoint

-- 4. Partner Contacts (جهات الاتصال)
CREATE TABLE IF NOT EXISTS "partner_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "partner_id" uuid NOT NULL REFERENCES "business_partners"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "job_title" varchar(100),
  "email" varchar(255),
  "phone" varchar(50),
  "is_authorized_signatory" boolean DEFAULT false NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_partner_contacts_partner" ON "partner_contacts" ("partner_id");
--> statement-breakpoint

-- 5. Partner Company Settings (إعدادات الطرف المستقلة لكل شركة قانونية)
CREATE TABLE IF NOT EXISTS "partner_company_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id") ON DELETE RESTRICT,
  "partner_id" uuid NOT NULL REFERENCES "business_partners"("id") ON DELETE CASCADE,
  "default_currency" varchar(3) DEFAULT 'SAR' NOT NULL,
  "payment_terms_days" integer DEFAULT 30 NOT NULL,
  "credit_limit" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "is_credit_blocked" boolean DEFAULT false NOT NULL,
  "price_tolerance_pct" numeric(5, 4) DEFAULT '0.0200' NOT NULL,
  "ar_control_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "ap_control_account_id" uuid REFERENCES "chart_of_accounts"("id"),
  "custom_discount_pct" numeric(5, 4) DEFAULT '0.0000' NOT NULL,
  "price_tier_id" uuid,
  "tax_exempt" boolean DEFAULT false NOT NULL,
  "tax_exemption_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_partner_company_unique" UNIQUE ("legal_entity_id", "partner_id"),
  CONSTRAINT "uq_partner_company_ref" UNIQUE ("id", "legal_entity_id", "tenant_id")
);
--> statement-breakpoint

-- 6. Partner Balances (الأرصدة اللحظية المستقلة لكل شركة وعملة)
CREATE TABLE IF NOT EXISTS "partner_balances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id") ON DELETE RESTRICT,
  "partner_id" uuid NOT NULL REFERENCES "business_partners"("id") ON DELETE CASCADE,
  "currency" varchar(3) DEFAULT 'SAR' NOT NULL,
  "customer_balance" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "customer_unallocated_receipts" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "vendor_balance" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "vendor_unallocated_payments" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "last_transaction_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_partner_balance_entity_partner" UNIQUE ("legal_entity_id", "partner_id", "currency")
);
--> statement-breakpoint

-- 7. Purchase Orders (أوامر الشراء لمطابقة 3-Way Matching)
CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "partner_id" uuid REFERENCES "business_partners"("id"),
  "supplier_id" uuid REFERENCES "suppliers"("id"),
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
  "order_number" varchar(50) NOT NULL,
  "status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
  "order_date" timestamp with time zone DEFAULT now() NOT NULL,
  "expected_delivery_date" timestamp with time zone,
  "subtotal" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "tax_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "grand_total" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "currency" varchar(3) DEFAULT 'SAR' NOT NULL,
  "notes" text,
  "issued_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_purchase_orders_entity_number" UNIQUE ("legal_entity_id", "order_number")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_tenant_id" ON "purchase_orders" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_partner_id" ON "purchase_orders" ("partner_id");
--> statement-breakpoint

-- 8. Purchase Order Lines
CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id"),
  "order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "uom_id" uuid NOT NULL REFERENCES "units_of_measure"("id"),
  "ordered_qty" numeric(14, 4) NOT NULL,
  "received_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "invoiced_qty" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "unit_price" numeric(14, 4) NOT NULL,
  "tax_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
  "line_total" numeric(14, 4) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenants"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_po_lines_order_id" ON "purchase_order_lines" ("order_id");
--> statement-breakpoint

-- 9. Goods Receipts (سندات استلام المخزون GRN)
CREATE TABLE IF NOT EXISTS "goods_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "purchase_order_id" uuid REFERENCES "purchase_orders"("id"),
  "partner_id" uuid REFERENCES "business_partners"("id"),
  "supplier_id" uuid REFERENCES "suppliers"("id"),
  "warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id"),
  "receipt_number" varchar(50) NOT NULL,
  "delivery_note_number" varchar(100),
  "status" varchar(30) DEFAULT 'RECEIVED' NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "received_by" uuid,
  "notes" text,
  CONSTRAINT "uq_goods_receipts_entity_number" UNIQUE ("legal_entity_id", "receipt_number")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_goods_receipts_tenant_id" ON "goods_receipts" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_goods_receipts_warehouse_id" ON "goods_receipts" ("warehouse_id");
--> statement-breakpoint

-- 10. Goods Receipt Lines
CREATE TABLE IF NOT EXISTS "goods_receipt_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id"),
  "receipt_id" uuid NOT NULL REFERENCES "goods_receipts"("id") ON DELETE CASCADE,
  "purchase_order_line_id" uuid REFERENCES "purchase_order_lines"("id"),
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "uom_id" uuid NOT NULL REFERENCES "units_of_measure"("id"),
  "received_qty" numeric(14, 4) NOT NULL,
  "unit_cost" numeric(14, 4) NOT NULL,
  "lot_number" varchar(100),
  "expiry_date" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenants"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gr_lines_receipt_id" ON "goods_receipt_lines" ("receipt_id");
--> statement-breakpoint

-- 11. AR Invoices (فواتير المبيعات بالدفتر المساعد للعملاء)
CREATE TABLE IF NOT EXISTS "ar_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id") ON DELETE RESTRICT,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE RESTRICT,
  "partner_id" uuid NOT NULL REFERENCES "business_partners"("id") ON DELETE RESTRICT,
  "invoice_number" varchar(50) NOT NULL,
  "invoice_type" varchar(30) DEFAULT 'TAX_INVOICE' NOT NULL,
  "original_invoice_id" uuid REFERENCES "ar_invoices"("id"),
  "original_invoice_uuid" varchar(100),
  "original_invoice_number" varchar(50),
  "original_invoice_date" date,
  "zatca_reason_code" varchar(10),
  "status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
  "issue_date" date DEFAULT CURRENT_DATE NOT NULL,
  "due_date" date NOT NULL,
  "currency" varchar(3) DEFAULT 'SAR' NOT NULL,
  "exchange_rate" numeric(12, 6) DEFAULT '1.000000' NOT NULL,
  "subtotal" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "discount_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "taxable_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "tax_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "grand_total" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "paid_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "remaining_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "zatca_uuid" varchar(100),
  "zatca_hash" varchar(255),
  "previous_invoice_hash" varchar(255),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  CONSTRAINT "uq_ar_invoices_ref" UNIQUE ("id", "legal_entity_id", "tenant_id"),
  CONSTRAINT "uq_ar_invoices_number" UNIQUE ("legal_entity_id", "invoice_number")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ar_invoices_entity_status" ON "ar_invoices" ("legal_entity_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ar_invoices_partner" ON "ar_invoices" ("partner_id", "status");
--> statement-breakpoint

-- 12. AR Invoice Lines
CREATE TABLE IF NOT EXISTS "ar_invoice_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "invoice_id" uuid NOT NULL REFERENCES "ar_invoices"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "uom_id" uuid NOT NULL REFERENCES "units_of_measure"("id"),
  "quantity" numeric(14, 4) NOT NULL,
  "unit_price" numeric(14, 4) NOT NULL,
  "discount_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "tax_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
  "tax_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "line_total" numeric(14, 4) NOT NULL,
  "notes" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ar_inv_lines_invoice" ON "ar_invoice_lines" ("invoice_id");
--> statement-breakpoint

-- 13. AR Receipt Allocations (تخصيص المقبوضات)
CREATE TABLE IF NOT EXISTS "ar_receipt_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "receipt_voucher_id" uuid NOT NULL REFERENCES "receipt_vouchers"("id") ON DELETE RESTRICT,
  "invoice_id" uuid NOT NULL REFERENCES "ar_invoices"("id") ON DELETE RESTRICT,
  "allocated_amount" numeric(14, 4) NOT NULL,
  "discount_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "fx_gain_loss" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "allocation_date" date DEFAULT CURRENT_DATE NOT NULL,
  "status" varchar(30) DEFAULT 'POSTED' NOT NULL,
  "reversal_of_id" uuid REFERENCES "ar_receipt_allocations"("id"),
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ar_alloc_voucher" ON "ar_receipt_allocations" ("receipt_voucher_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ar_alloc_invoice" ON "ar_receipt_allocations" ("invoice_id");
--> statement-breakpoint

-- 14. AP Invoices (فواتير المشتريات بالدفتر المساعد للموردين - 3-Way Matched)
CREATE TABLE IF NOT EXISTS "ap_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id") ON DELETE RESTRICT,
  "branch_id" uuid REFERENCES "branches"("id") ON DELETE RESTRICT,
  "warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "partner_id" uuid NOT NULL REFERENCES "business_partners"("id") ON DELETE RESTRICT,
  "supplier_invoice_number" varchar(100) NOT NULL,
  "internal_number" varchar(50) NOT NULL,
  "invoice_type" varchar(30) DEFAULT 'STANDARD' NOT NULL,
  "original_invoice_id" uuid REFERENCES "ap_invoices"("id"),
  "status" varchar(30) DEFAULT 'DRAFT' NOT NULL,
  "purchase_order_id" uuid REFERENCES "purchase_orders"("id") ON DELETE RESTRICT,
  "goods_receipt_id" uuid REFERENCES "goods_receipts"("id") ON DELETE RESTRICT,
  "matching_status" varchar(30) DEFAULT 'UNMATCHED' NOT NULL,
  "invoice_date" date NOT NULL,
  "due_date" date NOT NULL,
  "currency" varchar(3) DEFAULT 'SAR' NOT NULL,
  "exchange_rate" numeric(12, 6) DEFAULT '1.000000' NOT NULL,
  "subtotal" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "price_variance_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "tax_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "grand_total" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "paid_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "remaining_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  CONSTRAINT "uq_ap_invoices_ref" UNIQUE ("id", "legal_entity_id", "tenant_id"),
  CONSTRAINT "uq_ap_invoices_supplier_doc" UNIQUE ("legal_entity_id", "partner_id", "supplier_invoice_number")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ap_invoices_entity_status" ON "ap_invoices" ("legal_entity_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ap_invoices_partner" ON "ap_invoices" ("partner_id", "status");
--> statement-breakpoint

-- 15. AP Invoice Lines
CREATE TABLE IF NOT EXISTS "ap_invoice_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "invoice_id" uuid NOT NULL REFERENCES "ap_invoices"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "uom_id" uuid NOT NULL REFERENCES "units_of_measure"("id"),
  "quantity" numeric(14, 4) NOT NULL,
  "unit_price" numeric(14, 4) NOT NULL,
  "tax_rate" numeric(5, 4) DEFAULT '0.1500' NOT NULL,
  "tax_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "line_total" numeric(14, 4) NOT NULL,
  "notes" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ap_inv_lines_invoice" ON "ap_invoice_lines" ("invoice_id");
--> statement-breakpoint

-- 16. AP Payment Allocations (تخصيص المدفوعات)
CREATE TABLE IF NOT EXISTS "ap_payment_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "payment_voucher_id" uuid NOT NULL REFERENCES "payment_vouchers"("id") ON DELETE RESTRICT,
  "invoice_id" uuid NOT NULL REFERENCES "ap_invoices"("id") ON DELETE RESTRICT,
  "allocated_amount" numeric(14, 4) NOT NULL,
  "discount_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "fx_gain_loss" numeric(14, 4) DEFAULT '0.0000' NOT NULL,
  "allocation_date" date DEFAULT CURRENT_DATE NOT NULL,
  "status" varchar(30) DEFAULT 'POSTED' NOT NULL,
  "reversal_of_id" uuid REFERENCES "ap_payment_allocations"("id"),
  "journal_entry_id" uuid REFERENCES "journal_entries"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ap_alloc_voucher" ON "ap_payment_allocations" ("payment_voucher_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ap_alloc_invoice" ON "ap_payment_allocations" ("invoice_id");
--> statement-breakpoint

-- 17. Enhance journal_lines for Subledger Linking
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "partner_id" uuid REFERENCES "business_partners"("id");
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "partner_role" varchar(20);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "subledger_document_type" varchar(30);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "subledger_document_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_journal_lines_partner" ON "journal_lines" ("partner_id");
--> statement-breakpoint

-- 18. Enhance payment_vouchers & receipt_vouchers for Independent Allocation
ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "unallocated_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint
ALTER TABLE "receipt_vouchers" ADD COLUMN IF NOT EXISTS "unallocated_amount" numeric(14, 4) DEFAULT '0.0000' NOT NULL;
--> statement-breakpoint

-- 19. Permissions & Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
--> statement-breakpoint
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO rc_app_user;
