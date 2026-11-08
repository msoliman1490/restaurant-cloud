import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  createDatabaseClient,
  DatabaseInstance,
} from '@restaurant-cloud/database';
import { TenantContext } from '@restaurant-cloud/domain-kernel';
import postgres from 'postgres';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  public db!: DatabaseInstance;
  private sqlClient!: postgres.Sql;
  private tenantContextRunner!: <T>(
    context: TenantContext,
    operation: (tx: DatabaseInstance) => Promise<T>
  ) => Promise<T>;

  onModuleInit() {
    const connectionString =
      process.env.DATABASE_URL ||
      'postgresql://rc_app_user:rc_app_user_password_2026@localhost:5432/restaurant_cloud_dev';

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
