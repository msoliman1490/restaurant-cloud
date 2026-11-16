# Restaurant Cloud — Batch 2 Final Acceptance & Staging Verification Report

**Date:** 2026-11-16
**Scope:** Staging Only (`127.0.0.1:15432` via SSH tunnel `rc_agent@187.124.178.49` + Local Staging Runtime `http://127.0.0.1:4000` & `http://localhost:3001`)
**Production Impact:** None (Production untouched; ZATCA V1 active and V2 inactive in Production)
**Do Not Start Batch 3:** Acknowledged

---

## 1. Deployment Version & Environment Identifiers

- **Git Base Commit (`git rev-parse HEAD`):** `6ce535c4a9cfbab317d4c4fa41896e3b7e7e5005` (plus Batch 2 & Final Acceptance fixes in working tree)
- **Backend Build:** `apps/api/dist/main.js` (`nest build`, exit `0`)
- **Frontend Build:** `apps/web/dist/index.html` referencing `/assets/index-BgnnT6L1.js` (`1,045.90 kB`) and `/assets/index-Ci-pn5-V.css` (`67.41 kB`) (`tsc && vite build`, exit `0`)
- **Local Staging-Connected Runtime:**
  - API: `http://127.0.0.1:4000` (PID `61756`, `NODE_ENV=staging`, connected to `127.0.0.1:15432/restaurant_cloud_staging`)
  - Frontend: `http://localhost:3001` (Vite dev server proxying `/api` to `http://127.0.0.1:4000`)
- **Remote Staging VPS (`187.124.178.49`):** `UNVERIFIED` — SSH probe (`ssh -o BatchMode=yes rc_agent@187.124.178.49`) returned `This account is currently not available.` (`rc_agent` is a restricted DB tunnel-only account without shell/deployment privileges). `http://187.124.178.49` returned `404` and `https://187.124.178.49` timed out.

---

## 2. Final Batch 2 Acceptance Matrix

| Area | Classification | Summary |
|---|---|---|
| **Agent 1 — Offline POS Acceptance** | **PASS** | All 5 HTTP+DB acceptance scenarios (`offline-pos-acceptance.spec.ts` 5/5) + 6 service/DB scenarios (`offline-pos-sync.spec.ts` 6/6) passed on Staging. |
| **Agent 2 — Local Staging Runtime, Assets & API Paths** | **PASS** | `0` `/api/v1/api/v1` paths, `/health`, `/health/readiness`, `/api/v1/health/readiness`, `/api/v1/legal-entities`, and all corrected endpoints returned `200`/`201`. |
| **Agent 2 — Remote Staging VPS Deployment (`187.124.178.49`)** | **UNVERIFIED** | Blocked by restricted tunnel-only SSH user (`rc_agent`); remote VPS deployment must be run via CI/CD or privileged Staging host access. |
| **Agent 3 — POS Printing (80mm/A4 RTL) & Arabic CSV Export** | **PASS** | `renderToStaticMarkup` verified 80mm/A4 RTL layouts, 15% VAT, discounts, totals, customer details, ZATCA QR, and UTF-8 BOM (`0xEF 0xBB 0xBF`) Arabic CSV export. |
| **Agent 3 — POS Partial/Full Refunds & Cumulative Over-Refund** | **PASS** | `pos-printing-returns.spec.ts` (3/3), `phase3-4a` (20/20), `e2e-critical-journeys` (7/7) passed; cumulative over-refund defect in `SalesService.refundSalesOrder` fixed & rebuilt. |
| **Agent 4 — Purchasing, Migrations `0028`/`0029` & Performance** | **PASS** | `purchasing-requests.spec.ts` (3/3) + `purchasing-lifecycle.spec.ts` (5/5) passed; 27/27 indexes & RLS verified on Staging; `EXPLAIN ANALYZE` 0.11–0.34ms; `invalidateTenantCache` wired into IAM/Tenant mutations. |
| **Agent 5 — Browser E2E (Playwright Chromium on `http://localhost:3001`)** | **PASS** | Real Chromium Playwright suite (`batch2-staging.spec.ts`, 3/3 tests, 52.6s): **10/10 modules PASS**, `0` console errors, `0` page errors, `0` API errors, `0` `/api/v1/api/v1` 404s, mobile `390x844` RTL `scrollWidth === 390`. |

---

## 3. Detailed Scenarios, Actual Results & Evidence

### A. Agent 1 — Offline POS Acceptance (**PASS**)
- **Commands Executed:**
  - `pnpm --filter @restaurant-cloud/api exec vitest run test/offline-pos-sync.spec.ts` -> **6/6 passed** (`115.44s`, exit `0`).
  - `pnpm --filter @restaurant-cloud/api exec vitest run test/offline-pos-acceptance.spec.ts` -> **5/5 passed** (`125.79s`, exit `0`) against live `http://127.0.0.1:4000` and Staging DB `127.0.0.1:15432`.
- **Scenarios Verified:**
  1. **Network disconnect & offline sale persistence + app restart recovery (`PASS`):** Verified `PosView.tsx` (`queueOrderOffline`) + `offlinePosQueue.ts` (`enqueueOfflineOrder`, IndexedDB/`localStorage`, `recoverInterruptedSyncs()` restoring `SYNCING` -> `PENDING` and syncing upon reconnect).
  2. **Reconnect sync & duplicate request idempotency (`PASS`):** `POST /api/v1/sales/offline/sync` returned `summary.synced === 1`; repeating the exact payload returned `summary.alreadySynced === 1` (`ALREADY_SYNCED`) with `1` `sales_orders` row, `1` `payments` row, `1` `inventory_movements` row, and `1` `journal_entries` row.
  3. **Two POS devices selling concurrently (`PASS`):** Concurrent `POST /api/v1/sales/offline/leases` for `6` + `6` units against `10` on-hand allowed 1 (`201`) and rejected over-allocation (`409 Conflict`), then permitted allocating remaining `4` units (`6 + 4 = 10`).
  4. **Expired quota leases (`PASS`):** Past `validUntil` rejected (`400`); naturally expired signed lease rejected during sync with `CONFLICT` / `LEASE_EXPIRED`; lease renewal via `POST /api/v1/sales/offline/leases` recovered sync to `SYNCED`.
  5. **Sync failure & recovery (`PASS`):** Insufficient server stock triggered `CONFLICT` / `INSUFFICIENT_STOCK` (`PREVENT` policy) with `0` stock/invoice mutation; replenishing stock and retrying synced cleanly (`SYNCED`).

### B. Agent 2 — Staging Deployment Verification (**PARTIAL**: Local Runtime **PASS**, Remote VPS **UNVERIFIED**)
- **Health & Readiness:**
  - `GET http://127.0.0.1:4000/health`, `/health/readiness`, `/health/liveness` -> **HTTP 200** (`database: connected`).
  - `GET http://127.0.0.1:3001/api/v1/health/readiness` (after Technical Lead fix in `AppController`) -> **HTTP 200** (`{"status":"ok","service":"restaurant-cloud-api","checks":{"database":"connected"}}`).
- **Authenticated API Paths & Cache Headers:**
  - `POST /api/v1/auth/login` (`demo@restaurantcloud.sa`) -> **HTTP 201**.
  - `GET /api/v1/legal-entities`, `/delivery/orders`, `/settlements/batches`, `/zatca/config`, `/zatca/egs-units`, `/accounting/fiscal-years`, `/accounting/fiscal-periods`, `/accounting/accounts`, `/accounting/accounts/hierarchy` -> **HTTP 200**.
  - `apps/web/src` & `apps/web/dist` scan for `/api/v1/api/v1`: **0 matches**.
  - `vite preview` & Vite dev server serve `Cache-Control: no-cache` on `index.html`.

### C. Agent 3 — POS Printing, Refunds & Arabic CSV Export (**PASS**)
- **Printing & CSV Export (`PASS`):**
  - `vitest run .../verify_print_csv.test.tsx` -> **3/3 passed** (`17ms`). Verified 80mm (`w-[302px]`, `print-receipt-80mm`) & A4 (`max-w-[740px]`, `print-receipt-a4`) Arabic RTL HTML, 15% VAT, discounts, split payment text, customer VAT/name, ZATCA QR, and `exportToCsv` UTF-8 BOM (`[0xEF, 0xBB, 0xBF]`), `\r\n`, RFC-4180 quoting, and formula-injection guard (`'=SUM(...)`).
- **Refunds & Reversals (`PASS`):**
  - `vitest run test/pos-printing-returns.spec.ts` -> **3/3 passed** (`82.35s`, re-verified after Technical Lead cumulative over-refund fix).
  - `vitest run test/phase3-4a-sales-transaction-integration.spec.ts` -> **20/20 passed** (`286.34s`).
  - `vitest run test/e2e-critical-journeys.spec.ts` -> **7/7 passed** (`125.43s`).

### D. Agent 4 — Purchasing, Migrations & Performance (**PASS**)
- **Purchasing Suites (`PASS`):** `vitest run test/purchasing-requests.spec.ts test/purchasing-lifecycle.spec.ts` -> **8/8 passed** (`113.72s`); `audit_logs` recorded `PURCHASE_REQUEST_CREATED` (12), `APPROVED` (3), `REJECTED` (3), `CONVERTED_TO_PO` (3).
- **Schema Parity (`PASS`):** Staging `public.__drizzle_migrations` contains `0028_performance_indexes.sql` (`5d3cdcf3...`) and `0029_purchase_requests_parity.sql` (`1a5c5b26...`); `27/27` expected indexes present in `pg_indexes`; `purchase_requests` & `purchase_request_lines` have `rls_enabled = true`, `rls_forced = true`, isolation policies, and `rc_app_user` grants.
- **`EXPLAIN (ANALYZE, BUFFERS)` Metrics on Staging DB:**
  - `sales_orders`: `Bitmap Index Scan on idx_sales_orders_tenant_status_created` — **0.218 ms**
  - `journal_entries`: `Bitmap Index Scan on idx_journal_entries_tenant_branch_date` — **0.344 ms**
  - `inventory_movements`: `Index Scan using idx_inventory_movements_tenant_item_time` — **0.110 ms**
  - `purchase_orders` (36 rows): `Seq Scan` (1 heap page) — **0.102 ms**
  - `delivery_orders` (0 live rows): `Seq Scan` (1 heap page) — **0.097 ms**

### E. Agent 5 — Browser E2E & Product Quality (`apps/web/e2e/batch2-staging.spec.ts`) (**PASS**)
- **Command:** `pnpm exec playwright test apps/web/e2e/batch2-staging.spec.ts` (Chromium `159.0.8154.6`) -> **3/3 passed (52.6s)**.
- **Verified Modules (10/10 PASS, 0 page errors, 0 API errors, 0 console errors):**
  1. `نقاط البيع والكاشير (POS)` (`PASS` — 2 products loaded, payment modal & Offline POS drawer verified)
  2. `إدارة الصالة والطاولات` (`PASS`)
  3. `المشتريات وسلاسل الإمداد -> طلبات الشراء` (`PASS`)
  4. `أرصدة المخزون والتكلفة` (`PASS`)
  5. `التوصيل والسائقون` (`PASS`)
  6. `المحاسبة ودفتر الأستاذ -> دليل الحسابات الشجري (COA)` (`PASS`)
  7. `المحاسبة ودفتر الأستاذ -> تسويات الدفع والتوصيل` (`PASS`)
  8. `الفوترة الإلكترونية ZATCA V2` (`PASS`)
  9. `إقفال الفترات المالية` (`PASS`)
  10. `المصالحات والتقارير المالية` (`PASS`)
- **Responsive Mobile (`390x844` RTL):** `scrollWidth === 390`, `clientWidth === 390` on both Dashboard and POS.
- **Screenshots Directory:** `C:/Users/MALEEM/.gemini/antigravity/brain/97e503d6-3c4a-4639-b75a-36034920e25b/scratch/screenshots/`

---

## 4. Defects Discovered During Acceptance & Root Causes Resolved

| Defect | Root Cause | Resolution | Verification |
|---|---|---|---|
| **InventoryView blank white screen crash** | `b.itemName.toLowerCase()` threw `TypeError` when `itemName`/`itemSku`/`warehouseName` was undefined. | Guarded with `(b.* ?? '').toLowerCase()` in `apps/web/src/components/InventoryView.tsx`. | Playwright `أرصدة المخزون والتكلفة` **PASS** (`0` page errors). |
| **DiningView `403 Forbidden`** | 1) `demo-restaurant` lacked `RESTAURANT` row in `tenant_industry_packs`. 2) `TenantService.checkEntitlement()` queried `tenantIndustryPacks` without `withTenantContext()`, returning 0 rows under `FORCE ROW LEVEL SECURITY`. | Inserted `RESTAURANT` pack for `demo-restaurant` on Staging DB and wrapped `checkEntitlement()` in `this.dbService.withTenantContext(...)`. | Playwright `إدارة الصالة والطاولات` **PASS** (`0` API errors). |
| **Navbar `قاعدة البيانات غير متصلة` (`404`)** | `Navbar.tsx` called `/api/v1/health/readiness`, while `AppController` only exposed `/health/readiness`. | Added `@Get('api/v1/health')`, `@Get('api/v1/health/liveness')`, `@Get('api/v1/health/readiness')` in `apps/api/src/app.controller.ts`. | `GET /api/v1/health/readiness` returned **HTTP 200**. |
| **Accounting `vat-return` `400 Bad Request`** | `AccountingView.tsx` omitted required `startDate` & `endDate` ISO params on initial load. | Added `startDate` (start of year) & `endDate` (now) query params in `AccountingView.tsx`. | Playwright `المحاسبة -> COA` **PASS** (`0` API errors). |
| **Cumulative over-refund on `PARTIALLY_REFUNDED` order** | `SalesService.refundSalesOrder` checked `refundAmt > grandTotal` without summing prior `REFUNDED` payments. | Moved `orderPayments` query up and enforced `alreadyRefunded + refundAmt <= grandTotal + 0.0001`. | `nest build` exit `0` + `pos-printing-returns.spec.ts` **3/3 PASS**. |
| **`invalidateTenantCache` unused** | Exported in `TenantContextGuard` with 0 call sites outside the guard. | Wired `invalidateTenantCache` into `AuthService.updateUserStatus`, `AuthService.updateUserScopes`, and `TenantService.updateTenantSettings`. | `nest build` exit `0`. |

---

## 5. Remaining Risks & Open Items

1. **Remote Staging VPS Deployment (`187.124.178.49`):** Cannot be deployed from this workspace because `rc_agent` is restricted to DB port forwarding. The newly built `apps/api` and `apps/web` artifacts must be deployed to the remote Staging host via the normal CI/CD or privileged SSH pipeline before external users test the public Staging URL.
2. **Missing `?legalEntityId` query parameter handling:** Calling certain `legalEntityId`-scoped GET endpoints without `?legalEntityId=` currently returns `500` instead of `400 Bad Request` (not triggered by the UI, which passes `legalEntityId`, but should be tightened with Zod validation).
3. **Browser `window.print()` dialog & POS Checkout with Open Shift:** Playwright verified opening the POS Payment Modal and Offline POS Drawer without errors; completing a live cash checkout in Playwright requires opening a POS shift first for `demo@restaurantcloud.sa`.

---

## 6. Final Batch 2 Acceptance Status

- **Codebase, Staging DB & Local Staging-Connected Runtime (API + Real Chromium E2E):** **PASS** (All critical Batch 2 functional, security, financial integrity, migration, and browser UI/UX criteria verified).
- **Remote Staging VPS (`187.124.178.49`) Deployment:** **UNVERIFIED** (Requires privileged deployment access outside the restricted `rc_agent` tunnel account).
