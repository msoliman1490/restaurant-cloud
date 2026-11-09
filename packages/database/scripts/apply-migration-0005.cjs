const postgres = require('../node_modules/postgres');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
const url = process.env.MIGRATIONS_DATABASE_URL;

async function runMigration() {
  const sql = postgres(url, { max: 1, connect_timeout: 10 });
  try {
    console.log('--- Applying Migration 0005_advanced_inventory_wms_phase_a ---');
    const sqlPath = path.resolve(__dirname, '../drizzle/0005_advanced_inventory_wms_phase_a.sql');
    const content = fs.readFileSync(sqlPath, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    const statements = content
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    await sql.begin(async tx => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }
      await tx`
        INSERT INTO public.__drizzle_migrations (hash, created_at)
        VALUES (${hash}, 1794192000000);
      `;
    });

    console.log('[SUCCESS] Migration 0005 applied and registered in __drizzle_migrations!');
  } finally {
    await sql.end();
  }
}

runMigration().catch(err => {
  console.error('[FAILED]:', err);
  process.exit(1);
});
