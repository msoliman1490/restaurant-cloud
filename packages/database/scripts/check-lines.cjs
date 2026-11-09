const postgres = require('postgres');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const dbUrl = process.env.DATABASE_URL || 'postgresql://rc_app_user:staging_secret_pass@127.0.0.1:15432/restaurant_cloud_staging';
const sql = postgres(dbUrl, { max: 1 });

async function checkLines() {
  const [demoTenant] = await sql`SELECT id FROM tenants WHERE code = 'demo-restaurant' LIMIT 1;`;
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${demoTenant.id}, true)`;
    const [acc111100] = await tx`SELECT id FROM chart_of_accounts WHERE account_code = '111100' LIMIT 1;`;
    if (acc111100) {
      const lines = await tx`
        SELECT jl.*, je.journal_number, je.description, je.status
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        WHERE jl.account_id = ${acc111100.id};
      `;
      console.log('Lines on 111100:', lines);
    }
  });
  await sql.end();
}

checkLines().catch(console.error);
