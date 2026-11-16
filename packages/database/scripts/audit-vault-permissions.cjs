const postgres = require('postgres');
const path = require('path');
process.loadEnvFile(path.resolve(__dirname, '../../../.env'));

async function run() {
  const sql = postgres(process.env.DATABASE_URL);
  const rows = await sql`
    SELECT code, description 
    FROM permissions 
    ORDER BY code
  `;
  rows.forEach(r => console.log(`${r.code}: ${r.description}`));
  await sql.end();
}

run().catch(console.error);
