-- ==============================================================================
-- Part 1: Roles Setup & Production Database Isolation
-- Target Server: PostgreSQL 18.6
-- Target DB: Run against 'postgres' or default database (psql -d postgres)
-- Execution: Run ONCE as 'postgres' superuser via psql (NO \connect used)
-- Policy: Strictly Idempotent, Zero Passwords in Code
-- ==============================================================================

-- 1. Create or Harden Application Runtime Role (rc_app_user)
-- Password is set interactively in psql via: \password rc_app_user
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_app_user') THEN
    CREATE ROLE rc_app_user WITH LOGIN 
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE rc_app_user WITH 
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- 2. Enforce Strict Production Isolation (restaurant_cloud)
-- Revoke PUBLIC connection to prevent unprivileged roles from connecting
REVOKE CONNECT ON DATABASE restaurant_cloud FROM PUBLIC;

-- Preserve administrator access to production database
GRANT CONNECT ON DATABASE restaurant_cloud TO postgres;

-- Explicit defense-in-depth revokes for project roles
REVOKE CONNECT ON DATABASE restaurant_cloud FROM rc_migrator, rc_app_user;

-- 3. Configure Staging Database Connection Grants
GRANT CONNECT ON DATABASE restaurant_cloud_staging TO rc_migrator;
GRANT CONNECT ON DATABASE restaurant_cloud_staging TO rc_app_user;

-- 4. Audit & Verification Query
SELECT 
  datname as database_name, 
  pg_catalog.pg_get_userbyid(datdba) as database_owner,
  has_database_privilege('rc_migrator', datname, 'CONNECT') as migrator_can_connect,
  has_database_privilege('rc_app_user', datname, 'CONNECT') as app_user_can_connect
FROM pg_database 
WHERE datname IN ('restaurant_cloud', 'restaurant_cloud_staging');
