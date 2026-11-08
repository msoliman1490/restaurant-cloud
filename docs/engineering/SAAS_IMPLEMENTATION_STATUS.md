# SaaS Implementation Status & Feature Breakdown

## 1. Monorepo Structural Inventory

Restaurant Cloud maintains a clean, modular monorepo powered by `pnpm` workspaces and Turborepo:

| Package / App | Path | Primary Role | Implementation Status |
| :--- | :--- | :--- | :--- |
| `@restaurant-cloud/domain-kernel` | `packages/domain-kernel` | Core business entities, enums, value objects, and capability registry. | **Complete & Verified** |
| `@restaurant-cloud/shared-contracts`| `packages/shared-contracts`| Zod schemas, API request/response DTOs, and industry contracts. | **Complete & Verified** |
| `@restaurant-cloud/database` | `packages/database` | Drizzle schema, PostgreSQL 16 migrations, and RLS policies. | **Complete & Verified** |
| `@restaurant-cloud/api` | `apps/api` | Modular Monolith NestJS + Fastify REST API with RLS session management. | **Complete & Verified** |
| `@restaurant-cloud/web` | `apps/web` | Unified React SPA dashboard with integrated POS and Control Plane. | **Complete & Verified** |
| `@restaurant-cloud/pos` | `apps/pos` | Specialized standalone PWA cashier build. | **Aligned & Integrated** |
| `@restaurant-cloud/branch-server` | `apps/branch-server` | Local edge edge-server for offline resilient store nodes. | **Integrated** |

---

## 2. Feature Classification Matrix

### 2.1 Fully Supported & Implemented in Code
The following modules are completely built, integrated with Drizzle ORM, enforced by RLS, and verified by 84 automated tests:

1. **Multi-Tenant Identity & RLS Security**:
   - PostgreSQL 16 `FORCE ROW LEVEL SECURITY` on all operational and subscription tables.
   - Non-superuser runtime role (`rc_app_user`) with `SET LOCAL app.current_tenant_id` session binding.
   - Cross-tenant data isolation verified under concurrency.
2. **Double-Entry General Ledger & Accounting Engine**:
   - Saudi standard Chart of Accounts.
   - Atomic balanced journal postings for sales, purchases, inventory adjustments, and production.
   - Real-time VAT 201 aggregation (Input VAT, Output VAT, Net VAT).
3. **Multi-Warehouse Real-Time Inventory Ledger**:
   - Strict double-entry stock ledger (`inventory_movements`) tracking all physical goods in/out.
   - Moving weighted average costing engine.
   - Stock transfers, wastage tracking, and stocktake adjustments.
4. **Sales Order State Machine & POS Checkout**:
   - Order lifecycle transitions (`DRAFT` $\rightarrow$ `OPEN` $\rightarrow$ `CONFIRMED` $\rightarrow$ `PAID` $\rightarrow$ `CANCELLED` $\rightarrow$ `REFUNDED`).
   - Integrated POS view in `apps/web` (`/pos`) with full-screen cashier mode.
   - Multi-tender payments (Cash, Card/Mada, Split tender).
5. **Multi-Industry SaaS Subscriptions & Entitlements Engine**:
   - `tenant_subscriptions` and `tenant_industry_packs` database tables.
   - Mathematical union of capabilities for multi-pack activation.
   - Server-side `@RequireCapability(...)` decorator and `IndustryEntitlementGuard` returning 403 Forbidden on violations.
   - Non-destructive pack deactivation preserving historical data.
   - Control Plane UI in `apps/web` (`/settings/industries`) for managing active packs.
6. **ZATCA Phase 2 E-Invoicing Foundation**:
   - Cryptographic hashing, ICV sequence generation, and TLV QR-code generation for Simplified Tax Invoices.
7. **Procurement & Goods Receipt (GRN)**:
   - Purchase orders, supplier invoices, goods receipt notes, and 3-way matching.
8. **Recipe & Bill of Materials (BOM)**:
   - Recipe management, ingredient cost rollups, and production batch execution.

### 2.2 Modified & Unified for Single SaaS Product
- **Unified Domain Architecture**:
  - Re-routed from multiple independent customer portals to **one single domain (`app.restaurantcloud.sa`)**.
  - Merged POS cashier operations into `apps/web/src/components/PosView.tsx` with dedicated Full-Screen cashier view, allowing cashiers to operate the register while business managers access back-office modules within the same URL root.
  - Sidebar navigation menu in `apps/web` dynamically evaluates `activeIndustries` from the SaaS Control Plane to render relevant operational tabs.

### 2.3 Ready for Pilot (Phase 2 Roadmap)
- Hardware Device Drivers: WebUSB and ESC/POS thermal printer network streaming for receipts.
- Arabic localized receipt layout with certified ZATCA B2C QR code visual preview.
- Hardware barcode scale serial port stream decoder (RS-232 / WebSerial).

### 2.4 Future Phases
- Centralized multi-tenant payment gateway subscription recurring billing integration (e.g. Moyasar / Tap Payments recurring webhooks).
- Mobile Cashier iOS/Android build via Capacitor wrapping the unified PWA.
