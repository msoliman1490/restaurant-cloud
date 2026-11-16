# Restaurant Cloud — Batch 2 Parallel Engineering Progress Report

**Date:** 2026-11-16
**Environment:** Staging DB (`127.0.0.1:15432` via SSH tunnel `task-15535`) — Production untouched, ZATCA V1 active / V2 inactive in Production.

---

## 1. Executive Summary

Batch 2 parallel engineering across 5 specialized agents and Technical Lead integration has been completed and verified against the Staging PostgreSQL database:
- **Workspace Builds:** `@restaurant-cloud/database`, `@restaurant-cloud/shared-contracts`, `@restaurant-cloud/api`, and `@restaurant-cloud/web` all build cleanly (`exit 0`).
- **Staging DB Test Suite:** **11/11 test files passed (98/98 tests)** on Staging DB with RLS, RBAC, PostingEngine, and Inventory FIFO/concurrency intact.
- **UI/Browser Note:** Playwright is not installed in the workspace; end-to-end verification was performed at the HTTP API layer via Fastify `app.inject()` (`e2e-critical-journeys.spec.ts`, 7/7) and TypeScript/Vite production builds. Real browser DOM E2E remains `UNVERIFIED` until Playwright is added and run against a deployed Staging frontend.

---

## 2. Agent-by-Agent Execution Summary

### Agent 1 — Database Performance
- **Migration `0028_performance_indexes.sql`:** Created, registered in `packages/database/drizzle/meta/_journal.json`, applied to Staging DB, and recorded in `__drizzle_migrations` (verified via `EXPLAIN ANALYZE` replacing sequential scans and in-memory sorts with index scans).
- **`TenantContextGuard` TTL Cache:** Added 30-second TTL in-memory cache (`tenantAuthCache`, bypassed in `NODE_ENV=test` / `VITEST`) + `invalidateTenantCache()` in `apps/api/src/common/guards/tenant-context.guard.ts`.
- **Server-Side Pagination:** Implemented pagination + SQL `ILIKE` search in `apps/api/src/modules/sales/sales.service.ts` (`listShifts`), `sales.controller.ts`, `apps/api/src/modules/delivery/delivery.service.ts`, and `delivery.controller.ts`.
- **Lead Fix:** Updated `apps/api/test/phase3-4b-pos-shift-closing.spec.ts` to seed `tenantSubscriptions` (`planCode: 'ENTERPRISE'`, `maxBranches: 50`, `maxDevices: 50`) so multi-branch test #14 does not hit the `FREE_TRIAL` 3-branch limit (`14/14` passing).

### Agent 2 — POS Printing and Returns
- **Receipt Printing:** Connected `ReceiptPrintModal` (80mm / A4, Arabic RTL, VAT/discount/split payment breakdown) to `apps/web/src/components/PosView.tsx` and `apps/web/src/components/DiningView.tsx` with duplicate-print guard (`isPrintingGuard` + `printedOrderKeys` + reprint indicator).
- **CSV Export:** Connected `exportToCsv` to `AccountingView.tsx`, `ReconciliationReportingView.tsx`, and `InventoryView.tsx`.
- **Sales Refund UI & API:** Connected Sales Refund modal in `PosView.tsx` to `POST /api/v1/sales/orders/:id/refund` with idempotency key and RBAC permission `sales.refund`.
- **Tests:** `apps/api/test/pos-printing-returns.spec.ts` — **3/3 passed**.

### Agent 3 — Purchasing Completion
- **Purchase Requests (PR) Backend:** Implemented `POST /requests`, `GET /requests`, `GET /requests/:id`, `POST /requests/:id/approve`, `POST /requests/:id/reject`, and `POST /requests/:id/convert-to-po` (with `FOR UPDATE` row locking to prevent duplicate conversion) in `apps/api/src/modules/purchasing/purchasing.service.ts` and `purchasing.controller.ts`.
- **Purchasing Pagination:** Added server-side pagination for `orders`, `receipts`, `invoices`, and `returns`.
- **Purchasing Frontend:** Added PR tab, Create/Detail/Approve/Reject/Convert-to-PO modals, and pagination bars in `apps/web/src/components/PurchasingView.tsx`.
- **Migration Parity (`0029_purchase_requests_parity.sql`):** Created `packages/database/drizzle/0029_purchase_requests_parity.sql` (idempotent `CREATE TABLE IF NOT EXISTS` for `purchase_requests` and `purchase_request_lines`, indexes, `ENABLE`/`FORCE ROW LEVEL SECURITY`, tenant isolation policies, and `GRANT ... TO rc_app_user`), registered in `meta/_journal.json` (`idx: 29`), applied to Staging DB, and recorded in `__drizzle_migrations` (`sha256: 1a5c5b26642f3c51ea65174461f12becb14acf949ec70ca3ebc3d52c18b266f7`).
- **Tests:** `apps/api/test/purchasing-requests.spec.ts` (**3/3**) + `apps/api/test/purchasing-lifecycle.spec.ts` (**5/5**) = **8/8 passed**.

### Agent 4 — Offline POS
- **Backend (`offline-pos.service.ts`, `offline-pos.controller.ts`):** Implemented HMAC-signed `offline_quota_leases` (`POST/GET /api/v1/sales/offline/leases`), unlimited offline duration, shared local stock allocation, `PREVENT` conflict policy, and idempotent `POST /api/v1/sales/offline/sync` delegating to `SalesService.createSalesOrder`.
- **Frontend (`offlinePosQueue.ts`, `OfflinePosDrawer.tsx`, `PosView.tsx`):** Implemented IndexedDB + `localStorage` fallback queue (`PENDING`, `SYNCING`, `SYNCED`, `CONFLICT`, `FAILED`), `recoverInterruptedSyncs`, and wired `OfflinePosDrawer` + `enqueueOfflineOrder` + `subscribeNetworkStatus` directly into `apps/web/src/components/PosView.tsx` (both top bar status/drawer toggle and automatic offline checkout fallback on `!isOnline` or network failure).
- **Tests:** `apps/api/test/offline-pos-sync.spec.ts` — **6/6 passed**.

### Agent 5 — Product UI/UX and E2E
- **UI/UX Polish:** Replaced `alert()` calls in `CatalogView.tsx` with `useToast()`; added responsive `overflow-x-auto` table wrappers to `DeliveryView.tsx`, `ProductionView.tsx`, `HrEmployeesView.tsx`, `ZatcaV2View.tsx`, and `PeriodClosingView.tsx`.
- **HTTP E2E Suite (`apps/api/test/e2e-critical-journeys.spec.ts`):** Implemented 7 end-to-end journeys using Fastify `app.inject()` (Login/Session, Tenant & Branch Hierarchy, Catalog Management, Purchasing Lifecycle, Sales & Refund Lifecycle, Period Closing Engine, Multi-Tenant BOLA/IDOR Defense) — **7/7 passed**.
- **Delivery Pagination Fix:** Updated `apps/web/src/components/DeliveryView.tsx` to safely unwrap both array and paginated `{ data }` / `{ items }` responses from `/api/v1/delivery/*` endpoints.

---

## 3. Staging Verification Matrix (Latest Run)

| Check / Test Suite | Scope | Result |
|---|---|---|
| `@restaurant-cloud/database` build (`tsc`) | Package build | Passed (`exit 0`) |
| `@restaurant-cloud/shared-contracts` build (`tsc`) | Package build | Passed (`exit 0`) |
| `@restaurant-cloud/api` build (`nest build`) | Backend build | Passed (`exit 0`) |
| `@restaurant-cloud/web` build (`tsc && vite build`) | Frontend build | Passed (`exit 0`) |
| `test/pos-printing-returns.spec.ts` | POS printing & refunds | **3/3 passed** |
| `test/purchasing-requests.spec.ts` | PR workflow & pagination | **3/3 passed** |
| `test/purchasing-lifecycle.spec.ts` | Full Purchasing lifecycle | **5/5 passed** |
| `test/offline-pos-sync.spec.ts` | Offline POS leases & sync | **6/6 passed** |
| `test/e2e-critical-journeys.spec.ts` | HTTP Fastify E2E journeys | **7/7 passed** |
| `test/delivery-drivers.spec.ts` | Delivery, drivers & COD | **3/3 passed** |
| `test/phase3-4b-pos-shift-closing.spec.ts` | Shift closing & GL variance | **14/14 passed** |
| `test/phase3-4a-sales-transaction-integration.spec.ts` | Sales, multi-tender & COGS | **20/20 passed** |
| `test/production-recipes.spec.ts` | BOM, production & waste | **5/5 passed** |
| `test/financial-accounting-engine.spec.ts` | COA, GL, VAT, period lock | **17/17 passed** |
| `test/remediation-security-integrity.spec.ts` | Security, RBAC & concurrency | **15/15 passed** |
| **Total Vitest Staging DB Suite** | **11 test files** | **98/98 passed** |

---

## 4. Notes on Live Staging UI Screenshots & Remaining Deployment Step

- **Double `/api/v1/api/v1/companies` in ZATCA V2 / Period Closing screenshots:** Caused by an older frontend build currently running on the remote Staging server. In the current workspace source, `apps/web/src/api/client.ts` strips any leading `/api/v1` prefix, and `ZatcaV2View.tsx` / `PeriodClosingView.tsx` call `/legal-entities` (zero `/companies` calls remain in `apps/web/src`).
- **DeliveryView error toast:** Fixed in `apps/web/src/components/DeliveryView.tsx` to handle paginated `{ data }` responses cleanly.
- **Deployment Pending:** The newly built `apps/api` and `apps/web` artifacts in this workspace need to be deployed/restarted on the Staging host (`187.124.178.49`) for the live Staging browser UI to reflect these fixes.
- **Browser DOM E2E:** `UNVERIFIED` via Playwright (Playwright is not installed in the repository).
