const postgres = require('../node_modules/postgres');
const fs = require('fs');
const path = require('path');

// 1. Auto-load local untracked .env from project root
const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// Support probing specific target or both
const targetEnv = process.argv[2] || 'all';

async function probeUrl(url, label, expectedUser) {
  console.log(`\n--- Probing ${label} ---`);
  if (!url) {
    console.log(`[SKIP] ${label} is not defined in .env.`);
    return;
  }

  if (url.includes('REPLACE_WITH_APP_USER_PASSWORD') || url.includes('REPLACE_WITH_YOUR_MIGRATOR_PASSWORD')) {
    console.log(`[PENDING] ${label} contains placeholder password in .env.`);
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    console.error(`[ERROR] Malformed URL format for ${label}`);
    return;
  }

  const dbName = parsed.pathname.replace(/^\//, '');
  const username = parsed.username;
  const host = parsed.hostname;
  const port = parsed.port;

  console.log(`[GUARD] Target Host:     ${host}`);
  console.log(`[GUARD] Target Port:     ${port}`);
  console.log(`[GUARD] Target Database: ${dbName}`);
  console.log(`[GUARD] Target User:     ${username}`);

  if (username === 'postgres') {
    console.error('[SECURITY ERROR] The postgres superuser is strictly prohibited.');
    return;
  }

  if (dbName !== 'restaurant_cloud_staging') {
    console.error(`[SECURITY ERROR] Target must be "restaurant_cloud_staging", got "${dbName}".`);
    return;
  }

  const sql = postgres(url, { max: 1, connect_timeout: 4 });
  try {
    const rows = await sql`SELECT current_database(), current_user, version();`;
    if (rows && rows.length > 0) {
      const res = rows[0];
      console.log(`[SUCCESS] Connected as ${res.current_user} to database ${res.current_database}`);
      console.log(`[VERSION] ${res.version.split(' on ')[0]}`);

      if (expectedUser === 'rc_app_user') {
        const [ddlCheck] = await sql`SELECT has_schema_privilege(current_user, 'public', 'CREATE') as can_create;`;
        if (ddlCheck.can_create === false) {
          console.log('[SECURITY VERIFIED] rc_app_user has ZERO DDL privileges (strictly cannot create/alter tables).');
        } else {
          console.error('[SECURITY VIOLATION] rc_app_user unexpectedly has CREATE privilege on public schema!');
        }
      }
    }
  } catch (err) {
    console.error(`[FAILED] ${err.message || err}`);
  } finally {
    await sql.end();
  }
}

async function verifyProdIsolation(url, label) {
  if (!url || url.includes('REPLACE_WITH_APP_USER_PASSWORD') || url.includes('REPLACE_WITH_YOUR_MIGRATOR_PASSWORD')) return;
  const prodUrl = url.replace('restaurant_cloud_staging', 'restaurant_cloud');
  const sql = postgres(prodUrl, { max: 1, connect_timeout: 3 });
  try {
    await sql`SELECT 1;`;
    console.error(`[ISOLATION FAILED] ${label} was able to connect to production database restaurant_cloud!`);
  } catch (err) {
    console.log(`[ISOLATION VERIFIED] ${label} is strictly blocked from production: ${err.message}`);
  } finally {
    await sql.end();
  }
}

async function executeReadOnlyProbe() {
  console.log('======================================================================');
  console.log('   Restaurant Cloud — Staging Database Dual-Role Connection Probe');
  console.log('======================================================================');

  if (targetEnv === 'all' || targetEnv === 'migrator') {
    const migUrl = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
    await probeUrl(migUrl, 'MIGRATOR (rc_migrator)', 'rc_migrator');
    await verifyProdIsolation(migUrl, 'MIGRATOR (rc_migrator)');
  }

  if (targetEnv === 'all' || targetEnv === 'app') {
    const appUrl = process.env.DATABASE_URL;
    await probeUrl(appUrl, 'APP RUNTIME (rc_app_user)', 'rc_app_user');
    await verifyProdIsolation(appUrl, 'APP RUNTIME (rc_app_user)');
  }

  console.log('\n======================================================================');
}

executeReadOnlyProbe();
