# Restaurant Cloud — Pilot Hardening & Engineering Integrity Report

**Report Date:** 2026-11-08  
**Scope:** Core Operational & Financial Hardening (Sales Lifecycle, Accounts Payable, Production Costing, Concurrency, and Accounting)  
**Verification Suite:** 8 Test Suites Passed | 74/74 Automated Tests Passing (100% Success Rate)  
**Monorepo Health:** 7/7 Packages Compiling Cleanly | 14/14 Turbo Tasks Succeeded  

---

## 1. Executive Summary

Following the comprehensive operational readiness audit, this engineering hardening cycle systematically closed operational, transactional, and financial edge-case gaps across Restaurant Cloud. No new redundant modules were added; instead, existing implementations were inspected, hardened against concurrency race conditions, audited for mathematical accounting parity, and reinforced with strict validation rules.

All fixes were proven through the newly created test suite [`pilot-hardening-integrity.spec.ts`](file:///d:/Antigravity/pos/apps/api/test/pilot-hardening-integrity.spec.ts) (14 tests) alongside the existing 7 suites, bringing total automated test coverage to **74 passing tests**.

---

## 2. Hardening Interventions & Bug Fixes

### A. Sales Order Lifecycle & Idempotency Key Reuse
- **Identified Gap:** The original idempotency check returned any existing order matching `dto.idempotencyKey` without verifying if the incoming payload differed from the original order, risking silent parameter hijacking.
- **Hardening Fix:**
  - Implemented payload conflict detection: When `dto.idempotencyKey` matches an existing order, the system verifies that `existing.orderNumber === dto.orderNumber`. If conflicting parameters are submitted under the same idempotency key, the system immediately throws `ConflictException` (HTTP 409: *"Idempotency key already used for a different request payload"*).
  - Defined explicit order state transitions: `CONFIRMED` (stock reserved / order placed), `PAID` (payment captured in full), `CANCELLED` (manager void with restitution of stock), and `REFUNDED` / `PARTIALLY_REFUNDED`.
  - Implemented `refundSalesOrder` with atomic generation of reversing sales revenue, tax output, and cash disbursement journal entries.

### B. Supplier Payment & Accounts Payable Integrity
- **Identified Gaps:**
  1. An invoice was previously marked `PAID` regardless of whether the payment was partial or full.
  2. The system lacked an overpayment guard, allowing disbursements greater than the outstanding invoice or supplier balance.
  3. No journal entry was posted upon supplier payment disbursement.
  4. No cancellation/void mechanism existed for bounced or recalled payments.
- **Hardening Fixes:**
  - **Overpayment Guard:** Added strict boundary validation: If `paymentAmt > currentBalance`, throws `BadRequestException` (*"Payment amount exceeds outstanding supplier balance"*). If linked to an invoice and `paymentAmt > remainingDue`, throws `BadRequestException` (*"Payment amount exceeds remaining unpaid invoice amount"*).
  - **Partial Payment State:** Added `SupplierInvoiceStatus.PARTIALLY_PAID`. Invoices remain `PARTIALLY_PAID` until cumulative `paidAmount >= grandTotal`, at which point they transition to `PAID`.
  - **Automated GL Posting:** Every supplier payment automatically posts a balanced double-entry journal entry:
    - **Debit:** Account `2100` (Accounts Payable - Trade)
    - **Credit:** Account `1010` / `1020` (Cash on Hand / Bank)
  - **Payment Cancellation (`cancelSupplierPayment`):** Restores supplier balance, subtracts paid amount from invoice, reverts invoice status to `APPROVED` or `PARTIALLY_PAID`, and posts a reversing journal entry (`JV-REV-PMT-...`).

### C. Actual Production Costing (FIFO Layers vs Theoretical BOM)
- **Identified Gap:** The batch completion service previously used static item `defaultCost` instead of actual cost layers from incoming purchase receipts.
- **Hardening Fix:**
  - Updated `completeProductionBatch` to query `inventoryCostLayers` ordered by `created_at ASC` (`quantity_remaining > 0`).
  - Raw material consumption deducts from real FIFO purchase layers, updating `quantity_remaining` on each layer.
  - Actual batch production cost reflects market price variations across distinct goods receipts (e.g. Batch 1 consuming 20.00 SAR/kg meat vs Batch 2 consuming 30.00 SAR/kg meat).
  - Output meal or semi-finished prep batch is capitalized into its own active `inventoryCostLayers` record, which can subsequently be consumed by downstream recipes.
  - Automatically posts the Production Journal Entry:
    - **Debit:** Account `1300` (Finished Goods Inventory)
    - **Credit:** Account `1200` (Raw Materials Inventory)

### D. Inventory Concurrency & Zero Negative Stock
- **Identified Gap:** Potential race conditions when two POS terminals attempt to sell the last unit of an item simultaneously.
- **Hardening Fix:**
  - Enforced optimistic version locking on `inventory_balances`:
    ```sql
    UPDATE inventory_balances
    SET reserved_qty = ..., version = version + 1
    WHERE id = balance_id AND version = current_version;
    ```
  - When Terminal 1 commits a reservation, Terminal 2's simultaneous update matches 0 rows and throws `ConflictException` (409 Conflict: *"Optimistic lock failure. Please retry."*).
  - Available stock calculation ($\text{onHand} - \text{reserved}$) prevents any reservation when available quantity is 0, enforcing zero tolerance for negative inventory.

---

## 3. Test Suite Verification Summary

| Test Suite | Test File | Tests Passed | Focus Area |
|---|---|---|---|
| **Pilot Hardening Suite** | `pilot-hardening-integrity.spec.ts` | **14 / 14** | Sales lifecycle, AP partial payments, FIFO batch costing, optimistic concurrency, and zero variance |
| **Security Negative Suite** | `security-negative.spec.ts` | **12 / 12** | SQL injection, RLS bypass, cross-tenant isolation, immutability of audit logs |
| **Local RLS Suite** | `local-postgres-rls.spec.ts` | **13 / 13** | Multi-tenant and legal entity isolation with `FORCE ROW LEVEL SECURITY` |
| **Gate 1 Security Suite** | `gate1-security.spec.ts` | **10 / 10** | Role privileges (`rc_app_user` NOBYPASSRLS), context cleanup |
| **Catalog & Inventory Suite** | `catalog-inventory.spec.ts` | **6 / 6** | UOM conversion, WAC and FIFO costing, category trees |
| **Operational Integration** | `operational-integration.spec.ts` | **6 / 6** | Stock reservations, shift cash in/out, 3-way match, supplier payments |
| **End-to-End Operational Audit**| `e2e-operational-audit.spec.ts` | **6 / 6** | Scenarios A through F (Purchasing, Production, POS Sale, Void, Shift, Multi-Entity) |
| **Phase 3 Comprehensive** | `phase3-comprehensive.spec.ts` | **7 / 7** | General Ledger trial balance, fiscal periods, immutable reversals |
| **TOTAL** | **8 Suites** | **74 / 74 (100%)** | **All Systems Operational** |
