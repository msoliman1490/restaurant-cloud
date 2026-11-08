import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import { sql } from 'drizzle-orm';

export type DatabaseInstance = PostgresJsDatabase<typeof schema>;

export interface DatabaseConfig {
  connectionString: string;
  maxConnections?: number;
}

export function createDatabaseClient(config: DatabaseConfig): {
  db: DatabaseInstance;
  sqlClient: postgres.Sql;
  withTenantContext: <T>(
    context: TenantContext,
    operation: (tx: DatabaseInstance) => Promise<T>
  ) => Promise<T>;
} {
  const sqlClient = postgres(config.connectionString, {
    max: config.maxConnections ?? 20,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzle(sqlClient, { schema });

  /**
   * Executes an operation inside an explicit transaction with SET LOCAL variables
   * to ensure strict tenant isolation when used with connection pooling (e.g. PgBouncer).
   */
  async function withTenantContext<T>(
    context: TenantContext,
    operation: (tx: DatabaseInstance) => Promise<T>
  ): Promise<T> {
    return await db.transaction(async (tx) => {
      // 1. Set transaction-scoped tenant and user session variables:
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${context.tenantId}, true);`
      );
      await tx.execute(
        sql`SELECT set_config('app.current_user_id', ${context.userId}, true);`
      );

      // 2. Execute the protected operations:
      return await operation(tx as unknown as DatabaseInstance);
    });
  }

  return { db, sqlClient, withTenantContext };
}
