const postgres = require('postgres');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const adminUrl = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
const sql = postgres(adminUrl);

async function applyMigration0007() {
  console.log('========================================================================');
  console.log('Applying Migration 0007 (Business Partners & AR/AP Subledgers) to Staging...');
  console.log('========================================================================');
  
  const migrationFile = path.resolve(__dirname, '../drizzle/0007_business_partners_ar_ap_subledgers.sql');
  const sqlContent = fs.readFileSync(migrationFile, 'utf8');

  const statements = sqlContent
    .split('--> statement-breakpoint')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    try {
      await sql.unsafe(statement);
    } catch (err) {
      console.error('Error executing statement:', statement.substring(0, 100));
      console.error(err.message);
      throw err;
    }
  }

  // Register migration in __drizzle_migrations
  await sql`
    INSERT INTO "__drizzle_migrations" (hash, created_at)
    VALUES ('0007_business_partners_ar_ap_subledgers', 1794220000000)
    ON CONFLICT DO NOTHING;
  `;

  console.log('✓ Migration 0007 applied and registered in __drizzle_migrations successfully!');

  // Ensure tenant_id column on purchase_order_lines and goods_receipt_lines
  await sql.unsafe(`
    ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenants"("id");
    ALTER TABLE "goods_receipt_lines" ADD COLUMN IF NOT EXISTS "tenant_id" uuid REFERENCES "tenants"("id");
  `);

  // Apply dynamic RLS to all new tables
  const newTables = [
    'business_partners',
    'partner_roles',
    'partner_addresses',
    'partner_contacts',
    'partner_company_settings',
    'partner_balances',
    'purchase_orders',
    'purchase_order_lines',
    'goods_receipts',
    'goods_receipt_lines',
    'ar_invoices',
    'ar_invoice_lines',
    'ar_receipt_allocations',
    'ap_invoices',
    'ap_invoice_lines',
    'ap_payment_allocations'
  ];

  console.log('Configuring Row Level Security (RLS) policies for all new tables...');
  for (const table of newTables) {
    await sql.unsafe(`
      ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}";
      DROP POLICY IF EXISTS "tenant_isolation_policy" ON "${table}";
      DROP POLICY IF EXISTS "migrator_admin_policy" ON "${table}";
      CREATE POLICY "migrator_admin_policy" ON "${table}" FOR ALL TO rc_migrator USING (true) WITH CHECK (true);
      CREATE POLICY "tenant_isolation_policy" ON "${table}"
        FOR ALL
        TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    `);
  }
  console.log('✓ Dynamic RLS policies successfully applied to all 12 Business Partners & AR/AP tables.');

  // Initialize unallocated_amount on existing vouchers if needed
  await sql.unsafe(`
    UPDATE "payment_vouchers" SET "unallocated_amount" = "amount" WHERE "unallocated_amount" = 0 AND "status" = 'POSTED';
    UPDATE "receipt_vouchers" SET "unallocated_amount" = "amount" WHERE "unallocated_amount" = 0 AND "status" = 'POSTED';
  `);
  console.log('✓ Initialized unallocated amounts on vouchers.');

  console.log('========================================================================');
  console.log('>>> [SUCCESS] Migration 0007 and RLS Fully Completed on Staging! <<<');
  console.log('========================================================================');

  await sql.end();
}

applyMigration0007().catch(err => {
  console.error('Fatal Migration Error:', err);
  process.exit(1);
});
