import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inArray } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import {
  createDatabaseClient,
  DatabaseInstance,
  tenants,
  users,
  userMemberships,
  membershipScopes,
  roles,
  rolePermissions,
  groups,
  legalEntities,
  branches,
  warehouses,
  tenantSubscriptions,
  tenantIndustryPacks,
  pdplConsents,
  onboardingProgress,
  auditLogs,
  businessPartners,
  partnerRoles,
} from '@restaurant-cloud/database';
import type postgres from 'postgres';

const API_BASE = 'http://127.0.0.1:4000/api/v1';

function loadDbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.resolve(__dirname, '../../../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^DATABASE_URL=(.+)$/m);
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('DATABASE_URL not found');
}

describe('Unified Business Partners (Customers & Suppliers) + 0033 Performance Indexes (Staging DB)', () => {
  let db: DatabaseInstance;
  let sqlClient: postgres.Sql;

  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];
  const uniqueSuffix = Date.now().toString(36);

  let token1 = '';
  let token2 = '';
  let partnerId = '';

  async function apiCall(
    endpoint: string,
    options: { method?: string; token?: string; body?: unknown } = {}
  ) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    return { status: res.status, body: json };
  }

  beforeAll(async () => {
    const client = createDatabaseClient({ connectionString: loadDbUrl(), maxConnections: 5 });
    db = client.db;
    sqlClient = client.sqlClient;

    const t1 = await apiCall('/tenants/onboard', {
      method: 'POST',
      body: {
        displayName: `Partner Org 1 ${uniqueSuffix}`,
        initialLegalEntity: { legalName: `Partner Legal 1 ${uniqueSuffix}`, vatNumber: '310222333400003' },
        initialAdminUser: { email: `bp.t1.${uniqueSuffix}@example.sa`, displayName: 'BP Admin 1', password: 'BpPassword2026!' },
      },
    });
    expect(t1.status).toBe(201);
    token1 = t1.body.data.token;
    createdTenantIds.push(t1.body.data.tenant.id);
    createdUserIds.push(t1.body.data.user.id);

    const t2 = await apiCall('/tenants/onboard', {
      method: 'POST',
      body: {
        displayName: `Partner Org 2 ${uniqueSuffix}`,
        initialLegalEntity: { legalName: `Partner Legal 2 ${uniqueSuffix}`, vatNumber: '310555666700003' },
        initialAdminUser: { email: `bp.t2.${uniqueSuffix}@example.sa`, displayName: 'BP Admin 2', password: 'BpPassword2026!' },
      },
    });
    expect(t2.status).toBe(201);
    token2 = t2.body.data.token;
    createdTenantIds.push(t2.body.data.tenant.id);
    createdUserIds.push(t2.body.data.user.id);
  }, 60000);

  afterAll(async () => {
    if (db) {
      try {
        if (createdTenantIds.length > 0) {
          await db.delete(partnerRoles).where(inArray(partnerRoles.tenantId, createdTenantIds));
          await db.delete(businessPartners).where(inArray(businessPartners.tenantId, createdTenantIds));
          await db.delete(pdplConsents).where(inArray(pdplConsents.tenantId, createdTenantIds));
          await db.delete(onboardingProgress).where(inArray(onboardingProgress.tenantId, createdTenantIds));
          await db.delete(tenantIndustryPacks).where(inArray(tenantIndustryPacks.tenantId, createdTenantIds));
          await db.delete(tenantSubscriptions).where(inArray(tenantSubscriptions.tenantId, createdTenantIds));
          await db.delete(auditLogs).where(inArray(auditLogs.tenantId, createdTenantIds));
          await db.delete(warehouses).where(inArray(warehouses.tenantId, createdTenantIds));
          await db.delete(branches).where(inArray(branches.tenantId, createdTenantIds));
          await db.delete(legalEntities).where(inArray(legalEntities.tenantId, createdTenantIds));
          await db.delete(groups).where(inArray(groups.tenantId, createdTenantIds));
          const memberships = await db.select({ id: userMemberships.id }).from(userMemberships).where(inArray(userMemberships.tenantId, createdTenantIds));
          if (memberships.length > 0) {
            await db.delete(membershipScopes).where(inArray(membershipScopes.membershipId, memberships.map((m) => m.id)));
          }
          await db.delete(userMemberships).where(inArray(userMemberships.tenantId, createdTenantIds));
          const tenantRoles = await db.select({ id: roles.id }).from(roles).where(inArray(roles.tenantId, createdTenantIds));
          if (tenantRoles.length > 0) {
            await db.delete(rolePermissions).where(inArray(rolePermissions.roleId, tenantRoles.map((r) => r.id)));
          }
          await db.delete(roles).where(inArray(roles.tenantId, createdTenantIds));
          await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
        }
        if (createdUserIds.length > 0) {
          await db.delete(users).where(inArray(users.id, createdUserIds));
        }
      } catch {
        // Best-effort cleanup
      }
    }
    if (sqlClient) await sqlClient.end();
  }, 30000);

  it('creates Customer, rejects duplicate VAT, activates VENDOR role on same partner, paginates & enforces RLS', async () => {
    const createCust = await apiCall('/partners', {
      method: 'POST',
      token: token1,
      body: {
        partnerNumber: `CUST-${uniqueSuffix}`,
        partnerType: 'CORPORATE',
        legalNameAr: 'شركة المذاق الموحد',
        taxIdentificationNumber: '310888999000003',
        commercialRegistrationNumber: '1010445566',
        primaryPhone: '+966501234567',
        roles: ['CUSTOMER'],
      },
    });
    expect(createCust.status).toBe(201);
    partnerId = createCust.body.data.id ?? createCust.body.data.partner?.id;
    expect(partnerId).toBeTruthy();

    // Duplicate VAT must be rejected with 409
    const dupVat = await apiCall('/partners', {
      method: 'POST',
      token: token1,
      body: {
        partnerNumber: `SUP-DUP-${uniqueSuffix}`,
        partnerType: 'CORPORATE',
        legalNameAr: 'مكرر',
        taxIdentificationNumber: '310888999000003',
        roles: ['VENDOR'],
      },
    });
    expect(dupVat.status).toBe(409);

    // Activate VENDOR role on the SAME unified Business Partner
    const addVendor = await apiCall(`/partners/${partnerId}/roles`, {
      method: 'POST',
      token: token1,
      body: { roleType: 'VENDOR' },
    });
    expect(addVendor.status).toBe(201);

    // Server-side paginated listing under VENDOR role finds the same partner with enriched fields
    const listVendors = await apiCall('/partners?role=VENDOR&page=1&limit=10', { token: token1 });
    expect(listVendors.status).toBe(200);
    expect(listVendors.body.data.total).toBe(1);
    expect(listVendors.body.data.items[0].roles).toContain('CUSTOMER');
    expect(listVendors.body.data.items[0].roles).toContain('VENDOR');

    // Statement of account returns cleanly
    const stmt = await apiCall(`/partners/${partnerId}/statement?role=VENDOR`, { token: token1 });
    expect(stmt.status).toBe(200);
    expect(stmt.body.data.partner.id).toBe(partnerId);

    // Tenant 2 isolation: sees 0 partners
    const listT2 = await apiCall('/partners?role=CUSTOMER&page=1&limit=10', { token: token2 });
    expect(listT2.status).toBe(200);
    expect(listT2.body.data.total).toBe(0);
  });

  it('verifies all 0033 composite performance indexes exist on Staging DB', async () => {
    const rows = await sqlClient`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_items_tenant_active_name',
          'idx_sales_orders_tenant_created_desc',
          'idx_sales_orders_tenant_branch_status_created',
          'idx_payments_tenant_order',
          'idx_inv_cost_layers_fifo_active',
          'idx_inv_movements_tenant_wh_item_occurred',
          'idx_supplier_invoices_tenant_sup_status_date',
          'idx_purchase_orders_tenant_sup_status_date',
          'idx_journal_entries_tenant_entity_date_desc',
          'idx_delivery_orders_tenant_status_created',
          'idx_audit_logs_tenant_occurred_desc',
          'idx_zatca_outbox_tenant_status_created',
          'idx_bp_tenant_active_created_desc',
          'idx_ap_invoices_tenant_partner_created',
          'idx_ar_invoices_tenant_partner_created'
        )
    `;
    expect(rows.length).toBe(15);
  });
});
