const postgres = require('postgres');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const adminUrl = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
const sql = postgres(adminUrl);

async function applyMigration0006() {
  console.log('Applying Migration 0006 (WMS Phase B: Transfers & Stocktaking) to staging...');
  
  const migrationFile = path.resolve(__dirname, '../drizzle/0006_advanced_wms_phase_b_transfers_stocktake.sql');
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
    VALUES ('0006_advanced_wms_phase_b_transfers_stocktake', 1794210000000)
    ON CONFLICT DO NOTHING;
  `;

  console.log('✓ Migration 0006 applied and registered successfully!');

  // Apply dynamic RLS to new tables
  console.log('Applying RLS and policies to stocktake_orders and stocktake_lines...');
  await sql.unsafe(`
    ALTER TABLE stocktake_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE stocktake_orders FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_stocktake_orders ON stocktake_orders;
    DROP POLICY IF EXISTS tenant_isolation_policy ON stocktake_orders;
    DROP POLICY IF EXISTS migrator_admin_policy ON stocktake_orders;
    CREATE POLICY migrator_admin_policy ON stocktake_orders FOR ALL TO rc_migrator USING (true) WITH CHECK (true);
    CREATE POLICY tenant_isolation_policy ON stocktake_orders
      FOR ALL
      TO rc_app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

    ALTER TABLE stocktake_lines ENABLE ROW LEVEL SECURITY;
    ALTER TABLE stocktake_lines FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation_stocktake_lines ON stocktake_lines;
    DROP POLICY IF EXISTS tenant_isolation_policy ON stocktake_lines;
    DROP POLICY IF EXISTS migrator_admin_policy ON stocktake_lines;
    CREATE POLICY migrator_admin_policy ON stocktake_lines FOR ALL TO rc_migrator USING (true) WITH CHECK (true);
    CREATE POLICY tenant_isolation_policy ON stocktake_lines
      FOR ALL
      TO rc_app_user
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  `);
  console.log('✓ RLS policies configured for new tables.');

  await sql.end();
}

applyMigration0006().catch((err) => {
  console.error('Migration 0006 failed:', err);
  process.exit(1);
});
