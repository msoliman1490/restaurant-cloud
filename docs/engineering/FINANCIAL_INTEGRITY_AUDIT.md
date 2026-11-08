# Restaurant Cloud — Financial Integrity & Accounting Audit

**Audit Date:** 2026-11-08  
**Standard:** Saudi Organization for Chartered and Professional Accountants (SOCPA) / IFRS for SMEs  
**Ledger Architecture:** Balanced Double-Entry System with Immutable Reversal Pattern  

---

## 1. Operational Event Accounting Impact Matrix

Every operational event in Restaurant Cloud deterministically generates an immutable, balanced General Ledger journal entry. No transaction occurs without immediate financial reflection.

| Operational Event | Source Module | Debited Account(s) | Credited Account(s) | Financial Rationale |
|---|---|---|---|---|
| **Goods Receipt / Supplier Invoice** | Purchasing & AP | `1200` Raw Materials Inventory<br>`1400` VAT Input Recoverable (15%) | `2100` Accounts Payable - Trade | Capitalizes purchased assets and records recoverable input tax against vendor liability. |
| **Supplier Payment Disbursement** | Purchasing & AP | `2100` Accounts Payable - Trade | `1010` Cash on Hand / `1020` Bank | Settles vendor liability from liquid assets (Cash/Bank). |
| **POS Sales Order (Paid)** | Sales & POS | `1010` Cash on Hand (Drawer) / `1020` Bank (mada) | `4100` F&B Sales Revenue<br>`2200` VAT Output Collected (15%) | Recognizes earned revenue and collects mandatory 15% VAT on behalf of ZATCA. |
| **Cost of Goods Sold (BOM Deduction)** | Inventory & Kitchen | `5100` Cost of Goods Sold - Food | `1300` Finished Goods / `1200` Raw Materials | Matches the cost of consumed ingredients with the period's sales revenue (Matching Principle). |
| **Kitchen Production Batch Run** | Kitchen & BOM | `1300` Finished Goods Inventory | `1200` Raw Materials Inventory | Transforms raw inventory into finished meal inventory without changing total asset value. |
| **Kitchen Waste & Spoilage** | Kitchen & BOM | `5200` Kitchen Waste & Spoilage Expense | `1200` Raw Materials / `1300` Finished Goods | Recognizes destroyed or spoiled ingredients as an operational period expense. |
| **Sales Order Refund / Reversal** | Sales & POS | `4100` F&B Sales Revenue (Contra)<br>`2200` VAT Output (Reversal) | `1010` Cash on Hand / `1020` Bank | Reverses previously recognized revenue and output tax upon customer refund. |
| **POS Shift Closing Shortage** | Sales & POS | `5300` Cash Shortage Expense | `1010` Cash on Hand (POS Drawer) | Writes down ledger cash to match physical blind count in the cash drawer. |
| **POS Shift Closing Overage** | Sales & POS | `1010` Cash on Hand (POS Drawer) | `4900` Miscellaneous Operating Income | Increments ledger cash to match excess physical cash found in the drawer. |

---

## 2. Double-Entry Parity & Account Mapping Verification

Across the automated test suite execution (covering Scenarios A through F and the Pilot Hardening suite), all journal entries were verified for mathematical equilibrium:

$$\sum \text{Debits} \equiv \sum \text{Credits}$$

### Mathematical Proof of Equilibrium (Test Sample)
1. **Sales Order #ORD-100 (100.00 Net + 15.00 VAT):**
   $$\text{Debit (1010 Cash)} = 115.0000\text{ SAR}$$
   $$\text{Credit (4100 Revenue)} = 100.0000\text{ SAR},\quad \text{Credit (2200 VAT)} = 15.0000\text{ SAR}$$
   $$\text{Total Debit} = 115.0000\text{ SAR} == \text{Total Credit} = 115.0000\text{ SAR}\quad (\text{Variance} = 0.0000)$$

2. **Supplier Invoice #INV-SUPP-501 (1,000.00 Subtotal + 150.00 VAT):**
   $$\text{Debit (1200 Raw Materials)} = 1,000.0000\text{ SAR},\quad \text{Debit (1400 VAT Input)} = 150.0000\text{ SAR}$$
   $$\text{Credit (2100 Accounts Payable)} = 1,150.0000\text{ SAR}$$
   $$\text{Total Debit} = 1,150.0000\text{ SAR} == \text{Total Credit} = 1,150.0000\text{ SAR}\quad (\text{Variance} = 0.0000)$$

3. **Supplier Partial Payment #SPMT-001 (500.00 SAR):**
   $$\text{Debit (2100 Accounts Payable)} = 500.0000\text{ SAR}$$
   $$\text{Credit (1020 Bank Transfer)} = 500.0000\text{ SAR}$$
   $$\text{Total Debit} = 500.0000\text{ SAR} == \text{Total Credit} = 500.0000\text{ SAR}\quad (\text{Variance} = 0.0000)$$

---

## 3. Subledger-to-General Ledger Reconciliation Report

| Subsidiary Subledger | General Ledger Control Account | Subledger Sum (SAR) | GL Control Balance (SAR) | Variance (SAR) | Status |
|---|---|---|---|---|---|
| **Accounts Payable Subledger** (`supplier_balances`) | `2100` Accounts Payable - Trade | 650.0000 | 650.0000 Cr | 0.0000 | **MATCHED** |
| **Raw Materials Inventory** (`inventory_cost_layers`) | `1200` Raw Materials Inventory | 870.0000 | 870.0000 Dr | 0.0000 | **MATCHED** |
| **Finished Goods Inventory** (`inventory_cost_layers`) | `1300` Finished Goods Inventory | 91.0000 | 91.0000 Dr | 0.0000 | **MATCHED** |
| **VAT Input Tax Subledger** (Purchasing Invoices) | `1400` VAT Input Tax Recoverable | 150.0000 | 150.0000 Dr | 0.0000 | **MATCHED** |
| **VAT Output Tax Subledger** (Sales Invoices) | `2200` VAT Output Tax Collected | 10.1300 | 10.1300 Cr | 0.0000 | **MATCHED** |
| **POS Drawer Physical Cash** (Shift Count) | `1010` Cash on Hand - POS Drawer | 250.0000 | 250.0000 Dr | 0.0000 | **MATCHED** |

**Grand Trial Balance Variance Across All Accounts:** **0.0000 SAR**.

---

## 4. Immutability & Reversal Standard

1. **Direct Modification Blocked:**
   - Any attempt to execute `UPDATE journal_entries`, `UPDATE journal_lines`, `DELETE FROM journal_entries`, or `DELETE FROM journal_lines` is rejected by application architecture and database triggers.
2. **Compensating Reversals:**
   - When a refund, void, or payment recall is approved, the system generates a distinct reversing journal entry with inverted debits and credits and links `source_type` (e.g. `supplier_payment_cancellation`, `sales_refund`).
   - The historical audit trail is preserved intact for statutory audit compliance.
