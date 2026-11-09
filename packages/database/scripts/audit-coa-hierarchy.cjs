const postgres = require('postgres');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const dbUrl = process.env.DATABASE_URL || 'postgresql://rc_app_user:staging_secret_pass@127.0.0.1:15432/restaurant_cloud_staging';
const sql = postgres(dbUrl, { max: 1 });

async function inspectDemo() {
  const [demoTenant] = await sql`SELECT id, code, display_name FROM tenants WHERE code = 'demo-restaurant' LIMIT 1;`;
  if (!demoTenant) {
    console.log('demo-restaurant not found');
    return;
  }

  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${demoTenant.id}, true)`;
    
    const accounts = await tx`
      SELECT 
        c.id, 
        c.account_code, 
        c.name, 
        c.name_ar, 
        c.name_en,
        c.status,
        c.is_postable, 
        c.parent_id,
        p.account_code as parent_code,
        (SELECT COUNT(*)::int FROM chart_of_accounts children WHERE children.parent_id = c.id) as children_count,
        (SELECT COUNT(*)::int FROM journal_lines jl WHERE jl.account_id = c.id) as journal_lines_count
      FROM chart_of_accounts c
      LEFT JOIN chart_of_accounts p ON p.id = c.parent_id
      ORDER BY c.account_code;
    `;

    console.log(`\n=== ALL ACCOUNTS IN demo-restaurant ===`);
    for (const a of accounts) {
      console.log(`Code: ${a.account_code.padEnd(8)} | NameAr: ${(a.name_ar || a.name).padEnd(30)} | isPostable: ${a.is_postable.toString().padEnd(5)} | Children: ${a.children_count} | Lines: ${a.journal_lines_count} | Parent: ${a.parent_code || 'ROOT'}`);
    }
  });

  await sql.end();
}

inspectDemo().catch(console.error);
