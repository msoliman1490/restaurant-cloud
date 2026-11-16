# Restaurant Cloud — Migration Dependency Matrix (0000–0029)

**Date:** 2026-11-16
**Scope:** Read-only audit of `packages/database/drizzle/*.sql` (`30` files) and `meta/_journal.json` (`30` entries) vs Staging DB (`restaurant_cloud_staging`).

---

## 1. Summary Findings

- **Total Migration Files:** `30` (`0000` through `0029`), `100%` matched in `meta/_journal.json` and `public.__drizzle_migrations` on Staging.
- **Git Tracking Gap:** Only `0000`–`0007` (`8` files) are committed at `HEAD` (`6ce535c4`); **`0008`–`0029` (`22` files) are currently untracked (`??`)** and MUST be committed together.
- **Fresh DB Role Prerequisite:** `21` migrations (`0004`–`0008`, `0010`–`0012`, `0014`–`0024`, `0026`, `0029`) execute `GRANT ... TO rc_app_user` (or reference `rc_app_user` in RLS policies), but **none** of `0000`–`0029` runs `CREATE ROLE rc_app_user`. On a fresh PostgreSQL instance, `rc_app_user` MUST be provisioned before running migrations (via `packages/database/scripts/provision-staging-vps.sh` or `CREATE ROLE rc_app_user`).
- **Forward-Dependency Integrity:** `0` missing `ALTER TABLE` targets (`missingAlterTargets: []`); every `ALTER TABLE` in `0001`–`0029` targets a table created by an earlier migration.
- **Total Tables Created by `0000`–`0029`:** `125` tables (Staging DB has `127` tables: `124` app tables + `__drizzle_migrations` + legacy `item_barcodes` & `media_files` not referenced in Drizzle schema).

---

## 2. Complete Migration Matrix (0000–0029)

| File | Git Tracked | Tables Created | Tables Altered | RLS Policies | `rc_app_user` Grant | Idempotency Guards (`IF NOT EXISTS` / `DO $$`) |
|---|---|---|---|---|---|---|
| `0000_kind_luckman.sql` | Yes | 26 (tenants, groups, legal_entities, ...) | 23 (groups, legal_entities, branches, ...) | 0 | No | 0 |
| `0001_common_mordo.sql` | Yes | 12 (categories, units_of_measure, uom_conversions, ...) | 12 (categories, units_of_measure, uom_conversions, ...) | 0 | No | 0 |
| `0002_multi_industry_saas.sql` | Yes | 2 (tenant_subscriptions, tenant_industry_packs) | 2 (tenant_subscriptions, tenant_industry_packs) | 0 | No | 8 |
| `0003_global_crud_media.sql` | Yes | 1 (public) | 1 (public) | 0 | No | 13 |
| `0004_advanced_financial_engine.sql` | Yes | 10 (fiscal_periods, cost_centers, account_mappings, ...) | 3 (chart_of_accounts, journal_entries, journal_lines) | 0 | Yes | 52 |
| `0005_advanced_inventory_wms_phase_a.sql` | Yes | 1 (inventory_cost_layers) | 3 (warehouses, inventory_balances, inventory_movements) | 0 | Yes | 39 |
| `0006_advanced_wms_phase_b_transfers_stocktake.sql` | Yes | 2 (stocktake_orders, stocktake_lines) | 2 (stock_transfers, stock_transfer_lines) | 0 | Yes | 23 |
| `0007_business_partners_ar_ap_subledgers.sql` | Yes | 16 (business_partners, partner_roles, partner_addresses, ...) | 5 (purchase_order_lines, goods_receipt_lines, journal_lines, ...) | 0 | Yes | 48 |
| `0008_phase3_financial_resources_management.sql` | **No (Untracked)** | 3 (bank_account_branch_access, payment_methods, payment_terminals) | 4 (devices, bank_account_branch_access, payment_methods, ...) | 3 | Yes | 22 |
| `0009_phase3_account_mapping_branch_overrides.sql` | **No (Untracked)** | 0 | 1 (account_mappings) | 0 | No | 7 |
| `0010_phase3_recipes_and_production.sql` | **No (Untracked)** | 6 (recipes, recipe_ingredients, branch_recipe_overrides, ...) | 6 (recipes, branch_recipe_overrides, production_batches, ...) | 4 | Yes | 26 |
| `0011_dining_tables_and_voids.sql` | **No (Untracked)** | 4 (dining_tables, table_sessions, order_line_modifiers, ...) | 4 (dining_tables, table_sessions, order_voids, ...) | 3 | Yes | 17 |
| `0012_phase3_shift_cash_transactions.sql` | **No (Untracked)** | 1 (shift_cash_transactions) | 1 (shift_cash_transactions) | 1 | Yes | 5 |
| `0013_pos_shifts_closing_metadata.sql` | **No (Untracked)** | 0 | 1 (pos_shifts) | 0 | No | 10 |
| `0014_phase3_settlements_engine.sql` | **No (Untracked)** | 6 (settlement_providers, settlement_import_files, settlement_batches, ...) | 7 (payments, settlement_providers, settlement_import_files, ...) | 6 | Yes | 38 |
| `0015_phase3_interbranch_transfers.sql` | **No (Untracked)** | 1 (stock_transfer_discrepancies) | 3 (stock_transfers, stock_transfer_lines, stock_transfer_discrepancies) | 1 | Yes | 30 |
| `0016_phase3_reconciliation_and_reporting.sql` | **No (Untracked)** | 2 (financial_reconciliation_runs, financial_reconciliation_items) | 2 (financial_reconciliation_runs, financial_reconciliation_items) | 2 | Yes | 10 |
| `0017_phase3_6_period_closing.sql` | **No (Untracked)** | 2 (fiscal_years, fiscal_period_closing_logs) | 3 (fiscal_periods, fiscal_years, fiscal_period_closing_logs) | 2 | Yes | 19 |
| `0018_phase3_7_zatca_v2.sql` | **No (Untracked)** | 5 (zatca_legal_entity_configs, zatca_egs_certificates, zatca_documents, ...) | 5 (zatca_legal_entity_configs, zatca_egs_certificates, zatca_documents, ...) | 5 | Yes | 24 |
| `0019_hr_employees_attendance.sql` | **No (Untracked)** | 5 (employees, employee_branch_assignments, employee_shift_schedules, ...) | 5 (employees, employee_branch_assignments, employee_shift_schedules, ...) | 5 | Yes | 21 |
| `0020_delivery_drivers.sql` | **No (Untracked)** | 4 (delivery_zones, delivery_drivers, delivery_orders, ...) | 4 (delivery_zones, delivery_drivers, delivery_orders, ...) | 4 | Yes | 21 |
| `0021_hr_documents_advances_custody.sql` | **No (Untracked)** | 4 (employee_documents, employee_advances, employee_advance_transactions, ...) | 4 (employee_documents, employee_advances, employee_advance_transactions, ...) | 4 | Yes | 18 |
| `0022_dining_kitchen_tickets.sql` | **No (Untracked)** | 1 (kitchen_tickets) | 1 (kitchen_tickets) | 1 | Yes | 5 |
| `0023_purchasing_invoices_returns.sql` | **No (Untracked)** | 6 (supplier_invoices, supplier_invoice_lines, purchase_returns, ...) | 6 (supplier_invoices, supplier_invoice_lines, purchase_returns, ...) | 6 | Yes | 23 |
| `0024_integrations_notifications.sql` | **No (Untracked)** | 2 (tenant_integrations, notification_logs) | 2 (tenant_integrations, notification_logs) | 2 | Yes | 7 |
| `0025_integrations_security_retry.sql` | **No (Untracked)** | 0 | 1 (notification_logs) | 0 | No | 5 |
| `0026_webhook_replay_nonces.sql` | **No (Untracked)** | 1 (webhook_replay_nonces) | 1 (webhook_replay_nonces) | 1 | Yes | 4 |
| `0027_schema_parity_rls.sql` | **No (Untracked)** | 0 | 1 (sales_orders) | 1 | No | 4 |
| `0028_performance_indexes.sql` | **No (Untracked)** | 0 | 0 | 0 | No | 24 |
| `0029_purchase_requests_parity.sql` | **No (Untracked)** | 2 (purchase_requests, purchase_request_lines) | 2 (purchase_requests, purchase_request_lines) | 2 | Yes | 8 |
