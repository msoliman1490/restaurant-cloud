# Restaurant Cloud — Clean Database Reproducibility Audit

**Date:** 2026-11-16
**Mode:** Read-only audit (zero migrations applied, zero DB modifications)
**Verdict:** **PASS (with documented `rc_app_user` role bootstrap prerequisite)**

---

## 1. Fresh Database vs Staging Schema Comparison

| Check | Fresh DB (0000–0029) | Staging DB (`127.0.0.1:15432`) | Status |
|---|---|---|---|
| **Drizzle Schema Tables** | `125` tables created by `0000`–`0029` | `127` tables (`125` minus `public` token + `__drizzle_migrations` + legacy `item_barcodes`, `media_files`) | **PASS** (100% of Drizzle-schema tables covered by `0000`–`0029`) |
| **Migrations Applied (`__drizzle_migrations`)** | `30` (`0000`–`0029`) | `30` rows in `public.__drizzle_migrations` | **PASS** |
| **Functions & Triggers** | `prevent_audit_log_modification()` + `trg_prevent_audit_log_modification` on `audit_logs` | `prevent_audit_log_modification` + `trg_prevent_audit_log_modification` on `audit_logs` | **PASS** |
| **Extensions** | Built-in `plpgsql` (`gen_random_uuid()` used) | `plpgsql` (`1.0`) | **PASS** |
| **Database Roles** | **Not created by `0000`–`0029`** (`rc_app_user` required by `0004+`) | `postgres`, `rc_migrator`, `rc_app_user` | **PREREQUISITE** (Must run role bootstrap before `0004`) |
| **Legacy Tables in Staging Only** | Not created | `item_barcodes`, `media_files` (neither exists in `packages/database/src/schema/` or runtime services; media uses `media_objects` from `0003`) | **INFO** (Non-blocking legacy artifacts) |

---

## 2. Clean Environment Reproducibility Procedure

1. **Clone & Checkout Approved Baseline (after commit):**
   ```bash
   git clone https://github.com/msoliman1490/restaurant-cloud.git restaurant-cloud-clean
   cd restaurant-cloud-clean
   git checkout <approved-commit-sha>
   ```
2. **Install Dependencies Strictly from Lockfile:**
   ```bash
   pnpm install --frozen-lockfile
   ```
3. **Build All Workspace Packages:**
   ```bash
   pnpm --filter @restaurant-cloud/domain-kernel build
   pnpm --filter @restaurant-cloud/shared-contracts build
   pnpm --filter @restaurant-cloud/database build
   pnpm --filter @restaurant-cloud/api build
   pnpm --filter @restaurant-cloud/web build
   ```
4. **Provision Clean PostgreSQL 16 Database & Roles (`rc_app_user`, `rc_migrator`):**
   - Run `packages/database/scripts/provision-staging-vps.sh` (or create `rc_app_user` with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS` and `rc_migrator` before applying migrations).
   - Configure `.env` with `DATABASE_URL` (`rc_app_user`), `MIGRATIONS_DATABASE_URL` (`rc_migrator`/owner), `JWT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, and `NODE_ENV=staging`.
5. **Apply Migrations `0000`–`0029` in Exact Order:**
   - Apply `packages/database/drizzle/0000_*.sql` through `0029_purchase_requests_parity.sql` sequentially using `MIGRATIONS_DATABASE_URL` and record hashes in `public.__drizzle_migrations`.
6. **Start API & Web & Run Verification:**
   ```bash
   pnpm --filter @restaurant-cloud/api start
   pnpm --filter @restaurant-cloud/web dev   # or serve apps/web/dist
   curl -fsS http://127.0.0.1:4000/api/v1/health/readiness
   pnpm --filter @restaurant-cloud/api exec vitest run test/api-legal-entity-validation.spec.ts test/offline-pos-sync.spec.ts test/pos-printing-returns.spec.ts test/purchasing-requests.spec.ts
   ```
