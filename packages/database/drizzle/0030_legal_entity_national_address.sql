-- 0030_legal_entity_national_address.sql
-- Add Saudi National Address fields to legal_entities (idempotent)

ALTER TABLE "legal_entities" ADD COLUMN IF NOT EXISTS "building_number" varchar(10);
ALTER TABLE "legal_entities" ADD COLUMN IF NOT EXISTS "postal_code" varchar(10);
ALTER TABLE "legal_entities" ADD COLUMN IF NOT EXISTS "additional_number" varchar(10);
ALTER TABLE "legal_entities" ADD COLUMN IF NOT EXISTS "street_name" varchar(255);
ALTER TABLE "legal_entities" ADD COLUMN IF NOT EXISTS "district" varchar(255);
ALTER TABLE "legal_entities" ADD COLUMN IF NOT EXISTS "city" varchar(120);
ALTER TABLE "legal_entities" ADD COLUMN IF NOT EXISTS "short_address" varchar(16);
ALTER TABLE "legal_entities" ADD COLUMN IF NOT EXISTS "country" varchar(100) DEFAULT 'المملكة العربية السعودية';
