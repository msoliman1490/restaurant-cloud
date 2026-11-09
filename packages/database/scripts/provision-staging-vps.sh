#!/usr/bin/env bash
# ==============================================================================
# RESTAURANT CLOUD — STAGING ENVIRONMENT AUTOMATED PROVISIONING SCRIPT
# TARGET: Staging VPS (<STAGING_VPS_IP>)
# SAFE FOR EXECUTION: ZERO-TOUCH, STRICTLY TARGETS restaurant_cloud_staging ONLY
# PRESERVES ALL OTHER CONTAINERS (Maleem, Supabase, Chatwoot, Coolify)
# ==============================================================================
set -euo pipefail

echo "======================================================================"
echo ">>> STARTING RESTAURANT CLOUD STAGING PROVISIONING (REVISION 3.5) <<<"
echo "======================================================================"

# 1. Identify Target PostgreSQL Container for Restaurant Cloud
TARGET_CONTAINER=$(docker ps --filter "name=postgres" --filter "name=restaurant" --format "{{.Names}}" | head -n 1)

if [ -z "$TARGET_CONTAINER" ]; then
  # Fallback to general postgres container if project container has specific ID
  TARGET_CONTAINER=$(docker ps --filter "ancestor=postgres" --format "{{.Names}}" | grep -v -E "supabase|chatwoot|maleem" | head -n 1 || true)
fi

if [ -z "$TARGET_CONTAINER" ]; then
  echo "[ERROR] Could not automatically locate the Restaurant Cloud PostgreSQL container!"
  echo "Please specify the container name manually: export TARGET_CONTAINER=<name>"
  exit 1
fi

echo "[INFO] Using Container: $TARGET_CONTAINER"
echo "[INFO] Verifying container engine version..."
docker exec -i "$TARGET_CONTAINER" psql -U postgres -c "SELECT version();"

# 2. Check and Backup if restaurant_cloud_staging already exists
STAGING_EXISTS=$(docker exec -i "$TARGET_CONTAINER" psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='restaurant_cloud_staging';" || true)

if [ "$STAGING_EXISTS" = "1" ]; then
  BACKUP_FILE="/tmp/restaurant_cloud_staging_backup_$(date +%Y%m%d%H%M%S).dump"
  echo "[INFO] Existing staging DB detected. Creating safety snapshot at $BACKUP_FILE..."
  docker exec -i "$TARGET_CONTAINER" pg_dump -U postgres -d restaurant_cloud_staging -Fc > "$BACKUP_FILE"
  echo "[SUCCESS] Safety backup created: $BACKUP_FILE"
else
  echo "[INFO] Creating clean staging database 'restaurant_cloud_staging'..."
  docker exec -i "$TARGET_CONTAINER" psql -U postgres -c "CREATE DATABASE restaurant_cloud_staging ENCODING 'UTF8';"
fi

# 3. Create Hardened Roles (Strictly NOINHERIT for rc_app_user)
MIGRATOR_PASS="rc_migrator_staging_secure_$(openssl rand -hex 16)"
APP_USER_PASS="rc_app_user_staging_secure_$(openssl rand -hex 16)"
AUTH_USER_PASS="rc_auth_user_staging_secure_$(openssl rand -hex 16)"

echo "[INFO] Configuring roles with strict NOINHERIT & NOBYPASSRLS..."
docker exec -i "$TARGET_CONTAINER" psql -U postgres -d restaurant_cloud_staging -c "
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_migrator') THEN
    CREATE ROLE rc_migrator WITH LOGIN PASSWORD '$MIGRATOR_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE rc_migrator WITH LOGIN PASSWORD '$MIGRATOR_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_app_user') THEN
    CREATE ROLE rc_app_user WITH LOGIN PASSWORD '$APP_USER_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE rc_app_user WITH LOGIN PASSWORD '$APP_USER_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rc_auth_user') THEN
    CREATE ROLE rc_auth_user WITH LOGIN PASSWORD '$AUTH_USER_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    ALTER ROLE rc_auth_user WITH LOGIN PASSWORD '$AUTH_USER_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END \$\$;
"

# 4. Apply Sequential Migrations (0000, 0001, 0002)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "[INFO] Applying 0000_kind_luckman.sql..."
docker exec -i "$TARGET_CONTAINER" psql -U postgres -d restaurant_cloud_staging -v ON_ERROR_STOP=1 < "$REPO_ROOT/packages/database/drizzle/0000_kind_luckman.sql"

echo "[INFO] Applying 0001_common_mordo.sql..."
docker exec -i "$TARGET_CONTAINER" psql -U postgres -d restaurant_cloud_staging -v ON_ERROR_STOP=1 < "$REPO_ROOT/packages/database/drizzle/0001_common_mordo.sql"

echo "[INFO] Applying 0002_multi_industry_saas.sql..."
docker exec -i "$TARGET_CONTAINER" psql -U postgres -d restaurant_cloud_staging -v ON_ERROR_STOP=1 < "$REPO_ROOT/packages/database/drizzle/0002_multi_industry_saas.sql"

# 5. Apply Security Hardening Script (v3.5)
echo "[INFO] Applying Revision 3.5 Security Hardening and RLS Policies..."
docker exec -i "$TARGET_CONTAINER" psql -U postgres -d restaurant_cloud_staging -v ON_ERROR_STOP=1 < "$REPO_ROOT/packages/database/src/security-hardening-v35.sql"

# 6. Run Schema Drift Probe Verification
echo "[INFO] Running 13-Gate Exhaustive Schema Drift Probe..."
docker exec -i "$TARGET_CONTAINER" psql -U postgres -d restaurant_cloud_staging -v ON_ERROR_STOP=1 -c "
  SELECT public.run_exhaustive_schema_drift_probe();
"

# 7. Verify Role Properties & Non-Superuser Execution
echo "[INFO] Auditing Final Role Security Properties..."
docker exec -i "$TARGET_CONTAINER" psql -U postgres -d restaurant_cloud_staging -c "
  SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb 
  FROM pg_roles 
  WHERE rolname IN ('rc_migrator', 'rc_app_user', 'rc_auth_user');
"

# 8. Test NestJS Connection as rc_app_user
echo "[INFO] Testing application connection as rc_app_user..."
PGPASSWORD="$APP_USER_PASS" docker exec -i "$TARGET_CONTAINER" psql -U rc_app_user -d restaurant_cloud_staging -c "
  SELECT current_user, current_database(), session_user;
"

echo "======================================================================"
echo "[SUCCESS] STAGING PROVISIONING COMPLETED SUCCESSFULLY!"
echo "Database: restaurant_cloud_staging"
echo "Container: $TARGET_CONTAINER"
echo "Runtime Connection String:"
echo "DATABASE_URL=postgresql://rc_app_user:$APP_USER_PASS@127.0.0.1:5432/restaurant_cloud_staging"
echo "======================================================================"
