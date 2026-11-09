-- ==============================================================================
-- Restaurant Cloud — Database Administration: Hardened Role Setup & Production Isolation
-- Database: restaurant_cloud_staging & restaurant_cloud
-- Target Server: PostgreSQL 18.6
-- Execution Mode: Strictly Idempotent — Run ONCE as 'postgres' superuser via psql
-- Security Policy: Zero Passwords in Code, Least-Privilege DML, No Blanket EXECUTE
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Create or Harden Application Runtime Role (rc_app_user)
-- ------------------------------------------------------------------------------
-- Password is NOT set in this script to prevent credential exposure in files/logs.
-- Set password securely in psql after execution via: \password rc_app_user
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_app_user') THEN
    CREATE ROLE rc_app_user WITH LOGIN 
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE rc_app_user WITH 
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Enforce Strict Production Isolation (restaurant_cloud)
-- ------------------------------------------------------------------------------
-- Revoke PUBLIC connect privilege so unprivileged roles cannot connect to production
REVOKE CONNECT ON DATABASE restaurant_cloud FROM PUBLIC;

-- Preserve administrator access to production database
GRANT CONNECT ON DATABASE restaurant_cloud TO postgres;

-- Explicit defense-in-depth revokes for project roles
REVOKE CONNECT ON DATABASE restaurant_cloud FROM rc_migrator, rc_app_user;

-- ------------------------------------------------------------------------------
-- 3. Configure Staging Database Access & Object Privileges (restaurant_cloud_staging)
-- ------------------------------------------------------------------------------
GRANT CONNECT ON DATABASE restaurant_cloud_staging TO rc_migrator;
GRANT CONNECT ON DATABASE restaurant_cloud_staging TO rc_app_user;

-- Switch session to the staging database
\connect restaurant_cloud_staging

-- Grant schema resolution (USAGE only, strictly NO CREATE/DDL privileges for rc_app_user)
GRANT USAGE ON SCHEMA public TO rc_migrator;
GRANT USAGE ON SCHEMA public TO rc_app_user;

-- Ensure schema owner is strictly rc_migrator (DDL executor)
ALTER SCHEMA public OWNER TO rc_migrator;

-- Grant least-privilege DML on existing tables/sequences (if any)
-- Strictly NO TRUNCATE, NO DDL, NO blanket EXECUTE
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rc_app_user;

-- Configure DEFAULT privileges for FUTURE tables & sequences created by rc_migrator:
ALTER DEFAULT PRIVILEGES FOR ROLE rc_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rc_app_user;

ALTER DEFAULT PRIVILEGES FOR ROLE rc_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO rc_app_user;

-- NOTE: Blanket EXECUTE on routines is deliberately REMOVED for zero-trust security.
-- Application-facing functions will be granted individually by explicit migrations.

-- ------------------------------------------------------------------------------
-- 4. Audit & Verification Query
-- ------------------------------------------------------------------------------
SELECT 
  datname as database_name, 
  pg_catalog.pg_get_userbyid(datdba) as database_owner,
  has_database_privilege('rc_migrator', datname, 'CONNECT') as migrator_can_connect,
  has_database_privilege('rc_app_user', datname, 'CONNECT') as app_user_can_connect
FROM pg_database 
WHERE datname IN ('restaurant_cloud', 'restaurant_cloud_staging');
