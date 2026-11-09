import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  createDatabaseClient,
  DatabaseInstance,
} from '@restaurant-cloud/database';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import postgres from 'postgres';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  public db!: DatabaseInstance;
  private sqlClient!: postgres.Sql;
  private tenantContextRunner!: <T>(
    context: TenantContext,
    operation: (tx: DatabaseInstance) => Promise<T>
  ) => Promise<T>;

  onModuleInit() {
    if (!process.env.DATABASE_URL) {
      // Auto-load .env in development/staging environments if not preloaded by runtime
      const candidatePaths = [
        path.resolve(process.cwd(), '.env'),
        path.resolve(__dirname, '../../../../.env'),
        path.resolve(__dirname, '../../../.env'),
      ];
      for (const envPath of candidatePaths) {
        if (fs.existsSync(envPath)) {
          try {
            process.loadEnvFile(envPath);
            break;
          } catch {
            // Graceful fallback
          }
        }
      }
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'CRITICAL CONFIGURATION ERROR: DATABASE_URL is not set. A valid PostgreSQL connection string must be provided in the environment or root .env file.'
      );
    }

    const client = createDatabaseClient({
      connectionString,
      maxConnections: 20,
    });

    this.db = client.db;
    this.sqlClient = client.sqlClient;
    this.tenantContextRunner = client.withTenantContext;
  }

  async onModuleDestroy() {
    if (this.sqlClient) {
      await this.sqlClient.end();
    }
  }

  /**
   * Performs a lightweight database connectivity probe (SELECT 1).
   * Used strictly for container readiness checks without bypassing RLS or leaking connection details.
   */
  async ping(): Promise<boolean> {
    try {
      if (!this.sqlClient) return false;
      const res = await this.sqlClient`SELECT 1 as alive;`;
      return res.length > 0 && res[0]?.alive === 1;
    } catch {
      return false;
    }
  }

  /**
   * Runs an operation inside an isolated transaction that sets `SET LOCAL app.current_tenant_id`
   * and `app.current_user_id` so PostgreSQL RLS policies fail-closed and isolate tenant data safely.
   */
  async withTenantContext<T>(
    context: TenantContext,
    operation: (tx: DatabaseInstance) => Promise<T>
  ): Promise<T> {
    return this.tenantContextRunner(context, operation);
  }
}
