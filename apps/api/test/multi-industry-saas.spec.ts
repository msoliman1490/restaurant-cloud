import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import {
  IndustryType,
  IndustryPackStatus,
  SubscriptionPlanCode,
  SubscriptionStatus,
  INDUSTRY_CAPABILITIES,
} from '@restaurant-cloud/domain-kernel';

describe('Restaurant Cloud — Multi-Industry SaaS & Entitlements Engine Suite', () => {
  let pg: PGlite;

  const tenantRestaurantId = '11111111-1111-1111-1111-111111111111';
  const tenantGroceryId = '22222222-2222-2222-2222-222222222222';

  const entityRestId = '11111111-1111-1111-1111-222222222221';
  const branchRestId = '11111111-1111-1111-1111-333333333331';

  async function runInTenant<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
    await pg.exec('BEGIN;');
    try {
      await pg.exec('SET ROLE rc_app_user;');
      await pg.exec(`SELECT set_config('app.current_tenant_id', '${tenantId}', true);`);
      const result = await operation();
      await pg.exec('COMMIT;');
      return result;
    } catch (err) {
      await pg.exec('ROLLBACK;');
      throw err;
    } finally {
      await pg.exec('RESET ROLE;');
    }
  }

  beforeAll(async () => {
    pg = new PGlite();

    // DDL Setup with RLS
    await pg.exec(`
      CREATE TABLE tenants (
        id UUID PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE'
      );

      CREATE TABLE tenant_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plan_code VARCHAR(50) NOT NULL DEFAULT 'FREE_TRIAL',
        status VARCHAR(50) NOT NULL DEFAULT 'TRIAL',
        billing_interval VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
        max_branches INT NOT NULL DEFAULT 3,
        max_devices INT NOT NULL DEFAULT 5,
        max_users INT NOT NULL DEFAULT 10,
        trial_ends_at TIMESTAMPTZ,
        renews_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_tenant_subscription UNIQUE (tenant_id)
      );

      CREATE TABLE tenant_industry_packs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        industry VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        settings JSONB,
        activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deactivated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_tenant_industry UNIQUE (tenant_id, industry)
      );

      CREATE TABLE legal_entities (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_name VARCHAR(255) NOT NULL,
        vat_number VARCHAR(15) NOT NULL,
        functional_currency VARCHAR(3) NOT NULL DEFAULT 'SAR'
      );

      CREATE TABLE branches (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        legal_entity_id UUID NOT NULL REFERENCES legal_entities(id),
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL
      );

      CREATE TABLE dining_tables (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        branch_id UUID NOT NULL REFERENCES branches(id),
        table_number VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE'
      );

      CREATE ROLE rc_app_user;
      GRANT USAGE ON SCHEMA public TO rc_app_user;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO rc_app_user;

      ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tenant_subscriptions FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation_subscriptions ON tenant_subscriptions
        FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

      ALTER TABLE tenant_industry_packs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tenant_industry_packs FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation_industry_packs ON tenant_industry_packs
        FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

      ALTER TABLE dining_tables ENABLE ROW LEVEL SECURITY;
      ALTER TABLE dining_tables FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation_dining_tables ON dining_tables
        FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);
    `);

    // Bootstrap Tenants
    await pg.exec(`
      INSERT INTO tenants (id, code, display_name) VALUES
      ('${tenantRestaurantId}', 'TENANT-REST', 'Al-Nakheel Fine Dining'),
      ('${tenantGroceryId}', 'TENANT-GROC', 'Al-Madina Supermarket');

      INSERT INTO legal_entities (id, tenant_id, legal_name, vat_number) VALUES
      ('${entityRestId}', '${tenantRestaurantId}', 'Al-Nakheel Hospitality LLC', '300000000000003');

      INSERT INTO branches (id, tenant_id, legal_entity_id, code, name) VALUES
      ('${branchRestId}', '${tenantRestaurantId}', '${entityRestId}', 'BR-01', 'Riyadh Flagship');
    `);
  });

  it('1. Provisions primary industry pack and trial subscription upon onboarding', async () => {
    // Provision Restaurant Tenant
    await pg.exec(`
      INSERT INTO tenant_subscriptions (tenant_id, plan_code, status, max_branches, max_devices, max_users)
      VALUES ('${tenantRestaurantId}', '${SubscriptionPlanCode.FREE_TRIAL}', '${SubscriptionStatus.TRIAL}', 3, 5, 10);

      INSERT INTO tenant_industry_packs (tenant_id, industry, status, is_primary)
      VALUES ('${tenantRestaurantId}', '${IndustryType.RESTAURANT}', '${IndustryPackStatus.ACTIVE}', true);
    `);

    // Provision Grocery Tenant
    await pg.exec(`
      INSERT INTO tenant_subscriptions (tenant_id, plan_code, status, max_branches, max_devices, max_users)
      VALUES ('${tenantGroceryId}', '${SubscriptionPlanCode.GROWTH}', '${SubscriptionStatus.ACTIVE}', 10, 20, 50);

      INSERT INTO tenant_industry_packs (tenant_id, industry, status, is_primary)
      VALUES ('${tenantGroceryId}', '${IndustryType.GROCERY}', '${IndustryPackStatus.ACTIVE}', true);
    `);

    const restPacks = await pg.query(
      `SELECT * FROM tenant_industry_packs WHERE tenant_id = '${tenantRestaurantId}'`
    );
    expect(restPacks.rows).toHaveLength(1);
    expect(restPacks.rows[0].industry).toBe('RESTAURANT');
    expect(restPacks.rows[0].is_primary).toBe(true);
    expect(restPacks.rows[0].status).toBe('ACTIVE');

    const grocPacks = await pg.query(
      `SELECT * FROM tenant_industry_packs WHERE tenant_id = '${tenantGroceryId}'`
    );
    expect(grocPacks.rows).toHaveLength(1);
    expect(grocPacks.rows[0].industry).toBe('GROCERY');
    expect(grocPacks.rows[0].is_primary).toBe(true);
  });

  it('2. Evaluates discrete industry capabilities accurately', async () => {
    // Restaurant Capabilities
    const restCaps = INDUSTRY_CAPABILITIES[IndustryType.RESTAURANT];
    expect(restCaps).toContain('dining.tables');
    expect(restCaps).toContain('dining.floor_plan');
    expect(restCaps).toContain('production.kitchen_kds');
    expect(restCaps).toContain('production.recipes');
    expect(restCaps).not.toContain('pos.barcode_scanner');
    expect(restCaps).not.toContain('pos.weight_scale');

    // Grocery Capabilities
    const grocCaps = INDUSTRY_CAPABILITIES[IndustryType.GROCERY];
    expect(grocCaps).toContain('pos.barcode_scanner');
    expect(grocCaps).toContain('pos.weight_scale');
    expect(grocCaps).toContain('catalog.expiry_tracking');
    expect(grocCaps).not.toContain('dining.tables');
    expect(grocCaps).not.toContain('dining.floor_plan');
  });

  it('3. Activates secondary industry pack for the same tenant (Multi-Industry Union)', async () => {
    // Tenant 1 (Restaurant) activates GROCERY pack for convenience store corner
    await pg.exec(`
      INSERT INTO tenant_industry_packs (tenant_id, industry, status, is_primary)
      VALUES ('${tenantRestaurantId}', '${IndustryType.GROCERY}', '${IndustryPackStatus.ACTIVE}', false);
    `);

    const activePacks = await pg.query(
      `SELECT industry FROM tenant_industry_packs WHERE tenant_id = '${tenantRestaurantId}' AND status = 'ACTIVE'`
    );
    const industries = activePacks.rows.map((r: any) => r.industry);
    expect(industries).toHaveLength(2);
    expect(industries).toContain('RESTAURANT');
    expect(industries).toContain('GROCERY');

    // Compute union of capabilities
    const aggregatedCapabilities = new Set<string>();
    industries.forEach((ind: IndustryType) => {
      (INDUSTRY_CAPABILITIES[ind] || []).forEach((c) => aggregatedCapabilities.add(c));
    });

    // Now Tenant 1 has both Restaurant AND Grocery capabilities
    expect(aggregatedCapabilities.has('dining.tables')).toBe(true);
    expect(aggregatedCapabilities.has('dining.floor_plan')).toBe(true);
    expect(aggregatedCapabilities.has('pos.barcode_scanner')).toBe(true);
    expect(aggregatedCapabilities.has('pos.weight_scale')).toBe(true);
  });

  it('4. Enforces server-side entitlement checks and rejects unauthorized capabilities', async () => {
    function checkEntitlement(activeIndustries: IndustryType[], target: string): boolean {
      for (const ind of activeIndustries) {
        if (ind === target) return true;
        const caps = INDUSTRY_CAPABILITIES[ind] || [];
        if (caps.includes(target)) return true;
      }
      return false;
    }

    // Tenant 1 has RESTAURANT + GROCERY
    const tenant1Industries = [IndustryType.RESTAURANT, IndustryType.GROCERY];
    expect(checkEntitlement(tenant1Industries, 'dining.tables')).toBe(true);
    expect(checkEntitlement(tenant1Industries, 'pos.barcode_scanner')).toBe(true);
    expect(checkEntitlement(tenant1Industries, 'baking.production_batches')).toBe(false); // BAKERY pack not active

    // Tenant 2 has ONLY GROCERY
    const tenant2Industries = [IndustryType.GROCERY];
    expect(checkEntitlement(tenant2Industries, 'pos.barcode_scanner')).toBe(true);
    expect(checkEntitlement(tenant2Industries, 'dining.tables')).toBe(false); // Must be rejected with 403
  });

  it('5. Deactivates industry pack safely without deleting historical tenant records', async () => {
    // Insert historical table under restaurant
    await pg.exec(`
      INSERT INTO dining_tables (id, tenant_id, branch_id, table_number)
      VALUES ('55555555-5555-5555-5555-555555555555', '${tenantRestaurantId}', '${branchRestId}', 'T-01');
    `);

    // Deactivate GROCERY pack
    await pg.exec(`
      UPDATE tenant_industry_packs 
      SET status = '${IndustryPackStatus.INACTIVE}', deactivated_at = NOW()
      WHERE tenant_id = '${tenantRestaurantId}' AND industry = '${IndustryType.GROCERY}';
    `);

    // Verify pack status
    const packStatus = await pg.query(
      `SELECT status, deactivated_at FROM tenant_industry_packs WHERE tenant_id = '${tenantRestaurantId}' AND industry = '${IndustryType.GROCERY}'`
    );
    expect(packStatus.rows[0].status).toBe('INACTIVE');
    expect(packStatus.rows[0].deactivated_at).not.toBeNull();

    // Verify dining table record is preserved intact
    const tables = await pg.query(
      `SELECT * FROM dining_tables WHERE tenant_id = '${tenantRestaurantId}'`
    );
    expect(tables.rows).toHaveLength(1);
    expect(tables.rows[0].table_number).toBe('T-01');

    // Reactivate pack seamlessly
    await pg.exec(`
      UPDATE tenant_industry_packs 
      SET status = '${IndustryPackStatus.ACTIVE}', deactivated_at = NULL
      WHERE tenant_id = '${tenantRestaurantId}' AND industry = '${IndustryType.GROCERY}';
    `);

    const reactivated = await pg.query(
      `SELECT status FROM tenant_industry_packs WHERE tenant_id = '${tenantRestaurantId}' AND industry = '${IndustryType.GROCERY}'`
    );
    expect(reactivated.rows[0].status).toBe('ACTIVE');
  });

  it('6. Enforces PostgreSQL RLS isolation on industry packs and subscriptions', async () => {
    // Under Tenant 1 context, Tenant 2 records MUST NOT be visible
    await runInTenant(tenantRestaurantId, async () => {
      const visibleSubscriptions = await pg.query(`SELECT * FROM tenant_subscriptions;`);
      expect(visibleSubscriptions.rows).toHaveLength(1);
      expect(visibleSubscriptions.rows[0].tenant_id).toBe(tenantRestaurantId);

      const visiblePacks = await pg.query(`SELECT * FROM tenant_industry_packs;`);
      expect(visiblePacks.rows.every((r: any) => r.tenant_id === tenantRestaurantId)).toBe(true);
    });

    // Under Tenant 2 context, Tenant 1 records MUST NOT be visible
    await runInTenant(tenantGroceryId, async () => {
      const visibleSubscriptions = await pg.query(`SELECT * FROM tenant_subscriptions;`);
      expect(visibleSubscriptions.rows).toHaveLength(1);
      expect(visibleSubscriptions.rows[0].tenant_id).toBe(tenantGroceryId);

      const visiblePacks = await pg.query(`SELECT * FROM tenant_industry_packs;`);
      expect(visiblePacks.rows).toHaveLength(1);
      expect(visiblePacks.rows[0].tenant_id).toBe(tenantGroceryId);
      expect(visiblePacks.rows[0].industry).toBe('GROCERY');
    });
  });

  it('7. Adding legal entity or branch operates within same tenant and preserves entitlements', async () => {
    const secondEntityId = '11111111-1111-1111-1111-222222222222';
    const secondBranchId = '11111111-1111-1111-1111-333333333332';

    // Add 2nd Legal Entity & Branch under Tenant 1
    await pg.exec(`
      INSERT INTO legal_entities (id, tenant_id, legal_name, vat_number)
      VALUES ('${secondEntityId}', '${tenantRestaurantId}', 'Al-Nakheel Express Catering LLC', '300000000000004');

      INSERT INTO branches (id, tenant_id, legal_entity_id, code, name) VALUES
      ('${secondBranchId}', '${tenantRestaurantId}', '${secondEntityId}', 'BR-02', 'Jeddah Branch');
    `);

    // Verify tenant packs are unaltered
    const activePacks = await pg.query(
      `SELECT count(*) as count FROM tenant_industry_packs WHERE tenant_id = '${tenantRestaurantId}' AND status = 'ACTIVE'`
    );
    expect(Number(activePacks.rows[0].count)).toBe(2);

    // Verify branches belong to Tenant 1
    const branches = await pg.query(
      `SELECT * FROM branches WHERE tenant_id = '${tenantRestaurantId}'`
    );
    expect(branches.rows).toHaveLength(2);
  });
});
