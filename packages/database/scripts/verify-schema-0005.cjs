const postgres = require('postgres');
const path = require('path');
const fs = require('fs');

const envPath = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const sql = postgres(process.env.DATABASE_URL);

async function run() {
  console.log('--- 1. DRIZZLE MIGRATIONS REGISTERED ---');
  const migs = await sql`SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id ASC`;
  console.table(migs);

  console.log('--- 2. WMS TABLES EXISTENCE ---');
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name IN ('warehouses', 'inventory_balances', 'inventory_movements', 'inventory_cost_layers')
    ORDER BY table_name;
  `;
  console.table(tables);

  console.log('--- 3. INVENTORY_COST_LAYERS COLUMNS ---');
  const cols = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'inventory_cost_layers' 
    ORDER BY ordinal_position;
  `;
  console.table(cols);

  console.log('--- 4. INVENTORY_COST_LAYERS INDEXES ---');
  const idxs = await sql`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE schemaname = 'public' AND tablename = 'inventory_cost_layers';
  `;
  console.table(idxs);

  console.log('--- 5. CHECK COLUMNS ADDED TO WAREHOUSES, BALANCES & MOVEMENTS ---');
  const checkCols = await sql`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND (
      (table_name = 'warehouses' AND column_name IN ('legal_entity_id', 'warehouse_type', 'allow_receiving', 'allow_issuing', 'allow_transfer')) OR
      (table_name = 'inventory_balances' AND column_name IN ('in_transit_qty', 'damaged_qty', 'under_inspection_qty', 'wac_cost', 'min_stock', 'max_stock', 'reorder_point')) OR
      (table_name = 'inventory_movements' AND column_name IN ('movement_number', 'total_cost', 'is_reversed', 'reversal_of_id'))
    )
    ORDER BY table_name, column_name;
  `;
  console.table(checkCols);

  await sql.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
