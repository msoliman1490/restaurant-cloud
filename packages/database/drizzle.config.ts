import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });

export default defineConfig({
  schema: './dist/schema/index.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://rc_admin:rc_secure_dev_password_2026@localhost:5432/restaurant_cloud_dev',
  },
  verbose: true,
  strict: true,
});
