import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import {
  tenants,
  userMemberships,
  branches,
  devices,
  legalEntities,
  tenantSubscriptions,
  subscriptionPlans,
  saasPolicies,
  saasInvoices,
  saasPayments,
  pdplConsents,
  onboardingProgress,
  auditLogs,
} from '@restaurant-cloud/database';
import { TenantContext, SubscriptionStatus } from '@restaurant-cloud/domain-kernel';
import { eq, desc, asc, sql, and } from 'drizzle-orm';

export interface SaasWebhookPayload {
  providerEventId: string;
  eventType: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED';
  tenantId?: string;
  checkoutSessionId?: string;
  invoiceId?: string;
  provider?: string;
  providerTransactionId?: string;
  failureReason?: string;
}

@Injectable()
export class SaasService {
  constructor(private readonly dbService: DatabaseService) {}

  private withTenant<T>(
    tenantId: string,
    operation: (tx: typeof this.dbService.db) => Promise<T>
  ): Promise<T> {
    return this.dbService.withTenantContext(
      { tenantId, userId: tenantId, scopes: ['*'] } as TenantContext,
      operation
    );
  }

  private getWebhookSecret(): string {
    const configured = process.env.SAAS_WEBHOOK_SECRET;
    if (configured && configured.length >= 16) {
      return configured;
    }
    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      throw new Error('SAAS_WEBHOOK_SECRET must be configured in production');
    }
    return 'dev-saas-webhook-secret-staging-only';
  }

  verifyWebhookSignature(rawPayload: string, signatureHeader?: string): boolean {
    if (!signatureHeader) return false;
    const cleaned = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice(7)
      : signatureHeader;
    const expected = createHmac('sha256', this.getWebhookSecret())
      .update(rawPayload)
      .digest('hex');
    const a = Buffer.from(cleaned, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ====================================================================
  // Public Catalog & Legal Policies
  // ====================================================================

  async listPublicPlans() {
    const rows = await this.dbService.db
      .select()
      .from(subscriptionPlans)
      .where(and(eq(subscriptionPlans.isActive, true), eq(subscriptionPlans.isPublic, true)))
      .orderBy(asc(subscriptionPlans.sortOrder));

    return rows.map((p) => ({
      ...p,
      features: Array.isArray(p.featuresJson) ? p.featuresJson : [],
    }));
  }

  async listPublicPolicies() {
    return this.dbService.db
      .select()
      .from(saasPolicies)
      .orderBy(asc(saasPolicies.policyKey));
  }

  // ====================================================================
  // Tenant Self-Serve Subscription, Checkout & Billing
  // ====================================================================

  async getTenantSubscriptionOverview(context: TenantContext) {
    return this.withTenant(context.tenantId, async (tx) => {
      const [subscription] = await tx
        .select()
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, context.tenantId))
        .limit(1);

      const [plan] = subscription
        ? await tx
            .select()
            .from(subscriptionPlans)
            .where(eq(subscriptionPlans.code, subscription.planCode))
            .limit(1)
        : [undefined];

      const [branchCountRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(branches)
        .where(eq(branches.tenantId, context.tenantId));
      const [deviceCountRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(devices)
        .where(eq(devices.tenantId, context.tenantId));
      const [userCountRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(userMemberships)
        .where(eq(userMemberships.tenantId, context.tenantId));
      const [entityCountRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(legalEntities)
        .where(eq(legalEntities.tenantId, context.tenantId));

      const invoices = await tx
        .select()
        .from(saasInvoices)
        .where(eq(saasInvoices.tenantId, context.tenantId))
        .orderBy(desc(saasInvoices.createdAt))
        .limit(20);

      const payments = await tx
        .select()
        .from(saasPayments)
        .where(eq(saasPayments.tenantId, context.tenantId))
        .orderBy(desc(saasPayments.createdAt))
        .limit(20);

      return {
        subscription: subscription ?? null,
        plan: plan
          ? { ...plan, features: Array.isArray(plan.featuresJson) ? plan.featuresJson : [] }
          : null,
        usage: {
          branches: branchCountRow?.count ?? 0,
          devices: deviceCountRow?.count ?? 0,
          users: userCountRow?.count ?? 0,
          legalEntities: entityCountRow?.count ?? 0,
        },
        invoices,
        payments,
      };
    });
  }

  async createHostedCheckout(
    context: TenantContext,
    dto: { planCode: string; billingCycle: 'MONTHLY' | 'ANNUAL'; provider?: string }
  ) {
    const planCode = dto.planCode.trim().toUpperCase();
    const [plan] = await this.dbService.db
      .select()
      .from(subscriptionPlans)
      .where(and(eq(subscriptionPlans.code, planCode), eq(subscriptionPlans.isActive, true)))
      .limit(1);

    if (!plan) {
      throw new NotFoundException(`Subscription plan '${planCode}' not found`);
    }

    const subtotal =
      dto.billingCycle === 'ANNUAL'
        ? Number(plan.annualPriceSar)
        : Number(plan.monthlyPriceSar);
    const vat = Number((subtotal * 0.15).toFixed(2));
    const total = Number((subtotal + vat).toFixed(2));

    const invoiceNumber = `SAAS-${Date.now()}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const checkoutSessionId = `chk_${context.tenantId}_${randomBytes(6).toString('hex')}`;
    const provider = dto.provider || 'MOYASAR_HOSTED';

    return this.withTenant(context.tenantId, async (tx) => {
      const [sub] = await tx
        .select()
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, context.tenantId))
        .limit(1);

      if (!sub) {
        throw new NotFoundException('Tenant subscription record not found');
      }

      const [invoice] = await tx
        .insert(saasInvoices)
        .values({
          tenantId: context.tenantId,
          subscriptionId: sub.id,
          invoiceNumber,
          planCode: plan.code,
          billingCycle: dto.billingCycle,
          subtotalSar: subtotal.toFixed(2),
          vatSar: vat.toFixed(2),
          totalSar: total.toFixed(2),
          currency: 'SAR',
          status: 'PENDING',
          dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          idempotencyKey: checkoutSessionId,
        })
        .returning();

      if (!invoice) throw new Error('Failed to create SaaS invoice');

      const [payment] = await tx
        .insert(saasPayments)
        .values({
          tenantId: context.tenantId,
          invoiceId: invoice.id,
          provider,
          providerPaymentRef: checkoutSessionId,
          amountSar: total.toFixed(2),
          status: 'PENDING',
          rawMetadata: {
            initiatedByUserId: context.userId,
            planCode: plan.code,
            billingCycle: dto.billingCycle,
          },
        })
        .returning();

      await tx
        .update(tenantSubscriptions)
        .set({
          lastPaymentStatus: 'PENDING',
          updatedAt: new Date(),
        })
        .where(eq(tenantSubscriptions.tenantId, context.tenantId));

      await tx.insert(auditLogs).values({
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'SAAS_CHECKOUT_INITIATED',
        entityType: 'saas_invoice',
        entityId: invoice.id,
        afterState: JSON.stringify({
          invoiceNumber,
          planCode: plan.code,
          billingCycle: dto.billingCycle,
          totalSar: total.toFixed(2),
          checkoutSessionId,
        }),
      });

      return {
        invoice,
        payment,
        checkoutSessionId,
        hostedCheckoutUrl: `https://checkout.restaurantcloud.sa/pay/${checkoutSessionId}`,
        note: 'Invoice remains PENDING until signed server-side provider webhook confirms payment.',
      };
    });
  }

  private extractTenantIdFromCheckoutSession(checkoutSessionId?: string): string | null {
    if (!checkoutSessionId) return null;
    const match = checkoutSessionId.match(
      /^chk_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_/i
    );
    return match?.[1] ?? null;
  }

  /**
   * Authoritative server-side payment webhook handler.
   * Verifies HMAC-SHA256 signature and enforces idempotency by providerEventId.
   */
  async handlePaymentWebhook(
    rawPayload: string,
    signatureHeader: string | undefined,
    payload: SaasWebhookPayload
  ) {
    if (!this.verifyWebhookSignature(rawPayload, signatureHeader)) {
      throw new UnauthorizedException('Invalid SaaS payment webhook signature');
    }
    if (!payload.providerEventId) {
      throw new BadRequestException('providerEventId is required');
    }

    const resolvedTenantId =
      payload.tenantId ?? this.extractTenantIdFromCheckoutSession(payload.checkoutSessionId);
    if (!resolvedTenantId) {
      throw new NotFoundException('Matching SaaS tenant context not found for checkout session');
    }

    return this.withTenant(resolvedTenantId, async (tx) => {
      const [existingEvent] = await tx
        .select()
        .from(saasPayments)
        .where(eq(saasPayments.providerEventId, payload.providerEventId))
        .limit(1);

      if (existingEvent) {
        return {
          idempotent: true,
          paymentId: existingEvent.id,
          status: existingEvent.status,
        };
      }

      const [paymentRow] = payload.checkoutSessionId
        ? await tx
            .select()
            .from(saasPayments)
            .where(eq(saasPayments.providerPaymentRef, payload.checkoutSessionId))
            .limit(1)
        : payload.invoiceId
          ? await tx
              .select()
              .from(saasPayments)
              .where(eq(saasPayments.invoiceId, payload.invoiceId))
              .orderBy(desc(saasPayments.createdAt))
              .limit(1)
          : [undefined];

      if (!paymentRow) {
        throw new NotFoundException('Matching SaaS payment checkout session not found');
      }
      const [invoice] = await tx
        .select()
        .from(saasInvoices)
        .where(eq(saasInvoices.id, paymentRow.invoiceId))
        .limit(1);

      if (!invoice) {
        throw new NotFoundException('Associated SaaS invoice not found');
      }

      const [sub] = await tx
        .select()
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, paymentRow.tenantId))
        .limit(1);

      const [plan] = await tx
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.code, invoice.planCode))
        .limit(1);

      const now = new Date();

      if (payload.eventType === 'PAYMENT_SUCCEEDED') {
        await tx
          .update(saasPayments)
          .set({
            status: 'SUCCEEDED',
            providerEventId: payload.providerEventId,
            rawMetadata: {
              ...(paymentRow.rawMetadata ?? {}),
              providerTransactionId:
                payload.providerTransactionId ?? `txn_${randomBytes(6).toString('hex')}`,
              processedAt: now.toISOString(),
            },
          })
          .where(eq(saasPayments.id, paymentRow.id));

        await tx
          .update(saasInvoices)
          .set({
            status: 'PAID',
            paidAt: now,
          })
          .where(eq(saasInvoices.id, invoice.id));

        const nextStatus =
          sub?.status === SubscriptionStatus.SUSPENDED ||
          sub?.status === SubscriptionStatus.CANCELLED
            ? SubscriptionStatus.REACTIVATED
            : SubscriptionStatus.ACTIVE;

        const periodEnd = new Date(now);
        periodEnd.setDate(
          periodEnd.getDate() + (invoice.billingCycle === 'ANNUAL' ? 365 : 30)
        );

        await tx
          .update(tenantSubscriptions)
          .set({
            planCode: invoice.planCode,
            status: nextStatus,
            billingCycle: invoice.billingCycle,
            autoRenew: true,
            maxBranches: plan?.maxBranches ?? sub?.maxBranches ?? 3,
            maxDevices: plan?.maxDevices ?? sub?.maxDevices ?? 5,
            maxUsers: plan?.maxUsers ?? sub?.maxUsers ?? 10,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            gracePeriodEndsAt: null,
            cancelledAt: null,
            cancelReason: null,
            lastPaymentStatus: 'SUCCEEDED',
            updatedAt: now,
          })
          .where(eq(tenantSubscriptions.tenantId, paymentRow.tenantId));

        await tx.insert(auditLogs).values({
          tenantId: paymentRow.tenantId,
          actorId: null,
          action: 'SAAS_PAYMENT_SUCCEEDED',
          entityType: 'tenant_subscription',
          entityId: paymentRow.tenantId,
          afterState: JSON.stringify({
            invoiceId: invoice.id,
            planCode: invoice.planCode,
            status: nextStatus,
            providerEventId: payload.providerEventId,
          }),
        });

        return {
          idempotent: false,
          status: 'SUCCEEDED',
          subscriptionStatus: nextStatus,
          invoiceId: invoice.id,
        };
      } else {
        await tx
          .update(saasPayments)
          .set({
            status: 'FAILED',
            providerEventId: payload.providerEventId,
            failureReason: payload.failureReason || 'Payment declined by provider',
            rawMetadata: {
              ...(paymentRow.rawMetadata ?? {}),
              processedAt: now.toISOString(),
            },
          })
          .where(eq(saasPayments.id, paymentRow.id));

        await tx
          .update(saasInvoices)
          .set({
            status: 'FAILED',
          })
          .where(eq(saasInvoices.id, invoice.id));

        const graceEnds = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        await tx
          .update(tenantSubscriptions)
          .set({
            status: SubscriptionStatus.PAST_DUE,
            gracePeriodEndsAt: graceEnds,
            lastPaymentStatus: 'FAILED',
            updatedAt: now,
          })
          .where(eq(tenantSubscriptions.tenantId, paymentRow.tenantId));

        await tx.insert(auditLogs).values({
          tenantId: paymentRow.tenantId,
          actorId: null,
          action: 'SAAS_PAYMENT_FAILED',
          entityType: 'tenant_subscription',
          entityId: paymentRow.tenantId,
          afterState: JSON.stringify({
            invoiceId: invoice.id,
            reason: payload.failureReason || 'Payment declined by provider',
            providerEventId: payload.providerEventId,
          }),
        });

        return {
          idempotent: false,
          status: 'FAILED',
          subscriptionStatus: SubscriptionStatus.PAST_DUE,
          invoiceId: invoice.id,
        };
      }
    });
  }

  async cancelSubscription(context: TenantContext, reason?: string) {
    return this.withTenant(context.tenantId, async (tx) => {
      const now = new Date();
      const [updated] = await tx
        .update(tenantSubscriptions)
        .set({
          status: SubscriptionStatus.CANCELLED,
          autoRenew: false,
          cancelledAt: now,
          cancelReason: reason || 'Cancelled by tenant owner',
          updatedAt: now,
        })
        .where(eq(tenantSubscriptions.tenantId, context.tenantId))
        .returning();

      await tx.insert(auditLogs).values({
        tenantId: context.tenantId,
        actorId: context.userId,
        action: 'SAAS_SUBSCRIPTION_CANCELLED',
        entityType: 'tenant_subscription',
        entityId: context.tenantId,
        afterState: JSON.stringify({ reason: reason || 'Cancelled by tenant owner' }),
      });

      return updated;
    });
  }

  async toggleAutoRenew(context: TenantContext, autoRenew: boolean) {
    return this.withTenant(context.tenantId, async (tx) => {
      const [updated] = await tx
        .update(tenantSubscriptions)
        .set({ autoRenew, updatedAt: new Date() })
        .where(eq(tenantSubscriptions.tenantId, context.tenantId))
        .returning();
      return updated;
    });
  }

  // ====================================================================
  // Resumable Onboarding Wizard Progress
  // ====================================================================

  async getOnboardingProgress(context: TenantContext) {
    return this.withTenant(context.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(onboardingProgress)
        .where(eq(onboardingProgress.tenantId, context.tenantId))
        .limit(1);

      if (existing) {
        return existing;
      }

      const [created] = await tx
        .insert(onboardingProgress)
        .values({
          tenantId: context.tenantId,
          currentStep: 'tax',
          completedSteps: ['legal_entity', 'branch', 'warehouse', 'industry'],
          isCompleted: false,
        })
        .returning();

      return created;
    });
  }

  async updateOnboardingProgress(
    context: TenantContext,
    dto: {
      currentStep?: string;
      completedSteps?: string[];
      isCompleted?: boolean;
      skipped?: boolean;
    }
  ) {
    return this.withTenant(context.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(onboardingProgress)
        .where(eq(onboardingProgress.tenantId, context.tenantId))
        .limit(1);

      const currentSteps = Array.isArray(existing?.completedSteps)
        ? existing.completedSteps
        : [];
      const mergedSteps = dto.completedSteps
        ? Array.from(new Set([...currentSteps, ...dto.completedSteps]))
        : currentSteps;

      if (!existing) {
        const [inserted] = await tx
          .insert(onboardingProgress)
          .values({
            tenantId: context.tenantId,
            currentStep: dto.currentStep || 'tax',
            completedSteps: mergedSteps,
            isCompleted: Boolean(dto.isCompleted),
            skippedAt: dto.skipped ? new Date() : null,
          })
          .returning();
        return inserted;
      }

      const [updated] = await tx
        .update(onboardingProgress)
        .set({
          currentStep: dto.currentStep ?? existing.currentStep,
          completedSteps: mergedSteps,
          isCompleted: dto.isCompleted ?? existing.isCompleted,
          skippedAt: dto.skipped ? new Date() : existing.skippedAt,
          updatedAt: new Date(),
        })
        .where(eq(onboardingProgress.tenantId, context.tenantId))
        .returning();

      return updated;
    });
  }

  // ====================================================================
  // PDPL Consents & Data Subject Requests
  // ====================================================================

  async listPdplConsents(context: TenantContext) {
    return this.withTenant(context.tenantId, async (tx) => {
      return tx
        .select()
        .from(pdplConsents)
        .where(eq(pdplConsents.tenantId, context.tenantId))
        .orderBy(desc(pdplConsents.createdAt));
    });
  }

  async submitPdplDataRequest(
    context: TenantContext,
    dto: { requestType: 'EXPORT' | 'CORRECTION' | 'ERASURE'; notes?: string }
  ) {
    return this.withTenant(context.tenantId, async (tx) => {
      const [log] = await tx
        .insert(auditLogs)
        .values({
          tenantId: context.tenantId,
          actorId: context.userId,
          action: `PDPL_DSR_${dto.requestType}`,
          entityType: 'pdpl_request',
          entityId: context.tenantId,
          afterState: JSON.stringify({
            requestType: dto.requestType,
            notes: dto.notes || '',
            requestedAt: new Date().toISOString(),
          }),
        })
        .returning();
      return {
        requestId: log?.id,
        requestType: dto.requestType,
        status: 'RECEIVED',
        slaDays: 30,
      };
    });
  }

  // ====================================================================
  // Centralized Super Admin Portal (PlatformAdminGuard)
  // ====================================================================

  async getSuperAdminOverview() {
    const db = this.dbService.db;
    const allTenants = await db
      .select({
        id: tenants.id,
        status: tenants.status,
        subStatus: tenantSubscriptions.status,
      })
      .from(tenants)
      .leftJoin(tenantSubscriptions, eq(tenants.id, tenantSubscriptions.tenantId));

    const [paidRevenueRow] = await db
      .select({
        totalSar: sql<string>`coalesce(sum(${saasInvoices.totalSar}), 0)::text`,
        invoiceCount: sql<number>`count(*)::int`,
      })
      .from(saasInvoices)
      .where(eq(saasInvoices.status, 'PAID'));

    const plans = await db.select().from(subscriptionPlans);

    const bySubStatus: Record<string, number> = {};
    for (const row of allTenants) {
      const key = row.subStatus || 'UNASSIGNED';
      bySubStatus[key] = (bySubStatus[key] ?? 0) + 1;
    }

    return {
      totalTenants: allTenants.length,
      subscriptionsByStatus: bySubStatus,
      totalPaidRevenueSar: Number(paidRevenueRow?.totalSar ?? 0),
      paidInvoiceCount: paidRevenueRow?.invoiceCount ?? 0,
      activePlanCount: plans.filter((p) => p.isActive).length,
    };
  }

  async listAllTenants() {
    const db = this.dbService.db;
    return db
      .select({
        id: tenants.id,
        code: tenants.code,
        displayName: tenants.displayName,
        status: tenants.status,
        createdAt: tenants.createdAt,
        planCode: tenantSubscriptions.planCode,
        subscriptionStatus: tenantSubscriptions.status,
        billingCycle: tenantSubscriptions.billingCycle,
        maxBranches: tenantSubscriptions.maxBranches,
        maxDevices: tenantSubscriptions.maxDevices,
        maxUsers: tenantSubscriptions.maxUsers,
        trialEndsAt: tenantSubscriptions.trialEndsAt,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
        lastPaymentStatus: tenantSubscriptions.lastPaymentStatus,
      })
      .from(tenants)
      .leftJoin(tenantSubscriptions, eq(tenants.id, tenantSubscriptions.tenantId))
      .orderBy(desc(tenants.createdAt));
  }

  async updateTenantSubscriptionByAdmin(
    tenantId: string,
    actorId: string,
    dto: {
      planCode?: string;
      status?: SubscriptionStatus;
      billingCycle?: 'MONTHLY' | 'ANNUAL';
      maxBranches?: number;
      maxDevices?: number;
      maxUsers?: number;
      extendDays?: number;
      reason?: string;
    }
  ) {
    return this.withTenant(tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, tenantId))
        .limit(1);

      if (!existing) {
        throw new NotFoundException('Tenant subscription not found');
      }

      const now = new Date();
      let nextPeriodEnd = existing.currentPeriodEnd;
      if (dto.extendDays && dto.extendDays > 0) {
        const base =
          nextPeriodEnd && nextPeriodEnd > now ? new Date(nextPeriodEnd) : new Date(now);
        base.setDate(base.getDate() + dto.extendDays);
        nextPeriodEnd = base;
      }

      const [updated] = await tx
        .update(tenantSubscriptions)
        .set({
          planCode: dto.planCode ?? existing.planCode,
          status: dto.status ?? existing.status,
          billingCycle: dto.billingCycle ?? existing.billingCycle,
          maxBranches: dto.maxBranches ?? existing.maxBranches,
          maxDevices: dto.maxDevices ?? existing.maxDevices,
          maxUsers: dto.maxUsers ?? existing.maxUsers,
          currentPeriodEnd: nextPeriodEnd,
          updatedAt: now,
        })
        .where(eq(tenantSubscriptions.tenantId, tenantId))
        .returning();

      if (dto.status === SubscriptionStatus.SUSPENDED) {
        await tx
          .update(tenants)
          .set({ status: 'SUSPENDED' })
          .where(eq(tenants.id, tenantId));
      } else if (
        dto.status === SubscriptionStatus.ACTIVE ||
        dto.status === SubscriptionStatus.REACTIVATED ||
        dto.status === SubscriptionStatus.TRIAL
      ) {
        await tx
          .update(tenants)
          .set({ status: 'ACTIVE' })
          .where(eq(tenants.id, tenantId));
      }

      await tx.insert(auditLogs).values({
        tenantId,
        actorId,
        action: 'SUPER_ADMIN_SUBSCRIPTION_UPDATED',
        entityType: 'tenant_subscription',
        entityId: tenantId,
        beforeState: JSON.stringify(existing),
        afterState: JSON.stringify({ ...dto, updatedStatus: updated?.status }),
      });

      return updated;
    });
  }

  async listAllPlans() {
    const rows = await this.dbService.db
      .select()
      .from(subscriptionPlans)
      .orderBy(asc(subscriptionPlans.sortOrder));
    return rows.map((p) => ({
      ...p,
      features: Array.isArray(p.featuresJson) ? p.featuresJson : [],
    }));
  }

  async upsertPlan(dto: {
    code: string;
    nameAr: string;
    nameEn: string;
    descriptionAr?: string;
    descriptionEn?: string;
    monthlyPriceSar: number;
    annualPriceSar: number;
    trialDays: number;
    maxBranches: number;
    maxDevices: number;
    maxUsers: number;
    features?: string[];
    isActive?: boolean;
    isPublic?: boolean;
    sortOrder?: number;
  }) {
    const code = dto.code.trim().toUpperCase();
    const db = this.dbService.db;
    const [existing] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.code, code))
      .limit(1);

    const values = {
      code,
      nameAr: dto.nameAr,
      nameEn: dto.nameEn,
      descriptionAr: dto.descriptionAr,
      descriptionEn: dto.descriptionEn,
      monthlyPriceSar: dto.monthlyPriceSar.toFixed(2),
      annualPriceSar: dto.annualPriceSar.toFixed(2),
      trialDays: dto.trialDays,
      maxBranches: dto.maxBranches,
      maxDevices: dto.maxDevices,
      maxUsers: dto.maxUsers,
      featuresJson: dto.features ?? [],
      isActive: dto.isActive ?? true,
      isPublic: dto.isPublic ?? true,
      sortOrder: dto.sortOrder ?? 10,
      updatedAt: new Date(),
    };

    if (existing) {
      const [updated] = await db
        .update(subscriptionPlans)
        .set(values)
        .where(eq(subscriptionPlans.id, existing.id))
        .returning();
      return updated;
    }
    const [inserted] = await db.insert(subscriptionPlans).values(values).returning();
    return inserted;
  }

  async listAllInvoices() {
    return this.dbService.db
      .select({
        id: saasInvoices.id,
        tenantId: saasInvoices.tenantId,
        tenantCode: tenants.code,
        tenantName: tenants.displayName,
        invoiceNumber: saasInvoices.invoiceNumber,
        planCode: saasInvoices.planCode,
        billingCycle: saasInvoices.billingCycle,
        subtotalSar: saasInvoices.subtotalSar,
        vatSar: saasInvoices.vatSar,
        totalSar: saasInvoices.totalSar,
        currency: saasInvoices.currency,
        status: saasInvoices.status,
        paidAt: saasInvoices.paidAt,
        createdAt: saasInvoices.createdAt,
      })
      .from(saasInvoices)
      .innerJoin(tenants, eq(saasInvoices.tenantId, tenants.id))
      .orderBy(desc(saasInvoices.createdAt))
      .limit(100);
  }

  async listAllPolicies() {
    return this.dbService.db
      .select()
      .from(saasPolicies)
      .orderBy(asc(saasPolicies.policyKey));
  }

  async upsertPolicy(dto: {
    policyKey: string;
    version: string;
    titleAr: string;
    titleEn: string;
    contentAr: string;
    contentEn: string;
  }) {
    const db = this.dbService.db;
    const [existing] = await db
      .select()
      .from(saasPolicies)
      .where(eq(saasPolicies.policyKey, dto.policyKey))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(saasPolicies)
        .set({
          version: dto.version,
          titleAr: dto.titleAr,
          titleEn: dto.titleEn,
          contentAr: dto.contentAr,
          contentEn: dto.contentEn,
          updatedAt: new Date(),
        })
        .where(eq(saasPolicies.id, existing.id))
        .returning();
      return updated;
    }

    const [inserted] = await db
      .insert(saasPolicies)
      .values({
        policyKey: dto.policyKey,
        version: dto.version,
        titleAr: dto.titleAr,
        titleEn: dto.titleEn,
        contentAr: dto.contentAr,
        contentEn: dto.contentEn,
      })
      .returning();
    return inserted;
  }

  async listPlatformAuditLogs() {
    return this.dbService.db
      .select({
        id: auditLogs.id,
        tenantId: auditLogs.tenantId,
        actorId: auditLogs.actorId,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        afterState: auditLogs.afterState,
        createdAt: auditLogs.occurredAt,
      })
      .from(auditLogs)
      .orderBy(desc(auditLogs.occurredAt))
      .limit(100);
  }
}
