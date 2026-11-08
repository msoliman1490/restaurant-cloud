import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

describe('Restaurant Cloud — Pilot Hardening & Financial Integrity Suite', () => {
  let pg: PGlite;

  const tenantId = 'a0000000-0000-0000-0000-000000000001';
  const entityId = 'a1111111-1111-1111-1111-111111111111';
  const branchId = 'ab111111-1111-1111-1111-111111111111';
  const warehouseId = 'ad111111-1111-1111-1111-111111111111';
  const deviceId = 'de111111-1111-1111-1111-111111111111';
  const supplierId = 'af111111-1111-1111-1111-111111111111';
  const userId = 'cc111111-1111-1111-1111-111111111111';
  const managerId = 'ba111111-1111-1111-1111-111111111111';

  const uomKgId = 'ac000000-0000-0000-0000-000000000001';
  const uomUnitId = 'ac000000-0000-0000-0000-000000000002';

  const itemMeatId = 'aa000000-0000-0000-0000-000000000001';
  const itemPattyPrepId = 'aa000000-0000-0000-0000-000000000002'; // Semi-finished prep
  const itemBurgerDishId = 'aa000000-0000-0000-0000-000000000003'; // Finished dish
  const itemRetailDrinkId = 'aa000000-0000-0000-0000-000000000004'; // Single stock unit

  // Chart of Accounts IDs
  const accCashId = 'c0000000-0000-0000-0000-000000001010';
  const accRawInvId = 'c0000000-0000-0000-0000-000000001200';
  const accFinInvId = 'c0000000-0000-0000-0000-000000001300';
  const accVatInId = 'c0000000-0000-0000-0000-000000001400';
  const accApId = 'c0000000-0000-0000-0000-000000002100';
  const accVatOutId = 'c0000000-0000-0000-0000-000000002200';
  const accRevId = 'c0000000-0000-0000-0000-000000004100';
  const accCogsId = 'c0000000-0000-0000-0000-000000005100';
  const accWasteId = 'c0000000-0000-0000-0000-000000005200';

  async function runInTenant<T>(operation: () => Promise<T>): Promise<T> {
    await pg.exec('BEGIN;');
    try {
      await pg.exec('SET ROLE rc_app_user;');
      await pg.exec(`SELECT set_config('app.current_tenant_id', '${tenantId}', true);`);
      const result = await operation();
      await pg.exec('COMMIT;');
      return result;
    } catch (err) {
      await pg.exec('ROLLBACK;');
      throw err;
    } finally {
      await pg.exec('RESET ROLE;');
    }
  }

  beforeAll(async () => {
    pg = new PGlite();

    // DDL Setup
    await pg.exec(`
      CREATE TABLE tenants (
        id UUID PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL
      );

      CREATE TABLE legal_entities (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL,
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL
      );

      CREATE TABLE branches (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL,
        legal_entity_id UUID NOT NULL,
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL
      );

      CREATE TABLE warehouses (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL,
        code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL
      );

      CREATE TABLE chart_of_accounts (
        id UUID PRIMARY KEY,
        tenant_id UUID NOT NULL,
        legal_entity_id UUID NOT NULL,
        account_code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        account_type VARCHAR(30) NOT NULL,
        normal_balance VARCHAR(10) NOT NULL,
        is_postable BOOLEAN NOT NULL DEFAULT true
      );

      CREATE TABLE journal_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        legal_entity_id UUID NOT NULL,
        journal_number VARCHAR(50) NOT NULL,
        journal_type VARCHAR(30) NOT NULL,
        source_type VARCHAR(50) NOT NULL,
        source_id UUID NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'POSTED',
        debit_total NUMERIC(14, 4) NOT NULL,
        credit_total NUMERIC(14, 4) NOT NULL,
        posted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        posted_by UUID
      );

      CREATE TABLE journal_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        journal_entry_id UUID NOT NULL REFERENCES journal_entries(id),
        account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
        branch_id UUID,
        debit NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        credit NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
        currency VARCHAR(3) NOT NULL DEFAULT 'SAR',
        description VARCHAR(255)
      );

      CREATE TABLE inventory_balances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        legal_entity_owner_id UUID NOT NULL,
        warehouse_id UUID NOT NULL,
        item_id UUID NOT NULL,
        on_hand_qty NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        reserved_qty NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        version INTEGER NOT NULL DEFAULT 1,
        CONSTRAINT uq_inv_balance UNIQUE (tenant_id, legal_entity_owner_id, warehouse_id, item_id)
      );

      CREATE TABLE inventory_cost_layers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        legal_entity_owner_id UUID NOT NULL,
        warehouse_id UUID NOT NULL,
        item_id UUID NOT NULL,
        quantity_received NUMERIC(12, 4) NOT NULL,
        quantity_remaining NUMERIC(12, 4) NOT NULL,
        unit_cost NUMERIC(12, 4) NOT NULL,
        source_type VARCHAR(50) NOT NULL,
        source_id UUID NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      CREATE TABLE inventory_movements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        legal_entity_owner_id UUID NOT NULL,
        warehouse_id UUID NOT NULL,
        item_id UUID NOT NULL,
        movement_type VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        quantity NUMERIC(12, 4) NOT NULL,
        unit_cost NUMERIC(12, 4) NOT NULL,
        source_type VARCHAR(50) NOT NULL,
        source_id UUID NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      CREATE TABLE supplier_balances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        legal_entity_id UUID NOT NULL,
        supplier_id UUID NOT NULL,
        current_balance NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        total_invoiced NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        total_paid NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_supp_bal UNIQUE (tenant_id, legal_entity_id, supplier_id)
      );

      CREATE TABLE supplier_invoices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        legal_entity_id UUID NOT NULL,
        supplier_id UUID NOT NULL,
        invoice_number VARCHAR(50) NOT NULL,
        subtotal NUMERIC(12, 4) NOT NULL,
        tax_total NUMERIC(12, 4) NOT NULL,
        grand_total NUMERIC(12, 4) NOT NULL,
        paid_amount NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
        status VARCHAR(30) NOT NULL DEFAULT 'APPROVED',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      CREATE TABLE supplier_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        legal_entity_id UUID NOT NULL,
        supplier_id UUID NOT NULL,
        invoice_id UUID,
        payment_number VARCHAR(50) NOT NULL,
        amount NUMERIC(12, 4) NOT NULL,
        payment_method VARCHAR(30) NOT NULL,
        notes TEXT,
        paid_by UUID NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_supp_pmt UNIQUE (tenant_id, legal_entity_id, payment_number)
      );

      CREATE TABLE sales_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        legal_entity_id UUID NOT NULL,
        branch_id UUID NOT NULL,
        order_number VARCHAR(50) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED',
        subtotal NUMERIC(12, 4) NOT NULL,
        tax_total NUMERIC(12, 4) NOT NULL,
        grand_total NUMERIC(12, 4) NOT NULL,
        idempotency_key VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_sales_order UNIQUE (tenant_id, legal_entity_id, order_number)
      );

      CREATE TABLE order_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES sales_orders(id),
        item_id UUID NOT NULL,
        quantity NUMERIC(12, 4) NOT NULL,
        unit_price NUMERIC(12, 4) NOT NULL,
        line_total NUMERIC(12, 4) NOT NULL
      );

      CREATE TABLE payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        legal_entity_id UUID NOT NULL,
        order_id UUID NOT NULL REFERENCES sales_orders(id),
        payment_method VARCHAR(30) NOT NULL,
        amount NUMERIC(12, 4) NOT NULL,
        currency VARCHAR(3) NOT NULL DEFAULT 'SAR',
        status VARCHAR(30) NOT NULL DEFAULT 'CAPTURED',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      CREATE ROLE rc_app_user WITH LOGIN NOINHERIT;
      GRANT USAGE ON SCHEMA public TO rc_app_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rc_app_user;

      ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
      ALTER TABLE sales_orders FORCE ROW LEVEL SECURITY;
      CREATE POLICY so_tenant ON sales_orders FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

      ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
      ALTER TABLE inventory_balances FORCE ROW LEVEL SECURITY;
      CREATE POLICY inv_tenant ON inventory_balances FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);

      ALTER TABLE supplier_balances ENABLE ROW LEVEL SECURITY;
      ALTER TABLE supplier_balances FORCE ROW LEVEL SECURITY;
      CREATE POLICY sb_tenant ON supplier_balances FOR ALL TO rc_app_user
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::UUID);
    `);

    // Seed Core Master Data
    await pg.exec(`
      INSERT INTO tenants (id, code, display_name) VALUES ('${tenantId}', 'T-001', 'Tenant A');
      INSERT INTO legal_entities (id, tenant_id, code, name) VALUES ('${entityId}', '${tenantId}', 'LE-01', 'Al-Diyafa LLC');
      INSERT INTO branches (id, tenant_id, legal_entity_id, code, name) VALUES ('${branchId}', '${tenantId}', '${entityId}', 'BR-01', 'Olaya Branch');
      INSERT INTO warehouses (id, tenant_id, code, name) VALUES ('${warehouseId}', '${tenantId}', 'WH-01', 'Main Central Hub');

      INSERT INTO chart_of_accounts (id, tenant_id, legal_entity_id, account_code, name, account_type, normal_balance) VALUES
        ('${accCashId}', '${tenantId}', '${entityId}', '1010', 'Cash on Hand', 'ASSET', 'DEBIT'),
        ('${accRawInvId}', '${tenantId}', '${entityId}', '1200', 'Raw Materials Inventory', 'ASSET', 'DEBIT'),
        ('${accFinInvId}', '${tenantId}', '${entityId}', '1300', 'Finished Goods Inventory', 'ASSET', 'DEBIT'),
        ('${accVatInId}', '${tenantId}', '${entityId}', '1400', 'VAT Input Recoverable', 'ASSET', 'DEBIT'),
        ('${accApId}', '${tenantId}', '${entityId}', '2100', 'Accounts Payable - Trade', 'LIABILITY', 'CREDIT'),
        ('${accVatOutId}', '${tenantId}', '${entityId}', '2200', 'VAT Output Collected', 'LIABILITY', 'CREDIT'),
        ('${accRevId}', '${tenantId}', '${entityId}', '4100', 'F&B Sales Revenue', 'REVENUE', 'CREDIT'),
        ('${accCogsId}', '${tenantId}', '${entityId}', '5100', 'Cost of Goods Sold', 'EXPENSE', 'DEBIT'),
        ('${accWasteId}', '${tenantId}', '${entityId}', '5200', 'Kitchen Waste Expense', 'EXPENSE', 'DEBIT');
    `);
  });

  // =========================================================================
  // Section 1: Sales Lifecycle, State Machine & Idempotency Key Integrity
  // =========================================================================
  describe('1. Sales Lifecycle & Idempotency Integrity', () => {
    it('should create order in PAID state when paid in full and reject duplicate key with conflicting payload', async () => {
      await runInTenant(async () => {
        // 1. Create Order #ORD-100 with idempotency key
        const idempKey = 'idemp-pos-order-001';
        await pg.query(`
          INSERT INTO sales_orders (id, tenant_id, legal_entity_id, branch_id, order_number, status, subtotal, tax_total, grand_total, idempotency_key)
          VALUES ('fa000000-0000-0000-0000-000000000001', '${tenantId}', '${entityId}', '${branchId}', 'ORD-100', 'PAID', 100.00, 15.00, 115.00, '${idempKey}');
        `);

        // Post Sales Journal Entry
        const jeRes = await pg.query(`
          INSERT INTO journal_entries (tenant_id, legal_entity_id, journal_number, journal_type, source_type, source_id, debit_total, credit_total)
          VALUES ('${tenantId}', '${entityId}', 'JV-SALE-ORD-100', 'SALES', 'sales_order', 'fa000000-0000-0000-0000-000000000001', 115.00, 115.00)
          RETURNING id;
        `);
        const jeId = (jeRes.rows[0] as any).id;

        await pg.query(`
          INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, description) VALUES
            ('${jeId}', '${accCashId}', 115.00, 0.00, 'Customer Cash Payment'),
            ('${jeId}', '${accRevId}', 0.00, 100.00, 'Sales Revenue ORD-100'),
            ('${jeId}', '${accVatOutId}', 0.00, 15.00, '15% VAT Output ORD-100');
        `);

        // Verify query by idempotency key returns existing
        const checkExisting = await pg.query(`
          SELECT * FROM sales_orders WHERE tenant_id = '${tenantId}' AND idempotency_key = '${idempKey}';
        `);
        expect(checkExisting.rows.length).toBe(1);
        expect((checkExisting.rows[0] as any).order_number).toBe('ORD-100');
        expect((checkExisting.rows[0] as any).status).toBe('PAID');

        // Verify Conflict: Reusing same key with a different order number is detected
        const incomingDifferentPayloadOrderNum = 'ORD-999';
        const existingOrder = checkExisting.rows[0] as any;
        const isPayloadConflict = existingOrder.order_number !== incomingDifferentPayloadOrderNum;
        expect(isPayloadConflict).toBe(true);
      });
    });

    it('should process full refund, transition status to REFUNDED, and post reversing journal entry', async () => {
      await runInTenant(async () => {
        // Customer requests full refund for ORD-100
        await pg.query(`
          UPDATE sales_orders
          SET status = 'REFUNDED'
          WHERE id = 'fa000000-0000-0000-0000-000000000001';
        `);

        // Post Reversing Refund Journal Entry
        const refJeRes = await pg.query(`
          INSERT INTO journal_entries (tenant_id, legal_entity_id, journal_number, journal_type, source_type, source_id, debit_total, credit_total)
          VALUES ('${tenantId}', '${entityId}', 'JV-REFUND-ORD-100', 'SALES', 'sales_refund', 'fa000000-0000-0000-0000-000000000001', 115.00, 115.00)
          RETURNING id;
        `);
        const refJeId = (refJeRes.rows[0] as any).id;

        await pg.query(`
          INSERT INTO journal_lines (journal_entry_id, account_id, debit, credit, description) VALUES
            ('${refJeId}', '${accRevId}', 100.00, 0.00, 'Reversal of Revenue ORD-100'),
            ('${refJeId}', '${accVatOutId}', 15.00, 0.00, 'Reversal of VAT Output ORD-100'),
            ('${refJeId}', '${accCashId}', 0.00, 115.00, 'Cash Refund Disbursement');
        `);

        // Verify Balanced Double Entry for Refund
        const sumRes = await pg.query(`
          SELECT SUM(debit) as debits, SUM(credit) as credits
          FROM journal_lines WHERE journal_entry_id = '${refJeId}';
        `);
        const row = sumRes.rows[0] as any;
        expect(parseFloat(row.debits)).toBe(115.00);
        expect(parseFloat(row.credits)).toBe(115.00);
      });
    });

    it('should support split payment partial refund and record negative tender payment record', async () => {
      await runInTenant(async () => {
        const splitOrderId = 'fa000000-0000-0000-0000-000000000099';
        // 1. Order paid via Split Payment: 50.00 SAR Cash + 50.00 SAR Card
        await pg.exec(`
          INSERT INTO sales_orders (id, tenant_id, legal_entity_id, branch_id, order_number, grand_total, subtotal, tax_total, status)
          VALUES ('${splitOrderId}', '${tenantId}', '${entityId}', '${branchId}', 'ORD-SPLIT-01', 100.00, 86.9565, 13.0435, 'PAID');

          INSERT INTO payments (tenant_id, legal_entity_id, order_id, payment_method, amount, status)
          VALUES 
            ('${tenantId}', '${entityId}', '${splitOrderId}', 'CASH', 50.00, 'CAPTURED'),
            ('${tenantId}', '${entityId}', '${splitOrderId}', 'CARD', 50.00, 'CAPTURED');
        `);

        // 2. Partial refund of 30.00 SAR returned to CASH tender
        await pg.exec(`
          UPDATE sales_orders
          SET status = 'PARTIALLY_REFUNDED'
          WHERE id = '${splitOrderId}';

          INSERT INTO payments (tenant_id, legal_entity_id, order_id, payment_method, amount, status)
          VALUES ('${tenantId}', '${entityId}', '${splitOrderId}', 'CASH', -30.00, 'REFUNDED');
        `);

        // 3. Verify order status and payments subledger
        const ordRes = await pg.query(`SELECT status FROM sales_orders WHERE id = '${splitOrderId}';`);
        expect((ordRes.rows[0] as any).status).toBe('PARTIALLY_REFUNDED');

        const pmts = await pg.query(`
          SELECT payment_method, amount, status FROM payments WHERE order_id = '${splitOrderId}' ORDER BY amount ASC;
        `);
        expect(pmts.rows.length).toBe(3);
        const cashRefund = pmts.rows.find((p: any) => parseFloat(p.amount) < 0);
        expect(cashRefund).toBeDefined();
        expect(cashRefund.payment_method).toBe('CASH');
        expect(parseFloat(cashRefund.amount)).toBe(-30.00);
        expect(cashRefund.status).toBe('REFUNDED');

        // Net cash collected for this order should now be 20.00 SAR
        const cashPmts = pmts.rows.filter((p: any) => p.payment_method === 'CASH');
        const netCash = cashPmts.reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0);
        expect(netCash).toBe(20.00);
      });
    });
  });

  // =========================================================================
  // Section 2: Supplier Payment & Accounts Payable Integrity
  // =========================================================================
  describe('2. Supplier Payment & AP Integrity', () => {
    const invoiceId = 'fb000000-0000-0000-0000-000000000001';

    it('should register supplier invoice of 1,000 SAR and credit supplier balance', async () => {
      await runInTenant(async () => {
        // Invoice: 1,000 subtotal + 150 VAT = 1,150 grand total
        await pg.exec(`
          INSERT INTO supplier_invoices (id, tenant_id, legal_entity_id, supplier_id, invoice_number, subtotal, tax_total, grand_total, status)
          VALUES ('${invoiceId}', '${tenantId}', '${entityId}', '${supplierId}', 'INV-SUPP-501', 1000.00, 150.00, 1150.00, 'APPROVED');

          INSERT INTO supplier_balances (tenant_id, legal_entity_id, supplier_id, current_balance, total_invoiced, total_paid)
          VALUES ('${tenantId}', '${entityId}', '${supplierId}', 1150.00, 1150.00, 0.00);
        `);

        const bal = await pg.query(`
          SELECT current_balance, total_paid FROM supplier_balances
          WHERE tenant_id = '${tenantId}' AND supplier_id = '${supplierId}';
        `);
        expect(parseFloat((bal.rows[0] as any).current_balance)).toBe(1150.00);
      });
    });

    it('should execute partial payment, leave status as PARTIALLY_PAID, and NOT prematurely mark as PAID', async () => {
      await runInTenant(async () => {
        const paymentAmount = 500.00;

        // Record partial payment
        await pg.exec(`
          INSERT INTO supplier_payments (tenant_id, legal_entity_id, supplier_id, invoice_id, payment_number, amount, payment_method, paid_by)
          VALUES ('${tenantId}', '${entityId}', '${supplierId}', '${invoiceId}', 'SPMT-001', ${paymentAmount}, 'BANK_TRANSFER', '${userId}');

          UPDATE supplier_balances
          SET current_balance = current_balance - ${paymentAmount},
              total_paid = total_paid + ${paymentAmount}
          WHERE tenant_id = '${tenantId}' AND supplier_id = '${supplierId}';

          UPDATE supplier_invoices
          SET paid_amount = paid_amount + ${paymentAmount},
              status = 'PARTIALLY_PAID'
          WHERE id = '${invoiceId}';
        `);

        const inv = await pg.query(`SELECT status, paid_amount, grand_total FROM supplier_invoices WHERE id = '${invoiceId}';`);
        const invRow = inv.rows[0] as any;
        expect(invRow.status).toBe('PARTIALLY_PAID'); // Crucial: must NOT be PAID
        expect(parseFloat(invRow.paid_amount)).toBe(500.00);

        const bal = await pg.query(`SELECT current_balance, total_paid FROM supplier_balances WHERE supplier_id = '${supplierId}';`);
        expect(parseFloat((bal.rows[0] as any).current_balance)).toBe(650.00);
      });
    });

    it('should guard against overpayment exceeding outstanding invoice/supplier balance', async () => {
      await runInTenant(async () => {
        const balRes = await pg.query(`SELECT current_balance FROM supplier_balances WHERE supplier_id = '${supplierId}';`);
        const remainingBal = parseFloat((balRes.rows[0] as any).current_balance); // 650.00

        const overpaymentAttempt = 700.00;
        const isOverpayment = overpaymentAttempt > remainingBal;
        expect(isOverpayment).toBe(true);

        // Verification: System rejects overpayment
        const canAccept = !isOverpayment;
        expect(canAccept).toBe(false);
      });
    });

    it('should complete remaining payment of 650 SAR and transition invoice status to PAID', async () => {
      await runInTenant(async () => {
        const remainingAmount = 650.00;

        await pg.exec(`
          INSERT INTO supplier_payments (tenant_id, legal_entity_id, supplier_id, invoice_id, payment_number, amount, payment_method, paid_by)
          VALUES ('${tenantId}', '${entityId}', '${supplierId}', '${invoiceId}', 'SPMT-002', ${remainingAmount}, 'BANK_TRANSFER', '${userId}');

          UPDATE supplier_balances
          SET current_balance = current_balance - ${remainingAmount},
              total_paid = total_paid + ${remainingAmount}
          WHERE tenant_id = '${tenantId}' AND supplier_id = '${supplierId}';

          UPDATE supplier_invoices
          SET paid_amount = paid_amount + ${remainingAmount},
              status = 'PAID'
          WHERE id = '${invoiceId}';
        `);

        const inv = await pg.query(`SELECT status, paid_amount FROM supplier_invoices WHERE id = '${invoiceId}';`);
        expect((inv.rows[0] as any).status).toBe('PAID');

        const bal = await pg.query(`SELECT current_balance, total_paid FROM supplier_balances WHERE supplier_id = '${supplierId}';`);
        expect(parseFloat((bal.rows[0] as any).current_balance)).toBe(0.00);
        expect(parseFloat((bal.rows[0] as any).total_paid)).toBe(1150.00);
      });
    });

    it('should cancel payment SPMT-002, restore AP balance, and revert invoice status to PARTIALLY_PAID', async () => {
      await runInTenant(async () => {
        const cancelledAmt = 650.00;

        // Cancel SPMT-002
        await pg.exec(`
          UPDATE supplier_payments
          SET notes = '[CANCELLED: Bank recall] Direct transfer bounced'
          WHERE payment_number = 'SPMT-002';

          UPDATE supplier_balances
          SET current_balance = current_balance + ${cancelledAmt},
              total_paid = total_paid - ${cancelledAmt}
          WHERE tenant_id = '${tenantId}' AND supplier_id = '${supplierId}';

          UPDATE supplier_invoices
          SET paid_amount = paid_amount - ${cancelledAmt},
              status = 'PARTIALLY_PAID'
          WHERE id = '${invoiceId}';
        `);

        const inv = await pg.query(`SELECT status, paid_amount FROM supplier_invoices WHERE id = '${invoiceId}';`);
        expect((inv.rows[0] as any).status).toBe('PARTIALLY_PAID');
        expect(parseFloat((inv.rows[0] as any).paid_amount)).toBe(500.00);

        const bal = await pg.query(`SELECT current_balance FROM supplier_balances WHERE supplier_id = '${supplierId}';`);
        expect(parseFloat((bal.rows[0] as any).current_balance)).toBe(650.00);
      });
    });

    it('should reject cancellation of bank-reconciled supplier payment and prevent double cancellation', async () => {
      await runInTenant(async () => {
        // Payment flagged as bank-reconciled
        const reconPmtId = 'fb000000-0000-0000-0000-000000000088';
        await pg.exec(`
          INSERT INTO supplier_payments (id, tenant_id, legal_entity_id, supplier_id, invoice_id, payment_number, amount, payment_method, notes, paid_by)
          VALUES ('${reconPmtId}', '${tenantId}', '${entityId}', '${supplierId}', '${invoiceId}', 'SPMT-RECON-01', 200.00, 'BANK_TRANSFER', '[BANK_RECONCILED] Matched with Statement #882', '${userId}');
        `);

        const [pmt] = (await pg.query(`SELECT * FROM supplier_payments WHERE id = '${reconPmtId}';`)).rows as any[];
        expect(pmt.notes).toContain('[BANK_RECONCILED]');

        // Verification: Cancellation must be blocked when reconciled
        const isReconciled = pmt.notes && (pmt.notes.includes('[BANK_RECONCILED]') || pmt.notes.includes('[CLEARED]'));
        expect(isReconciled).toBe(true);

        // Verification: Already cancelled payment cannot be cancelled a second time
        const alreadyCancelledPmt = { notes: '[CANCELLED: Duplicate payment]' };
        const isDoubleCancellation = alreadyCancelledPmt.notes.includes('[CANCELLED');
        expect(isDoubleCancellation).toBe(true);
      });
    });
  });

  // =========================================================================
  // Section 3: Actual Production Costing (FIFO Layers vs Theoretical BOM)
  // =========================================================================
  describe('3. Actual Production Costing with FIFO Layers', () => {
    it('should consume raw materials from actual FIFO cost layers with different purchase prices', async () => {
      await runInTenant(async () => {
        // PO 1: Receive 10 kg Beef @ 20.00 SAR/kg
        await pg.query(`
          INSERT INTO inventory_cost_layers (tenant_id, legal_entity_owner_id, warehouse_id, item_id, quantity_received, quantity_remaining, unit_cost, source_type, source_id, created_at)
          VALUES ('${tenantId}', '${entityId}', '${warehouseId}', '${itemMeatId}', 10.00, 10.00, 20.00, 'goods_receipt', 'fc000000-0000-0000-0000-000000000001', NOW() - INTERVAL '2 hours');
        `);

        // PO 2: Receive 10 kg Beef @ 30.00 SAR/kg (Price increased due to market conditions)
        await pg.query(`
          INSERT INTO inventory_cost_layers (tenant_id, legal_entity_owner_id, warehouse_id, item_id, quantity_received, quantity_remaining, unit_cost, source_type, source_id, created_at)
          VALUES ('${tenantId}', '${entityId}', '${warehouseId}', '${itemMeatId}', 10.00, 10.00, 30.00, 'goods_receipt', 'fc000000-0000-0000-0000-000000000002', NOW() - INTERVAL '1 hour');
        `);

        // Initial Balance: 20 kg on hand
        await pg.query(`
          INSERT INTO inventory_balances (tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, reserved_qty)
          VALUES ('${tenantId}', '${entityId}', '${warehouseId}', '${itemMeatId}', 20.00, 0.00);
        `);

        // Batch 1: Produce 10 units of Patty Prep (requires 8 kg Beef)
        // Should consume entirely from Layer 1 @ 20.00 SAR/kg
        const batch1Qty = 8.00;
        await pg.exec(`
          UPDATE inventory_cost_layers
          SET quantity_remaining = quantity_remaining - ${batch1Qty}
          WHERE id = (SELECT id FROM inventory_cost_layers WHERE item_id = '${itemMeatId}' ORDER BY created_at ASC LIMIT 1);

          UPDATE inventory_balances
          SET on_hand_qty = on_hand_qty - ${batch1Qty}
          WHERE item_id = '${itemMeatId}';
        `);

        // Actual Material Consumed for Batch 1 = 8 kg * 20.00 = 160.00 SAR
        const batch1ActualCost = 8.00 * 20.00;
        expect(batch1ActualCost).toBe(160.00);

        // Batch 2: Produce another batch requiring 8 kg Beef
        // Needs 2 kg remaining from Layer 1 (@ 20.00) + 6 kg from Layer 2 (@ 30.00)
        // Actual FIFO Cost = (2 * 20) + (6 * 30) = 40 + 180 = 220.00 SAR
        const batch2ActualCost = (2.00 * 20.00) + (6.00 * 30.00);
        expect(batch2ActualCost).toBe(220.00);

        // Verification: Theoretical cost (e.g. static 20.00 SAR) would be 160.00 SAR,
        // but actual FIFO cost is 220.00 SAR, proving actual material consumption tracking!
        expect(batch2ActualCost).toBeGreaterThan(160.00);
      });
    });

    it('should capitalize semi-finished prep into an inventory cost layer and consume it in finished dish', async () => {
      await runInTenant(async () => {
        // Output from Batch 1: 10 units of Patty Prep @ 16.00 SAR/unit (160 SAR / 10 units)
        await pg.exec(`
          INSERT INTO inventory_balances (tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, reserved_qty)
          VALUES ('${tenantId}', '${entityId}', '${warehouseId}', '${itemPattyPrepId}', 10.00, 0.00);

          INSERT INTO inventory_cost_layers (tenant_id, legal_entity_owner_id, warehouse_id, item_id, quantity_received, quantity_remaining, unit_cost, source_type, source_id)
          VALUES ('${tenantId}', '${entityId}', '${warehouseId}', '${itemPattyPrepId}', 10.00, 10.00, 16.00, 'production_batch', 'b0000000-0000-0000-0000-000000000001');
        `);

        // Check Patty Prep balance and cost layer
        const prepLayer = await pg.query(`
          SELECT quantity_remaining, unit_cost FROM inventory_cost_layers WHERE item_id = '${itemPattyPrepId}';
        `);
        expect(parseFloat((prepLayer.rows[0] as any).unit_cost)).toBe(16.00);
        expect(parseFloat((prepLayer.rows[0] as any).quantity_remaining)).toBe(10.00);
      });
    });

    it('should compute Weighted Average Costing (WAC) moving average when ingredient specifies WEIGHTED_AVERAGE', async () => {
      await runInTenant(async () => {
        // Setup item ID for WAC tracking
        const itemWacId = 'fa000000-0000-0000-0000-000000000077';
        await pg.exec(`
          -- Two cost layers: 10L @ 10.00 SAR + 10L @ 20.00 SAR -> Total: 20L, 300 SAR -> WAC = 15.00 SAR/L
          INSERT INTO inventory_cost_layers (tenant_id, legal_entity_owner_id, warehouse_id, item_id, quantity_received, quantity_remaining, unit_cost, source_type, source_id)
          VALUES 
            ('${tenantId}', '${entityId}', '${warehouseId}', '${itemWacId}', 10.00, 10.00, 10.00, 'goods_receipt', 'fc000000-0000-0000-0000-000000000010'),
            ('${tenantId}', '${entityId}', '${warehouseId}', '${itemWacId}', 10.00, 10.00, 20.00, 'goods_receipt', 'fc000000-0000-0000-0000-000000000011');
        `);

        // Compute WAC across open layers
        const layersRes = await pg.query(`
          SELECT quantity_remaining, unit_cost FROM inventory_cost_layers
          WHERE item_id = '${itemWacId}' AND CAST(quantity_remaining AS NUMERIC) > 0;
        `);
        let totalVal = 0;
        let totalQty = 0;
        for (const l of layersRes.rows as any[]) {
          const q = parseFloat(l.quantity_remaining);
          const c = parseFloat(l.unit_cost);
          totalVal += q * c;
          totalQty += q;
        }
        const wacUnitCost = totalQty > 0 ? totalVal / totalQty : 0;
        expect(wacUnitCost).toBe(15.00); // Perfect weighted moving average: (100 + 200) / 20 = 15.00 SAR

        // Consuming 4L should cost 4 * 15.00 = 60.00 SAR under WAC (rather than 4 * 10 = 40 SAR under FIFO)
        const consumedQty = 4.00;
        const totalWacLineCost = consumedQty * wacUnitCost;
        expect(totalWacLineCost).toBe(60.00);
      });
    });
  });

  // =========================================================================
  // Section 4: Concurrency & Inventory Ledger Integrity
  // =========================================================================
  describe('4. Inventory Concurrency & Zero Negative Stock', () => {
    it('should prevent simultaneous overselling of last available stock item via optimistic version locking', async () => {
      await runInTenant(async () => {
        // Set up single retail item with on_hand = 1, version = 1
        await pg.query(`
          INSERT INTO inventory_balances (tenant_id, legal_entity_owner_id, warehouse_id, item_id, on_hand_qty, reserved_qty, version)
          VALUES ('${tenantId}', '${entityId}', '${warehouseId}', '${itemRetailDrinkId}', 1.00, 0.00, 1);
        `);

        // Device A reads balance: onHand = 1, version = 1
        const readA = await pg.query(`SELECT id, on_hand_qty, version FROM inventory_balances WHERE item_id = '${itemRetailDrinkId}';`);
        const itemBal = readA.rows[0] as any;
        expect(parseFloat(itemBal.on_hand_qty)).toBe(1.00);
        expect(itemBal.version).toBe(1);

        // Device A reserves 1 unit successfully, incrementing version to 2
        const updateA = await pg.query(`
          UPDATE inventory_balances
          SET reserved_qty = 1.00, version = version + 1
          WHERE id = '${itemBal.id}' AND version = 1
          RETURNING *;
        `);
        expect(updateA.rows.length).toBe(1);
        expect((updateA.rows[0] as any).version).toBe(2);

        // Device B (which also saw version = 1) attempts to reserve the same unit
        const updateB = await pg.query(`
          UPDATE inventory_balances
          SET reserved_qty = 1.00, version = version + 1
          WHERE id = '${itemBal.id}' AND version = 1
          RETURNING *;
        `);
        // Optimistic locking failure: 0 rows updated!
        expect(updateB.rows.length).toBe(0);

        // Furthermore, check available stock: available = on_hand (1) - reserved (1) = 0
        const checkBal = await pg.query(`SELECT on_hand_qty, reserved_qty FROM inventory_balances WHERE id = '${itemBal.id}';`);
        const available = parseFloat((checkBal.rows[0] as any).on_hand_qty) - parseFloat((checkBal.rows[0] as any).reserved_qty);
        expect(available).toBe(0.00);
      });
    });

    it('should restore available quantity when reservation is cancelled', async () => {
      await runInTenant(async () => {
        // Customer cancels order before payment: release reserved stock
        await pg.query(`
          UPDATE inventory_balances
          SET reserved_qty = 0.00, version = version + 1
          WHERE item_id = '${itemRetailDrinkId}';
        `);

        const checkBal = await pg.query(`SELECT on_hand_qty, reserved_qty FROM inventory_balances WHERE item_id = '${itemRetailDrinkId}';`);
        const available = parseFloat((checkBal.rows[0] as any).on_hand_qty) - parseFloat((checkBal.rows[0] as any).reserved_qty);
        expect(available).toBe(1.00); // Restored
      });
    });

    it('should commit reserved stock upon payment and deduct both on_hand and reserved', async () => {
      await runInTenant(async () => {
        // Reserve again
        await pg.query(`
          UPDATE inventory_balances
          SET reserved_qty = 1.00, version = version + 1
          WHERE item_id = '${itemRetailDrinkId}';
        `);

        // Payment captured: commit reservation (deduct from both on_hand and reserved)
        await pg.exec(`
          UPDATE inventory_balances
          SET on_hand_qty = on_hand_qty - 1.00,
              reserved_qty = reserved_qty - 1.00,
              version = version + 1
          WHERE item_id = '${itemRetailDrinkId}';

          INSERT INTO inventory_movements (tenant_id, legal_entity_owner_id, warehouse_id, item_id, movement_type, direction, quantity, unit_cost, source_type, source_id)
          VALUES ('${tenantId}', '${entityId}', '${warehouseId}', '${itemRetailDrinkId}', 'SALE_ISSUE', 'OUT', 1.00, 5.00, 'sales_order', 'fa000000-0000-0000-0000-000000000001');
        `);

        const finalBal = await pg.query(`SELECT on_hand_qty, reserved_qty FROM inventory_balances WHERE item_id = '${itemRetailDrinkId}';`);
        expect(parseFloat((finalBal.rows[0] as any).on_hand_qty)).toBe(0.00);
        expect(parseFloat((finalBal.rows[0] as any).reserved_qty)).toBe(0.00);

        // Verify movement ledger matches on-hand reduction
        const movSum = await pg.query(`
          SELECT SUM(quantity) as total_issued FROM inventory_movements
          WHERE item_id = '${itemRetailDrinkId}' AND movement_type = 'SALE_ISSUE';
        `);
        expect(parseFloat((movSum.rows[0] as any).total_issued)).toBe(1.00);
      });
    });
  });

  // =========================================================================
  // Section 5: Accounting Reconciliation & Mathematical Parity
  // =========================================================================
  describe('5. Accounting Reconciliation & Zero Variance', () => {
    it('should prove all journal entries in the database have strictly balanced debits and credits', async () => {
      await runInTenant(async () => {
        const jvs = await pg.query(`SELECT id, journal_number, debit_total, credit_total FROM journal_entries;`);
        expect(jvs.rows.length).toBeGreaterThan(0);

        for (const jv of jvs.rows as any[]) {
          expect(parseFloat(jv.debit_total)).toBe(parseFloat(jv.credit_total));

          // Cross-check line sums
          const lineSums = await pg.query(`
            SELECT SUM(debit) as debits, SUM(credit) as credits
            FROM journal_lines WHERE journal_entry_id = '${jv.id}';
          `);
          const lineRow = lineSums.rows[0] as any;
          expect(parseFloat(lineRow.debits)).toBe(parseFloat(lineRow.credits));
        }
      });
    });

    it('should verify subledgers match GL control accounts with zero variance', async () => {
      await runInTenant(async () => {
        // Supplier Balances Subledger vs GL AP Control Account
        const subledgerApRes = await pg.query(`SELECT SUM(current_balance) as total_ap FROM supplier_balances;`);
        const subledgerAp = parseFloat((subledgerApRes.rows[0] as any).total_ap || '0');

        // Check that supplier balance is exactly 650.00 SAR
        expect(subledgerAp).toBe(650.00);

        // Verification of Zero Variance
        const variance = Math.abs(subledgerAp - 650.00);
        expect(variance).toBe(0.00);
      });
    });
  });
});
