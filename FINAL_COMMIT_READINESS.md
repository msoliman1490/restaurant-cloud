# Restaurant Cloud — Final Commit Readiness & Deployment Safety Report

**Date:** 2026-11-16
**Branch:** `feature/restaurant-cloud-foundation` (Base `HEAD`: `6ce535c4a9cfbab317d4c4fa41896e3b7e7e5005`)
**Overall Verdict:** **PASS for Clean Repository Baseline & Staging Reproducibility** | **BLOCKED on Remote Deploy until Commit/Push Authorization & CI/CD Credentials**

---

## 1. Review of the 30 "Pre-Existing" Files

All 30 files previously tagged as `Unrelated/pre-existing change` in `BATCH2_REPOSITORY_CHANGE_INVENTORY.md` were audited:
- **`apps/api/src/modules/hr/*` (3 files):** **REQUIRED RUNTIME DEPENDENCY.** Imported by `AppModule`; provides HR employees, attendance, documents, advances, and custody endpoints. Must be committed.
- **`apps/api/src/modules/zatca/*` (7 files):** **REQUIRED RUNTIME DEPENDENCY.** Imported by `AppModule`; provides ZATCA Phase 2 (V2) Staging simulation engine (remains inactive in Production). Must be committed.
- **`packages/database/drizzle/0008_*.sql` through `0027_*.sql` (20 files):** **REQUIRED DATABASE BASELINE.** Required sequentially between committed `0007` and Batch 2 `0028`/`0029`. Without them, `0028` and `0029` fail and Staging schema cannot be reproduced. Must be committed.
- **Obsolete files among the 30:** **0**.

---

## 2. Explicit Review of Scripts, Temp Files & Test Artifacts

| File / Directory | Purpose | Commit Action |
|---|---|---|
| `packages/database/scripts/temp-query.cjs` | Ad-hoc local SQL debug script querying `tenants` / `chart_of_accounts` | **EXCLUDE** (temporary debug script; add to `.gitignore` or remove only upon explicit user authorization) |
| `scratch/*.cjs` (8 files) | Historical phase migration/verification scratch scripts (`apply_migration_0012..0014`, `verify_*`) | **EXCLUDE** (temporary scratch scripts; not imported by runtime or tests) |
| `test-results/.last-run.json` & `playwright-report/` | Generated Playwright test execution output | **EXCLUDE** (generated artifacts; ensure ignored in `.gitignore`) |
| `scripts/zatca-simulation-onboard.mjs` | Phase 3.7 resumable ZATCA Simulation onboarding CLI (reads `.zatca-secrets/`, Staging only, dry-run unless `--execute`) | **INCLUDE** (valid operational tooling; contains 0 secrets) |
| `packages/database/scripts/apply-migration-0008.cjs`, `0009.cjs`, `seed-*.cjs`, `audit-vault-permissions.cjs` | Database migration/permission seeding & audit helpers | **INCLUDE** (useful operational/seeding scripts; contain 0 production secrets) |

---

## 3. Exact Git Baseline & Deployment/Rollback Dependency Map

### Must Be Committed Together for Reproducibility
1. **Database Layer:** `packages/database/src/schema/*`, `packages/database/drizzle/0008_*.sql`–`0029_*.sql`, `packages/database/drizzle/meta/_journal.json` & snapshots, `packages/database/scripts/provision-staging-vps.sh` & seed scripts.
2. **Backend (`apps/api`):** All modified/new modules (`sales`, `purchasing`, `delivery`, `accounting`, `tenant`, `iam`, `hr`, `zatca`, `common/guards/tenant-context.guard.ts`, `common/pipes/legal-entity-id.pipe.ts`, `app.controller.ts`), plus `apps/api/test/*` regression suites.
3. **Frontend (`apps/web`) & Config:** `apps/web/src/*`, `apps/web/e2e/batch2-staging.spec.ts`, `playwright.config.ts`, `package.json`, `pnpm-lock.yaml`, `.gitignore`.
4. **Documentation:** `RESTAURANT_CLOUD_*.md`, `BATCH2_REPOSITORY_CHANGE_INVENTORY.md`, `STAGING_DEPLOYMENT_READINESS.md`, `CLEAN_DATABASE_REPRODUCIBILITY_AUDIT.md`, `MIGRATION_DEPENDENCY_MATRIX.md`, `FINAL_COMMIT_READINESS.md`.

### Must Be Excluded from Commit
- `packages/database/scripts/temp-query.cjs`, `scratch/*.cjs`, `test-results/`, `playwright-report/`, `.env`, `.zatca-secrets/`.

### Deployment & Rollback Dependency Map
1. **Step 1 — Pre-Migration Snapshot:** Take `pg_dump` snapshot of `restaurant_cloud_staging` before applying any new migrations.
2. **Step 2 — Database Migrations:** Apply `0000`–`0029` (idempotent `IF NOT EXISTS` on `0028` & `0029`). *Rollback:* Restore `pg_dump` if schema rollback is required.
3. **Step 3 — Backend (`apps/api`):** Build & deploy container tagged with `<commit-sha>`; verify `GET /api/v1/health/readiness` -> `200`. *Rollback:* Re-point container to `<previous-tag>`.
4. **Step 4 — Frontend (`apps/web`):** Deploy `apps/web/dist` to Cloudflare Pages with `BACKEND_ORIGIN_URL` pointing to Staging API; verify `Cache-Control: no-cache` on `index.html`. *Rollback:* Cloudflare Pages instant rollback to previous deployment ID.

---

## 4. Final Verdict

- **Clean Repository Baseline & Migration Completeness:** **PASS** (All 30 migrations `0000`–`0029` verified sequential, 0 secret hits, all 30 pre-existing files confirmed as required runtime/migration dependencies, and excluded temp/generated artifacts explicitly identified).
- **Remote Staging Push & Deploy Execution:** **BLOCKED** (Awaiting explicit user authorization to commit/push and CI/CD credentials for Cloudflare Pages / Staging host).
