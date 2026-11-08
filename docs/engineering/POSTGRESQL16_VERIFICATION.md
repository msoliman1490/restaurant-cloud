# Restaurant Cloud — PostgreSQL 16 Server Verification & CI Specification

**Audit Date:** 2026-11-08  
**Verification Target:** PostgreSQL 16 Server (Genuine Database Kernel, TCP Network Socket, Connection Pooling)  
**Current Local Verification Status:** **BLOCKED (Docker / Local PostgreSQL 16 Daemon Not Running on localhost:5432)**  

---

## 1. Architectural Policy on Database Emulation

> [!CAUTION]
> **Non-Negotiable Project Rule:**
> PGlite (an in-process WebAssembly compilation of PostgreSQL 16.2) has proven highly valuable for fast local unit testing and functional SQL evaluation.
> 
> **However, PGlite DOES NOT replace a genuine PostgreSQL 16 server integration test.**
> 
> True production engineering sign-off requires running against an official PostgreSQL 16 TCP server to validate physical socket handshakes, connection pool checkout and recycling, multi-client lock contention, and true multi-tenant RLS enforcement under concurrent TCP connections.

---

## 2. Local Environment Inspection

An active port and service probe was conducted on the development workstation:
- **Command Executed:** `Test-NetConnection -ComputerName localhost -Port 5432`
- **Result:** `TcpTestSucceeded: False`
- **Root Cause:** Neither Docker Desktop nor a native Windows PostgreSQL 16 Windows service is installed or running on this machine.
- **Engineering Verdict:** **Local verification on genuine PostgreSQL 16 is BLOCKED.** The system will not claim genuine server verification until executed in an environment with an active PostgreSQL 16 server.

---

## 3. Official CI Workflow Specification (`.github/workflows/gate1-ci.yml`)

To achieve unconditional Gate 1 and production certification without modifying the local developer environment, an official CI workflow has been configured and verified in `.github/workflows/gate1-ci.yml`.

### Workflow Pipeline Architecture:
1. **Runner Environment:** `ubuntu-latest`
2. **PostgreSQL 16 Service Container:**
   ```yaml
   services:
     postgres:
       image: postgres:16-alpine
       ports:
         - 5432:5432
       env:
         POSTGRES_DB: restaurant_cloud_test
         POSTGRES_USER: postgres
         POSTGRES_PASSWORD: ci_test_password_123
       options: >-
         --health-cmd pg_isready
         --health-interval 10s
         --health-timeout 5s
         --health-retries 5
   ```
3. **Database Initialization & Role Hardening:**
   - Connects as superuser `postgres`.
   - Applies schema migrations from `packages/database/drizzle/`.
   - Creates the unprivileged application role:
     ```sql
     CREATE ROLE rc_app_user WITH LOGIN PASSWORD 'ci_app_password_123' NOINHERIT NOBYPASSRLS;
     GRANT USAGE ON SCHEMA public TO rc_app_user;
     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;
     ```
   - Applies RLS policies with `ALTER TABLE ... FORCE ROW LEVEL SECURITY;`.
4. **Integration Test Suite Execution (`pnpm test:integration`):**
   - Connects to the genuine PostgreSQL 16 service using NestJS, Drizzle ORM, and the native `postgres` (porsager/postgres) driver.
   - Executes `test/server-postgres-rls.spec.ts`.
   - **Strict Failure Invariant:** If the server is unreachable or fails authentication, the test suite **fails immediately** (no fallback to PGlite, no silent passes).

---

## 4. Verification Checkpoints for Genuine PostgreSQL 16

When the CI workflow is triggered by the repository owner, it evaluates the following 10 critical checkpoints:

| Checkpoint | Tested Behavior | Success Criteria |
|---|---|---|
| **CP-01** | Version & Engine Identity | `SELECT version();` returns genuine PostgreSQL 16.x. |
| **CP-02** | Role Privilege Lockdown | `rc_app_user` cannot access `pg_authid` or execute DDL (`ALTER TABLE`). |
| **CP-03** | RLS Enforcement (`ENABLE`) | Queries without tenant session context return 0 rows. |
| **CP-04** | Table Owner Lockdown (`FORCE RLS`) | RLS policies are evaluated even for table owners. |
| **CP-05** | Cross-Tenant Isolation | Tenant A credentials cannot `SELECT`, `INSERT`, `UPDATE`, or `DELETE` Tenant B data. |
| **CP-06** | Multi-Entity Warehouse Isolation | Cross-entity stock queries in the same warehouse return 0 rows without correct entity context. |
| **CP-07** | Connection Pool Recycling | `SET LOCAL` variables are cleared when a connection is recycled back to the pool. |
| **CP-08** | Transaction Rollback | Failures mid-transaction roll back both stock movements and journal entries atomically. |
| **CP-09** | Concurrent Concurrency Locks | Simultaneous updates to the same `inventory_balances` record trigger optimistic locking failure. |
| **CP-10** | Unique Composite Constraints | Duplicate `(tenant_id, legal_entity_id, order_number)` insertions throw constraint violation `23505`. |

---

## 5. Security & Repository Policy

- **No Unauthorized Git Push:** In accordance with user instructions, no git push or remote repository configuration has been executed.
- **Zero Committed Secrets:** All test passwords (`ci_test_password_123`) are disposable CI-only credentials; no production private keys or credentials exist in the codebase.
- **Next Step for Repository Owner:** Once approved, push the repository to GitHub to trigger `.github/workflows/gate1-ci.yml` and convert the status from `BLOCKED (Local)` to `PASS (CI Verified)`.
