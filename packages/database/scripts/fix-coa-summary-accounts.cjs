const postgres = require('postgres');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const dbUrl = process.env.DATABASE_URL || 'postgresql://rc_app_user:staging_secret_pass@127.0.0.1:15432/restaurant_cloud_staging';
const sql = postgres(dbUrl, { max: 1 });

async function fixSummaryAccounts() {
  console.log('Auditing and fixing summary accounts across all tenants (with RLS context)...');
  const tenants = await sql`SELECT id, code, display_name FROM tenants;`;
  
  let totalFixed = 0;

  for (const t of tenants) {
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${t.id}, true)`;
      
      const toFix = await tx`
        SELECT 
          c.id, 
          c.account_code, 
          c.name, 
          c.name_ar, 
          c.is_postable,
          (SELECT COUNT(*)::int FROM chart_of_accounts children WHERE children.parent_id = c.id) as children_count
        FROM chart_of_accounts c
        WHERE c.is_postable = true
          AND EXISTS (SELECT 1 FROM chart_of_accounts children WHERE children.parent_id = c.id);
      `;

      if (toFix.length > 0) {
        console.log(`\nTenant: ${t.code} (${t.display_name}) - Found ${toFix.length} accounts to fix:`);
        for (const a of toFix) {
          console.log(`  - Updating [${a.account_code}] ${a.name_ar || a.name} (Children: ${a.children_count}) -> is_postable = FALSE`);
          await tx`
            UPDATE chart_of_accounts
            SET is_postable = false, updated_at = NOW()
            WHERE id = ${a.id};
          `;
          totalFixed++;
        }
      }
    });
  }

  console.log(`\nFix completed! Total summary accounts updated to is_postable = FALSE: ${totalFixed}`);
  await sql.end();
}

fixSummaryAccounts().catch(err => {
  console.error('Fix failed:', err);
  process.exit(1);
});
