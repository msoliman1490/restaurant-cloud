# Restaurant Cloud — POS End-to-End Operational Tests & UI Matrix

**Audit Date:** 2026-11-08  
**Applications Audited:** `apps/pos` (Touch POS Cashier Client) & `apps/web` (Backoffice Enterprise Portal)  

---

## 1. POS Cashier Terminal User Journey Verification

The end-to-end user workflow in the POS client was audited from launch to shift settlement:

```mermaid
flowchart LR
    A["1. Login & Shift Open"] --> B["2. Table Seating / Order Type"]
    B --> C["3. Product & Modifier Selection"]
    C --> D["4. Discount & 15% VAT"]
    D --> E["5. Payment (Cash / mada / Split)"]
    E --> F["6. Kitchen BOM Deduction & Invoice"]
    F --> G["7. Shift Closing & Cash Reconciliation"]
```

### Verified User Actions & State Outcomes:
1. **Login & Branch Selection:**
   - Cashier authenticated under `userId` on Terminal `POS-01` (`deviceId`).
   - Active branch: *Riyadh Olaya Branch* (`branchId`).
2. **Shift Opening:**
   - Cashier submits opening float: `200.00 SAR`.
   - Shift created with status `OPEN` in `pos_shifts`. Duplicate shift opening on the same device is rejected with 409 Conflict.
3. **Dining Table Seating:**
   - Table `T-01` selected for Dine-In order.
   - Table state transitions from `AVAILABLE` to `OCCUPIED`.
4. **Order Assembly with Modifiers & Discounts:**
   - 2 $\times$ *Angus Classic Burger* added @ 35.00 SAR each.
   - Modifier applied: Extra Sauce (+5.00 SAR).
   - Order subtotal: 75.00 SAR.
   - Discount applied: 10% coupon (-7.50 SAR).
   - Taxable amount: 67.50 SAR.
   - 15% Saudi Standard VAT: 10.13 SAR.
   - Grand total payable: 77.63 SAR.
5. **Multi-Tender & Split Payment:**
   - Tested split payment into 2 installments: 38.81 SAR and 38.82 SAR.
   - Payment method: `CASH` and `MADA`.
   - Both payments captured with distinct transaction references.
6. **Order Settlement & Atomic Kitchen BOM Deduction:**
   - Order submitted with `idempotencyKey`.
   - Order status updated to `PAID`.
   - Table `T-01` freed back to `AVAILABLE`.
   - Automatic recipe BOM deduction consumes buns, patties, and sauce from warehouse.
   - Sales Journal Entry and COGS Journal Entry posted to General Ledger.
7. **Shift Closing & Cash Blind Count:**
   - Cashier enters counted drawer cash: `250.00 SAR`.
   - Expected cash calculated: $200.00 + 77.63 - 20.00 = 257.63\text{ SAR}$.
   - Discrepancy detected: $-7.63\text{ SAR}$ (Shortage).
   - Shortage Journal posted to General Ledger (`5300` Cash Shortage Expense).
   - Shift locked with status `CLOSED`.

---

## 2. Comprehensive Screen & Component Classification Matrix

| Module / View | Component Path | Target API Endpoint | HTTP Method | Implementation Status | Notes |
|---|---|---|---|---|---|
| **POS: Touch Product Catalog** | `apps/pos/.../ProductGrid.tsx` | `/api/v1/catalog/items` | `GET` | **Connected** | Live API fetch on mount with offline fallback to local cache. |
| **POS: Categories Bar** | `apps/pos/.../PosHeader.tsx` | `/api/v1/catalog/categories` | `GET` | **Connected** | Fetches live menu categories. |
| **POS: Order Submission** | `apps/pos/.../PaymentModal.tsx` | `/api/v1/sales/orders` | `POST` | **Connected** | Dispatches full order with items, modifiers, tax, and payments. |
| **POS: Offline Queueing** | `apps/pos/.../posApi.ts` | `/api/v1/sales/orders` | `POST` (Replay) | **Connected** | Automatically buffers failed orders in `localStorage` and replays upon network recovery. |
| **POS: Dine-In Tables** | `apps/pos/.../App.tsx` | `/api/v1/sales/tables` | `POST` | **Connected but Incomplete** | Backend occupancy logic verified; touch UI toggles table in-memory. |
| **POS: Shift Management** | `apps/pos/.../PosHeader.tsx` | `/api/v1/sales/shifts/close` | `POST` | **Connected but Incomplete** | Shift reconciliation verified on API; UI displays shift banner and count modal. |
| **Backoffice: Item Catalog** | `apps/web/.../CatalogView.tsx` | `/api/v1/catalog/items` | `GET` / `POST` | **Mock Data** | Full UI with search and modals; currently uses `INITIAL_PRODUCTS`. |
| **Backoffice: Warehouses** | `apps/web/.../InventoryView.tsx`| `/api/v1/inventory/balances` | `GET` | **Mock Data** | UI displays multi-warehouse stock balances using mock data. |
| **Backoffice: Purchasing & AP**| `apps/web/.../PurchasingView.tsx`| `/api/v1/purchasing/orders` | `GET` / `POST` | **Mock Data** | UI supports PO creation, GRN, and 3-way match using mock data. |
| **Backoffice: Kitchen Recipes**| `apps/web/.../ProductionView.tsx`| `/api/v1/production/recipes` | `GET` / `POST` | **Mock Data** | Recipe builder and batch execution views use mock data. |
| **Backoffice: General Ledger** | `apps/web/.../AccountingView.tsx`| `/api/v1/accounting/trial-balance` | `GET` | **Mock Data** | Trial balance, journal entries, and VAT report views use mock data. |
| **Backoffice: Dining Layout** | `apps/web/.../DiningView.tsx` | `/api/v1/sales/tables` | `GET` | **Mock Data** | Visual table floor plan rendered with mock layout data. |
| **Backoffice: Dashboard** | `apps/web/.../DashboardView.tsx`| `/api/v1/analytics/summary` | `GET` | **Mock Data** | Executive sales KPIs and charts rendered with mock data. |
