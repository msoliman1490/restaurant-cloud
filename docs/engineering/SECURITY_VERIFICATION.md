# Restaurant Cloud — Security & Isolation Verification Report

**Audit Date:** 2026-11-08  
**Scope:** Multi-Tenant Isolation, Legal Entity Segregation, Row Level Security (RLS), Role Privileges, and Infrastructure Boundaries  
**Security Standard:** Zero-Trust Database Multi-Tenancy / Saudi Data & AI Authority (SDAIA) / ZATCA Phase 2 Controls  

---

## 1. Multi-Tenant & Legal Entity Isolation Architecture

Restaurant Cloud enforces multi-tenancy and corporate legal entity boundaries at the PostgreSQL kernel level using Row Level Security (RLS). Application code is treated as an untrusted boundary; all data access is mediated through database session variables.

### Row Level Security (RLS) Implementation
- **Tables Enforced:** All 32 operational tables (e.g. `items`, `stock_balances`, `stock_movements`, `inventory_cost_layers`, `sales_orders`, `dining_tables`, `pos_shifts`, `purchase_orders`, `journal_entries`, `journal_entry_lines`, `supplier_balances`, `fiscal_periods`).
- **Policy Standard:**
  ```sql
  ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
  ALTER TABLE <table_name> FORCE ROW LEVEL SECURITY;
  
  CREATE POLICY <table_name>_tenant_isolation ON <table_name>
    FOR ALL
    TO rc_app_user
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);
  ```
- **The `FORCE ROW LEVEL SECURITY` Invariant:** Even if a table owner or administrative script executes a query, PostgreSQL forces policy evaluation. Table data cannot leak through role-based shortcuts.

### Multi-Entity Ownership within Single Tenant
- For entities sharing physical infrastructure (e.g., shared central warehouses), legal ownership is partitioned using `legal_entity_owner_id`.
- Composite unique indexes ensure data integrity:
  `UNIQUE (tenant_id, legal_entity_owner_id, warehouse_id, item_id)`
- Prevents cross-entity contamination of inventory costs, stock balances, and financial liabilities.

---

## 2. Database Role Privileges & Principle of Least Privilege

The database security model partitions migration/DDL authorities from runtime application operations:

| Role Name | Superuser | Bypass RLS | Granted Permissions | Purpose |
|---|---|---|---|---|
| `postgres` (Admin / Deployer) | YES | YES | DDL, Migrations, Role creation | Schema migration scripts and CI setup only. Never used by NestJS runtime. |
| `rc_app_user` (Runtime Application) | **NO** | **NO (`NOBYPASSRLS`)** | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on tenant tables | Production connection pool role used by NestJS backend. Cannot bypass policies. |
| `rc_readonly_auditor` | **NO** | **NO (`NOBYPASSRLS`)** | `SELECT` only | Financial auditors and reporting engines. |

### Immutability of Sensitive Tables
- `audit_logs` and `journal_entry_lines` are strictly protected against mutation.
- `GRANT SELECT, INSERT ON audit_logs TO rc_app_user;` (`UPDATE` and `DELETE` privileges are explicitly revoked).
- Any attempt by `rc_app_user` to run `UPDATE audit_logs` results in immediate PostgreSQL error `permission denied for table audit_logs`.

---

## 3. Session Context Injection & Transaction Scoping

1. **Transaction Wrapping:** Every API request executing tenant-scoped operations runs inside a database transaction (`BEGIN ... COMMIT`).
2. **Context Setting:**
   ```sql
   SET LOCAL app.current_tenant_id = '<tenant_uuid>';
   SET LOCAL app.current_legal_entity_id = '<legal_entity_uuid>';
   ```
3. **Connection Pool Safety:**
   - Because `SET LOCAL` is used, the session configuration is automatically discarded upon transaction completion (`COMMIT` or `ROLLBACK`).
   - If a connection is returned to the connection pool and subsequently checked out without setting a tenant, `current_setting('app.current_tenant_id', true)` evaluates to `NULL`.
   - Any query executed without tenant context returns **0 rows** (fail-safe closed state).

---

## 4. Security Negative Test Suite Verification

The security negative test suite (`apps/api/test/security-negative.spec.ts`) was executed with 12 distinct attack and edge-case vectors. All 12 passed:

| Test Case | Attack / Fault Vector | Expected Outcome | Actual Result | Status |
|---|---|---|---|---|
| `SEC-NEG-01` | Cross-tenant `SELECT` across tenants A and B | Zero rows returned from Tenant B | 0 rows returned | **PASS** |
| `SEC-NEG-02` | Cross-tenant `INSERT` attempting Tenant B UUID under Tenant A context | RLS `WITH CHECK` violation error | Violation caught (`new row violates RLS`) | **PASS** |
| `SEC-NEG-03` | Cross-tenant `UPDATE` targeting foreign tenant primary key | 0 rows affected | 0 rows updated | **PASS** |
| `SEC-NEG-04` | Cross-tenant `DELETE` targeting foreign tenant primary key | 0 rows affected | 0 rows deleted | **PASS** |
| `SEC-NEG-05` | SQL Injection attempt in tenant context header | Query rejected by Zod UUID validator | HTTP 400 Bad Request | **PASS** |
| `SEC-NEG-06` | SQL Injection in item search parameter (`' OR '1'='1`) | Parameterized Drizzle query escapes input | 0 rows matched | **PASS** |
| `SEC-NEG-07` | Attempt by `rc_app_user` to execute `ALTER TABLE` | PostgreSQL permission denied | Error code `42501` | **PASS** |
| `SEC-NEG-08` | Direct modification of `audit_logs` table | PostgreSQL permission denied on UPDATE | Update blocked | **PASS** |
| `SEC-NEG-09` | Replay attack with duplicate `idempotencyKey` | Idempotent cached response returned | Duplicate order blocked | **PASS** |
| `SEC-NEG-10` | Parameter tampering: negative quantity in stock reservation | Zod positive decimal schema rejects payload | HTTP 400 Bad Request | **PASS** |
| `SEC-NEG-11` | Negative stock issue exceeding warehouse inventory | Transaction aborted with `NegativeStockException` | Rollback executed | **PASS** |
| `SEC-NEG-12` | Unset tenant context query execution | Query evaluates with `NULL` tenant context | 0 rows returned | **PASS** |

---

## 5. Environment Reality Check & Active Blocker

> [!CAUTION]
> **Active Blocker: Absence of Genuine PostgreSQL 16 Server in Local Environment**
> 
> - **Current Local State:** The automated tests executed successfully against **PGlite v0.5.15** (an in-process WebAssembly compilation of PostgreSQL 16.2).
> - **Network Verification:** Active probe on `localhost:5432` (`Test-NetConnection -ComputerName localhost -Port 5432`) confirmed port 5432 is closed (Docker Desktop and local PostgreSQL services are not installed/running).
> - **Architectural Policy:** In accordance with project engineering rules, **PGlite cannot be substituted as a final sign-off for a genuine PostgreSQL 16 server**.
> - **Implication:** True concurrent connection pool exhaustion, physical socket TCP handshakes, real network latency, and multi-threaded transaction lock contention must be verified on a genuine PostgreSQL 16 server via the GitHub Actions CI pipeline (`.github/workflows/gate1-ci.yml`) or a dedicated staging environment prior to final production certification.
