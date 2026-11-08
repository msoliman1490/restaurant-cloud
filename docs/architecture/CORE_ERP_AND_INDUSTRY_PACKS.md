# Core ERP vs. Industry Packs Specification

## 1. Architectural Philosophy

In Restaurant Cloud, **Core ERP** represents the generic, invariant business engines that power every commerce operation in the Kingdom of Saudi Arabia. **Industry Packs** are specialized modular layers that attach to the Core ERP to tailor user interfaces, workflows, and operational mechanics to specific retail and hospitality sectors.

```
+-----------------------------------------------------------------------------------+
|                            Unified SaaS Web Portal (SPA)                          |
+-----------------------------------------------------------------------------------+
|                                Industry Packs                                     |
|  [ Restaurants ]   [ Cafes ]   [ Grocery ]   [ Bakeries ]  [ Catering ]  [ Retail ]|
+-----------------------------------------------------------------------------------+
|                                 Core ERP Engine                                   |
|   Double-Entry Accounting  |  Real-Time Inventory  |  ZATCA Phase 2 E-Invoicing   |
|   Procurement & 3-Way Match|  Sales State Machine  |  Multi-Branch / Multi-Entity |
+-----------------------------------------------------------------------------------+
|                           PostgreSQL 16 Engine with RLS                           |
+-----------------------------------------------------------------------------------+
```

---

## 2. Core ERP Capabilities (Shared Across All Industries)

Every tenant onboarded into Restaurant Cloud inherits the following core ERP modules:

### 2.1 Double-Entry General Ledger & Accounting
- **Saudi Standard Chart of Accounts (COA)**: Standardized accounts for Cash, Banks, Accounts Receivable, Inventory Asset, Accounts Payable, VAT In (Input), VAT Out (Output), Sales Revenue, Cost of Goods Sold (COGS), and Waste/Spoilage.
- **Atomic Journal Posting**: Automated balanced debit/credit posting for every commercial transaction (Sales Order paid, Supplier Invoice approved, Inventory Adjustment posted, Production run completed).
- **ZATCA VAT 201 Tax Return**: Real-time aggregation of Output VAT, Input VAT, and net tax liability.
- **Period Locks**: Fiscal period locking to prevent backdated entries.

### 2.2 Perpetual Multi-Warehouse Inventory Ledger
- **Strict Double-Entry Stock Ledger**: Quantities never update with raw `UPDATE stock SET qty = qty - 1`. Every movement generates an immutable row in `inventory_movements` with source, destination, unit cost, and total value.
- **Costing Engines**: Dynamic calculation of moving weighted average and FIFO valuation.
- **Multi-Warehouse Topology**: Support for Central Warehouses, Branch Stores, and POS Cashier Stock locations with stock transfer orders and approvals.

### 2.3 Sales Order & Financial State Machine
- Standardized order lifecycle states:
  - `DRAFT` $\rightarrow$ Order created, cart populated.
  - `OPEN` $\rightarrow$ Order opened on table or register.
  - `CONFIRMED` $\rightarrow$ Inventory committed/reserved.
  - `PAID` $\rightarrow$ Payment captured, stock consumed, revenue and VAT recognized.
  - `CANCELLED` $\rightarrow$ Order voided prior to payment; commitments released.
  - `PARTIALLY_REFUNDED` / `REFUNDED` $\rightarrow$ Reverse journals created, stock re-entered if items returned to shelf.

### 2.4 ZATCA Phase 2 E-Invoicing
- Standard Tax Invoices (B2B, `388`) with digital signatures and XML generation.
- Simplified Tax Invoices (B2C, `381`) with cryptographic hashes, invoice counter sequence (ICV), and dynamic QR codes containing Seller Name, VAT Number, Timestamp, Total with VAT, and VAT Amount.

### 2.5 Procurement & Supplier Management
- Supplier directory, Purchase Orders (PO), Goods Receipt Notes (GRN), and 3-way matching between PO, GRN, and Supplier Tax Invoice.
- Payment vouchers and Accounts Payable aging.

### 2.6 Multi-Tenant & Multi-Entity Hierarchy
- Tenant $\rightarrow$ Legal Entity $\rightarrow$ Branch $\rightarrow$ Warehouse $\rightarrow$ POS Terminal / Device.
- Granular Role-Based Access Control (RBAC) with scoped memberships.

---

## 3. Detailed Industry Pack Specifications

### 3.1 Restaurant Pack (`RESTAURANT`)
Designed for full-service table dining, casual dining, and fast-food eateries.
- **Table & Seating Management**: Real-time floor plan layout, table status tracking (`AVAILABLE`, `OCCUPIED`, `RESERVED`, `DIRTY`), and visual seating map.
- **Dining Bill Operations**: Bill splitting (by seat or by fraction), guest count tracking, and table transfers.
- **Kitchen Display System (KDS)**: Real-time routing of order tickets to hot kitchen, cold pantry, and beverage stations with preparation timers.
- **Recipe & Bill of Materials (BOM)**: Standardized dish recipes defining raw ingredient usage (e.g., 180g beef patty, 1 brioche bun, 20g sauce) to automatically deduct raw stock and calculate exact food cost per dish.
- **Modifier System**: Forced modifiers (e.g., meat temperature: Medium, Well Done) and optional modifiers (e.g., extra cheese, no pickles).

### 3.2 Cafe & Specialty Coffee Pack (`CAFE`)
Designed for specialty coffee houses, drive-thru lanes, and grab-and-go kiosks.
- **Beverage Size Matrices**: Multi-tier pricing and recipe scaling for Small, Medium, Large cups.
- **Milk & Syrup Customizations**: Add-on tracking (Oat milk, Almond milk, Sugar-free vanilla syrup) with automatic ingredient deduction.
- **Quick-Counter POS**: High-throughput POS interface optimized for sub-10-second order entry.
- **Customer Loyalty Points**: Integration of visit stamps and redeemable reward points.

### 3.3 Grocery & Supermarket Pack (`GROCERY`)
Designed for supermarkets, minimarts, convenience stores, and wholesale bodegas.
- **Continuous Barcode Scanning**: Hardware barcode scanner listener that immediately appends scanned GS1 / EAN-13 barcodes to the active cart without manual clicks.
- **Integrated Weighing Scales**: Parsing of embedded weight barcodes (e.g., prefix `21` or `28` containing weight or total price) for fruits, vegetables, and bulk deli meats.
- **Expiration Date & Lot Tracking**: Tracking batch expiration dates for perishable retail goods with warning alerts when near expiry.
- **High-Density Inventory**: Rapid replenishment, supplier box-to-unit conversions, and shelf price tag printing.

### 3.4 Bakery Pack (`BAKERY`)
Designed for artisan bakeries, pastry kitchens, and commercial bread manufacturers.
- **Batch Production Management**: Production orders for large dough batches yielding hundreds of loaves or pastries.
- **Dough Yield & Scrap Calculation**: Tracking flour hydration, dough scaling loss, and bake evaporation loss.
- **Daily Freshness Expiration**: Automatic shelf-life expiration at end-of-day with one-click clearance markdown or waste posting.
- **Production Waste Ledger**: Tracking raw scrap vs. burnt/defective finished products.

### 3.5 Catering Pack (`CATERING`)
Designed for event catering companies and corporate meal supply services.
- **Event & Banquet Bookings**: Advance scheduling of corporate buffets, weddings, and private dinners.
- **Per-Person Menu Engineering**: Package pricing per guest (e.g., SAR 150/guest for 3-course menu).
- **Deposit & Milestone Payments**: Staged billing (50% deposit upon booking, 50% upon event delivery).
- **Delivery & Equipment Logistics**: Tracking chafing dishes, warmers, cutlery, and service personnel.

### 3.6 Retail Pack (`RETAIL`)
Designed for apparel boutiques, gift shops, and specialty goods retailers.
- **Matrix Product Grid**: Multi-dimensional variants (e.g., T-Shirt in Sizes S/M/L/XL across Colors Black/White/Navy).
- **Serial Number Tracking**: Tracking unique serial numbers for electronics and high-value accessories.
- **Gift Cards & Store Credits**: Issuance and redemption of store credit vouchers.

---

## 4. Industry Pack Activation Matrix

| Module | Core ERP | Restaurant | Cafe | Grocery | Bakery | Catering | Retail |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Chart of Accounts & GL | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |
| Inventory Movements & FIFO | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |
| ZATCA E-Invoicing Phase 2 | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |
| Procurement & POs | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |
| Table Management & KDS | No | **Yes** | No | No | No | No | No |
| Beverage Customizations | No | Optional | **Yes** | No | No | No | No |
| Continuous Barcode POS | No | No | No | **Yes** | No | No | **Yes** |
| Weighing Scale Support | No | No | No | **Yes** | No | No | No |
| Batch Baking Recipes | No | No | No | No | **Yes** | No | No |
| Event Bookings & Deposits | No | No | No | No | No | **Yes** | No |
| Variant Matrix (Size/Color) | No | No | No | No | No | No | **Yes** |
