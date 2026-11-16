const postgres = require('postgres');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const adminUrl = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
const sql = postgres(adminUrl);

async function applyMigration0008() {
  console.log('========================================================================');
  console.log('Applying Migration 0008 (Phase 3.2 Financial Resources Management)...');
  console.log('========================================================================');

  const migrationFile = path.resolve(__dirname, '../drizzle/0008_phase3_financial_resources_management.sql');
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

  // Register in __drizzle_migrations
  await sql`
    INSERT INTO "__drizzle_migrations" (hash, created_at)
    VALUES ('0008_phase3_financial_resources_management', 1794300000000)
    ON CONFLICT DO NOTHING;
  `;

  console.log('✓ Migration 0008 applied and registered successfully!');

  // Verify tables created
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name IN ('bank_account_branch_access', 'payment_methods', 'payment_terminals')
  `;
  console.log('Verified created tables:', tables.map(t => t.table_name));

  // Verify RLS
  const rlsStatus = await sql`
    SELECT relname, relrowsecurity, relforcerowsecurity 
    FROM pg_class 
    WHERE relname IN ('bank_account_branch_access', 'payment_methods', 'payment_terminals')
  `;
  console.log('RLS Status:', rlsStatus);

  await sql.end();
}

applyMigration0008().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
