const postgres = require('../node_modules/postgres');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 1. Load root .env
const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const url = process.env.MIGRATIONS_DATABASE_URL;

async function runStagingMigrations() {
  console.log('======================================================================');
  console.log('   Restaurant Cloud — Staging Migration Runner (rc_migrator)');
  console.log('======================================================================');

  if (!url) {
    console.error('[ERROR] MIGRATIONS_DATABASE_URL is not defined in .env');
    process.exit(1);
  }

  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '');
  const username = parsed.username;

  console.log(`[GUARD] Target Database: ${dbName}`);
  console.log(`[GUARD] Target User:     ${username}`);

  if (dbName !== 'restaurant_cloud_staging') {
    console.error(`[SECURITY ERROR] Target must be "restaurant_cloud_staging", got "${dbName}".`);
    process.exit(1);
  }

  if (username !== 'rc_migrator') {
    console.error(`[SECURITY ERROR] Migrations must run as rc_migrator, got "${username}".`);
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, connect_timeout: 10 });

  try {
    // 2. Ensure __drizzle_migrations table exists in public schema
    await sql`
      CREATE TABLE IF NOT EXISTS public.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      );
    `;
    console.log('[OK] Checked/Created public.__drizzle_migrations');

    const executedRows = await sql`SELECT created_at FROM public.__drizzle_migrations;`;
    const executedTimestamps = new Set(executedRows.map(r => Number(r.created_at)));

    // 3. Read _journal.json
    const journalPath = path.resolve(__dirname, '../drizzle/meta/_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

    for (const entry of journal.entries) {
      if (executedTimestamps.has(entry.when)) {
        console.log(`[SKIP] Migration already applied: ${entry.tag} (${entry.when})`);
        continue;
      }

      console.log(`\n[APPLYING] Migration: ${entry.tag} (${entry.when})...`);
      const sqlFilePath = path.resolve(__dirname, `../drizzle/${entry.tag}.sql`);
      const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

      // Compute SHA-256 hash
      const hash = crypto.createHash('sha256').update(sqlContent).digest('hex');

      // Split statements by Drizzle delimiter
      const statements = sqlContent
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      // Execute in explicit transaction
      await sql.begin(async tx => {
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        await tx`
          INSERT INTO public.__drizzle_migrations (hash, created_at)
          VALUES (${hash}, ${entry.when});
        `;
      });

      console.log(`[SUCCESS] Applied: ${entry.tag}`);
    }

    // 4. Apply Security Hardening & RLS Policies (security-hardening-v35.sql)
    console.log('\n[APPLYING] Security Hardening v3.5 (RLS Policies & Drift Probe)...');
    const hardeningPath = path.resolve(__dirname, '../src/security-hardening-v35.sql');
    if (fs.existsSync(hardeningPath)) {
      const hardeningSql = fs.readFileSync(hardeningPath, 'utf8');
      await sql.unsafe(hardeningSql);
      console.log('[SUCCESS] Applied security-hardening-v35.sql successfully!');
    }

    // 5. Execute Schema Drift Probe
    console.log('\n[VERIFYING] Running Exhaustive 13-Gate Schema Drift Probe...');
    const probeResults = await sql`SELECT * FROM public.run_exhaustive_schema_drift_probe();`;
    console.log('----------------------------------------------------------------------');
    let allPassed = true;
    for (const r of probeResults) {
      console.log(`[${r.status}] Gate ${r.gate_name}: ${r.details}`);
      if (r.status !== 'PASS') allPassed = false;
    }
    console.log('----------------------------------------------------------------------');

    if (allPassed) {
      console.log('[SUCCESS] All 13 Drift Probe Gates PASSED on restaurant_cloud_staging!');
    } else {
      console.error('[WARNING] Some drift probe gates failed.');
    }

  } catch (err) {
    console.error('\n[MIGRATION FAILED]:', err.message || err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runStagingMigrations();
