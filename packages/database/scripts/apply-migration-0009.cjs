const postgres = require('postgres');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const adminUrl = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
const sql = postgres(adminUrl);

async function applyMigration0009() {
  console.log('========================================================================');
  console.log('Applying Migration 0009 (Phase 3.3 Account Mapping & Branch Overrides)...');
  console.log('========================================================================');

  const migrationFile = path.resolve(__dirname, '../drizzle/0009_phase3_account_mapping_branch_overrides.sql');
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
    VALUES ('0009_phase3_account_mapping_branch_overrides', 1794350000000)
    ON CONFLICT DO NOTHING;
  `;

  console.log('✓ Migration 0009 applied and registered successfully!');

  // Verify columns created
  const cols = await sql`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'account_mappings'
    ORDER BY ordinal_position
  `;
  console.log('account_mappings columns:', cols.map(c => `${c.column_name} (${c.data_type})`));

  // Verify indexes
  const idxs = await sql`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE tablename = 'account_mappings'
  `;
  console.log('account_mappings indexes:', idxs.map(i => i.indexname));

  await sql.end();
}

applyMigration0009().catch(err => {
  console.error('Migration 0009 failed:', err);
  process.exit(1);
});
