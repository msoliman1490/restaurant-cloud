import { describe, it, expect, afterAll } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import postgres from 'postgres';

describe('NestJS DatabaseService Live Connection as rc_app_user', () => {
  const pg18Url = 'postgresql://rc_app_user:rc_app_user_ci_disposable_2026@127.0.0.1:5433/restaurant_cloud_ci';
  let dbService: DatabaseService;

  afterAll(async () => {
    if (dbService) {
      await dbService.onModuleDestroy();
    }
  });

  it('connects to PostgreSQL 18 strictly as rc_app_user and verifies non-superuser session', async () => {
    process.env.DATABASE_URL = pg18Url;

    dbService = new DatabaseService();
    dbService.onModuleInit();

    // 1. Direct query with error logging
    try {
      const res = await (dbService as any).sqlClient`SELECT 1 as alive;`;
      console.log('Query succeeded:', res);
      expect(res[0]?.alive).toBe(1);
    } catch (err) {
      console.error('Ping failed with error:', err);
      throw err;
    }

    // 2. Query session user and verify it is strictly rc_app_user
    const sql = postgres(pg18Url);
    try {
      const [identity] = await sql`SELECT current_user, session_user, current_setting('is_superuser') as is_superuser;`;
      expect(identity.current_user).toBe('rc_app_user');
      expect(identity.session_user).toBe('rc_app_user');
      expect(identity.is_superuser).toBe('off');
    } finally {
      await sql.end();
    }
  });
});
