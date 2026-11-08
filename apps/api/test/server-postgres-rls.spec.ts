import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

describe('Genuine PostgreSQL 16 Server Integration & Security Verification', () => {
  const isCiMode =
    process.env.CI === 'true' || process.env.STRICT_INTEGRATION === 'true';

  const adminUrl =
    process.env.CI_DATABASE_URL ||
    process.env.MIGRATION_DATABASE_URL ||
    'postgresql://rc_admin:rc_admin_ci_disposable_2026@localhost:5432/restaurant_cloud_ci';

  const runtimeUrl =
    process.env.RUNTIME_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://rc_app_user:rc_app_user_ci_disposable_2026@localhost:5432/restaurant_cloud_ci';

  let adminSql: postgres.Sql | null = null;
  let runtimeSql: postgres.Sql | null = null;
  let serverAvailable = false;
  let serverVersion = '';

  const tenantAId = 'a0000000-0000-0000-0000-000000000001';
  const tenantBId = 'b0000000-0000-0000-0000-000000000002';
  const entityA1Id = 'a1111111-1111-1111-1111-111111111111';
  const entityA2Id = 'a2222222-2222-2222-2222-222222222222';
  const warehouseSharedId = 'ad111111-1111-1111-1111-111111111111';
  const itemMeatId = 'aa000000-0000-0000-0000-000000000001';
  const orderAId = '11111111-1111-1111-1111-111111111111';
  const orderBId = '22222222-2222-2222-2222-222222222222';
  const auditId = '99999999-9999-9999-9999-999999999999';

  beforeAll(async () => {
    try {
      // 1. Probe Server Connection with actual postgres driver
      adminSql = postgres(adminUrl, {
        connect_timeout: 3,
        max: 5,
        idle_timeout: 10,
      });

      const verResult = await adminSql`SELECT version();`;
      serverVersion = (verResult[0]?.version as string) || '';
      serverAvailable = true;
      console.log(`[PostgreSQL 16 Server] Connected successfully to: ${serverVersion}`);
    } catch (err: unknown) {
      serverAvailable = false;
      const errorMsg = (err as Error).message;
      if (isCiMode) {
        // In CI mode: MUST fail immediately. No silent skips.
        throw new Error(
          `[FATAL CI FAILURE] Genuine PostgreSQL 16 server is REQUIRED in CI mode but was unreachable at ${adminUrl}. ` +
          `Connection error: ${errorMsg}. Integration suite cannot proceed without a live PostgreSQL 16 server.`
        );
      }
      console.warn(
        `[Local Mode Notice] PostgreSQL server not reachable at ${adminUrl}: ${errorMsg}. Server integration tests will be explicitly SKIPPED (not passed).`
      );
      return;
    }

    // 2. Setup DDL Schema for Integration Verification (Static DDL via Simple Query Protocol)
    await adminSql.unsafe(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS legal_entities (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sales_orders (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        order_number VARCHAR(50) NOT NULL,
        grand_total NUMERIC(12, 4) NOT NULL,
        idempotency_key VARCHAR(255),
        CONSTRAINT uq_server_order_num UNIQUE (tenant_id, order_number)
      );

      CREATE TABLE IF NOT EXISTS inventory_balances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_owner_id UUID NOT NULL REFERENCES legal_entities(id),
        warehouse_id UUID NOT NULL,
        item_id UUID NOT NULL,
        on_hand_qty NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        reserved_qty NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        version INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT uq_server_inv UNIQUE (tenant_id, legal_entity_owner_id, warehouse_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        action VARCHAR(100) NOT NULL,
        entity_id UUID NOT NULL
      );
    `);

    // 3. Configure Runtime Role rc_app_user (strictly NOSUPERUSER NOBYPASSRLS)
    await adminSql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_app_user') THEN
          CREATE ROLE rc_app_user WITH LOGIN PASSWORD 'rc_app_user_ci_disposable_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        ELSE
          ALTER ROLE rc_app_user WITH LOGIN PASSWORD 'rc_app_user_ci_disposable_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END $$;

      GRANT USAGE ON SCHEMA public TO rc_app_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rc_app_user;

      REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM rc_app_user;

      CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Security Violation: Audit logs are strictly immutable and cannot be modified or deleted.';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_audit_log_modification ON audit_logs;
      CREATE TRIGGER trg_prevent_audit_log_modification
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW
        EXECUTE FUNCTION prevent_audit_log_modification();
    `);

    // 4. Force Row Level Security on all multi-tenant tables
    await adminSql.unsafe(`
      ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

      ALTER TABLE legal_entities ENABLE ROW LEVEL SECURITY;
      ALTER TABLE legal_entities FORCE ROW LEVEL SECURITY;

      ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
      ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;

      ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
      ALTER TABLE inventory_balances FORCE ROW LEVEL SECURITY;

      ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
    `);

    // 5. Apply Permissive Policies with BOTH USING and WITH CHECK
    await adminSql.unsafe(`
      DROP POLICY IF EXISTS tenant_isolation_tenants ON tenants;
      CREATE POLICY tenant_isolation_tenants ON tenants
        FOR ALL TO rc_app_user
        USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      DROP POLICY IF EXISTS tenant_isolation_legal_entities ON legal_entities;
      CREATE POLICY tenant_isolation_legal_entities ON legal_entities
        FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      DROP POLICY IF EXISTS tenant_isolation_sales_orders ON sales_orders;
      CREATE POLICY tenant_isolation_sales_orders ON sales_orders
        FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      DROP POLICY IF EXISTS tenant_isolation_inventory_balances ON inventory_balances;
      CREATE POLICY tenant_isolation_inventory_balances ON inventory_balances
        FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      DROP POLICY IF EXISTS tenant_isolation_audit_logs ON audit_logs;
      CREATE POLICY tenant_isolation_audit_logs ON audit_logs
        FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    `);

    // 6. Seed Baseline Tenants and Legal Entities as Admin (individual parameterized statements)
    await adminSql`
      INSERT INTO tenants (id, code, display_name) VALUES
        (${tenantAId}, 'tenant-a', 'Tenant A Org'),
        (${tenantBId}, 'tenant-b', 'Tenant B Org')
      ON CONFLICT (id) DO NOTHING;
    `;

    await adminSql`
      INSERT INTO legal_entities (id, tenant_id, code, name) VALUES
        (${entityA1Id}, ${tenantAId}, 'LE-A1', 'Al-Diyafa LLC'),
        (${entityA2Id}, ${tenantAId}, 'LE-A2', 'Fast Food Ltd')
      ON CONFLICT (id) DO NOTHING;
    `;

    // 7. Initialize Runtime Connection Pool strictly as rc_app_user
    runtimeSql = postgres(runtimeUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 5,
    });
  });

  afterAll(async () => {
    if (runtimeSql) await runtimeSql.end();
    if (adminSql) await adminSql.end();
  });

  function requireServer(ctx: { skip: () => void }) {
    if (!serverAvailable) {
      if (isCiMode) {
        throw new Error('Fatal: server must be available in CI mode');
      }
      ctx.skip();
    }
  }

  it('1. Server Environment Verification: detects and confirms PostgreSQL 16+', (ctx) => {
    requireServer(ctx);
    expect(serverVersion).toMatch(/PostgreSQL 16|PostgreSQL 17|PostgreSQL 18/i);
  });

  it('2. Runtime Database Role Security: rc_app_user is strictly NOSUPERUSER and NOBYPASSRLS', async (ctx) => {
    requireServer(ctx);
    const res = await adminSql!`
      SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
      FROM pg_roles WHERE rolname = 'rc_app_user';
    `;
    expect(res.length).toBe(1);
    expect(res[0]?.rolsuper).toBe(false);
    expect(res[0]?.rolbypassrls).toBe(false);
    expect(res[0]?.rolcreatedb).toBe(false);
    expect(res[0]?.rolcreaterole).toBe(false);
  });

  it('3. Real Tenant Isolation (INSERT): allows inserting records only under matching tenant context', async (ctx) => {
    requireServer(ctx);
    await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      await tx`
        INSERT INTO sales_orders (id, tenant_id, order_number, grand_total)
        VALUES (${orderAId}, ${tenantAId}, 'ORD-A-001', 150.00);
      `;
    });

    await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantBId}, true);`;
      await tx`
        INSERT INTO sales_orders (id, tenant_id, order_number, grand_total)
        VALUES (${orderBId}, ${tenantBId}, 'ORD-B-001', 300.00);
      `;
    });
  });

  it('4. Real Tenant Isolation (SELECT): Tenant A query sees only Tenant A orders, Tenant B is hidden', async (ctx) => {
    requireServer(ctx);
    const rows = await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      return await tx`SELECT id, order_number FROM sales_orders;`;
    });

    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(orderAId);
    expect(rows[0]?.order_number).toBe('ORD-A-001');
  });

  it('5. Real Tenant Isolation (SELECT): Tenant B query sees only Tenant B orders, Tenant A is hidden', async (ctx) => {
    requireServer(ctx);
    const rows = await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantBId}, true);`;
      return await tx`SELECT id, order_number FROM sales_orders;`;
    });

    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(orderBId);
    expect(rows[0]?.order_number).toBe('ORD-B-001');
  });

  it('6. Fail-Closed Verification: queries without tenant context return 0 records', async (ctx) => {
    requireServer(ctx);
    const rows = await runtimeSql!.begin(async (tx) => {
      return await tx`SELECT id FROM sales_orders;`;
    });
    expect(rows.length).toBe(0);
  });

  it('7. Real Cross-Tenant Prevention (INSERT): WITH CHECK blocks inserting rows with mismatched tenant_id', async (ctx) => {
    requireServer(ctx);
    let errorThrown = false;
    try {
      await runtimeSql!.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
        await tx`
          INSERT INTO sales_orders (id, tenant_id, order_number, grand_total)
          VALUES ('33333333-3333-3333-3333-333333333333', ${tenantBId}, 'ATTACK-001', 999.00);
        `;
      });
    } catch (err: unknown) {
      errorThrown = true;
      expect((err as Error).message).toContain('row-level security policy');
    }
    expect(errorThrown).toBe(true);
  });

  it('8. Real Cross-Tenant Prevention (UPDATE): Tenant A cannot modify Tenant B records', async (ctx) => {
    requireServer(ctx);
    const result = await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      return await tx`
        UPDATE sales_orders SET grand_total = 0.00 WHERE id = ${orderBId};
      `;
    });

    expect(result.count).toBe(0);

    const rows = await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantBId}, true);`;
      return await tx`SELECT grand_total FROM sales_orders WHERE id = ${orderBId};`;
    });
    expect(Number(rows[0]?.grand_total)).toBe(300.00);
  });

  it('9. Real Cross-Tenant Prevention (DELETE): Tenant A cannot delete Tenant B records', async (ctx) => {
    requireServer(ctx);
    const result = await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      return await tx`
        DELETE FROM sales_orders WHERE id = ${orderBId};
      `;
    });

    expect(result.count).toBe(0);

    const rows = await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantBId}, true);`;
      return await tx`SELECT id FROM sales_orders WHERE id = ${orderBId};`;
    });
    expect(rows.length).toBe(1);
  });

  it('10. Connection Pool Isolation: SET LOCAL context is completely cleared when transaction ends', async (ctx) => {
    requireServer(ctx);
    await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      await tx`SELECT * FROM sales_orders;`;
    });

    const check = await runtimeSql!`
      SELECT NULLIF(current_setting('app.current_tenant_id', true), '') AS current_tenant;
    `;
    expect(check[0]?.current_tenant).toBeNull();
  });

  it('11. Connection Pool Isolation: Transaction ROLLBACK immediately clears tenant context', async (ctx) => {
    requireServer(ctx);
    try {
      await runtimeSql!.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
        throw new Error('Forced rollback for testing');
      });
    } catch {
      // Expected rollback
    }

    const check = await runtimeSql!`
      SELECT NULLIF(current_setting('app.current_tenant_id', true), '') AS current_tenant;
    `;
    expect(check[0]?.current_tenant).toBeNull();
  });

  it('12. Audit Log Append-Only: rc_app_user can INSERT audit logs under tenant context', async (ctx) => {
    requireServer(ctx);
    await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      await tx`
        INSERT INTO audit_logs (id, tenant_id, action, entity_id)
        VALUES (${auditId}, ${tenantAId}, 'ORDER_CREATED', ${orderAId});
      `;
    });

    const rows = await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      return await tx`SELECT id FROM audit_logs WHERE id = ${auditId};`;
    });
    expect(rows.length).toBe(1);
  });

  it('13. Audit Log Append-Only: UPDATE and DELETE are strictly prohibited by trigger & permissions', async (ctx) => {
    requireServer(ctx);
    let updateFailed = false;
    try {
      await runtimeSql!.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
        await tx`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = ${auditId};`;
      });
    } catch (err: unknown) {
      updateFailed = true;
      expect((err as Error).message).toMatch(/permission denied|Security Violation/i);
    }
    expect(updateFailed).toBe(true);

    let deleteFailed = false;
    try {
      await runtimeSql!.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
        await tx`DELETE FROM audit_logs WHERE id = ${auditId};`;
      });
    } catch (err: unknown) {
      deleteFailed = true;
      expect((err as Error).message).toMatch(/permission denied|Security Violation/i);
    }
    expect(deleteFailed).toBe(true);
  });

  it('14. Real Multi-Entity Shared Warehouse Isolation: Segregated ownership under Tenant A', async (ctx) => {
    requireServer(ctx);
    // Entity A1 records stock in shared warehouse
    await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      await tx`
        INSERT INTO inventory_balances (tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, version)
        VALUES (${tenantAId}, ${entityA1Id}, ${warehouseSharedId}, ${itemMeatId}, 50.00, 1)
        ON CONFLICT (tenant_id, legal_entity_owner_id, warehouse_id, item_id) DO UPDATE SET on_hand_qty = 50.00;
      `;
    });

    // Query under Tenant B returns 0 rows (RLS isolation)
    const rowsB = await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantBId}, true);`;
      return await tx`SELECT * FROM inventory_balances WHERE warehouse_id = ${warehouseSharedId};`;
    });
    expect(rowsB.length).toBe(0);

    // Query under Tenant A returns Entity A1's balance
    const rowsA = await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      return await tx`SELECT * FROM inventory_balances WHERE warehouse_id = ${warehouseSharedId};`;
    });
    expect(rowsA.length).toBe(1);
    expect(Number(rowsA[0]?.on_hand_qty)).toBe(50.00);
  });

  it('15. Real Server Concurrency: Optimistic locking blocks simultaneous overselling', async (ctx) => {
    requireServer(ctx);
    // Initialize stock of 1 unit
    await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      await tx`
        UPDATE inventory_balances
        SET on_hand_qty = 1.00, reserved_qty = 0.00, version = 1
        WHERE tenant_id = ${tenantAId} AND legal_entity_owner_id = ${entityA1Id} AND item_id = ${itemMeatId};
      `;
    });

    // Device 1 and Device 2 simulate concurrent reservation attempts
    const client1Promise = runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      return await tx`
        UPDATE inventory_balances
        SET reserved_qty = 1.00, version = version + 1
        WHERE tenant_id = ${tenantAId} AND legal_entity_owner_id = ${entityA1Id} AND item_id = ${itemMeatId} AND version = 1
        RETURNING *;
      `;
    });

    const client2Promise = runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      return await tx`
        UPDATE inventory_balances
        SET reserved_qty = 1.00, version = version + 1
        WHERE tenant_id = ${tenantAId} AND legal_entity_owner_id = ${entityA1Id} AND item_id = ${itemMeatId} AND version = 1
        RETURNING *;
      `;
    });

    const [res1, res2] = await Promise.all([client1Promise, client2Promise]);
    // Exactly one must succeed (length === 1) and one must receive 0 rows (length === 0)
    const successCount = (res1.length === 1 ? 1 : 0) + (res2.length === 1 ? 1 : 0);
    expect(successCount).toBe(1);
  });

  it('16. Real Unique Composite Constraints: Rejects duplicate order number within same tenant', async (ctx) => {
    requireServer(ctx);
    let duplicateRejected = false;
    try {
      await runtimeSql!.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
        await tx`
          INSERT INTO sales_orders (id, tenant_id, order_number, grand_total)
          VALUES ('44444444-4444-4444-4444-444444444444', ${tenantAId}, 'ORD-A-001', 500.00);
        `;
      });
    } catch (err: unknown) {
      duplicateRejected = true;
      expect((err as Error).message).toMatch(/unique constraint|duplicate key/i);
    }
    expect(duplicateRejected).toBe(true);
  });

  it('17. Connection Pool Sequential Safety: Consecutive connection reuse leaks zero tenant context', async (ctx) => {
    requireServer(ctx);
    // Request 1: Tenant A
    await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      await tx`SELECT id FROM sales_orders;`;
    });

    // Request 2 (unauthenticated checkout on pool): returns 0 rows and NULL context
    const checkCtx = await runtimeSql!`
      SELECT NULLIF(current_setting('app.current_tenant_id', true), '') AS current_tenant;
    `;
    expect(checkCtx[0]?.current_tenant).toBeNull();

    const noContextRows = await runtimeSql!`SELECT * FROM sales_orders;`;
    expect(noContextRows.length).toBe(0);
  });

  it('18. Real Transaction Atomicity: Multi-statement transaction rollback restores state completely', async (ctx) => {
    requireServer(ctx);
    try {
      await runtimeSql!.begin(async (tx) => {
        await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
        await tx`
          INSERT INTO sales_orders (id, tenant_id, order_number, grand_total)
          VALUES ('55555555-5555-5555-5555-555555555555', ${tenantAId}, 'ORD-ABORT-01', 99.00);
        `;
        // Intentional failure mid-transaction
        throw new Error('Intentional crash to test rollback atomicity');
      });
    } catch {
      // Expected
    }

    // Verify aborted order was not committed
    const verifyRows = await runtimeSql!.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantAId}, true);`;
      return await tx`SELECT id FROM sales_orders WHERE id = '55555555-5555-5555-5555-555555555555';`;
    });
    expect(verifyRows.length).toBe(0);
  });
});
