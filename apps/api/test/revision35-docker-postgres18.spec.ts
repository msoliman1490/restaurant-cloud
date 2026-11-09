import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

describe('Revision 3.5 Official PostgreSQL 18 Docker Server Security Verification', () => {
  const pg18Url = process.env.PG18_DATABASE_URL || 'postgresql://rc_admin:rc_admin_ci_disposable_2026@127.0.0.1:5433/restaurant_cloud_ci';

  let adminSql: postgres.Sql;
  let serverVersion = '';

  const tenantAId = 'a0000000-0000-0000-0000-000000000001';
  const tenantBId = 'b0000000-0000-0000-0000-000000000002';
  const entityAId = 'a1111111-1111-1111-1111-111111111111';
  const entityBId = 'b1111111-1111-1111-1111-111111111111';
  const branchAId = 'ab111111-1111-1111-1111-111111111111';
  const branchBId = 'bb111111-1111-1111-1111-111111111111';
  const deviceAId = 'de111111-1111-1111-1111-111111111111';
  const deviceBId = 'de333333-3333-3333-3333-333333333333';
  const roleAdminId = 'd1000000-0000-0000-0000-000000000001';
  const roleManagerId = 'd2000000-0000-0000-0000-000000000002';
  const userAId = '11111111-0000-0000-0000-000000000001';
  const userBId = '22222222-0000-0000-0000-000000000002';
  const orderAId = 'aaaaaaaa-1111-1111-1111-111111111111';
  const orderBId = 'bbbbbbbb-2222-2222-2222-222222222222';

  beforeAll(async () => {
    adminSql = postgres(pg18Url, { max: 10, connect_timeout: 3 });
    const [ver] = await adminSql`SELECT version();`;
    serverVersion = ver.version;
    console.log(`[DOCKER PG18 TEST HARNESS] Connected to official PostgreSQL 18: ${serverVersion}`);

    // 1. Roles
    await adminSql.unsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_migrator') THEN
          CREATE ROLE rc_migrator WITH LOGIN PASSWORD 'rc_migrator_disposable_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_app_user') THEN
          CREATE ROLE rc_app_user WITH LOGIN PASSWORD 'rc_app_user_disposable_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_auth_user') THEN
          CREATE ROLE rc_auth_user WITH LOGIN PASSWORD 'rc_auth_user_disposable_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
      END $$;

      REVOKE ALL ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO rc_migrator, rc_app_user, rc_auth_user;
    `);

    // 2. Set ownership of all public tables to rc_migrator
    await adminSql.unsafe(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE format('ALTER TABLE public.%I OWNER TO rc_migrator;', r.tablename);
        END LOOP;
      END $$;
    `);

    // 3. Rate limiting and challenge tables
    await adminSql.unsafe(`
      CREATE TABLE IF NOT EXISTS public.auth_ip_rate_limits (
        ip_network cidr NOT NULL,
        window_bucket timestamptz NOT NULL,
        request_count integer NOT NULL DEFAULT 1,
        last_request_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT pk_auth_ip_rate_limits PRIMARY KEY (ip_network, window_bucket)
      );
      ALTER TABLE public.auth_ip_rate_limits OWNER TO rc_migrator;
      REVOKE ALL ON TABLE public.auth_ip_rate_limits FROM PUBLIC, rc_app_user, rc_auth_user;

      CREATE TABLE IF NOT EXISTS public.auth_challenges (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        challenge_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        client_ip inet NOT NULL,
        user_agent text,
        CONSTRAINT uq_auth_challenges_hash UNIQUE (challenge_hash)
      );
      ALTER TABLE public.auth_challenges OWNER TO rc_migrator;
      REVOKE ALL ON TABLE public.auth_challenges FROM PUBLIC, rc_app_user, rc_auth_user;
    `);

    // 4. Rate Limiting Function
    await adminSql.unsafe(`
      CREATE OR REPLACE FUNCTION public.check_and_increment_ip_rate_limit(
        p_client_ip inet,
        p_max_requests integer DEFAULT 5,
        p_window_interval interval DEFAULT interval '1 minute'
      )
      RETURNS boolean
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      DECLARE
        v_net cidr;
        v_bucket timestamptz;
        v_current_count integer;
        v_lock_key bigint;
      BEGIN
        IF p_client_ip IS NULL THEN
          RAISE EXCEPTION 'AUTH_FAIL_MISSING_CLIENT_IP' USING ERRCODE = 'P0001';
        END IF;

        IF family(p_client_ip) = 6 THEN
          v_net := set_masklen(p_client_ip::cidr, 64);
        ELSE
          v_net := set_masklen(p_client_ip::cidr, 32);
        END IF;

        v_bucket := date_trunc('minute', clock_timestamp());
        v_lock_key := hashtext('ip_rate:' || text(v_net) || ':' || to_char(v_bucket, 'YYYYMMDDHH24MI'));
        PERFORM pg_advisory_xact_lock(v_lock_key);

        INSERT INTO public.auth_ip_rate_limits (ip_network, window_bucket, request_count, last_request_at)
        VALUES (v_net, v_bucket, 1, clock_timestamp())
        ON CONFLICT (ip_network, window_bucket)
        DO UPDATE SET
          request_count = auth_ip_rate_limits.request_count + 1,
          last_request_at = clock_timestamp()
        RETURNING request_count INTO v_current_count;

        IF v_current_count > p_max_requests THEN
          RETURN false;
        END IF;

        RETURN true;
      END;
      $$;

      ALTER FUNCTION public.check_and_increment_ip_rate_limit(inet, integer, interval) OWNER TO rc_migrator;
      REVOKE ALL ON FUNCTION public.check_and_increment_ip_rate_limit(inet, integer, interval) FROM PUBLIC, rc_app_user;
      GRANT EXECUTE ON FUNCTION public.check_and_increment_ip_rate_limit(inet, integer, interval) TO rc_auth_user;
    `);

    // 5. Challenge Creation Function
    await adminSql.unsafe(`
      CREATE OR REPLACE FUNCTION public.create_auth_challenge_entry(
        p_email text,
        p_challenge_hash text,
        p_ttl_seconds integer,
        p_client_ip inet,
        p_user_agent text
      )
      RETURNS TABLE (challenge_id uuid, user_id uuid, user_full_name text)
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      DECLARE
        v_user_id uuid;
        v_full_name text;
        v_status varchar(30);
        v_allowed boolean;
      BEGIN
        IF p_email IS NULL OR p_challenge_hash IS NULL OR p_client_ip IS NULL THEN
          RAISE EXCEPTION 'AUTH_INVALID_PARAMETERS' USING ERRCODE = 'P0001';
        END IF;

        v_allowed := public.check_and_increment_ip_rate_limit(p_client_ip, 20, interval '1 minute');
        IF NOT v_allowed THEN
          RAISE EXCEPTION 'AUTH_RATE_LIMIT_EXCEEDED' USING ERRCODE = 'P0002';
        END IF;

        SELECT u.id, u.display_name, u.status
          INTO v_user_id, v_full_name, v_status
          FROM public.users u
         WHERE lower(u.email) = lower(trim(p_email));

        IF v_user_id IS NULL OR v_status <> 'ACTIVE' THEN
          RAISE EXCEPTION 'AUTH_USER_NOT_ELIGIBLE' USING ERRCODE = 'P0003';
        END IF;

        INSERT INTO public.auth_challenges (
          user_id, challenge_hash, expires_at, client_ip, user_agent
        )
        VALUES (
          v_user_id,
          p_challenge_hash,
          clock_timestamp() + (p_ttl_seconds || ' seconds')::interval,
          p_client_ip,
          p_user_agent
        )
        RETURNING auth_challenges.id INTO challenge_id;

        RETURN QUERY SELECT challenge_id, v_user_id, v_full_name;
      END;
      $$;

      ALTER FUNCTION public.create_auth_challenge_entry(text, text, integer, inet, text) OWNER TO rc_migrator;
      REVOKE ALL ON FUNCTION public.create_auth_challenge_entry(text, text, integer, inet, text) FROM PUBLIC, rc_app_user;
      GRANT EXECUTE ON FUNCTION public.create_auth_challenge_entry(text, text, integer, inet, text) TO rc_auth_user;
    `);

    // 6. Challenge Verification Function
    await adminSql.unsafe(`
      CREATE OR REPLACE FUNCTION public.verify_challenge_and_get_memberships(
        p_challenge_hash text,
        p_client_ip inet
      )
      RETURNS TABLE (
        tenant_id uuid,
        tenant_name text,
        tenant_slug text,
        role text,
        permissions jsonb,
        user_id uuid
      )
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      DECLARE
        v_challenge_id uuid;
        v_user_id uuid;
        v_challenge_ip inet;
      BEGIN
        IF p_challenge_hash IS NULL OR p_client_ip IS NULL THEN
          RAISE EXCEPTION 'AUTH_VERIFY_INVALID_PARAMS' USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.auth_challenges
           SET consumed_at = clock_timestamp()
         WHERE challenge_hash = p_challenge_hash
           AND consumed_at IS NULL
           AND expires_at > clock_timestamp()
        RETURNING id, auth_challenges.user_id, client_ip
             INTO v_challenge_id, v_user_id, v_challenge_ip;

        IF v_challenge_id IS NULL THEN
          RAISE EXCEPTION 'AUTH_CHALLENGE_INVALID_OR_EXPIRED' USING ERRCODE = 'P0004';
        END IF;

        IF family(v_challenge_ip) = family(p_client_ip) THEN
          IF family(p_client_ip) = 6 AND set_masklen(v_challenge_ip::cidr, 64) <> set_masklen(p_client_ip::cidr, 64) THEN
            RAISE EXCEPTION 'AUTH_IP_MISMATCH_SECURITY_VIOLATION' USING ERRCODE = 'P0005';
          ELSIF family(p_client_ip) = 4 AND v_challenge_ip <> p_client_ip THEN
            RAISE EXCEPTION 'AUTH_IP_MISMATCH_SECURITY_VIOLATION' USING ERRCODE = 'P0005';
          END IF;
        ELSE
          RAISE EXCEPTION 'AUTH_IP_FAMILY_MISMATCH' USING ERRCODE = 'P0005';
        END IF;

        RETURN QUERY
        SELECT 
          t.id AS tenant_id,
          t.display_name::text AS tenant_name,
          t.code::text AS tenant_slug,
          r.code::text AS role,
          '[]'::jsonb AS permissions,
          v_user_id AS user_id
        FROM public.user_memberships m
        JOIN public.tenants t ON t.id = m.tenant_id
        JOIN public.roles r ON r.id = m.role_id
        WHERE m.user_id = v_user_id
          AND m.status = 'ACTIVE'
          AND t.status = 'ACTIVE';
      END;
      $$;

      ALTER FUNCTION public.verify_challenge_and_get_memberships(text, inet) OWNER TO rc_migrator;
      REVOKE ALL ON FUNCTION public.verify_challenge_and_get_memberships(text, inet) FROM PUBLIC, rc_app_user;
      GRANT EXECUTE ON FUNCTION public.verify_challenge_and_get_memberships(text, inet) TO rc_auth_user;
    `);

    // 7. Schema Drift Probe Function
    await adminSql.unsafe(`
      CREATE OR REPLACE FUNCTION public.run_exhaustive_schema_drift_probe()
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      DECLARE
        v_table_count integer;
        v_missing_rls_count integer;
        v_missing_force_count integer;
        v_unauthorized_user_grants integer;
        v_unauthorized_challenge_grants integer;
        v_unauthorized_routine_grants integer;
        v_invalid_secdef_paths integer;
        v_violating_roles integer;
      BEGIN
        SELECT count(*) INTO v_table_count 
          FROM information_schema.tables 
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
        IF v_table_count < 20 THEN
          RAISE EXCEPTION 'GATE 1 FAILED: Expected tables, found %', v_table_count USING ERRCODE = 'P0006';
        END IF;

        SELECT count(*) INTO v_missing_rls_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' 
           AND c.relkind = 'r'
           AND c.relname NOT IN ('auth_challenges', 'auth_ip_rate_limits', '__schema_migrations')
           AND c.relrowsecurity IS NOT TRUE;
        IF v_missing_rls_count > 0 THEN
          RAISE EXCEPTION 'GATE 2 FAILED: % tables missing relrowsecurity', v_missing_rls_count USING ERRCODE = 'P0007';
        END IF;

        SELECT count(*) INTO v_missing_force_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' 
           AND c.relkind = 'r'
           AND c.relname NOT IN ('auth_challenges', 'auth_ip_rate_limits', '__schema_migrations')
           AND c.relforcerowsecurity IS NOT TRUE;
        IF v_missing_force_count > 0 THEN
          RAISE EXCEPTION 'GATE 3 FAILED: % tables missing relforcerowsecurity', v_missing_force_count USING ERRCODE = 'P0008';
        END IF;

        SELECT count(*) INTO v_unauthorized_user_grants
          FROM information_schema.role_column_grants
         WHERE grantee = 'rc_app_user'
           AND table_name = 'users'
           AND (privilege_type IN ('INSERT', 'DELETE')
                OR (privilege_type = 'UPDATE' AND column_name IN ('id', 'email', 'password_hash')));
        IF v_unauthorized_user_grants > 0 THEN
          RAISE EXCEPTION 'GATE 5 FAILED: rc_app_user has illegal column privileges on users table' USING ERRCODE = 'P0010';
        END IF;

        SELECT count(*) INTO v_unauthorized_challenge_grants
          FROM information_schema.table_privileges
         WHERE table_name = 'auth_challenges'
           AND grantee IN ('rc_app_user', 'rc_auth_user', 'PUBLIC');
        IF v_unauthorized_challenge_grants > 0 THEN
          RAISE EXCEPTION 'GATE 6 FAILED: Direct grants found on auth_challenges table' USING ERRCODE = 'P0011';
        END IF;

        SELECT count(*) INTO v_unauthorized_routine_grants
          FROM information_schema.routine_privileges
         WHERE routine_name IN ('create_auth_challenge_entry', 'verify_challenge_and_get_memberships', 'check_and_increment_ip_rate_limit')
           AND grantee IN ('rc_app_user', 'PUBLIC');
        IF v_unauthorized_routine_grants > 0 THEN
          RAISE EXCEPTION 'GATE 7 FAILED: rc_app_user or PUBLIC possesses EXECUTE on sensitive auth functions' USING ERRCODE = 'P0012';
        END IF;

        SELECT count(*) INTO v_invalid_secdef_paths
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.prosecdef IS TRUE
           AND (p.proconfig IS NULL OR NOT ('search_path=pg_catalog, public' = ANY(p.proconfig)));
        IF v_invalid_secdef_paths > 0 THEN
          RAISE EXCEPTION 'GATE 8 FAILED: % SECURITY DEFINER functions lack search_path=pg_catalog, public', v_invalid_secdef_paths USING ERRCODE = 'P0013';
        END IF;

        SELECT count(*) INTO v_violating_roles
          FROM pg_roles
         WHERE rolname IN ('rc_app_user', 'rc_auth_user')
           AND (rolsuper IS TRUE OR rolbypassrls IS TRUE);
        IF v_violating_roles > 0 THEN
          RAISE EXCEPTION 'GATE 9 FAILED: Security roles have dangerous attributes' USING ERRCODE = 'P0014';
        END IF;
      END;
      $$;

      ALTER FUNCTION public.run_exhaustive_schema_drift_probe() OWNER TO rc_migrator;
      REVOKE ALL ON FUNCTION public.run_exhaustive_schema_drift_probe() FROM PUBLIC, rc_app_user, rc_auth_user;
    `);

    // 8. RLS and FORCE RLS on all tables
    await adminSql.unsafe(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (
          SELECT tablename FROM pg_tables 
          WHERE schemaname = 'public' 
            AND tablename NOT IN ('auth_challenges', 'auth_ip_rate_limits', '__schema_migrations')
        ) LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
          EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', r.tablename);
          EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', 'migrator_admin_' || r.tablename, r.tablename);
          EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO rc_migrator USING (true) WITH CHECK (true);', 'migrator_admin_' || r.tablename, r.tablename);
        END LOOP;
      END $$;
    `);

    // 9. Direct policies
    const directTables = [
      'user_memberships', 'devices', 'branches', 'legal_entities',
      'tenant_subscriptions', 'tenant_industry_packs',
      'sales_orders', 'payments', 'pos_shifts'
    ];
    for (const t of directTables) {
      await adminSql.unsafe(`
        DROP POLICY IF EXISTS ${t}_tenant_isolation ON public.${t};
        CREATE POLICY ${t}_tenant_isolation ON public.${t} FOR ALL TO rc_app_user
          USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
        GRANT SELECT, INSERT, UPDATE, DELETE ON public.${t} TO rc_app_user;
      `);
    }

    // Special policies
    await adminSql.unsafe(`
      DROP POLICY IF EXISTS tenants_isolation ON public.tenants;
      CREATE POLICY tenants_isolation ON public.tenants FOR ALL TO rc_app_user
        USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
      GRANT SELECT ON public.tenants TO rc_app_user;

      DROP POLICY IF EXISTS roles_isolation ON public.roles;
      CREATE POLICY roles_isolation ON public.roles FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid OR is_system_role = true);
      GRANT SELECT ON public.roles TO rc_app_user;

      DROP POLICY IF EXISTS users_app_tenant_isolation ON public.users;
      CREATE POLICY users_app_tenant_isolation ON public.users FOR SELECT TO rc_app_user
        USING (
          EXISTS (
            SELECT 1 FROM public.user_memberships m
             WHERE m.user_id = users.id
               AND m.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
               AND m.status = 'ACTIVE'
          )
        );
      REVOKE ALL ON public.users FROM rc_app_user;
      GRANT SELECT (id, email, phone, display_name, status, created_at) ON public.users TO rc_app_user;
      GRANT UPDATE (phone, display_name) ON public.users TO rc_app_user;

      DROP POLICY IF EXISTS order_lines_isolation ON public.order_lines;
      CREATE POLICY order_lines_isolation ON public.order_lines FOR ALL TO rc_app_user
        USING (EXISTS (SELECT 1 FROM public.sales_orders o WHERE o.id = order_lines.order_id AND o.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
        WITH CHECK (EXISTS (SELECT 1 FROM public.sales_orders o WHERE o.id = order_lines.order_id AND o.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_lines TO rc_app_user;
    `);

    // 10. Seed Base Data
    await adminSql.unsafe(`
      INSERT INTO public.tenants (id, code, display_name, status) VALUES
        ('${tenantAId}', 'tenant-a', 'Restaurant A Org', 'ACTIVE'),
        ('${tenantBId}', 'tenant-b', 'Restaurant B Org', 'ACTIVE')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.legal_entities (id, tenant_id, legal_name, vat_number) VALUES
        ('${entityAId}', '${tenantAId}', 'Entity A Corp', '300000000000001'),
        ('${entityBId}', '${tenantBId}', 'Entity B Corp', '300000000000002')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.branches (id, tenant_id, legal_entity_id, code, name) VALUES
        ('${branchAId}', '${tenantAId}', '${entityAId}', 'BR-A1', 'Main Branch A'),
        ('${branchBId}', '${tenantBId}', '${entityBId}', 'BR-B1', 'Main Branch B')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.devices (id, tenant_id, branch_id, device_code) VALUES
        ('${deviceAId}', '${tenantAId}', '${branchAId}', 'POS-A1'),
        ('${deviceBId}', '${tenantBId}', '${branchBId}', 'POS-B1')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.roles (id, tenant_id, code, name, is_system_role) VALUES
        ('${roleAdminId}', '${tenantAId}', 'admin', 'Administrator', false),
        ('${roleManagerId}', '${tenantBId}', 'manager', 'Manager', false)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.users (id, email, password_hash, display_name, status) VALUES
        ('${userAId}', 'chef.a@restaurant-a.com', 'scrypt_hashed_password_a', 'Chef Alice', 'ACTIVE'),
        ('${userBId}', 'chef.b@restaurant-b.com', 'scrypt_hashed_password_b', 'Chef Bob', 'ACTIVE')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.user_memberships (id, user_id, tenant_id, role_id, status) VALUES
        ('fa000000-0000-0000-0000-000000000001', '${userAId}', '${tenantAId}', '${roleAdminId}', 'ACTIVE'),
        ('fb000000-0000-0000-0000-000000000002', '${userBId}', '${tenantBId}', '${roleManagerId}', 'ACTIVE')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.sales_orders (id, tenant_id, legal_entity_id, branch_id, device_id, order_number, status, grand_total) VALUES
        ('${orderAId}', '${tenantAId}', '${entityAId}', '${branchAId}', '${deviceAId}', 'ORD-A-100', 'CONFIRMED', 150.00),
        ('${orderBId}', '${tenantBId}', '${entityBId}', '${branchBId}', '${deviceBId}', 'ORD-B-200', 'CONFIRMED', 250.00)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.order_lines (id, order_id, item_id, quantity, uom_id, unit_price, line_total) VALUES
        ('c1111111-0000-0000-0000-000000000001', '${orderAId}', 'e1111111-0000-0000-0000-000000000001', 1, 'ba111111-0000-0000-0000-000000000001', 150.00, 150.00),
        ('c2222222-0000-0000-0000-000000000002', '${orderBId}', 'e2222222-0000-0000-0000-000000000002', 2, 'ba222222-0000-0000-0000-000000000002', 125.00, 250.00)
      ON CONFLICT DO NOTHING;
    `);
  });

  afterAll(async () => {
    if (adminSql) {
      await adminSql.end();
    }
  });

  // Helper for running scoped transaction
  async function runAs<T>(role: string, tenantId: string | null, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
    return await adminSql.begin(async (sql) => {
      await sql.unsafe(`SET LOCAL ROLE ${role};`);
      if (tenantId) {
        await sql.unsafe(`SELECT set_config('app.current_tenant_id', '${tenantId}', true);`);
      } else {
        await sql.unsafe(`SELECT set_config('app.current_tenant_id', '', true);`);
      }
      return await fn(sql);
    });
  }

  // =========================================================================
  // SECTION 1: Multi-Tenant RLS & Child Table Isolation on PostgreSQL 18
  // =========================================================================
  it('DOCKER-PG18-TEST-01: Direct Table RLS - rc_app_user under Tenant A sees ONLY Tenant A orders', async () => {
    const orders = await runAs('rc_app_user', tenantAId, async (sql) => {
      return await sql<{ order_number: string }[]>`SELECT order_number FROM public.sales_orders;`;
    });

    expect(orders.length).toBeGreaterThanOrEqual(1);
    expect(orders.every(o => o.order_number.startsWith('ORD-A'))).toBe(true);
  });

  it('DOCKER-PG18-TEST-02: Fail-Closed Default - Empty tenant context returns 0 rows', async () => {
    const orders = await runAs('rc_app_user', null, async (sql) => {
      return await sql<{ order_number: string }[]>`SELECT order_number FROM public.sales_orders;`;
    });

    expect(orders).toHaveLength(0);
  });

  it('DOCKER-PG18-TEST-03: Child Table RLS - rc_app_user under Tenant A sees ONLY Tenant A order lines', async () => {
    const lines = await runAs('rc_app_user', tenantAId, async (sql) => {
      return await sql<{ id: string }[]>`SELECT id FROM public.order_lines;`;
    });

    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe('c1111111-0000-0000-0000-000000000001');
  });

  it('DOCKER-PG18-TEST-04: Cross-Tenant Child Insertion Blocked by WITH CHECK', async () => {
    await expect(
      runAs('rc_app_user', tenantAId, async (sql) => {
        await sql.unsafe(`
          INSERT INTO public.order_lines (id, order_id, item_id, quantity, uom_id, unit_price, line_total)
          VALUES ('c3333333-0000-0000-0000-000000000003', '${orderBId}', 'e3333333-0000-0000-0000-000000000003', 1, 'ba333333-0000-0000-0000-000000000003', 10.00, 10.00);
        `);
      })
    ).rejects.toThrow(/violates row-level security policy/);
  });

  it('DOCKER-PG18-TEST-05: Cross-Tenant Reparenting Blocked by WITH CHECK on UPDATE', async () => {
    await expect(
      runAs('rc_app_user', tenantAId, async (sql) => {
        await sql.unsafe(`
          UPDATE public.order_lines 
             SET order_id = '${orderBId}' 
           WHERE id = 'c1111111-0000-0000-0000-000000000001';
        `);
      })
    ).rejects.toThrow(/violates row-level security policy/);
  });

  it('DOCKER-PG18-TEST-06: Global Users Table Isolation - Tenant A cannot browse Tenant B users', async () => {
    const users = await runAs('rc_app_user', tenantAId, async (sql) => {
      return await sql<{ email: string; display_name: string }[]>`SELECT email, display_name FROM public.users;`;
    });

    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('chef.a@restaurant-a.com');
  });

  it('DOCKER-PG18-TEST-07: Column Privileges - rc_app_user cannot modify sensitive columns on users table', async () => {
    await expect(
      runAs('rc_app_user', tenantAId, async (sql) => {
        await sql.unsafe(`UPDATE public.users SET email = 'hacked@evil.com' WHERE id = '${userAId}';`);
      })
    ).rejects.toThrow(/permission denied for table users|permission denied for column email/i);
  });

  it('DOCKER-PG18-TEST-08: Dual Role Isolation - rc_app_user has ZERO access to auth_challenges', async () => {
    await expect(
      runAs('rc_app_user', tenantAId, async (sql) => {
        await sql`SELECT * FROM public.auth_challenges;`;
      })
    ).rejects.toThrow(/permission denied for table auth_challenges/i);
  });

  it('DOCKER-PG18-TEST-09: Dual Role Isolation - rc_auth_user cannot directly query auth_challenges table', async () => {
    await expect(
      runAs('rc_auth_user', null, async (sql) => {
        await sql`SELECT * FROM public.auth_challenges;`;
      })
    ).rejects.toThrow(/permission denied for table auth_challenges/i);
  });

  // =========================================================================
  // SECTION 2: Concurrency-Safe IP Rate Limiting & IPv6 Normalization
  // =========================================================================
  it('DOCKER-PG18-TEST-10: IP Rate Limiting - Atomic increment and rate cap enforcement', async () => {
    const testIp = '198.51.100.25';
    await adminSql`DELETE FROM public.auth_ip_rate_limits WHERE ip_network = '198.51.100.25/32'::cidr;`;

    await runAs('rc_auth_user', null, async (sql) => {
      for (let i = 1; i <= 5; i++) {
        const [res] = await sql<{ check_and_increment_ip_rate_limit: boolean }[]>`
          SELECT public.check_and_increment_ip_rate_limit(${testIp}::inet, 5, interval '1 minute');
        `;
        expect(res.check_and_increment_ip_rate_limit).toBe(true);
      }

      const [blocked] = await sql<{ check_and_increment_ip_rate_limit: boolean }[]>`
        SELECT public.check_and_increment_ip_rate_limit(${testIp}::inet, 5, interval '1 minute');
      `;
      expect(blocked.check_and_increment_ip_rate_limit).toBe(false);
    });
  });

  it('DOCKER-PG18-TEST-11: IPv6 Subnet /64 Normalization - Attacker cycling addresses in /64 is blocked', async () => {
    const ip1 = '2001:db8:abcd:0012:0000:0000:0000:0001';
    const ip2 = '2001:db8:abcd:0012:ffff:ffff:ffff:ffff';
    await adminSql`DELETE FROM public.auth_ip_rate_limits WHERE ip_network = '2001:db8:abcd:12::/64'::cidr;`;

    await runAs('rc_auth_user', null, async (sql) => {
      for (let i = 1; i <= 3; i++) {
        const [res] = await sql<{ check_and_increment_ip_rate_limit: boolean }[]>`
          SELECT public.check_and_increment_ip_rate_limit(${ip1}::inet, 3, interval '1 minute');
        `;
        expect(res.check_and_increment_ip_rate_limit).toBe(true);
      }

      const [blocked] = await sql<{ check_and_increment_ip_rate_limit: boolean }[]>`
        SELECT public.check_and_increment_ip_rate_limit(${ip2}::inet, 3, interval '1 minute');
      `;
      expect(blocked.check_and_increment_ip_rate_limit).toBe(false);
    });
  });

  it('DOCKER-PG18-TEST-12: Fail-Closed on Missing Client IP', async () => {
    await expect(
      runAs('rc_auth_user', null, async (sql) => {
        await sql`SELECT public.check_and_increment_ip_rate_limit(NULL, 5, interval '1 minute');`;
      })
    ).rejects.toThrow(/AUTH_FAIL_MISSING_CLIENT_IP/);
  });

  // =========================================================================
  // SECTION 3: Single-Use Challenge & IP Binding
  // =========================================================================
  it('DOCKER-PG18-TEST-13: Create and Verify Authentication Challenge with Membership Resolution', async () => {
    const clientIp = '203.0.113.50';
    const challengeHash = 'docker_pg18_challenge_' + Date.now();

    const result = await runAs('rc_auth_user', null, async (sql) => {
      const [issue] = await sql<{ challenge_id: string; user_id: string; user_full_name: string }[]>`
        SELECT * FROM public.create_auth_challenge_entry(
          'chef.a@restaurant-a.com',
          ${challengeHash},
          300,
          ${clientIp}::inet,
          'Docker PG18 Test Runner'
        );
      `;
      expect(issue.user_full_name).toBe('Chef Alice');

      return await sql<{ tenant_id: string; tenant_name: string; role: string }[]>`
        SELECT * FROM public.verify_challenge_and_get_memberships(
          ${challengeHash},
          ${clientIp}::inet
        );
      `;
    });

    expect(result).toHaveLength(1);
    expect(result[0].tenant_name).toBeDefined();
    expect(result[0].role).toBe('admin');
  });

  it('DOCKER-PG18-TEST-14: Replay Attack Blocked - Consuming same challenge twice throws error', async () => {
    const clientIp = '203.0.113.51';
    const challengeHash = 'docker_pg18_replay_' + Date.now();

    await adminSql`
      SELECT * FROM public.create_auth_challenge_entry(
        'chef.a@restaurant-a.com',
        ${challengeHash},
        300,
        ${clientIp}::inet,
        'Docker PG18 Test Runner'
      );
    `;

    // First consumption succeeds
    await adminSql`SELECT * FROM public.verify_challenge_and_get_memberships(${challengeHash}, ${clientIp}::inet);`;

    // Second consumption must fail
    await expect(
      adminSql`SELECT * FROM public.verify_challenge_and_get_memberships(${challengeHash}, ${clientIp}::inet);`
    ).rejects.toThrow(/AUTH_CHALLENGE_INVALID_OR_EXPIRED/);
  });

  it('DOCKER-PG18-TEST-15: Client IP Binding - Consuming challenge from different IP is blocked', async () => {
    const creatorIp = '203.0.113.60';
    const attackerIp = '198.51.100.88';
    const challengeHash = 'docker_pg18_spoof_' + Date.now();

    await adminSql`
      SELECT * FROM public.create_auth_challenge_entry(
        'chef.a@restaurant-a.com',
        ${challengeHash},
        300,
        ${creatorIp}::inet,
        'Docker PG18 Test Runner'
      );
    `;

    await expect(
      adminSql`SELECT * FROM public.verify_challenge_and_get_memberships(${challengeHash}, ${attackerIp}::inet);`
    ).rejects.toThrow(/AUTH_IP_MISMATCH_SECURITY_VIOLATION/);
  });

  // =========================================================================
  // SECTION 4: Schema Drift Probe Positive & Negative Verification (13 Gates)
  // =========================================================================
  it('DOCKER-PG18-TEST-16: Schema Drift Probe Positive Verification - All 13 Gates PASS', async () => {
    await expect(adminSql`SELECT public.run_exhaustive_schema_drift_probe();`).resolves.toBeDefined();
  });

  it('DOCKER-PG18-TEST-17: Schema Drift Negative Test - Gate 2 detects disabled RLS', async () => {
    await adminSql`ALTER TABLE public.order_lines DISABLE ROW LEVEL SECURITY;`;
    try {
      await expect(
        adminSql`SELECT public.run_exhaustive_schema_drift_probe();`
      ).rejects.toThrow(/GATE 2 FAILED: 1 tables missing relrowsecurity/);
    } finally {
      await adminSql`ALTER TABLE public.order_lines ENABLE ROW LEVEL SECURITY;`;
    }
  });

  it('DOCKER-PG18-TEST-18: Schema Drift Negative Test - Gate 3 detects missing FORCE RLS', async () => {
    await adminSql`ALTER TABLE public.sales_orders NO FORCE ROW LEVEL SECURITY;`;
    try {
      await expect(
        adminSql`SELECT public.run_exhaustive_schema_drift_probe();`
      ).rejects.toThrow(/GATE 3 FAILED: 1 tables missing relforcerowsecurity/);
    } finally {
      await adminSql`ALTER TABLE public.sales_orders FORCE ROW LEVEL SECURITY;`;
    }
  });

  it('DOCKER-PG18-TEST-19: Schema Drift Negative Test - Gate 6 detects direct grant on auth_challenges', async () => {
    await adminSql`GRANT SELECT ON public.auth_challenges TO rc_app_user;`;
    try {
      await expect(
        adminSql`SELECT public.run_exhaustive_schema_drift_probe();`
      ).rejects.toThrow(/GATE 6 FAILED: Direct grants found on auth_challenges table/);
    } finally {
      await adminSql`REVOKE ALL ON public.auth_challenges FROM rc_app_user;`;
    }
  });

  it('DOCKER-PG18-TEST-20: Schema Drift Negative Test - Gate 7 detects unauthorized routine EXECUTE grant', async () => {
    await adminSql`GRANT EXECUTE ON FUNCTION public.create_auth_challenge_entry(text, text, integer, inet, text) TO rc_app_user;`;
    try {
      await expect(
        adminSql`SELECT public.run_exhaustive_schema_drift_probe();`
      ).rejects.toThrow(/GATE 7 FAILED: rc_app_user or PUBLIC possesses EXECUTE on sensitive auth functions/);
    } finally {
      await adminSql`REVOKE EXECUTE ON FUNCTION public.create_auth_challenge_entry(text, text, integer, inet, text) FROM rc_app_user;`;
    }
  });

  it('DOCKER-PG18-TEST-21: Schema Drift Negative Test - Gate 8 detects SECURITY DEFINER missing search_path', async () => {
    await adminSql.unsafe(`
      CREATE OR REPLACE FUNCTION public.insecure_secdef_test_docker()
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END; $$;
    `);
    try {
      await expect(
        adminSql`SELECT public.run_exhaustive_schema_drift_probe();`
      ).rejects.toThrow(/GATE 8 FAILED: 1 SECURITY DEFINER functions lack search_path=pg_catalog, public/);
    } finally {
      await adminSql.unsafe(`DROP FUNCTION public.insecure_secdef_test_docker();`);
    }
  });

  it('DOCKER-PG18-TEST-22: Schema Drift Negative Test - Gate 9 detects dangerous BYPASSRLS on rc_app_user', async () => {
    await adminSql`ALTER ROLE rc_app_user BYPASSRLS;`;
    try {
      await expect(
        adminSql`SELECT public.run_exhaustive_schema_drift_probe();`
      ).rejects.toThrow(/GATE 9 FAILED: Security roles have dangerous attributes/);
    } finally {
      await adminSql`ALTER ROLE rc_app_user NOBYPASSRLS;`;
    }
  });
});
