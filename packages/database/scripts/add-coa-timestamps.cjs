const postgres = require('../node_modules/postgres');
const path = require('path');
process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL);

async function run() {
  await sql`ALTER TABLE public.chart_of_accounts ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now() NOT NULL;`;
  await sql`ALTER TABLE public.chart_of_accounts ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;`;
  console.log('Successfully added created_at and updated_at to chart_of_accounts');
  await sql.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
