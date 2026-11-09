import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Robust resolution of .env from monorepo root or local workspace
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const dbUrl = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error('CRITICAL CONFIGURATION ERROR: MIGRATIONS_DATABASE_URL must be defined in environment or root .env file.');
}

export default defineConfig({
  schema: './dist/schema/index.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: dbUrl,
  },
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
  verbose: true,
  strict: true,
});
