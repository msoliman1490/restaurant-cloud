-- Migration: 0003_global_crud_media.sql
-- Description: Adds media_files, item_barcodes and item enterprise fields

-- 1. Extend items table with enterprise product management fields
ALTER TABLE "public"."items" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "public"."items" ADD COLUMN IF NOT EXISTS "min_stock_level" numeric(12, 4) DEFAULT '0.0000';
ALTER TABLE "public"."items" ADD COLUMN IF NOT EXISTS "max_stock_level" numeric(12, 4);
ALTER TABLE "public"."items" ADD COLUMN IF NOT EXISTS "is_recipe_ingredient" boolean DEFAULT false NOT NULL;
ALTER TABLE "public"."items" ADD COLUMN IF NOT EXISTS "is_archived" boolean DEFAULT false NOT NULL;
ALTER TABLE "public"."items" ADD COLUMN IF NOT EXISTS "primary_image_url" text;

-- 2. Create media_files table
CREATE TABLE IF NOT EXISTS "public"."media_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
  "entity_type" varchar(50) NOT NULL,
  "entity_id" uuid NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "original_name" varchar(255) NOT NULL,
  "mime_type" varchar(100) NOT NULL,
  "file_size" integer NOT NULL,
  "storage_path" text NOT NULL,
  "public_url" text NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_media_files_tenant_id" ON "public"."media_files" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_media_files_entity" ON "public"."media_files" ("tenant_id", "entity_type", "entity_id");

-- 3. Create item_barcodes table
CREATE TABLE IF NOT EXISTS "public"."item_barcodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "public"."items"("id") ON DELETE CASCADE,
  "barcode" varchar(100) NOT NULL,
  "barcode_type" varchar(30) DEFAULT 'CODE128' NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_item_barcodes_tenant_id" ON "public"."item_barcodes" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_item_barcodes_item_id" ON "public"."item_barcodes" ("tenant_id", "item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_item_barcodes_tenant_barcode" ON "public"."item_barcodes" ("tenant_id", "barcode");
