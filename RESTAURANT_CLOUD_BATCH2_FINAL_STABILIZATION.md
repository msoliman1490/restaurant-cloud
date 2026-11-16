# Restaurant Cloud — Batch 2 Final Stabilization & Release Readiness Report

**Date:** 2026-11-16
**Scope:** Batch 2 Final Stabilization & Release Readiness (Staging Only)
**Restrictions Honored:** Staging only; zero Production changes; zero ZATCA V2 live activation; zero Batch 3 work; zero destructive Git operations; zero commits/pushes.

---

## 1. Stabilization Phase Classifications

| Phase | Area | Classification | Key Evidence |
|---|---|---|---|
| **Phase 1** | Repository Integrity Audit | **PASS** | `194` uncommitted entries inventoried (`72` M, `122` ??, `0` D, `0` R); `30/30` sequential migrations (`0000`–`0029`) match `_journal.json`; `0` secret hits. See [BATCH2_REPOSITORY_CHANGE_INVENTORY.md](file:///d:/Antigravity/pos/BATCH2_REPOSITORY_CHANGE_INVENTORY.md). |
| **Phase 2** | Financial Integrity Verification (`ORD-CASH-MWIW7MRX`) | **PASS** | Read-only Staging DB audit confirmed balanced 5-line GL (`70.2500 === 70.2500`), exact `18.5000` COGS/Inventory posting, `15%` VAT (`6.7500`), and `1` record per table (zero duplicates). |
| **Phase 3** | Remote Staging Deployment Readiness | **UNVERIFIED** | Architecture & rollback workflow documented in [STAGING_DEPLOYMENT_READINESS.md](file:///d:/Antigravity/pos/STAGING_DEPLOYMENT_READINESS.md); execution blocked pending CD secrets (`CLOUDFLARE_API_TOKEN`, `STAGING_DEPLOY_SSH_KEY`) and commit/push approval. |
| **Phase 4** | Virtual / PDF Printing Readiness (80mm & A4 RTL) | **PASS** | Chromium `@media print` CSS (`72mm` 80mm receipt, `196mm` A4 invoice, `6mm` margin, `dir="rtl"`) verified via real PDFs (`receipt-80mm-print.pdf`, `invoice-a4-print.pdf`). |
| **Phase 4** | Physical Printer Hardware (80mm Thermal & A4 Paper) | **UNVERIFIED** | No 80mm thermal printer installed; physical A4 paper print not executed on `Brother MFC-L8690CDW` / `EPSON L3250`. |

---

## 2. Phase 2 Evidence — Financial Integrity Audit (`ORD-CASH-MWIW7MRX`)

Read-only verification against `restaurant_cloud_staging` (`127.0.0.1:15432`):

1. **Order & Line (`sales_orders` + `order_lines`):**
   - `order_id`: `01065718-9980-4a4b-a71f-aa5c8856c952` | `status`: `PAID` | `shift_id`: `64111919-f610-401f-9f46-1d062e932d54`
   - Item: `POS-MEAL-01` (`وجبة أنجوس برجر الكلاسيكية`, `WEIGHTED_AVERAGE`) — `qty: 1.0000`, `unit_price: 45.0000`, `tax_amount: 6.7500` (15%), `grand_total: 51.7500`.
2. **Duplicate Check (Counts):**
   - `sales_orders`: `1` | `payments`: `1` (`CASH`, `51.7500`, `CAPTURED`) | `inventory_movements`: `1` (`SALE_ISSUE`, `qty: 1.0000`, `unit_cost: 18.5000`) | `journal_entries`: `1` (`JV-SALE-ORD-CASH-MWIW7MRX`, `POSTED`, `source_type = sales_orders`, `source_id = 01065718-9980-4a4b-a71f-aa5c8856c952`).
3. **Why Journal Debit/Credit Total is `70.2500` SAR vs `51.7500` SAR Payment:**
   Under perpetual inventory double-entry accounting, `JV-SALE-ORD-CASH-MWIW7MRX` posts two coupled economic events atomically:
   - **Customer Cash Receipt & Revenue/VAT (`51.7500` SAR):**
     - **Debit** `111001` (`خزينة الإدارة العامة (الرئيسية)` — shift cash vault): **`51.7500`**
     - **Credit** `411000` (`إيرادات مبيعات المطاعم والمشروبات` — `SALES` mapping): **`45.0000`**
     - **Credit** `212000` (`ضريبة القيمة المضافة المستحقة (مخرجات)` — `VAT_OUTPUT` mapping): **`6.7500`**
   - **Perpetual Inventory Issue & COGS Recognition (`18.5000` SAR):**
     - **Debit** `511000` (`تكلفة البضاعة المباعة (COGS)` — `COGS` mapping): **`18.5000`**
     - **Credit** `112000` (`مخزون المواد الغذائية والمستودعات` — `INVENTORY` mapping): **`18.5000`**
   - **Balance Proof:** `SUM(debit) = 51.7500 + 18.5000 = 70.2500` === `SUM(credit) = 45.0000 + 6.7500 + 18.5000 = 70.2500`.

---

## 3. Phase 4 Evidence — Printing Readiness (`apps/web/src/index.css` & `ReceiptPrintModal.tsx`)

- **80mm Thermal Profile (`.print-receipt-80mm`):** Width `72mm` (printable area within 80mm roll), `@page { margin: 6mm }`, `padding: 2mm 0`, `font-size: 11px`, `line-height: 1.4`, monochrome `#000000` on `#ffffff`, `dir="rtl"`.
- **A4 Tax Invoice Profile (`.print-receipt-a4`):** Width `100%`, `max-width: 196mm`, `padding: 4mm`, `font-size: 12px`, `line-height: 1.5`, `dir="rtl"`, `.print-avoid-break` on summary blocks.
- **Hardware Status:** Physical 80mm thermal printer and physical A4 paper output remain explicitly **`UNVERIFIED`**.

---

## 4. Release Readiness Conclusion

Batch 2 is **technically stabilized and verified** across code, builds, API validation (`54/54`), Staging DB financial integrity, and Playwright Chromium browser workflows, with **two explicit non-code gates remaining `UNVERIFIED`**:
1. Authorized commit/push & remote Staging CI/CD deployment.
2. Physical 80mm thermal & A4 hardware printer testing.
