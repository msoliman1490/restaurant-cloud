const postgres = require('../node_modules/postgres');
const fs = require('fs');
const path = require('path');

process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
const url = process.env.MIGRATIONS_DATABASE_URL;

async function applyRLS() {
  console.log('--- Applying Multi-Tenant RLS Policies as rc_migrator ---');
  const sql = postgres(url, { max: 1, connect_timeout: 10 });

  try {
    const rawSql = fs.readFileSync(path.resolve(__dirname, '../src/rls-policies.sql'), 'utf8');

    // Skip the role creation block (lines 1 to 14)
    const startIdx = rawSql.indexOf('-- 2. Grant Schema Usage and DML Privileges');
    const executableSql = rawSql.substring(startIdx);

    await sql.unsafe(executableSql);
    console.log('[SUCCESS] Applied rls-policies.sql successfully on staging!');

    // Verify RLS status on tables
    const rlsTables = await sql`
      SELECT tablename, rowsecurity, forcerowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' AND rowsecurity = true;
    `;
    console.log(`\nVerified RLS enabled & forced on ${rlsTables.length} tables:`);
    console.log(rlsTables.slice(0, 10).map(t => t.tablename).join(', ') + '...');

  } catch (err) {
    console.error('Error applying RLS:', err.message || err);
  } finally {
    await sql.end();
  }
}

applyRLS();
