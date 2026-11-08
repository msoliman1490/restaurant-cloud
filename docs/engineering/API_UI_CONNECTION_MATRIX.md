# Restaurant Cloud — API & UI Connection Matrix

**Audit Date:** 2026-11-08  
**Scope:** Complete frontend-to-backend integration audit across `apps/web` (Backoffice Management) and `apps/pos` (Touch Point-of-Sale Terminal)  

---

## 1. Classification Taxonomy

To ensure engineering rigor and transparency, every view, screen, and user action is evaluated and classified into one of five unambiguous statuses:

1. **Connected:** Fully wired to live NestJS backend API endpoints. Performs real network I/O, transactional mutations in PostgreSQL, handles HTTP errors, and updates live application state.
2. **Connected but Incomplete:** Endpoint is connected for read or write, but lacks complete lifecycle handling (e.g. read works from API, but create/edit uses local fallback, or pagination/filters are handled purely in memory).
3. **Mock Data:** Visual UI and full user workflow are rendered using rich in-memory sample datasets; mock interactions simulate real ERP state transitions locally, but network requests to NestJS are not yet dispatched.
4. **UI Only:** Visual elements and markup exist, but interactive controls (buttons, forms, submit actions) are static or non-functional stubs.
5. **Not Implemented:** Feature or view is defined in architectural specifications but no component or screen exists yet in the codebase.

---

## 2. Summary Status by Application

| Application | Total Views / Modules | Connected | Connected but Incomplete | Mock Data | UI Only | Not Implemented |
|---|---|---|---|---|---|---|
| **apps/pos (Cashier & Dining POS)** | 5 Workflows | 3 (60%) | 2 (40%) | 0 (0%) | 0 (0%) | 0 (0%) |
| **apps/web (Enterprise Backoffice)** | 7 Modules | 0 (0%) | 0 (0%) | 7 (100%) | 0 (0%) | 0 (0%) |
| **Total** | **12 Modules** | **3 (25%)** | **2 (17%)** | **7 (58%)** | **0 (0%)** | **0 (0%)** |

---

## 3. POS Terminal Integration Matrix (`apps/pos`)

| Screen / Component | User Action / Flow | Target Backend API Endpoint | HTTP Method | Integration Status | Offline Fallback Mechanism | Notes |
|---|---|---|---|---|---|---|
| **Catalog Grid** (`ProductGrid.tsx`) | Initial menu load & item render | `/api/v1/catalog/items` | `GET` | **Connected** | `INITIAL_PRODUCTS` cache | Fetches live items; falls back to cached items if network unavailable. |
| **Category Bar** (`PosHeader.tsx`) | Category selection & filtering | `/api/v1/catalog/categories` | `GET` | **Connected** | `INITIAL_CATEGORIES` cache | Live categories loaded on mount. |
| **Payment Modal** (`PaymentModal.tsx`) | Single / Split Payment Submission | `/api/v1/sales/orders` | `POST` | **Connected** | LocalStorage Queue (`rc_pos_offline_orders`) | Submits full order, items, modifiers, tax, and payment. Automatically queues in `localStorage` on connection failure. |
| **Dine-In Table Selector** | Seating & Table Assignment | `/api/v1/sales/tables` | `GET` / `POST` | **Connected but Incomplete** | In-memory selection | Table occupancy API implemented in backend; frontend UI toggle uses in-memory table state. |
| **Shift Management** | Open / Cash In-Out / Close Shift | `/api/v1/sales/shifts/close` | `POST` | **Connected but Incomplete** | Local shift counter | Backend shift reconciliation and journal posting is verified; Cashier UI displays shift status banner. |

---

## 4. Backoffice Enterprise Web Matrix (`apps/web`)

| Module View | File Path | User Action / Screen | Corresponding Backend Controller / API | Current Status | Required Action for Next Workstream |
|---|---|---|---|---|---|
| **Catalog Management** | `components/CatalogView.tsx` | View Items, Search, Create Item, Filter Categories | `CatalogController` (`/api/v1/catalog/items`) | **Mock Data** | Replace `INITIAL_PRODUCTS` with React Query / SWR hook calling `GET /api/v1/catalog/items`. Connect modal to `POST /api/v1/catalog/items`. |
| **Inventory & Warehouses** | `components/InventoryView.tsx` | Warehouse Balances, Stock Transfers, Physical Counts | `InventoryController` (`/api/v1/inventory/balances`, `/transfers`) | **Mock Data** | Connect balance table to `GET /api/v1/inventory/balances`. Wire transfer modal to `POST /api/v1/inventory/transfers`. |
| **Purchasing & AP** | `components/PurchasingView.tsx` | Suppliers, POs, 3-Way Match GRN, Invoices | `PurchasingController` (`/api/v1/purchasing/orders`, `/payments`) | **Mock Data** | Wire PO creation and Goods Receipt Note entry to `/api/v1/purchasing/orders` and `/api/v1/purchasing/goods-receipts`. |
| **Kitchen & Recipes** | `components/ProductionView.tsx` | Recipe BOMs, Production Batches, Waste Logging | `ProductionController` (`/api/v1/production/orders`, `/recipes`) | **Mock Data** | Wire Recipe builder and production batch runs to `/api/v1/production/orders` and `/api/v1/production/recipes`. |
| **Accounting & General Ledger** | `components/AccountingView.tsx` | Trial Balance, Balance Sheet, Journal Entries, VAT Report | `AccountingController` (`/api/v1/accounting/trial-balance`, `/reports`) | **Mock Data** | Connect Trial Balance and Journal ledger views to `GET /api/v1/accounting/trial-balance` and `GET /api/v1/accounting/journal-entries`. |
| **Dining & Floor Plan** | `components/DiningView.tsx` | Table Map, Floor Sections, Table Occupancy | `SalesController` (`/api/v1/sales/tables`) | **Mock Data** | Connect visual table layout to live dining table states (`AVAILABLE`, `OCCUPIED`, `RESERVED`). |
| **Executive Dashboard** | `components/DashboardView.tsx` | Daily Gross Sales, COGS Margin, Fast-Moving Dishes | Aggregated Analytics Controller | **Mock Data** | Wire KPI cards to aggregated sales and inventory summary endpoints. |

---

## 5. Offline & Resiliency Evaluation

### POS Offline Engine (`apps/pos/src/api/posApi.ts`)
- **Queue Storage:** Orders that fail network dispatch are automatically encrypted and appended to `localStorage.getItem('rc_pos_offline_orders')`.
- **Badge Indication:** POS Header displays an amber badge when offline queued transactions are pending.
- **Replay Mechanism:** Upon window online event, POS initiates FIFO replay against `/api/v1/sales/orders` using client-generated idempotent UUIDs (`idempotencyKey`), preventing duplicate database records.
- **Client-Side Financial Authority:** **STRICTLY ZERO**. The offline POS records transactions as intents; inventory deduction, FIFO cost allocation, and general ledger journal postings occur deterministically on the backend upon synchronization.
