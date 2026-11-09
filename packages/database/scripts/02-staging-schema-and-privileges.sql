-- ==============================================================================
-- Part 2: Staging Database Schema & Default Privileges
-- Target Server: PostgreSQL 18.6
-- Target DB: Run directly against 'restaurant_cloud_staging' (psql -d restaurant_cloud_staging)
-- Execution: Run as 'postgres' (or 'rc_migrator') via psql (NO \connect used)
-- Policy: Least-Privilege DML, No Blanket EXECUTE, Strictly Idempotent
-- ==============================================================================

-- 1. Ensure Schema Ownership & Usage in restaurant_cloud_staging
GRANT USAGE ON SCHEMA public TO rc_migrator;
GRANT USAGE ON SCHEMA public TO rc_app_user;

-- Ensure schema owner is strictly rc_migrator (DDL executor)
ALTER SCHEMA public OWNER TO rc_migrator;

-- 2. Grant Least-Privilege DML on Existing Tables & Sequences (if any)
-- Strictly NO TRUNCATE, NO DDL, NO blanket EXECUTE
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rc_app_user;

-- 3. Configure DEFAULT privileges for FUTURE tables & sequences created by rc_migrator:
ALTER DEFAULT PRIVILEGES FOR ROLE rc_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rc_app_user;

ALTER DEFAULT PRIVILEGES FOR ROLE rc_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO rc_app_user;

-- NOTE: Blanket EXECUTE on routines is deliberately REMOVED for zero-trust security.
-- Application-facing functions will be granted individually by explicit migrations.

-- 4. Audit & Verification Output
SELECT 
  pg_get_userbyid(defaclrole) as grantor,
  defaclnamespace::regnamespace as schema_name,
  CASE defaclobjtype 
    WHEN 'r' THEN 'TABLES'
    WHEN 'S' THEN 'SEQUENCES'
    WHEN 'f' THEN 'FUNCTIONS'
    ELSE defaclobjtype::text 
  END as object_type,
  defaclacl as default_access_privileges
FROM pg_default_acl;
