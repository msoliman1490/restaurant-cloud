import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash, createHmac } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
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
  saasInvoices,
  saasPayments,
  pdplConsents,
  onboardingProgress,
  authVerificationTokens,
  auditLogs,
  whatsappTemplates,
  notificationLogs,
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

describe('SaaS Onboarding, Auth Hardening, Subscriptions & Super Admin (Live API + Staging DB)', () => {
  let db: DatabaseInstance;
  let sqlClient: postgres.Sql;

  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdEmails: string[] = [];

  const uniqueSuffix = Date.now().toString(36);
  const ownerEmail = `saas.owner.${uniqueSuffix}@example.sa`;
  const owner2Email = `saas.owner2.${uniqueSuffix}@example.sa`;
  const initialPassword = 'SaasOwner2026!';
  const resetPasswordNew = 'SaasOwnerNew2026!';

  let ownerToken = '';
  let ownerTenantId = '';
  let ownerTenantCode = '';
  let ownerUserId = '';
  let owner2Token = '';
  let checkoutSessionId = '';

  function signWebhook(payload: object): string {
    const secret = process.env.SAAS_WEBHOOK_SECRET || 'dev-saas-webhook-secret-staging-only';
    return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  }

  async function apiCall(
    endpoint: string,
    options: { method?: string; token?: string; headers?: Record<string, string>; body?: unknown } = {}
  ) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    };
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
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
    createdEmails.push(ownerEmail, owner2Email);
  });

  afterAll(async () => {
    if (db) {
      try {
        if (createdTenantIds.length > 0) {
          await db.delete(saasPayments).where(inArray(saasPayments.tenantId, createdTenantIds));
          await db.delete(saasInvoices).where(inArray(saasInvoices.tenantId, createdTenantIds));
          await db.delete(pdplConsents).where(inArray(pdplConsents.tenantId, createdTenantIds));
          await db
            .delete(onboardingProgress)
            .where(inArray(onboardingProgress.tenantId, createdTenantIds));
          await db
            .delete(whatsappTemplates)
            .where(inArray(whatsappTemplates.tenantId, createdTenantIds));
          await db
            .delete(notificationLogs)
            .where(inArray(notificationLogs.tenantId, createdTenantIds));
          await db
            .delete(tenantIndustryPacks)
            .where(inArray(tenantIndustryPacks.tenantId, createdTenantIds));
          await db
            .delete(tenantSubscriptions)
            .where(inArray(tenantSubscriptions.tenantId, createdTenantIds));
          await db.delete(auditLogs).where(inArray(auditLogs.tenantId, createdTenantIds));
          await db.delete(warehouses).where(inArray(warehouses.tenantId, createdTenantIds));
          await db.delete(branches).where(inArray(branches.tenantId, createdTenantIds));
          await db.delete(legalEntities).where(inArray(legalEntities.tenantId, createdTenantIds));
          await db.delete(groups).where(inArray(groups.tenantId, createdTenantIds));

          const memberships = await db
            .select({ id: userMemberships.id })
            .from(userMemberships)
            .where(inArray(userMemberships.tenantId, createdTenantIds));
          if (memberships.length > 0) {
            await db
              .delete(membershipScopes)
              .where(inArray(membershipScopes.membershipId, memberships.map((m) => m.id)));
          }
          await db
            .delete(userMemberships)
            .where(inArray(userMemberships.tenantId, createdTenantIds));

          const tenantRoles = await db
            .select({ id: roles.id })
            .from(roles)
            .where(inArray(roles.tenantId, createdTenantIds));
          if (tenantRoles.length > 0) {
            await db
              .delete(rolePermissions)
              .where(inArray(rolePermissions.roleId, tenantRoles.map((r) => r.id)));
          }
          await db.delete(roles).where(inArray(roles.tenantId, createdTenantIds));
          await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
        }
        if (createdEmails.length > 0) {
          await db
            .delete(authVerificationTokens)
            .where(inArray(authVerificationTokens.target, createdEmails));
        }
        if (createdUserIds.length > 0) {
          await db.delete(users).where(inArray(users.id, createdUserIds));
        }
      } catch {
        // Best-effort cleanup
      }
    }
    if (sqlClient) {
      await sqlClient.end();
    }
  });

  it('lists public subscription plans and PDPL/E-Commerce policies', async () => {
    const plansRes = await apiCall('/saas/public/plans');
    expect(plansRes.status).toBe(200);
    expect(plansRes.body.success).toBe(true);
    expect(plansRes.body.data.length).toBeGreaterThanOrEqual(3);

    const policiesRes = await apiCall('/saas/public/policies');
    expect(policiesRes.status).toBe(200);
    expect(policiesRes.body.success).toBe(true);
    expect(policiesRes.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('onboards a new tenant with auto-generated tenantCode, Saudi National Address, PDPL consent & onboarding progress', async () => {
    const badVatRes = await apiCall('/tenants/onboard', {
      method: 'POST',
      body: {
        displayName: `Bad Vat ${uniqueSuffix}`,
        initialLegalEntity: {
          legalName: `Bad Vat Co ${uniqueSuffix}`,
          vatNumber: '253113521400003',
        },
        initialAdminUser: {
          email: `bad.vat.${uniqueSuffix}@example.sa`,
          displayName: 'Bad Vat',
          password: initialPassword,
        },
      },
    });
    expect(badVatRes.status).toBe(400);

    const res = await apiCall('/tenants/onboard', {
      method: 'POST',
      body: {
        displayName: `Najd Kitchen ${uniqueSuffix}`,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT',
        planCode: 'STARTER',
        billingCycle: 'MONTHLY',
        pdplConsentAccepted: true,
        termsAccepted: true,
        initialLegalEntity: {
          legalName: `Najd Kitchen Co ${uniqueSuffix}`,
          vatNumber: '310123456700003',
          crNumber: '1010998877',
          functionalCurrency: 'SAR',
          buildingNumber: '4521',
          streetName: 'King Fahd Road',
          district: 'Al Olaya',
          city: 'Riyadh',
          postalCode: '12214',
          additionalNumber: '7890',
          countryCode: 'SA',
        },
        initialAdminUser: {
          email: ownerEmail,
          displayName: 'Tariq Owner',
          phone: '+966501112233',
          password: initialPassword,
        },
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenant.code).toMatch(/^rc-najd-kitchen-/);
    expect(res.body.data.subscription.status).toBe('TRIAL');
    expect(res.body.data.subscription.planCode).toBe('STARTER');
    expect(res.body.data.onboardingProgress.isCompleted).toBe(false);
    expect(res.body.data.user.isPlatformAdmin).toBe(false);

    ownerToken = res.body.data.token;
    ownerTenantId = res.body.data.tenant.id;
    ownerTenantCode = res.body.data.tenant.code;
    ownerUserId = res.body.data.user.id;
    createdTenantIds.push(ownerTenantId);
    createdUserIds.push(ownerUserId);
  });

  it('verifies email OTP, supports forgot/reset password with anti-enumeration, and enforces brute-force lockout', async () => {
    // 1. Issue verification token & confirm no devPreviewCode leaked in Staging
    const reqOtp = await apiCall('/auth/request-verification', {
      method: 'POST',
      body: { target: ownerEmail, purpose: 'EMAIL_VERIFY' },
    });
    expect(reqOtp.status).toBe(201);
    expect(reqOtp.body.data.accepted).toBe(true);
    expect(reqOtp.body.data.devPreviewCode).toBeUndefined();

    // Update latest token hash in DB to a known test code to verify end-to-end OTP validation
    const knownOtp = '654321';
    const knownHash = createHash('sha256').update(knownOtp).digest('hex');
    await db
      .update(authVerificationTokens)
      .set({ tokenHash: knownHash })
      .where(eq(authVerificationTokens.target, ownerEmail));

    const verifyOtp = await apiCall('/auth/verify-contact', {
      method: 'POST',
      body: { target: ownerEmail, purpose: 'EMAIL_VERIFY', code: knownOtp },
    });
    expect(verifyOtp.status).toBe(201);
    expect(verifyOtp.body.data.verified).toBe(true);

    // 2. Anti-enumeration on unknown email
    const unknownForgot = await apiCall('/auth/forgot-password', {
      method: 'POST',
      body: { email: 'nonexistent.user@example.sa' },
    });
    expect(unknownForgot.status).toBe(201);
    expect(unknownForgot.body.data.accepted).toBe(true);

    // 3. Forgot + Reset Password for real owner
    const forgotRes = await apiCall('/auth/forgot-password', {
      method: 'POST',
      body: { email: ownerEmail },
    });
    expect(forgotRes.status).toBe(201);

    const knownResetCode = '778899';
    await db
      .update(authVerificationTokens)
      .set({ tokenHash: createHash('sha256').update(knownResetCode).digest('hex') })
      .where(eq(authVerificationTokens.target, ownerEmail));

    const resetRes = await apiCall('/auth/reset-password', {
      method: 'POST',
      body: { email: ownerEmail, code: knownResetCode, newPassword: resetPasswordNew },
    });
    expect(resetRes.status).toBe(201);
    expect(resetRes.body.data.reset).toBe(true);

    // 4. Login with new password succeeds
    const goodLogin = await apiCall('/auth/login', {
      method: 'POST',
      body: { email: ownerEmail, password: resetPasswordNew, tenantCode: ownerTenantCode },
    });
    expect(goodLogin.status).toBe(201);
    ownerToken = goodLogin.body.data.token;
    expect(goodLogin.body.data.user.emailVerifiedAt).toBeTruthy();

    // 5. Brute-force lockout after 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const badLogin = await apiCall('/auth/login', {
        method: 'POST',
        body: { email: ownerEmail, password: 'WrongPassword123!' },
      });
      expect(badLogin.status).toBe(401);
    }

    const lockedLogin = await apiCall('/auth/login', {
      method: 'POST',
      body: { email: ownerEmail, password: resetPasswordNew },
    });
    expect(lockedLogin.status).toBe(401);
    expect(JSON.stringify(lockedLogin.body)).toContain('locked');

    // Clear lock in DB for remaining subscription tests
    await db
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, ownerUserId));
  });

  it('creates hosted checkout (15% VAT) and processes signed HMAC-SHA256 webhooks idempotently', async () => {
    const checkoutRes = await apiCall('/saas/billing/checkout', {
      method: 'POST',
      token: ownerToken,
      body: { planCode: 'GROWTH', billingCycle: 'MONTHLY' },
    });
    expect(checkoutRes.status).toBe(201);
    const checkoutData = checkoutRes.body.data;
    expect(checkoutData.invoice.status).toBe('PENDING');
    expect(Number(checkoutData.invoice.vatSar)).toBeGreaterThan(0);
    checkoutSessionId = checkoutData.checkoutSessionId;

    // Unsigned / invalid signature must be rejected
    const badSigPayload = {
      providerEventId: `evt_bad_${uniqueSuffix}`,
      eventType: 'PAYMENT_SUCCEEDED',
      checkoutSessionId,
    };
    const badWebhook = await apiCall('/saas/webhooks/payment', {
      method: 'POST',
      headers: { 'x-saas-webhook-signature': 'deadbeef' },
      body: badSigPayload,
    });
    expect(badWebhook.status).toBe(401);

    // Signed PAYMENT_FAILED -> PAST_DUE
    const failPayload = {
      providerEventId: `evt_fail_${uniqueSuffix}`,
      eventType: 'PAYMENT_FAILED',
      checkoutSessionId,
      failureReason: 'Insufficient funds',
    };
    const failWebhook = await apiCall('/saas/webhooks/payment', {
      method: 'POST',
      headers: { 'x-saas-webhook-signature': signWebhook(failPayload) },
      body: failPayload,
    });
    expect(failWebhook.status).toBe(201);
    expect(failWebhook.body.data.subscriptionStatus).toBe('PAST_DUE');

    // Signed PAYMENT_SUCCEEDED -> ACTIVE
    const okPayload = {
      providerEventId: `evt_ok_${uniqueSuffix}`,
      eventType: 'PAYMENT_SUCCEEDED',
      checkoutSessionId,
    };
    const okWebhook = await apiCall('/saas/webhooks/payment', {
      method: 'POST',
      headers: { 'x-saas-webhook-signature': signWebhook(okPayload) },
      body: okPayload,
    });
    expect(okWebhook.status).toBe(201);
    expect(okWebhook.body.data.subscriptionStatus).toBe('ACTIVE');
    expect(okWebhook.body.data.idempotent).toBe(false);

    // Duplicate providerEventId -> idempotent: true
    const dupWebhook = await apiCall('/saas/webhooks/payment', {
      method: 'POST',
      headers: { 'x-saas-webhook-signature': signWebhook(okPayload) },
      body: okPayload,
    });
    expect(dupWebhook.status).toBe(201);
    expect(dupWebhook.body.data.idempotent).toBe(true);
  });

  it('persists resumable onboarding progress, PDPL consents, and enforces Super Admin + cross-tenant RLS isolation', async () => {
    const patchOnb = await apiCall('/saas/onboarding', {
      method: 'PATCH',
      token: ownerToken,
      body: {
        currentStep: 'users',
        completedSteps: ['tax', 'users'],
        isCompleted: false,
      },
    });
    expect(patchOnb.status).toBe(200);
    expect(patchOnb.body.data.completedSteps).toContain('tax');
    expect(patchOnb.body.data.completedSteps).toContain('users');

    const consentsRes = await apiCall('/saas/pdpl/consents', { token: ownerToken });
    expect(consentsRes.status).toBe(200);
    expect(consentsRes.body.data.length).toBeGreaterThanOrEqual(2);

    const dsrRes = await apiCall('/saas/pdpl/data-request', {
      method: 'POST',
      token: ownerToken,
      body: { requestType: 'EXPORT', notes: 'Audit check' },
    });
    expect(dsrRes.status).toBe(201);
    expect(dsrRes.body.data.status).toBe('RECEIVED');

    // Normal tenant owner receives 403 on Super Admin endpoints
    const forbiddenAdmin = await apiCall('/super-admin/overview', { token: ownerToken });
    expect(forbiddenAdmin.status).toBe(403);

    // Promote user temporarily to Platform Admin -> 200 on Super Admin overview
    await db
      .update(users)
      .set({ isPlatformAdmin: true })
      .where(eq(users.id, ownerUserId));

    const adminOverview = await apiCall('/super-admin/overview', { token: ownerToken });
    expect(adminOverview.status).toBe(200);
    expect(adminOverview.body.data.totalTenants).toBeGreaterThanOrEqual(1);

    // Cross-tenant RLS isolation on saas_invoices
    const tenant2Res = await apiCall('/tenants/onboard', {
      method: 'POST',
      body: {
        displayName: `Second Org ${uniqueSuffix}`,
        initialLegalEntity: {
          legalName: `Second Legal ${uniqueSuffix}`,
          vatNumber: '310987654300003',
        },
        initialAdminUser: {
          email: owner2Email,
          displayName: 'Second Owner',
          password: initialPassword,
        },
      },
    });
    expect(tenant2Res.status).toBe(201);
    owner2Token = tenant2Res.body.data.token;
    createdTenantIds.push(tenant2Res.body.data.tenant.id);
    createdUserIds.push(tenant2Res.body.data.user.id);

    const tenant2Sub = await apiCall('/saas/subscription', { token: owner2Token });
    expect(tenant2Sub.status).toBe(200);
    expect(tenant2Sub.body.data.invoices.length).toBe(0);

    // 6. WhatsApp Message Templates CRUD, Preview & Dispatch Rendering
    const listTpl = await apiCall('/tenants/whatsapp-templates', { token: ownerToken });
    expect(listTpl.status).toBe(200);
    expect(listTpl.body.data.length).toBeGreaterThanOrEqual(5);

    const customTpl = await apiCall('/tenants/whatsapp-templates', {
      method: 'POST',
      token: ownerToken,
      body: {
        templateKey: 'CUSTOM_PROMO',
        nameAr: 'عرض خاص',
        nameEn: 'Special Promo',
        metaTemplateName: 'rc_custom_promo_ar',
        languageCode: 'ar',
        category: 'MARKETING',
        headerText: 'عرض {{customer_name}}',
        bodyText: 'خصم {{discount_pct}}% على طلبك التالي!',
        footerText: 'مطعم نجد',
        isActive: true,
      },
    });
    expect(customTpl.status).toBe(201);
    expect(customTpl.body.data.variablesJson).toContain('customer_name');
    expect(customTpl.body.data.variablesJson).toContain('discount_pct');

    const previewTpl = await apiCall('/tenants/whatsapp-templates/preview', {
      method: 'POST',
      token: ownerToken,
      body: {
        templateId: customTpl.body.data.id,
        variables: { customer_name: 'فهد', discount_pct: '20' },
      },
    });
    expect(previewTpl.status).toBe(201);
    expect(previewTpl.body.data.renderedMessage).toContain('فهد');
    expect(previewTpl.body.data.renderedMessage).toContain('20%');

    const dispatchTpl = await apiCall('/tenants/notifications/dispatch', {
      method: 'POST',
      token: ownerToken,
      body: {
        channel: 'WHATSAPP',
        recipient: '+966501112233',
        eventType: 'CUSTOM_PROMO',
        payload: {
          templateKey: 'CUSTOM_PROMO',
          variables: { customer_name: 'فهد', discount_pct: '20' },
        },
      },
    });
    expect(dispatchTpl.status).toBe(201);
    expect(dispatchTpl.body.data.payload.renderedMessage).toContain('خصم 20%');

    const deleteTpl = await apiCall(`/tenants/whatsapp-templates/${customTpl.body.data.id}`, {
      method: 'DELETE',
      token: ownerToken,
    });
    expect(deleteTpl.status).toBe(200);
  });
});
