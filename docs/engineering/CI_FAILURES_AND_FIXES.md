# CI Failures, Root Causes, and Engineering Fixes

## 1. Overview

During the preparation and hardening of the PostgreSQL 16 CI pipeline and operational audit test suites, 8 technical defects and architectural gaps were identified. Every issue was investigated, diagnosed to its root cause, resolved, and verified.

---

## 2. Technical Failure & Resolution Registry

### Failure 1: Integration Tests Skipping Silently in CI
- **Symptom**: When PostgreSQL 16 was absent, the server integration suite skipped tests with `console.warn`, allowing CI to report a passing green checkmark without executing against a real database.
- **Root Cause**: The test runner had a conditional early return without checking whether the execution was in a CI environment.
- **Fix**: Added strict environment detection in `apps/api/test/server-postgres-rls.spec.ts`:
  ```typescript
  if (!canConnect) {
    if (process.env.CI === 'true' || process.env.STRICT_INTEGRATION === 'true') {
      throw new Error(
        '[FATAL CI FAILURE] Genuine PostgreSQL 16 server is REQUIRED in CI mode, but connection to localhost:5432 failed. ' +
        'Tests CANNOT be skipped in CI.'
      );
    }
    console.warn('PostgreSQL 16 not reachable locally. Skipping server integration tests.');
    return;
  }
  ```
- **Verification**: Verified that running `STRICT_INTEGRATION=true pnpm test:integration` without port 5432 fails immediately with exit code 1.

---

### Failure 2: PGlite Prepared Statement Multi-Command Rejection
- **Symptom**: `error: cannot insert multiple commands into a prepared statement` when executing mock schema setup scripts.
- **Root Cause**: `pg.query(...)` in PGlite compiles SQL via prepared statements, which PostgreSQL forbids when multiple semicolon-separated statements are provided.
- **Fix**: Replaced multi-command statements with `pg.exec(...)` in `apps/api/test/pilot-hardening-integrity.spec.ts`.
- **Verification**: All multi-statement seed queries now execute cleanly.

---

### Failure 3: Non-Hexadecimal UUID Formatting Rejection
- **Symptom**: PostgreSQL parser rejected synthetic test IDs with `invalid input syntax for type uuid: "s0000000-0000-0000-0000-000000000001"`.
- **Root Cause**: UUID standard RFC 4122 requires hexadecimal characters `[0-9a-f]`. The letter `s`, `i`, and `g` are outside the hex range.
- **Fix**: Replaced all test UUID prefixes with valid hex numbers:
  - Tenants: `fa00...`
  - Legal Entities: `fb00...`
  - Warehouses / Items: `fc00...`
- **Verification**: Database accepts all identifiers without formatting errors.

---

### Failure 4: Mock Schema Column Mismatch in Pilot Hardening Suite
- **Symptom**: `error: column "device_id" of relation "sales_orders" does not exist`.
- **Root Cause**: The test inserted `device_id` into `sales_orders`, but the mock DDL in `pilot-hardening-integrity.spec.ts` had not declared that column.
- **Fix**: Standardized the test query and created the `payments` table definition in the mock DDL.
- **Verification**: Tests in `pilot-hardening-integrity.spec.ts` pass with 17/17 tests passing.

---

### Failure 5: TypeScript Strict Null / Undefined Invariant Violations
- **Symptom**: `tsc --noEmit` failed with `TS2532: Object is possibly 'undefined'` and `TS18048: 'acc' is possibly 'undefined'` in `apps/api/src/modules/sales/sales.service.ts`.
- **Root Cause**: Allocating split payments across tenders used dynamically indexed object properties `tenderBalances[method]` which TypeScript flags as possibly undefined under `noUncheckedIndexedAccess`.
- **Fix**: Refactored `tenderBalances` to use a typed `Map<string, { netPaid: number; sample?: Payment }>()` with non-null assertion on verified map lookups, and added fallback account assignment `targetAcc = acc || defaultCreditAccount`.
- **Verification**: `pnpm turbo run build typecheck` succeeds across all 14 tasks in 7 packages.

---

### Failure 6: Partial Refunds and Split Payment Subledger Disconnect (Code Review Point A)
- **Symptom**: When `refundSalesOrder` was executed, the system updated the order header status and posted a GL journal entry, but inserted no records into the `payments` table. When shifts were closed, cashier cash reconciliation did not reflect customer cash refunds. Furthermore, orders paid with split payment (Cash + Card) lacked proportional or tender-specific refund allocation.
- **Root Cause**: `refundSalesOrder` was implemented as a simple status transition rather than a complete subledger transaction.
- **Fix**:
  1. Enhanced `refundSalesOrder` in `sales.service.ts` to inspect all original captured payments for the order.
  2. Implemented automatic tender allocation: calculates available refundable balance per payment method (Cash, Card, etc.).
  3. Inserts negative payment rows into `payments` table with `status = PaymentStatus.REFUNDED`.
  4. Generates GL journal lines matching the specific payment disbursement accounts (Cash Account `1010` vs Bank / POS Clearing `1020`).
  5. Updated `closeShift` to include `OrderStatus.PARTIALLY_REFUNDED` and `OrderStatus.REFUNDED` in shift orders, and sum both captured and refunded payments, guaranteeing drawer cash count accuracy.
- **Verification**: Automated test verifies split-tender payment of 50 SAR Cash + 50 SAR Card, partial refund of 30 SAR returned to Cash tender, resulting in 20 SAR net cash and exact subledger reconciliation.

---

### Failure 7: Inconsistent Recipe Ingredient Costing (FIFO vs WAC) (Code Review Point B)
- **Symptom**: In `apps/api/src/modules/production/production.service.ts`, `completeProductionBatch` hardcoded FIFO layer consumption for all ingredients, ignoring the item's configured `costingMethod` (`WEIGHTED_AVERAGE`).
- **Root Cause**: The query only selected `items.defaultCost` and did not evaluate `items.costingMethod`.
- **Fix**:
  1. Updated `production.service.ts` to inspect `items.costingMethod`.
  2. When `costingMethod === CostingMethod.WEIGHTED_AVERAGE`: computes the moving weighted average unit cost across open inventory cost layers (`totalRemainingValue / totalRemainingQuantity`).
  3. Uses this moving average cost for the production consumption record and depletes cost layers at the moving average rate.
  4. When `costingMethod === CostingMethod.FIFO`: consumes cost layers strictly in chronological order (oldest first).
- **Verification**: Automated test verifies that an ingredient with two layers (10L @ 10 SAR + 10L @ 20 SAR) evaluates to a moving average cost of 15.00 SAR/L under WAC, yielding 60.00 SAR for 4L rather than 40.00 SAR under FIFO.

---

### Failure 8: Cancellation of Bank-Reconciled Supplier Payments (Code Review Point C)
- **Symptom**: `cancelSupplierPayment` in `purchasing.service.ts` allowed voiding supplier payments even if the payment had already been matched, reconciled, and cleared on bank statements, risking ledger de-synchronization with bank feeds. Furthermore, payments could be cancelled repeatedly, causing multiple AP restorations.
- **Root Cause**: Lack of state validation on `supplierPayments.notes` prior to balance reversal.
- **Fix**:
  1. Added check: if `payment.notes?.includes('[CANCELLED')`, throws `BadRequestException` preventing duplicate cancellations.
  2. Added check: if `payment.notes?.includes('[BANK_RECONCILED]')` or `payment.notes?.includes('[CLEARED]')`, throws `BadRequestException('Cannot cancel supplier payment: Payment has already been reconciled with bank statements. Please reverse bank reconciliation before voiding.')`.
  3. Upon cancellation, prepends `[CANCELLED: reason]` to notes.
- **Verification**: Automated test verifies that bank-reconciled payments reject cancellation requests and duplicate cancellations are prohibited.
