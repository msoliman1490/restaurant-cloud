const postgres = require('../node_modules/postgres');
const fs = require('fs');
const path = require('path');

process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
const url = process.env.MIGRATIONS_DATABASE_URL;

async function applySecurity() {
  console.log('--- Applying Security Hardening (RLS & Drift Probe) ---');
  const sql = postgres(url, { max: 1, connect_timeout: 10 });

  try {
    const rawSql = fs.readFileSync(path.resolve(__dirname, '../src/security-hardening-v35.sql'), 'utf8');

    // Skip the role creation block (lines 7 to 30) since roles already exist and are hardened
    const roleBlockEnd = rawSql.indexOf('-- Revoke default public schema access');
    const executableSql = rawSql.substring(roleBlockEnd);

    console.log('Executing RLS policies, functions, and drift probe...');
    await sql.unsafe(executableSql);
    console.log('[SUCCESS] Applied security-hardening-v35.sql successfully!');

    // Run Drift Probe
    console.log('\nRunning 13-Gate Schema Drift Probe...');
    const results = await sql`SELECT * FROM public.run_exhaustive_schema_drift_probe();`;
    let allPass = true;
    for (const r of results) {
      console.log(`[${r.status}] Gate ${r.gate_name}: ${r.details}`);
      if (r.status !== 'PASS') allPass = false;
    }

    if (allPass) {
      console.log('\n>>> ALL 13 DRIFT PROBE GATES PASSED 100%! <<<');
    }

  } catch (err) {
    console.error('Error applying security:', err.message || err);
  } finally {
    await sql.end();
  }
}

applySecurity();
