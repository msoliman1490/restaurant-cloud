import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('Local PostgreSQL Engine (PGlite) Security & RLS Isolation Tests', () => {
  let pg: PGlite;

  const tenantAId = 'a0000000-0000-0000-0000-000000000001';
  const tenantBId = 'b0000000-0000-0000-0000-000000000002';
  const orderAId = '11111111-1111-1111-1111-111111111111';
  const orderBId = '22222222-2222-2222-2222-222222222222';

  async function runInTransaction<T>(
    tenantId: string | null,
    role: string | null,
    operation: () => Promise<T>
  ): Promise<T> {
    await pg.exec('BEGIN;');
    try {
      if (role) {
        await pg.exec(`SET ROLE ${role};`);
      }
      if (tenantId) {
        await pg.exec(`SELECT set_config('app.current_tenant_id', '${tenantId}', true);`);
      }
      const result = await operation();
      await pg.exec('COMMIT;');
      return result;
    } catch (err) {
      await pg.exec('ROLLBACK;');
      throw err;
    } finally {
      if (role) {
        await pg.exec('RESET ROLE;');
      }
    }
  }

  beforeAll(async () => {
    pg = new PGlite();

    // 1. Create Core Tables
    await pg.exec(`
      CREATE TABLE tenants (
        id UUID PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL
      );

      CREATE TABLE sales_orders (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        order_number VARCHAR(50) NOT NULL,
        grand_total NUMERIC(12, 4) NOT NULL
      );

      CREATE TABLE audit_logs (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        action VARCHAR(100) NOT NULL,
        entity_id UUID NOT NULL
      );
    `);

    // 2. Setup Role & Permissions
    await pg.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_app_user') THEN
          CREATE ROLE rc_app_user WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END $$;

      GRANT USAGE ON SCHEMA public TO rc_app_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;

      -- Revoke UPDATE and DELETE on audit_logs (Append-Only)
      REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM rc_app_user;

      -- Trigger Level Immutability for Audit Logs
      CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Security Violation: Audit logs are strictly immutable and cannot be modified or deleted.';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_prevent_audit_log_modification
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW
        EXECUTE FUNCTION prevent_audit_log_modification();
    `);

    // 3. Enable and FORCE Row Level Security
    await pg.exec(`
      ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

      ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
      ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;

      ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
    `);

    // 4. Create Policies with BOTH USING (read/delete) and WITH CHECK (insert/update)
    await pg.exec(`
      CREATE POLICY tenant_isolation_tenants ON tenants
        FOR ALL
        TO rc_app_user
        USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      CREATE POLICY tenant_isolation_sales_orders ON sales_orders
        FOR ALL
        TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

      CREATE POLICY tenant_isolation_audit_logs ON audit_logs
        FOR ALL
        TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    `);

    // 5. Seed Tenants (as superuser/admin)
    await pg.exec(`
      INSERT INTO tenants (id, code, display_name) VALUES
        ('${tenantAId}', 'tenant-a', 'Tenant A Org'),
        ('${tenantBId}', 'tenant-b', 'Tenant B Org');
    `);
  });

  describe('1. Database Role Security Verification', () => {
    it('should confirm rc_app_user is NOSUPERUSER and NOBYPASSRLS', async () => {
      const res = await pg.query<{ rolsuper: boolean; rolbypassrls: boolean }>(`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'rc_app_user';
      `);
      expect(res.rows[0]?.rolsuper).toBe(false);
      expect(res.rows[0]?.rolbypassrls).toBe(false);
    });
  });

  describe('2. Real Tenant Isolation (SELECT, INSERT, UPDATE, DELETE)', () => {
    it('should allow Tenant A to insert records only under Tenant A context', async () => {
      await runInTransaction(tenantAId, 'rc_app_user', async () => {
        await pg.exec(`
          INSERT INTO sales_orders (id, tenant_id, order_number, grand_total)
          VALUES ('${orderAId}', '${tenantAId}', 'ORD-A-001', 150.00);
        `);
      });

      await runInTransaction(tenantBId, 'rc_app_user', async () => {
        await pg.exec(`
          INSERT INTO sales_orders (id, tenant_id, order_number, grand_total)
          VALUES ('${orderBId}', '${tenantBId}', 'ORD-B-001', 300.00);
        `);
      });
    });

    it('should isolate SELECT: Tenant A sees ONLY Tenant A orders, Tenant B orders are invisible', async () => {
      const rows = await runInTransaction(tenantAId, 'rc_app_user', async () => {
        const res = await pg.query<{ id: string; order_number: string }>(`
          SELECT id, order_number FROM sales_orders;
        `);
        return res.rows;
      });

      expect(rows.length).toBe(1);
      expect(rows[0]?.id).toBe(orderAId);
      expect(rows[0]?.order_number).toBe('ORD-A-001');
    });

    it('should isolate SELECT: Tenant B sees ONLY Tenant B orders', async () => {
      const rows = await runInTransaction(tenantBId, 'rc_app_user', async () => {
        const res = await pg.query<{ id: string; order_number: string }>(`
          SELECT id, order_number FROM sales_orders;
        `);
        return res.rows;
      });

      expect(rows.length).toBe(1);
      expect(rows[0]?.id).toBe(orderBId);
      expect(rows[0]?.order_number).toBe('ORD-B-001');
    });

    it('should fail-closed: missing tenant context returns 0 rows', async () => {
      const rows = await runInTransaction(null, 'rc_app_user', async () => {
        const res = await pg.query<{ id: string }>(`
          SELECT id FROM sales_orders;
        `);
        return res.rows;
      });

      expect(rows.length).toBe(0);
    });

    it('should reject cross-tenant INSERT with RLS violation error (WITH CHECK enforcement)', async () => {
      let errorThrown = false;
      try {
        await runInTransaction(tenantAId, 'rc_app_user', async () => {
          // Attempting to insert a record for Tenant B while running under Tenant A context:
          await pg.exec(`
            INSERT INTO sales_orders (id, tenant_id, order_number, grand_total)
            VALUES ('33333333-3333-3333-3333-333333333333', '${tenantBId}', 'ATTACK-001', 999.00);
          `);
        });
      } catch (err: unknown) {
        errorThrown = true;
        expect((err as Error).message).toContain('row-level security policy');
      }
      expect(errorThrown).toBe(true);
    });

    it('should block cross-tenant UPDATE: Tenant A cannot update Tenant B records', async () => {
      const affectedRows = await runInTransaction(tenantAId, 'rc_app_user', async () => {
        const res = await pg.query(`
          UPDATE sales_orders SET grand_total = 0.00 WHERE id = '${orderBId}';
        `);
        return res.affectedRows;
      });

      expect(affectedRows).toBe(0);

      // Verify Tenant B's order was untouched
      const grandTotal = await runInTransaction(tenantBId, 'rc_app_user', async () => {
        const res = await pg.query<{ grand_total: string }>(`
          SELECT grand_total FROM sales_orders WHERE id = '${orderBId}';
        `);
        return Number(res.rows[0]?.grand_total);
      });

      expect(grandTotal).toBe(300.00);
    });

    it('should block cross-tenant DELETE: Tenant A cannot delete Tenant B records', async () => {
      const affectedRows = await runInTransaction(tenantAId, 'rc_app_user', async () => {
        const res = await pg.query(`
          DELETE FROM sales_orders WHERE id = '${orderBId}';
        `);
        return res.affectedRows;
      });

      expect(affectedRows).toBe(0);

      // Verify Tenant B's order still exists
      const exists = await runInTransaction(tenantBId, 'rc_app_user', async () => {
        const res = await pg.query<{ id: string }>(`
          SELECT id FROM sales_orders WHERE id = '${orderBId}';
        `);
        return res.rows.length;
      });

      expect(exists).toBe(1);
    });
  });

  describe('3. Connection Pooling & Context Isolation', () => {
    it('should reset SET LOCAL context completely between transactions on the same connection', async () => {
      // Transaction 1: Tenant A sets context
      await runInTransaction(tenantAId, 'rc_app_user', async () => {
        await pg.query(`SELECT * FROM sales_orders;`);
      });

      // Immediate check on the same connection outside any transaction:
      const checkRes = await pg.query<{ val: string | null }>(`
        SELECT NULLIF(current_setting('app.current_tenant_id', true), '') AS val;
      `);
      expect(checkRes.rows[0]?.val).toBeNull();

      // Transaction 2: Tenant B executes on the same connection
      const tenantBRows = await runInTransaction(tenantBId, 'rc_app_user', async () => {
        const res = await pg.query<{ id: string }>(`SELECT id FROM sales_orders;`);
        return res.rows;
      });

      expect(tenantBRows.length).toBe(1);
      expect(tenantBRows[0]?.id).toBe(orderBId);
    });

    it('should clear tenant context immediately upon transaction ROLLBACK', async () => {
      try {
        await runInTransaction(tenantAId, null, async () => {
          throw new Error('Forced rollback');
        });
      } catch {
        // Expected rollback
      }

      const checkRes = await pg.query<{ val: string | null }>(`
        SELECT NULLIF(current_setting('app.current_tenant_id', true), '') AS val;
      `);
      expect(checkRes.rows[0]?.val).toBeNull();
    });
  });

  describe('4. Audit Log Integrity & Immutability', () => {
    const auditId = '99999999-9999-9999-9999-999999999999';

    it('should allow rc_app_user to INSERT audit logs under tenant context', async () => {
      await runInTransaction(tenantAId, 'rc_app_user', async () => {
        await pg.exec(`
          INSERT INTO audit_logs (id, tenant_id, action, entity_id)
          VALUES ('${auditId}', '${tenantAId}', 'ORDER_CREATED', '${orderAId}');
        `);
      });

      const rows = await runInTransaction(tenantAId, 'rc_app_user', async () => {
        const res = await pg.query<{ id: string }>(`
          SELECT id FROM audit_logs WHERE id = '${auditId}';
        `);
        return res.rows;
      });

      expect(rows.length).toBe(1);
    });

    it('should reject UPDATE on audit_logs at database level (permission / trigger)', async () => {
      let updateError = false;
      try {
        await runInTransaction(tenantAId, 'rc_app_user', async () => {
          await pg.exec(`
            UPDATE audit_logs SET action = 'MALICIOUS_TAMPER' WHERE id = '${auditId}';
          `);
        });
      } catch (err: unknown) {
        updateError = true;
        expect((err as Error).message).toMatch(/permission denied|Security Violation/i);
      }
      expect(updateError).toBe(true);
    });

    it('should reject DELETE on audit_logs at database level (permission / trigger)', async () => {
      let deleteError = false;
      try {
        await runInTransaction(tenantAId, 'rc_app_user', async () => {
          await pg.exec(`
            DELETE FROM audit_logs WHERE id = '${auditId}';
          `);
        });
      } catch (err: unknown) {
        deleteError = true;
        expect((err as Error).message).toMatch(/permission denied|Security Violation/i);
      }
      expect(deleteError).toBe(true);
    });
  });
});
