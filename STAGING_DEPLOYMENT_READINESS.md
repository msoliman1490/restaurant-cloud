# Restaurant Cloud — Remote Staging Deployment Readiness

**Date:** 2026-11-16
**Target Environment:** Remote Staging ONLY (Production untouched; ZATCA V1 active / V2 inactive in Production)
**Overall Status:** **UNVERIFIED / BLOCKED ON EXTERNAL CREDENTIALS & CD PIPELINE**

---

## 1. Identified Hosting Architecture & Deployment Target

Based on repository artifacts (`docs/engineering/CLOUDFLARE_DEPLOYMENT_ARCHITECTURE.md`, `apps/web/functions/api/[[catchall]].ts`, `apps/api/Dockerfile`, `packages/database/scripts/provision-staging-vps.sh`):

1. **Frontend (`apps/web`):**
   - **Target:** Cloudflare Pages SPA (`pnpm run build`, output directory `dist`).
   - **API Proxy:** `apps/web/functions/api/[[catchall]].ts` forwards `/api/*` requests to `env.BACKEND_ORIGIN_URL` (preserving `Authorization`, `Cookie`, `Content-Type`, same-origin policy).
2. **Backend (`apps/api`):**
   - **Target:** Containerized NestJS + Fastify service (`apps/api/Dockerfile`, `node:22-alpine`, port `4000`, Docker `HEALTHCHECK` on `/health/liveness`).
3. **Database (`Staging PostgreSQL 16`):**
   - **Host:** Provisioned on Staging VPS (`187.124.178.49`, Docker container / internal `172.16.1.22:5432`, database `restaurant_cloud_staging`).
   - **Current Access:** Reachable locally only via restricted DB tunnel user `rc_agent@187.124.178.49` (`127.0.0.1:15432`), which has **no** shell or app deployment privileges (`This account is currently not available.`).

---

## 2. Intended CI/CD Deployment Mechanism vs Current State

- **Current `.github/workflows/`:** Contains only `gate1-ci.yml` (PostgreSQL 16 integration & security verification). There is **no** CD deployment workflow for Staging or Production.
- **Current Local CLI/Auth State:**
  - `gh` CLI: not installed.
  - `wrangler` CLI: not installed.
  - `CLOUDFLARE_*`, `STAGING_*`, `DEPLOY_*`, `GITHUB_*`, `BACKEND_ORIGIN_URL`: not present in environment or `.env`.
  - Uncommitted local changes: `194` entries (`72` modified, `122` untracked) on `feature/restaurant-cloud-foundation`.

---

## 3. Exact Missing Credentials & Permissions

To execute remote Staging deployment safely without bypassing restricted tunnel permissions, the following must be provided in GitHub Actions Secrets / authorized deployment runner:
1. **Git Push / PR Authorization:** Commit and push `feature/restaurant-cloud-foundation` (excluding build/test artifacts such as `playwright-report/`).
2. **Cloudflare Pages Credentials:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, Staging Pages project name, and `BACKEND_ORIGIN_URL` configured in Cloudflare Pages Staging environment variables.
3. **Backend Container / Host Credentials:** Container registry credentials (e.g., GHCR / Docker Hub) and authorized Staging host deploy key (`STAGING_DEPLOY_SSH_KEY`, **not** `rc_agent`) or PaaS deploy token, plus Staging runtime env vars (`DATABASE_URL`, `JWT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `NODE_ENV=staging`).

---

## 4. Proposed Safe Staging Deployment Workflow (With Rollback & Health Checks)

```yaml
# Proposed: .github/workflows/deploy-staging.yml (Staging ONLY, manual/branch trigger)
# 1. Pre-flight: pnpm install --frozen-lockfile && pnpm build && run migration parity check
# 2. DB Migrations (Staging only): run Drizzle migrations 0000..0029 against MIGRATIONS_DATABASE_URL
# 3. Backend Deploy:
#    - Build & tag Docker image with ${{ github.sha }}
#    - Keep previous image tag (${{ env.PREVIOUS_TAG }}) for instant rollback
#    - Start new container on port 4000, wait up to 30s for:
#      curl -fsS http://127.0.0.1:4000/api/v1/health/readiness
#    - If readiness fails: automatically restart ${{ env.PREVIOUS_TAG }} and fail job
# 4. Frontend Deploy (Cloudflare Pages):
#    - wrangler pages deploy apps/web/dist --project-name=restaurant-cloud-staging --branch=staging
#    - Verify served index.html has Cache-Control: no-cache and zero /api/v1/api/v1 strings
# 5. Post-Deploy Smoke Check:
#    - GET https://<staging-domain>/api/v1/health/readiness -> HTTP 200
#    - POST https://<staging-domain>/api/v1/auth/login -> HTTP 201
#    - GET https://<staging-domain>/api/v1/legal-entities -> HTTP 200
```

**Classification:** **UNVERIFIED** (Proposal ready; execution blocked pending authorized CI/CD secrets and user approval to commit/push).
