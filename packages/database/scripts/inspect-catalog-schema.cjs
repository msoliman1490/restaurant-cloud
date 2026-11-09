const postgres = require('../node_modules/postgres');
const path = require('path');
const fs = require('fs');

process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
const sql = postgres(process.env.MIGRATIONS_DATABASE_URL);

async function inspect() {
  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'items'
    ORDER BY ordinal_position;
  `;
  console.log('items columns:', cols.map(c => `${c.column_name} (${c.data_type})`));
  
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name IN ('media_files', 'item_barcodes', 'categories', 'units_of_measure');
  `;
  console.log('relevant tables:', tables.map(t => t.table_name));
  await sql.end();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
