# Restaurant Cloud — Database Security & Tenant Isolation Verification

**Audit Date:** 2026-11-08  
**Verification Target:** Genuine PostgreSQL 16 Kernel Security Policies, Role Privileges, and Context Scoping  
**Test Suite Reference:** `apps/api/test/server-postgres-rls.spec.ts` & `security-negative.spec.ts`  

---

## 1. Row Level Security & The `FORCE RLS` Invariant

In multi-tenant SaaS architectures, relying solely on `WHERE tenant_id = ...` in application queries introduces catastrophic data leakage risks if a developer omits the filter. Restaurant Cloud enforces tenant segregation at the PostgreSQL kernel layer.

### The Standard Implementation:
```sql
ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table_name> FORCE ROW LEVEL SECURITY;

CREATE POLICY <table_name>_tenant_isolation ON <table_name>
  FOR ALL
  TO rc_app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);
```

### Why `FORCE ROW LEVEL SECURITY` is Mandatory:
In PostgreSQL, standard RLS is bypassed by table owners by default. `FORCE ROW LEVEL SECURITY` instructs PostgreSQL to apply policy evaluation **unconditionally**, even if a script executes under the table owner account. Only superusers with explicit bypass can circumvent it, and `rc_app_user` is strictly barred from both.

---

## 2. Principle of Least Privilege: Role Architecture

| Security Property | `rc_admin` (Migration / CI Setup) | `rc_app_user` (Production Application Pool) | Verification Result |
|---|---|---|---|
| **Superuser (`rolsuper`)** | `true` | **`false`** | Verified via `SELECT rolsuper FROM pg_roles;` |
| **Bypass RLS (`rolbypassrls`)**| `true` | **`false`** | Verified via `SELECT rolbypassrls FROM pg_roles;` |
| **Create DB (`rolcreatedb`)** | `true` | **`false`** | Verified via `SELECT rolcreatedb FROM pg_roles;` |
| **Create Role (`rolcreaterole`)**| `true` | **`false`** | Verified via `SELECT rolcreaterole FROM pg_roles;` |
| **DDL Privileges (`ALTER TABLE`)**| Granted | **Denied** | Throws SQL error `42501` |
| **Audit Logs DML** | Granted | **`INSERT, SELECT` ONLY** | `UPDATE` and `DELETE` explicitly revoked |

---

## 3. Session Scoping & Connection Pool Context Reuse

One of the most dangerous vulnerabilities in multi-tenant connection pooling is **Tenant Context Bleed**, where a pooled TCP connection retains a previous tenant's session variable and executes a subsequent query for a different tenant.

### The `SET LOCAL` Architecture:
```sql
BEGIN;
SELECT set_config('app.current_tenant_id', :tenantId, true);
-- All tenant queries run here
COMMIT; -- Context automatically evaporates
```

### Verified Pool Reuse Scenarios (`server-postgres-rls.spec.ts`):
1. **Transaction Completion Context Evaporation (Test 10):**
   - Tenant A checks out Connection #1, sets `app.current_tenant_id = Tenant A`, and commits.
   - Connection #1 is returned to the pool.
   - Next query on Connection #1 checks `current_setting('app.current_tenant_id', true)`: Evaluates to **`NULL`**.
2. **Transaction Rollback Context Evaporation (Test 11):**
   - Tenant A starts a transaction, sets context, and throws an exception triggering `ROLLBACK`.
   - Context is immediately wiped. `current_tenant` evaluates to **`NULL`**.
3. **Fail-Closed Unauthenticated Queries (Test 6 & 17):**
   - An application query executed on any pool connection without an active transaction or without setting context returns **0 rows**.
   - No cross-tenant data can ever be read on unauthenticated checkouts.

---

## 4. Cross-Tenant Attack Defense Verification

| Attack Vector | Simulated Action | PostgreSQL Security Defense | Actual Result | Status |
|---|---|---|---|---|
| **Cross-Tenant SELECT** | Tenant A attempts `SELECT * FROM sales_orders WHERE tenant_id = 'Tenant B'` | RLS `USING` filter evaluates to false | **0 rows returned** | **PASS** |
| **Cross-Tenant INSERT** | Tenant A attempts `INSERT INTO sales_orders` with Tenant B's UUID | RLS `WITH CHECK` constraint violation | **Throws `new row violates RLS policy`** | **PASS** |
| **Cross-Tenant UPDATE** | Tenant A attempts `UPDATE sales_orders SET grand_total = 0 WHERE id = order_b_id` | RLS filter hides Tenant B row | **0 rows affected** (Row B unaffected) | **PASS** |
| **Cross-Tenant DELETE** | Tenant A attempts `DELETE FROM sales_orders WHERE id = order_b_id` | RLS filter hides Tenant B row | **0 rows affected** (Row B unaffected) | **PASS** |
| **Direct DDL Injection** | Attacker injects `ALTER TABLE sales_orders DISABLE ROW LEVEL SECURITY;` | PostgreSQL role privilege check blocks DDL | **Throws error `42501 (permission denied)`** | **PASS** |
| **Audit Log Tampering** | Attacker attempts `UPDATE audit_logs SET action = 'ALTERED'` | Dedicated plpgsql trigger `trg_prevent_audit_log_modification` | **Throws `Security Violation: Audit logs are immutable`** | **PASS** |

---

## 5. Multi-Entity Segregation in Shared Warehouses

- **Architecture:** Multiple corporate legal entities operating under Tenant A may share the same physical warehouse (`warehouse_id`).
- **Enforcement:**
  - Foreign key: `legal_entity_owner_id REFERENCES legal_entities(id)`
  - Composite Unique Index: `UNIQUE (tenant_id, legal_entity_owner_id, warehouse_id, item_id)`
- **Verification Result (Test 14):**
  - Entity A1 records 50 units of stock.
  - Queries under Tenant B return **0 rows**.
  - Queries under Tenant A return Entity A1's stock balance, with legal ownership and cost layers strictly partitioned.
