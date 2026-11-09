-- ============================================================================
-- RESTAURANT CLOUD — PRODUCTION SECURITY HARDENING & ISOLATION (REVISION 3.5)
-- TARGET ENGINES: PostgreSQL 16 & PostgreSQL 18 Compatible
-- SAFE FOR REPEATABLE EXECUTION (IDEMPOTENT & TRANSACTIONAL)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ROLE DEFINITIONS & ATTRIBUTE HARDENING
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_migrator') THEN
    CREATE ROLE rc_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE rc_migrator WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_app_user') THEN
    CREATE ROLE rc_app_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  ELSE
    ALTER ROLE rc_app_user WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_auth_user') THEN
    CREATE ROLE rc_auth_user WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE rc_auth_user WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- Revoke default public schema access
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO rc_migrator, rc_app_user, rc_auth_user;

-- Revoke automatic default privileges in schema public
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, rc_app_user, rc_auth_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, rc_app_user, rc_auth_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM PUBLIC, rc_app_user, rc_auth_user;

-- ----------------------------------------------------------------------------
-- 2. OWNERSHIP & MIGRATION HISTORY TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.__schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.__schema_migrations OWNER TO rc_migrator;
REVOKE ALL ON TABLE public.__schema_migrations FROM PUBLIC, rc_app_user, rc_auth_user;

-- ----------------------------------------------------------------------------
-- 3. DEDICATED ATOMIC RATE LIMITING TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_ip_rate_limits (
  ip_network cidr NOT NULL,
  window_bucket timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  last_request_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pk_auth_ip_rate_limits PRIMARY KEY (ip_network, window_bucket)
);

ALTER TABLE public.auth_ip_rate_limits OWNER TO rc_migrator;
REVOKE ALL ON TABLE public.auth_ip_rate_limits FROM PUBLIC, rc_app_user, rc_auth_user;

CREATE INDEX IF NOT EXISTS idx_auth_ip_rate_limits_window 
  ON public.auth_ip_rate_limits (window_bucket);

-- ----------------------------------------------------------------------------
-- 4. HARDENED AUTHENTICATION CHALLENGES TABLE
-- ----------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_auth_challenges_lookup 
  ON public.auth_challenges (challenge_hash, expires_at) 
  WHERE consumed_at IS NULL;

-- ----------------------------------------------------------------------------
-- 5. ATOMIC RATE LIMITING FUNCTION (CONCURRENCY-SAFE & IPV6 /64 NORMALIZED)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_and_increment_ip_rate_limit(
  p_client_ip inet,
  p_max_requests integer DEFAULT 30,
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

-- ----------------------------------------------------------------------------
-- 6. CHALLENGE ISSUANCE FUNCTION
-- ----------------------------------------------------------------------------
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

  v_allowed := public.check_and_increment_ip_rate_limit(p_client_ip, 30, interval '1 minute');
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

-- ----------------------------------------------------------------------------
-- 7. CHALLENGE VERIFICATION & MEMBERSHIP RESOLUTION FUNCTION
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 8. COMPREHENSIVE SCHEMA DRIFT PROBE (13 GATES — FAIL CLOSED)
-- ----------------------------------------------------------------------------
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
  -- GATE 1: Table Count
  SELECT count(*) INTO v_table_count 
    FROM information_schema.tables 
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  IF v_table_count < 20 THEN
    RAISE EXCEPTION 'GATE 1 FAILED: Expected tables, found %', v_table_count USING ERRCODE = 'P0006';
  END IF;

  -- GATE 2: RLS Enabled
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

  -- GATE 3: FORCE RLS
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

  -- GATE 5: users table unauthorized writes
  SELECT count(*) INTO v_unauthorized_user_grants
    FROM information_schema.role_column_grants
   WHERE grantee = 'rc_app_user'
     AND table_name = 'users'
     AND (privilege_type IN ('INSERT', 'DELETE')
          OR (privilege_type = 'UPDATE' AND column_name IN ('id', 'email', 'password_hash')));
  IF v_unauthorized_user_grants > 0 THEN
    RAISE EXCEPTION 'GATE 5 FAILED: rc_app_user has illegal column privileges on users table' USING ERRCODE = 'P0010';
  END IF;

  -- GATE 6: auth_challenges isolation
  SELECT count(*) INTO v_unauthorized_challenge_grants
    FROM information_schema.table_privileges
   WHERE table_name = 'auth_challenges'
     AND grantee IN ('rc_app_user', 'rc_auth_user', 'PUBLIC');
  IF v_unauthorized_challenge_grants > 0 THEN
    RAISE EXCEPTION 'GATE 6 FAILED: Direct grants found on auth_challenges table' USING ERRCODE = 'P0011';
  END IF;

  -- GATE 7: routine isolation
  SELECT count(*) INTO v_unauthorized_routine_grants
    FROM information_schema.routine_privileges
   WHERE routine_name IN ('create_auth_challenge_entry', 'verify_challenge_and_get_memberships', 'check_and_increment_ip_rate_limit')
     AND grantee IN ('rc_app_user', 'PUBLIC');
  IF v_unauthorized_routine_grants > 0 THEN
    RAISE EXCEPTION 'GATE 7 FAILED: rc_app_user or PUBLIC possesses EXECUTE on sensitive auth functions' USING ERRCODE = 'P0012';
  END IF;

  -- GATE 8: search_path hardening
  SELECT count(*) INTO v_invalid_secdef_paths
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef IS TRUE
     AND (p.proconfig IS NULL OR NOT ('search_path=pg_catalog, public' = ANY(p.proconfig)));
  IF v_invalid_secdef_paths > 0 THEN
    RAISE EXCEPTION 'GATE 8 FAILED: % SECURITY DEFINER functions lack search_path=pg_catalog, public', v_invalid_secdef_paths USING ERRCODE = 'P0013';
  END IF;

  -- GATE 9: role attributes
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

-- ----------------------------------------------------------------------------
-- 9. ENABLE & FORCE RLS ON ALL PUBLIC TABLES & MIGRATOR ADMIN POLICIES
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 10. DIRECT TENANT POLICIES (FOR ALL DIRECT TABLES)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  tbl_name text;
  direct_tables text[] := ARRAY[
    'user_memberships', 'devices', 'branches', 'legal_entities',
    'tenant_subscriptions', 'tenant_industry_packs',
    'sales_orders', 'payments', 'pos_shifts',
    'warehouses', 'inventory_items', 'stock_transactions',
    'purchase_orders', 'suppliers', 'recipe_headers',
    'tables', 'floor_plans', 'reservations', 'printers',
    'kitchen_stations', 'delivery_zones', 'driver_dispatches',
    'accounts', 'journal_entries', 'tax_configs', 'tax_records',
    'fiscal_periods', 'billing_invoices', 'categories', 'items',
    'price_lists', 'units_of_measure', 'item_allergens'
  ];
BEGIN
  FOREACH tbl_name IN ARRAY direct_tables LOOP
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl_name) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl_name || '_tenant_isolation', tbl_name);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO rc_app_user USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid);', tbl_name || '_tenant_isolation', tbl_name);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO rc_app_user;', tbl_name);
    END IF;
  END LOOP;
END $$;

-- Special Policies: tenants & roles
DROP POLICY IF EXISTS tenants_isolation ON public.tenants;
CREATE POLICY tenants_isolation ON public.tenants FOR ALL TO rc_app_user
  USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT ON public.tenants TO rc_app_user;

DROP POLICY IF EXISTS roles_isolation ON public.roles;
CREATE POLICY roles_isolation ON public.roles FOR ALL TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid OR is_system_role = true);
GRANT SELECT ON public.roles TO rc_app_user;

-- Special Policy: users table (Restricted to same active tenant members)
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

-- ----------------------------------------------------------------------------
-- 11. CHILD TABLES POLICIES (EXISTS DAG POLICIES)
-- ----------------------------------------------------------------------------
-- order_lines -> sales_orders
DROP POLICY IF EXISTS order_lines_isolation ON public.order_lines;
CREATE POLICY order_lines_isolation ON public.order_lines FOR ALL TO rc_app_user
  USING (EXISTS (SELECT 1 FROM public.sales_orders o WHERE o.id = order_lines.order_id AND o.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales_orders o WHERE o.id = order_lines.order_id AND o.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_lines TO rc_app_user;
