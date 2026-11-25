ALTER TABLE "partner_addresses" ALTER COLUMN "building_number" DROP NOT NULL;
ALTER TABLE "partner_addresses" ALTER COLUMN "street_name" DROP NOT NULL;
ALTER TABLE "partner_addresses" ALTER COLUMN "district_name" DROP NOT NULL;
ALTER TABLE "partner_addresses" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "partner_addresses" ALTER COLUMN "postal_code" DROP NOT NULL;
ALTER TABLE "partner_addresses" ADD COLUMN IF NOT EXISTS "unit_number" varchar(20);
ALTER TABLE "partner_addresses" ADD COLUMN IF NOT EXISTS "country" varchar(100) NOT NULL DEFAULT 'المملكة العربية السعودية';
