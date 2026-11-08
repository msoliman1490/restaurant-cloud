# Restaurant Cloud — GitHub Actions CI Setup & Activation Guide

**Guide Date:** 2026-11-08  
**Target:** Project Owner & DevOps Lead  
**Pipeline File:** [`.github/workflows/gate1-ci.yml`](file:///d:/Antigravity/pos/.github/workflows/gate1-ci.yml)  

---

## 1. Safety & Compliance Statement

> [!IMPORTANT]
> **Strict Adherence to Git Governance Rules:**
> - The AI Assistant has **NOT** created a GitHub repository.
> - The AI Assistant has **NOT** configured a git remote.
> - The AI Assistant has **NOT** performed a git push or modified repository credentials.
> - All configuration files and test suites have been prepared locally in your workspace for your manual review and activation.

---

## 2. Pre-Flight Verification Checklist

Before pushing to GitHub, verify that your local workspace meets all prerequisites:

1. **Clean Monorepo Build:**
   ```powershell
   pnpm turbo run build typecheck
   ```
   *Expected outcome: 14 successful tasks across 7 workspace packages.*
2. **Local Test Suite:**
   ```powershell
   pnpm --filter @restaurant-cloud/api test:local
   ```
   *Expected outcome: 8 test files passed, 74 tests passing (100% success rate).*
3. **Absence of Production Secrets:**
   - The CI configuration uses disposable, container-internal passwords (`rc_admin_ci_disposable_2026` and `rc_app_user_ci_disposable_2026`).
   - `.env` files are excluded via `.gitignore`.
   - No production private keys, taxpayer certificates, or real customer credentials are committed.

---

## 3. Step-by-Step Activation Instructions

Follow these exact steps to connect your repository and trigger the automated PostgreSQL 16 verification gate:

### Step 1: Create a Private GitHub Repository
1. Log into your GitHub account.
2. Click **New Repository**.
3. Name the repository: `restaurant-cloud` (or your preferred name).
4. Set visibility to **Private**.
5. **Do NOT** initialize with a README, .gitignore, or license (these already exist locally).

### Step 2: Configure the Remote & Push Branch
Open PowerShell in `d:\Antigravity\pos` and execute:

```powershell
# 1. Stage all prepared files and commit
git add .
git commit -m "feat(ci): complete PostgreSQL 16 CI pipeline, RLS security, and financial hardening"

# 2. Add your GitHub remote repository
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/restaurant-cloud.git

# 3. Set branch to master/main and push
git branch -M master
git push -u origin master
```

---

## 4. What Happens in GitHub Actions

Once pushed, GitHub Actions automatically executes `.github/workflows/gate1-ci.yml`:

```
================================================================================
GITHUB ACTIONS CI PIPELINE EXECUTION
================================================================================
1. Spin up Ubuntu 22.04 Runner
2. Launch official 'postgres:16-alpine' service container on Port 5432
3. Wait for database readiness via pg_isready health checks
4. Install monorepo dependencies (pnpm install --frozen-lockfile)
5. Build and typecheck all 7 packages (turbo run build typecheck)
6. Apply Drizzle migration DDL schemas (0000 -> 0001 -> 0002) from scratch
7. Verify all 32 tables, unique composite constraints, and indexes
8. Apply RLS policies with FORCE ROW LEVEL SECURITY and immutability triggers
9. Validate role properties: rc_app_user (NOSUPERUSER, NOBYPASSRLS)
10. Run 74 local functional & costing tests (PGlite WASM)
11. Run 18 real server integration tests against PostgreSQL 16 TCP socket
12. Output final Markdown Verification Summary to GitHub Actions Step Summary
================================================================================
```

---

## 5. Interpreting Results

- **Green Checkmark (Success):** All 13 checkpoints passed. PostgreSQL 16 integration is verified, and **Gate 1 is FULLY APPROVED**.
- **Viewing the Report:** Navigate to the **Actions** tab in your GitHub repository, click on the latest workflow run, and view the **PostgreSQL 16 CI Gate Verification Summary** table rendered at the bottom of the run page.
