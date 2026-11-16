import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, desc, sql, inArray, gte, lte, or, ilike } from 'drizzle-orm';
import * as crypto from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PostingEngineService, PostingLineInput } from '../accounting/posting-engine.service';
import { OperationsFrameworkService } from '../../common/operations/operations-framework.service';
import {
  TenantContext,
  DefaultAccountMappingKey,
  JournalType,
  SettlementProviderCategory,
  SettlementMatchingStrategy,
  SettlementBatchStatus,
  SettlementLineMatchStatus,
  SettlementDiscrepancyType,
  SettlementDiscrepancyStatus,
  PaymentSettlementStatus,
  OrderStatus,
  PaymentStatus,
} from '@restaurant-cloud/domain-kernel';
import {
  CreateSettlementProviderRequest,
  UpdateSettlementProviderRequest,
  ImportSettlementStatementRequest,
  ResolveSettlementDiscrepancyRequest,
  PostSettlementBatchRequest,
} from '@restaurant-cloud/shared-contracts';
import {
  settlementProviders,
  settlementImportFiles,
  settlementBatches,
  settlementBatchLines,
  settlementDiscrepancies,
  bankSettlementTransactions,
  bankAccounts,
  bankAccountBranchAccess,
  payments,
  salesOrders,
  legalEntities,
  branches,
  journalEntries,
  journalLines,
  chartOfAccounts,
} from '@restaurant-cloud/database';
import { parseSettlementStatement } from './statement-parser';

const DEFAULT_PROVIDER_PRESETS: Array<{
  code: string;
  nameAr: string;
  nameEn: string;
  category: SettlementProviderCategory;
  matchingStrategy: SettlementMatchingStrategy;
  clearingMappingKey: DefaultAccountMappingKey;
  feeMappingKey: DefaultAccountMappingKey;
  defaultFeeRate: string;
  vatOnFeeApplicable: boolean;
}> = [
  {
    code: 'MADA',
    nameAr: 'شبكة مدى (Mada)',
    nameEn: 'Mada Payment Network',
    category: SettlementProviderCategory.PAYMENT_GATEWAY,
    matchingStrategy: SettlementMatchingStrategy.REFERENCE_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.MADA_CLEARING,
    feeMappingKey: DefaultAccountMappingKey.GATEWAY_FEES,
    defaultFeeRate: '0.8000',
    vatOnFeeApplicable: true,
  },
  {
    code: 'VISA_MC',
    nameAr: 'فيزا / ماستركارد',
    nameEn: 'Visa / Mastercard',
    category: SettlementProviderCategory.PAYMENT_GATEWAY,
    matchingStrategy: SettlementMatchingStrategy.REFERENCE_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.VISA_CLEARING,
    feeMappingKey: DefaultAccountMappingKey.GATEWAY_FEES,
    defaultFeeRate: '2.2000',
    vatOnFeeApplicable: true,
  },
  {
    code: 'APPLE_PAY',
    nameAr: 'أبل باي (Apple Pay)',
    nameEn: 'Apple Pay',
    category: SettlementProviderCategory.PAYMENT_GATEWAY,
    matchingStrategy: SettlementMatchingStrategy.REFERENCE_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.APPLE_PAY_CLEARING,
    feeMappingKey: DefaultAccountMappingKey.GATEWAY_FEES,
    defaultFeeRate: '1.5000',
    vatOnFeeApplicable: true,
  },
  {
    code: 'STC_PAY',
    nameAr: 'STC Pay',
    nameEn: 'STC Pay',
    category: SettlementProviderCategory.PAYMENT_GATEWAY,
    matchingStrategy: SettlementMatchingStrategy.REFERENCE_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.STC_PAY_CLEARING,
    feeMappingKey: DefaultAccountMappingKey.GATEWAY_FEES,
    defaultFeeRate: '1.5000',
    vatOnFeeApplicable: true,
  },
  {
    code: 'HYPERPAY',
    nameAr: 'هايبر باي (HyperPay)',
    nameEn: 'HyperPay',
    category: SettlementProviderCategory.PAYMENT_GATEWAY,
    matchingStrategy: SettlementMatchingStrategy.REFERENCE_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.CARD_CLEARING,
    feeMappingKey: DefaultAccountMappingKey.GATEWAY_FEES,
    defaultFeeRate: '1.8000',
    vatOnFeeApplicable: true,
  },
  {
    code: 'GEIDEA',
    nameAr: 'جيديا (Geidea)',
    nameEn: 'Geidea',
    category: SettlementProviderCategory.PAYMENT_GATEWAY,
    matchingStrategy: SettlementMatchingStrategy.REFERENCE_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.CARD_CLEARING,
    feeMappingKey: DefaultAccountMappingKey.GATEWAY_FEES,
    defaultFeeRate: '1.7500',
    vatOnFeeApplicable: true,
  },
  {
    code: 'NEARPAY',
    nameAr: 'نير باي (NearPay)',
    nameEn: 'NearPay',
    category: SettlementProviderCategory.PAYMENT_GATEWAY,
    matchingStrategy: SettlementMatchingStrategy.REFERENCE_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.CARD_CLEARING,
    feeMappingKey: DefaultAccountMappingKey.GATEWAY_FEES,
    defaultFeeRate: '1.7500',
    vatOnFeeApplicable: true,
  },
  {
    code: 'TAMARA',
    nameAr: 'تمارا (Tamara)',
    nameEn: 'Tamara BNPL',
    category: SettlementProviderCategory.PAYMENT_GATEWAY,
    matchingStrategy: SettlementMatchingStrategy.ORDER_NUMBER_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.CARD_CLEARING,
    feeMappingKey: DefaultAccountMappingKey.GATEWAY_FEES,
    defaultFeeRate: '4.5000',
    vatOnFeeApplicable: true,
  },
  {
    code: 'HUNGERSTATION',
    nameAr: 'هنقرستيشن (HungerStation)',
    nameEn: 'HungerStation',
    category: SettlementProviderCategory.DELIVERY_AGGREGATOR,
    matchingStrategy: SettlementMatchingStrategy.ORDER_NUMBER_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.AGGREGATOR_RECEIVABLE,
    feeMappingKey: DefaultAccountMappingKey.AGGREGATOR_COMMISSION,
    defaultFeeRate: '20.0000',
    vatOnFeeApplicable: true,
  },
  {
    code: 'JAHEZ',
    nameAr: 'جاهز (Jahez)',
    nameEn: 'Jahez',
    category: SettlementProviderCategory.DELIVERY_AGGREGATOR,
    matchingStrategy: SettlementMatchingStrategy.ORDER_NUMBER_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.AGGREGATOR_RECEIVABLE,
    feeMappingKey: DefaultAccountMappingKey.AGGREGATOR_COMMISSION,
    defaultFeeRate: '18.0000',
    vatOnFeeApplicable: true,
  },
  {
    code: 'KEETA',
    nameAr: 'كيتا (Keeta)',
    nameEn: 'Keeta',
    category: SettlementProviderCategory.DELIVERY_AGGREGATOR,
    matchingStrategy: SettlementMatchingStrategy.ORDER_NUMBER_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.AGGREGATOR_RECEIVABLE,
    feeMappingKey: DefaultAccountMappingKey.AGGREGATOR_COMMISSION,
    defaultFeeRate: '18.0000',
    vatOnFeeApplicable: true,
  },
  {
    code: 'THE_CHEFZ',
    nameAr: 'ذا شفز (The Chefz)',
    nameEn: 'The Chefz',
    category: SettlementProviderCategory.DELIVERY_AGGREGATOR,
    matchingStrategy: SettlementMatchingStrategy.ORDER_NUMBER_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.AGGREGATOR_RECEIVABLE,
    feeMappingKey: DefaultAccountMappingKey.AGGREGATOR_COMMISSION,
    defaultFeeRate: '20.0000',
    vatOnFeeApplicable: true,
  },
  {
    code: 'TOYOU',
    nameAr: 'تو يو (ToYou)',
    nameEn: 'ToYou',
    category: SettlementProviderCategory.DELIVERY_AGGREGATOR,
    matchingStrategy: SettlementMatchingStrategy.ORDER_NUMBER_AND_AMOUNT,
    clearingMappingKey: DefaultAccountMappingKey.AGGREGATOR_RECEIVABLE,
    feeMappingKey: DefaultAccountMappingKey.AGGREGATOR_COMMISSION,
    defaultFeeRate: '18.0000',
    vatOnFeeApplicable: true,
  },
];

@Injectable()
export class SettlementsService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly postingEngine: PostingEngineService,
    private readonly opsFramework: OperationsFrameworkService
  ) {}

  private checkScope(context: TenantContext, legalEntityId?: string, branchId?: string) {
    this.opsFramework.verifyScope(context, context.userScopes, {
      legalEntityId,
      branchId,
    });
  }

  private getBranchScopeFilter(context: TenantContext): string | null {
    const hasGlobal = context.userScopes?.some(
      (s) => s.scopeType === 'TENANT' || s.scopeType === 'GROUP'
    );
    if (hasGlobal) return null;
    const branchScope = context.userScopes?.find((s) => s.scopeType === 'BRANCH' && s.scopeId);
    return branchScope?.scopeId ?? null;
  }

  private round4(n: number): number {
    return Math.round(n * 10000) / 10000;
  }

  // ====================================================================
  // 1. Settlement Providers Configuration (Per Legal Entity)
  // ====================================================================

  async listProviders(
    context: TenantContext,
    filters: { legalEntityId?: string; category?: string; isActive?: string }
  ) {
    return this.dbService.withTenantContext(context, async (tx) => {
      const conditions: any[] = [eq(settlementProviders.tenantId, context.tenantId)];
      if (filters.legalEntityId) {
        this.checkScope(context, filters.legalEntityId);
        conditions.push(eq(settlementProviders.legalEntityId, filters.legalEntityId));
      }
      if (filters.category) {
        conditions.push(eq(settlementProviders.category, filters.category));
      }
      if (filters.isActive === 'true' || filters.isActive === 'false') {
        conditions.push(eq(settlementProviders.isActive, filters.isActive === 'true'));
      }

      return tx
        .select()
        .from(settlementProviders)
        .where(and(...conditions))
        .orderBy(settlementProviders.category, settlementProviders.code);
    });
  }

  async createProvider(context: TenantContext, dto: CreateSettlementProviderRequest) {
    this.checkScope(context, dto.legalEntityId);

    return this.dbService.withTenantContext(context, async (tx) => {
      const [entity] = await tx
        .select({ id: legalEntities.id })
        .from(legalEntities)
        .where(
          and(
            eq(legalEntities.tenantId, context.tenantId),
            eq(legalEntities.id, dto.legalEntityId)
          )
        )
        .limit(1);
      if (!entity) {
        throw new NotFoundException('المنشأة القانونية غير موجودة');
      }

      if (dto.defaultBankAccountId) {
        const [bank] = await tx
          .select({ id: bankAccounts.id })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.tenantId, context.tenantId),
              eq(bankAccounts.legalEntityId, dto.legalEntityId),
              eq(bankAccounts.id, dto.defaultBankAccountId)
            )
          )
          .limit(1);
        if (!bank) {
          throw new BadRequestException('الحساب البنكي الافتراضي لا يتبع المنشأة القانونية المحددة');
        }
      }

      const codeUpper = dto.code.toUpperCase().trim();
      const [existing] = await tx
        .select({ id: settlementProviders.id })
        .from(settlementProviders)
        .where(
          and(
            eq(settlementProviders.tenantId, context.tenantId),
            eq(settlementProviders.legalEntityId, dto.legalEntityId),
            eq(settlementProviders.code, codeUpper)
          )
        )
        .limit(1);
      if (existing) {
        throw new ConflictException(`مزود التسوية '${codeUpper}' مسجل مسبقاً لهذه المنشأة`);
      }

      const [created] = await tx
        .insert(settlementProviders)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          code: codeUpper,
          nameAr: dto.nameAr,
          nameEn: dto.nameEn,
          category: dto.category,
          matchingStrategy: dto.matchingStrategy,
          clearingMappingKey: dto.clearingMappingKey,
          feeMappingKey: dto.feeMappingKey,
          defaultFeeRate: dto.defaultFeeRate,
          vatOnFeeApplicable: dto.vatOnFeeApplicable,
          defaultBankAccountId: dto.defaultBankAccountId ?? null,
          configJson: dto.configJson ?? null,
        })
        .returning();
      if (!created) throw new BadRequestException('فشل إنشاء مزود التسوية');

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SETTLEMENT_PROVIDER_CREATED',
          entityType: 'settlement_providers',
          entityId: created.id,
          afterState: created,
        },
        tx
      );

      return created;
    });
  }

  async updateProvider(
    context: TenantContext,
    providerId: string,
    dto: UpdateSettlementProviderRequest
  ) {
    return this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(settlementProviders)
        .where(
          and(
            eq(settlementProviders.tenantId, context.tenantId),
            eq(settlementProviders.id, providerId)
          )
        )
        .limit(1);
      if (!existing) {
        throw new NotFoundException('مزود التسوية غير موجود');
      }
      this.checkScope(context, existing.legalEntityId);

      if (dto.defaultBankAccountId) {
        const [bank] = await tx
          .select({ id: bankAccounts.id })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.tenantId, context.tenantId),
              eq(bankAccounts.legalEntityId, existing.legalEntityId),
              eq(bankAccounts.id, dto.defaultBankAccountId)
            )
          )
          .limit(1);
        if (!bank) {
          throw new BadRequestException('الحساب البنكي لا يتبع نفس المنشأة القانونية');
        }
      }

      const [updated] = await tx
        .update(settlementProviders)
        .set({
          ...(dto.nameAr !== undefined ? { nameAr: dto.nameAr } : {}),
          ...(dto.nameEn !== undefined ? { nameEn: dto.nameEn } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.matchingStrategy !== undefined ? { matchingStrategy: dto.matchingStrategy } : {}),
          ...(dto.clearingMappingKey !== undefined ? { clearingMappingKey: dto.clearingMappingKey } : {}),
          ...(dto.feeMappingKey !== undefined ? { feeMappingKey: dto.feeMappingKey } : {}),
          ...(dto.defaultFeeRate !== undefined ? { defaultFeeRate: dto.defaultFeeRate } : {}),
          ...(dto.vatOnFeeApplicable !== undefined ? { vatOnFeeApplicable: dto.vatOnFeeApplicable } : {}),
          ...(dto.defaultBankAccountId !== undefined ? { defaultBankAccountId: dto.defaultBankAccountId } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.configJson !== undefined ? { configJson: dto.configJson } : {}),
          updatedAt: new Date(),
        })
        .where(eq(settlementProviders.id, providerId))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SETTLEMENT_PROVIDER_UPDATED',
          entityType: 'settlement_providers',
          entityId: providerId,
          beforeState: existing,
          afterState: updated,
        },
        tx
      );

      return updated;
    });
  }

  async seedDefaultProviders(context: TenantContext, legalEntityId: string) {
    this.checkScope(context, legalEntityId);

    return this.dbService.withTenantContext(context, async (tx) => {
      const existing = await tx
        .select({ code: settlementProviders.code })
        .from(settlementProviders)
        .where(
          and(
            eq(settlementProviders.tenantId, context.tenantId),
            eq(settlementProviders.legalEntityId, legalEntityId)
          )
        );
      const existingCodes = new Set(existing.map((e) => e.code));

      const toInsert = DEFAULT_PROVIDER_PRESETS.filter((p) => !existingCodes.has(p.code)).map(
        (p) => ({
          tenantId: context.tenantId,
          legalEntityId,
          code: p.code,
          nameAr: p.nameAr,
          nameEn: p.nameEn,
          category: p.category,
          matchingStrategy: p.matchingStrategy,
          clearingMappingKey: p.clearingMappingKey,
          feeMappingKey: p.feeMappingKey,
          defaultFeeRate: p.defaultFeeRate,
          vatOnFeeApplicable: p.vatOnFeeApplicable,
          isActive: true,
        })
      );

      if (toInsert.length > 0) {
        await tx.insert(settlementProviders).values(toInsert);
      }

      return tx
        .select()
        .from(settlementProviders)
        .where(
          and(
            eq(settlementProviders.tenantId, context.tenantId),
            eq(settlementProviders.legalEntityId, legalEntityId)
          )
        )
        .orderBy(settlementProviders.category, settlementProviders.code);
    });
  }

  // ====================================================================
  // 2. Statement Import & Reconciliation Engine
  // ====================================================================

  async importStatement(context: TenantContext, dto: ImportSettlementStatementRequest) {
    this.checkScope(context, dto.legalEntityId, dto.branchId ?? undefined);

    return this.dbService.withTenantContext(context, async (tx) => {
      const [provider] = await tx
        .select()
        .from(settlementProviders)
        .where(
          and(
            eq(settlementProviders.tenantId, context.tenantId),
            eq(settlementProviders.legalEntityId, dto.legalEntityId),
            eq(settlementProviders.id, dto.providerId)
          )
        )
        .limit(1);
      if (!provider) {
        throw new NotFoundException('مزود التسوية غير موجود أو لا يتبع المنشأة القانونية');
      }
      if (!provider.isActive) {
        throw new BadRequestException(`مزود التسوية '${provider.nameAr}' غير نشط حالياً`);
      }

      // Compute deterministic fileHash for duplicate / concurrent import protection
      const hashPayload =
        dto.format === 'JSON_API'
          ? JSON.stringify({
              providerId: dto.providerId,
              branchId: dto.branchId || null,
              settlementDate: dto.settlementDate,
              rows: dto.rows || [],
            })
          : dto.csvContent || dto.fileContentBase64 || '';
      const fileHash = crypto.createHash('sha256').update(hashPayload).digest('hex');

      // Idempotency check 1: Idempotency key on batch
      if (dto.idempotencyKey) {
        const [existingByKey] = await tx
          .select()
          .from(settlementBatches)
          .where(
            and(
              eq(settlementBatches.tenantId, context.tenantId),
              eq(settlementBatches.idempotencyKey, dto.idempotencyKey)
            )
          )
          .limit(1);
        if (existingByKey) {
          return { ...existingByKey, idempotent: true };
        }
      }

      // Idempotency check 2: File hash
      const [existingImport] = await tx
        .select()
        .from(settlementImportFiles)
        .where(
          and(
            eq(settlementImportFiles.tenantId, context.tenantId),
            eq(settlementImportFiles.legalEntityId, dto.legalEntityId),
            eq(settlementImportFiles.providerId, dto.providerId),
            eq(settlementImportFiles.fileHash, fileHash)
          )
        )
        .limit(1);

      if (existingImport) {
        if (existingImport.status === 'PROCESSING') {
          throw new ConflictException('هذا الملف قيد المعالجة حالياً؛ يرجى الانتظار لمنع التكرار');
        }
        const [existingBatch] = await tx
          .select()
          .from(settlementBatches)
          .where(
            and(
              eq(settlementBatches.tenantId, context.tenantId),
              eq(settlementBatches.importFileId, existingImport.id)
            )
          )
          .limit(1);
        if (existingBatch) {
          return { ...existingBatch, idempotent: true };
        }
      }

      const parsed = parseSettlementStatement({
        format: dto.format,
        csvContent: dto.csvContent,
        fileContentBase64: dto.fileContentBase64,
        rows: dto.rows,
      });

      const [importRecord] = await tx
        .insert(settlementImportFiles)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          providerId: dto.providerId,
          fileName: dto.fileName,
          fileHash,
          format: dto.format,
          status: 'PROCESSING',
          totalRows: parsed.totalRows,
          errorRows: parsed.rowErrors.length,
          errorsJson: parsed.rowErrors.length > 0 ? parsed.rowErrors : null,
          importedBy: context.userId,
        })
        .returning();
      if (!importRecord) throw new BadRequestException('فشل إنشاء سجل ملف الاستيراد');

      const batchNumber =
        dto.batchNumber ||
        `STL-${provider.code}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-5)}`;

      const [batch] = await tx
        .insert(settlementBatches)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId ?? null,
          providerId: provider.id,
          importFileId: importRecord.id,
          batchNumber,
          settlementType: provider.category,
          settlementDate: new Date(dto.settlementDate),
          periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
          periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null,
          bankAccountId: dto.bankAccountId ?? provider.defaultBankAccountId ?? null,
          status: SettlementBatchStatus.RECONCILING,
          hasValidTaxInvoice: dto.hasValidTaxInvoice ?? false,
          taxInvoiceNumber: dto.taxInvoiceNumber ?? null,
          isVatRecoverable: dto.isVatRecoverable ?? false,
          bankReference: dto.bankReference ?? null,
          idempotencyKey: dto.idempotencyKey ?? null,
          notes: dto.notes ?? null,
          createdBy: context.userId,
        })
        .returning();
      if (!batch) throw new BadRequestException('فشل إنشاء دفعة التسوية');

      // Bulk-load candidate payments & orders in 2 queries (No N+1)
      const extRefs = [
        ...new Set(parsed.rows.map((r) => r.externalRef).filter((v): v is string => !!v && v.trim() !== '')),
      ];
      const orderNums = [
        ...new Set(parsed.rows.map((r) => r.orderNumber).filter((v): v is string => !!v && v.trim() !== '')),
      ];

      const candidatePaymentsByRef = new Map<string, any>();
      const candidatePaymentsByOrderId = new Map<string, any[]>();
      const candidateOrdersByNumber = new Map<string, any>();

      if (extRefs.length > 0) {
        const payRows = await tx
          .select({
            payment: payments,
            orderNumber: salesOrders.orderNumber,
            orderStatus: salesOrders.status,
            orderBranchId: salesOrders.branchId,
          })
          .from(payments)
          .innerJoin(salesOrders, eq(payments.orderId, salesOrders.id))
          .where(
            and(
              eq(payments.tenantId, context.tenantId),
              eq(payments.legalEntityId, dto.legalEntityId),
              inArray(payments.providerTransactionRef, extRefs)
            )
          );
        for (const pr of payRows) {
          if (pr.payment.providerTransactionRef) {
            candidatePaymentsByRef.set(pr.payment.providerTransactionRef, {
              ...pr.payment,
              orderNumber: pr.orderNumber,
              orderStatus: pr.orderStatus,
              orderBranchId: pr.orderBranchId,
            });
          }
        }
      }

      if (orderNums.length > 0) {
        const ordConditions: any[] = [
          eq(salesOrders.tenantId, context.tenantId),
          eq(salesOrders.legalEntityId, dto.legalEntityId),
          inArray(salesOrders.orderNumber, orderNums),
        ];
        if (dto.branchId) {
          ordConditions.push(eq(salesOrders.branchId, dto.branchId));
        }
        const ordRows = await tx
          .select()
          .from(salesOrders)
          .where(and(...ordConditions));
        for (const ord of ordRows) {
          candidateOrdersByNumber.set(ord.orderNumber, ord);
        }

        const ordIds = ordRows.map((o) => o.id);
        if (ordIds.length > 0) {
          const ordPayments = await tx
            .select()
            .from(payments)
            .where(
              and(
                eq(payments.tenantId, context.tenantId),
                inArray(payments.orderId, ordIds)
              )
            );
          for (const p of ordPayments) {
            const arr = candidatePaymentsByOrderId.get(p.orderId) || [];
            arr.push(p);
            candidatePaymentsByOrderId.set(p.orderId, arr);
          }
        }
      }

      // Track seen keys inside this file to catch duplicates
      const seenKeys = new Set<string>();
      const matchedPaymentIds = new Set<string>();
      const lineInserts: any[] = [];
      const discrepancyDrafts: Array<{
        lineNumber: number;
        discrepancyType: SettlementDiscrepancyType;
        sourceSystem: string;
        amount: string;
        description: string;
      }> = [];

      let totalGross = 0;
      let totalCancelled = 0;
      let totalRestDiscount = 0;
      let totalPlatDiscount = 0;
      let totalDeliveryFee = 0;
      let totalFee = 0;
      let totalFeeTax = 0;
      let totalWithheld = 0;
      let totalNetExpected = 0;
      let matchedCount = 0;
      let discrepancyCount = 0;

      const isAggregator = provider.category === SettlementProviderCategory.DELIVERY_AGGREGATOR;

      for (let idx = 0; idx < parsed.rows.length; idx++) {
        const row = parsed.rows[idx];
        if (!row) continue;
        const lineNumber = idx + 1;
        const gross = parseFloat(row.grossAmount || '0');
        const discRest = parseFloat(row.discountRestaurant || '0');
        const discPlat = parseFloat(row.discountPlatform || '0');
        const delivFee = parseFloat(row.deliveryFee || '0');
        const fee = parseFloat(row.feeAmount || '0');
        const feeTax = parseFloat(row.feeTaxAmount || '0');
        const withheld = parseFloat(row.withheldAmount || '0');
        const computedNet = this.round4(
          gross - discRest - fee - feeTax - withheld + (isAggregator ? delivFee : 0)
        );
        const rowNet = row.netAmount !== undefined ? parseFloat(row.netAmount) : computedNet;

        // 1. Match against system records using provider matchingStrategy
        let matchedOrder: any = null;
        let matchedPayment: any = null;

        if (provider.matchingStrategy === SettlementMatchingStrategy.ORDER_NUMBER_AND_AMOUNT) {
          if (row.orderNumber && candidateOrdersByNumber.has(row.orderNumber)) {
            matchedOrder = candidateOrdersByNumber.get(row.orderNumber);
            const ordPays = candidatePaymentsByOrderId.get(matchedOrder.id) || [];
            matchedPayment =
              ordPays.find((p) => parseFloat(p.amount) > 0 && p.status !== PaymentStatus.VOIDED) ||
              ordPays[0] ||
              null;
          } else if (row.externalRef && candidatePaymentsByRef.has(row.externalRef)) {
            matchedPayment = candidatePaymentsByRef.get(row.externalRef);
            matchedOrder = {
              id: matchedPayment.orderId,
              orderNumber: matchedPayment.orderNumber,
              status: matchedPayment.orderStatus,
              branchId: matchedPayment.orderBranchId,
              grandTotal: matchedPayment.amount,
            };
          }
        } else {
          // REFERENCE_AND_AMOUNT or BATCH_SUMMARY
          if (row.externalRef && candidatePaymentsByRef.has(row.externalRef)) {
            matchedPayment = candidatePaymentsByRef.get(row.externalRef);
            matchedOrder = {
              id: matchedPayment.orderId,
              orderNumber: matchedPayment.orderNumber,
              status: matchedPayment.orderStatus,
              branchId: matchedPayment.orderBranchId,
              grandTotal: matchedPayment.amount,
            };
          } else if (row.orderNumber && candidateOrdersByNumber.has(row.orderNumber)) {
            matchedOrder = candidateOrdersByNumber.get(row.orderNumber);
            const ordPays = candidatePaymentsByOrderId.get(matchedOrder.id) || [];
            matchedPayment =
              ordPays.find(
                (p) =>
                  parseFloat(p.amount) > 0 &&
                  (!row.paymentMethod || p.paymentMethod === row.paymentMethod)
              ) ||
              ordPays[0] ||
              null;
          }
        }

        // Determine duplicate key
        const dedupKey = row.externalRef
          ? `REF:${row.externalRef}`
          : row.orderNumber
            ? `ORD:${row.orderNumber}`
            : null;
        const isDuplicateInFile = dedupKey ? seenKeys.has(dedupKey) : false;
        if (dedupKey) seenKeys.add(dedupKey);

        const rowStatusUpper = (row.status || '').toUpperCase();
        const isRowCancelled =
          rowStatusUpper === 'CANCELLED' || rowStatusUpper === 'REFUNDED' || gross < 0;
        const isPartialRow = rowStatusUpper === 'PARTIAL' || rowStatusUpper === 'PARTIALLY_SETTLED';

        let matchStatus: SettlementLineMatchStatus = SettlementLineMatchStatus.MATCHED;
        let systemAmount = 0;
        let settledAmount = gross;

        if (isDuplicateInFile) {
          matchStatus = SettlementLineMatchStatus.DUPLICATE;
          discrepancyCount++;
          discrepancyDrafts.push({
            lineNumber,
            discrepancyType: SettlementDiscrepancyType.DUPLICATE_ENTRY,
            sourceSystem: isAggregator ? 'AGGREGATOR_STATEMENT' : 'GATEWAY_STATEMENT',
            amount: Math.abs(gross).toFixed(4),
            description: `عملية مكررة في كشف التسوية (${dedupKey})`,
          });
        } else if (!matchedPayment && !matchedOrder) {
          matchStatus = SettlementLineMatchStatus.MISSING_IN_SYSTEM;
          settledAmount = 0;
          discrepancyCount++;
          discrepancyDrafts.push({
            lineNumber,
            discrepancyType: SettlementDiscrepancyType.MISSING_IN_SYSTEM,
            sourceSystem: isAggregator ? 'AGGREGATOR_STATEMENT' : 'GATEWAY_STATEMENT',
            amount: Math.abs(gross).toFixed(4),
            description: `عملية موجودة في كشف المزود وغير موجودة في النظام (مرجع: ${row.externalRef || row.orderNumber || lineNumber})`,
          });
        } else {
          systemAmount = matchedPayment
            ? parseFloat(matchedPayment.amount)
            : parseFloat(matchedOrder.grandTotal);
          const alreadySettled = matchedPayment ? parseFloat(matchedPayment.settledAmount || '0') : 0;
          const remainingUnsettled = this.round4(Math.max(0, systemAmount - alreadySettled));

          if (matchedPayment) {
            matchedPaymentIds.add(matchedPayment.id);
          }

          if (matchedPayment && matchedPayment.settlementStatus === PaymentSettlementStatus.SETTLED) {
            matchStatus = SettlementLineMatchStatus.DUPLICATE;
            discrepancyCount++;
            discrepancyDrafts.push({
              lineNumber,
              discrepancyType: SettlementDiscrepancyType.DUPLICATE_ENTRY,
              sourceSystem: isAggregator ? 'AGGREGATOR_STATEMENT' : 'GATEWAY_STATEMENT',
              amount: Math.abs(gross).toFixed(4),
              description: `عملية مسوّاة مسبقاً في دفعة أخرى (Payment #${matchedPayment.id})`,
            });
          } else if (
            isRowCancelled ||
            matchedOrder?.status === OrderStatus.CANCELLED ||
            matchedOrder?.status === OrderStatus.REFUNDED ||
            matchedPayment?.status === PaymentStatus.VOIDED ||
            matchedPayment?.status === PaymentStatus.REFUNDED
          ) {
            matchStatus = SettlementLineMatchStatus.CANCELLED_OR_REFUNDED;
            totalCancelled += Math.abs(gross);
            discrepancyCount++;
            discrepancyDrafts.push({
              lineNumber,
              discrepancyType: SettlementDiscrepancyType.CANCELLED_OR_REFUNDED,
              sourceSystem: isAggregator ? 'AGGREGATOR_STATEMENT' : 'GATEWAY_STATEMENT',
              amount: Math.abs(gross).toFixed(4),
              description: `عملية ملغاة أو مستردة في النظام أو الكشف (${row.orderNumber || row.externalRef || lineNumber})`,
            });
          } else if (
            isPartialRow ||
            (gross > 0 && gross < remainingUnsettled - 0.01 && provider.matchingStrategy !== SettlementMatchingStrategy.BATCH_SUMMARY && rowStatusUpper === 'PARTIAL')
          ) {
            matchStatus = SettlementLineMatchStatus.PARTIAL;
            settledAmount = gross;
            matchedCount++;
          } else if (Math.abs(gross - remainingUnsettled) > 0.01) {
            // Check if partial without explicit flag: if gross < remainingUnsettled and partial allowed?
            // Standard rule: flag AMOUNT_MISMATCH so accountant reviews!
            matchStatus = SettlementLineMatchStatus.AMOUNT_MISMATCH;
            discrepancyCount++;
            discrepancyDrafts.push({
              lineNumber,
              discrepancyType: SettlementDiscrepancyType.AMOUNT_MISMATCH,
              sourceSystem: isAggregator ? 'AGGREGATOR_STATEMENT' : 'GATEWAY_STATEMENT',
              amount: Math.abs(gross - remainingUnsettled).toFixed(4),
              description: `اختلاف قيمة العملية: الكشف (${gross.toFixed(2)}) مقابل المتبقي بالنظام (${remainingUnsettled.toFixed(2)})`,
            });
          } else {
            matchedCount++;
          }

          // Check net arithmetic / commission discrepancy if netAmount explicitly supplied
          if (row.netAmount !== undefined && Math.abs(rowNet - computedNet) > 0.02) {
            discrepancyCount++;
            discrepancyDrafts.push({
              lineNumber,
              discrepancyType: SettlementDiscrepancyType.FEE_MISMATCH,
              sourceSystem: isAggregator ? 'AGGREGATOR_STATEMENT' : 'GATEWAY_STATEMENT',
              amount: Math.abs(rowNet - computedNet).toFixed(4),
              description: `اختلاف احتساب العمولة/الصافي: صافي الكشف (${rowNet.toFixed(2)}) مقابل المحسوب (${computedNet.toFixed(2)})`,
            });
          }

          // Check withheld amounts
          if (withheld > 0.0001) {
            if (matchStatus === SettlementLineMatchStatus.MATCHED) {
              matchStatus = SettlementLineMatchStatus.WITHHELD;
            }
            discrepancyCount++;
            discrepancyDrafts.push({
              lineNumber,
              discrepancyType: SettlementDiscrepancyType.WITHHELD_AMOUNT,
              sourceSystem: isAggregator ? 'AGGREGATOR_STATEMENT' : 'GATEWAY_STATEMENT',
              amount: withheld.toFixed(4),
              description: `مبلغ محتجز لدى المزود بقيمة ${withheld.toFixed(2)}`,
            });
          }
        }

        if (!isDuplicateInFile && !isRowCancelled) {
          totalGross += gross;
          totalRestDiscount += discRest;
          totalPlatDiscount += discPlat;
          totalDeliveryFee += delivFee;
          totalFee += fee;
          totalFeeTax += feeTax;
          totalWithheld += withheld;
          totalNetExpected += rowNet;
        }

        lineInserts.push({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId ?? matchedOrder?.branchId ?? null,
          batchId: batch.id,
          providerId: provider.id,
          lineNumber,
          externalRef: row.externalRef ?? null,
          orderNumber: row.orderNumber ?? null,
          paymentMethod: row.paymentMethod ?? null,
          transactionDate: row.transactionDate ? new Date(row.transactionDate) : null,
          grossAmount: gross.toFixed(4),
          discountRestaurant: discRest.toFixed(4),
          discountPlatform: discPlat.toFixed(4),
          deliveryFee: delivFee.toFixed(4),
          feeAmount: fee.toFixed(4),
          feeTaxAmount: feeTax.toFixed(4),
          withheldAmount: withheld.toFixed(4),
          netAmount: rowNet.toFixed(4),
          matchedPaymentId: matchedPayment?.id ?? null,
          matchedOrderId: matchedOrder?.id ?? null,
          systemAmount: systemAmount.toFixed(4),
          settledAmount: settledAmount.toFixed(4),
          matchStatus,
          rawRowJson: row,
        });
      }

      const insertedLines =
        lineInserts.length > 0
          ? await tx.insert(settlementBatchLines).values(lineInserts).returning()
          : [];
      const lineIdByNumber = new Map(insertedLines.map((l) => [l.lineNumber, l.id]));

      // Missing in Statement check when periodStart & periodEnd are provided
      if (dto.periodStart && dto.periodEnd) {
        const periodPayConditions: any[] = [
          eq(payments.tenantId, context.tenantId),
          eq(payments.legalEntityId, dto.legalEntityId),
          eq(payments.status, PaymentStatus.CAPTURED),
          sql`${payments.settlementStatus} != ${PaymentSettlementStatus.SETTLED}`,
          gte(payments.confirmedAt, new Date(dto.periodStart)),
          lte(payments.confirmedAt, new Date(dto.periodEnd)),
        ];
        if (dto.branchId) {
          periodPayConditions.push(eq(salesOrders.branchId, dto.branchId));
        }
        if (provider.category === SettlementProviderCategory.PAYMENT_GATEWAY) {
          periodPayConditions.push(
            or(
              eq(payments.providerCode, provider.code),
              eq(payments.paymentMethod, provider.code)
            )
          );
        } else {
          periodPayConditions.push(
            or(
              eq(payments.providerCode, provider.code),
              eq(salesOrders.channel, 'AGGREGATOR')
            )
          );
        }

        const periodSystemPayments = await tx
          .select({
            id: payments.id,
            amount: payments.amount,
            settledAmount: payments.settledAmount,
            providerTransactionRef: payments.providerTransactionRef,
            orderNumber: salesOrders.orderNumber,
          })
          .from(payments)
          .innerJoin(salesOrders, eq(payments.orderId, salesOrders.id))
          .where(and(...periodPayConditions));

        for (const sp of periodSystemPayments) {
          if (!matchedPaymentIds.has(sp.id)) {
            const rem = this.round4(parseFloat(sp.amount) - parseFloat(sp.settledAmount || '0'));
            if (rem > 0.0001) {
              discrepancyCount++;
              discrepancyDrafts.push({
                lineNumber: 0,
                discrepancyType: SettlementDiscrepancyType.MISSING_IN_STATEMENT,
                sourceSystem: 'POS_PAYMENT',
                amount: rem.toFixed(4),
                description: `عملية مسجلة في النظام (طلب #${sp.orderNumber} / مرجع ${sp.providerTransactionRef || 'بدون'}) ولم ترد في كشف التسوية`,
              });
            }
          }
        }
      }

      if (discrepancyDrafts.length > 0) {
        await tx.insert(settlementDiscrepancies).values(
          discrepancyDrafts.map((d) => ({
            tenantId: context.tenantId,
            legalEntityId: dto.legalEntityId,
            branchId: dto.branchId ?? null,
            batchId: batch.id,
            batchLineId: d.lineNumber > 0 ? lineIdByNumber.get(d.lineNumber) ?? null : null,
            discrepancyType: d.discrepancyType,
            sourceSystem: d.sourceSystem,
            amount: d.amount,
            description: d.description,
            status: SettlementDiscrepancyStatus.OPEN,
            createdBy: context.userId,
          }))
        );
      }

      const bankReceived =
        dto.bankReceivedAmount !== undefined ? parseFloat(dto.bankReceivedAmount) : totalNetExpected;
      const variance = this.round4(bankReceived - totalNetExpected);
      const finalBatchStatus =
        discrepancyDrafts.length > 0
          ? SettlementBatchStatus.DISCREPANCY_PENDING
          : SettlementBatchStatus.RECONCILING;

      const [updatedBatch] = await tx
        .update(settlementBatches)
        .set({
          status: finalBatchStatus,
          grossAmount: totalGross.toFixed(4),
          cancelledAmount: totalCancelled.toFixed(4),
          restaurantDiscountAmount: totalRestDiscount.toFixed(4),
          platformDiscountAmount: totalPlatDiscount.toFixed(4),
          deliveryFeeAmount: totalDeliveryFee.toFixed(4),
          feeAmount: totalFee.toFixed(4),
          feeTaxAmount: totalFeeTax.toFixed(4),
          withheldAmount: totalWithheld.toFixed(4),
          netExpectedAmount: totalNetExpected.toFixed(4),
          bankReceivedAmount: bankReceived.toFixed(4),
          varianceAmount: variance.toFixed(4),
          updatedAt: new Date(),
        })
        .where(eq(settlementBatches.id, batch.id))
        .returning();
      if (!updatedBatch) throw new BadRequestException('فشل تحديث دفعة التسوية');

      await tx
        .update(settlementImportFiles)
        .set({
          status: 'COMPLETED',
          matchedRows: matchedCount,
          discrepancyRows: discrepancyCount,
          completedAt: new Date(),
        })
        .where(eq(settlementImportFiles.id, importRecord.id));

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SETTLEMENT_STATEMENT_IMPORTED',
          entityType: 'settlement_batches',
          entityId: batch.id,
          afterState: {
            batchNumber: updatedBatch.batchNumber,
            providerCode: provider.code,
            totalRows: parsed.rows.length,
            matchedCount,
            discrepancyCount,
          },
        },
        tx
      );

      return {
        ...updatedBatch,
        idempotent: false,
        matchedRows: matchedCount,
        discrepancyCount: discrepancyDrafts.length,
      };
    });
  }

  // ====================================================================
  // 3. Discrepancy Resolution Workflow
  // ====================================================================

  async resolveDiscrepancy(
    context: TenantContext,
    discrepancyId: string,
    dto: ResolveSettlementDiscrepancyRequest
  ) {
    return this.dbService.withTenantContext(context, async (tx) => {
      const [disc] = await tx
        .select()
        .from(settlementDiscrepancies)
        .where(
          and(
            eq(settlementDiscrepancies.tenantId, context.tenantId),
            eq(settlementDiscrepancies.id, discrepancyId)
          )
        )
        .limit(1);
      if (!disc) {
        throw new NotFoundException('سجل الفرق غير موجود');
      }
      this.checkScope(context, disc.legalEntityId, disc.branchId ?? undefined);

      const [batch] = await tx
        .select()
        .from(settlementBatches)
        .where(eq(settlementBatches.id, disc.batchId))
        .limit(1);
      if (!batch) {
        throw new NotFoundException('دفعة التسوية غير موجودة');
      }
      if (batch.status === SettlementBatchStatus.POSTED) {
        throw new BadRequestException('لا يمكن تعديل فروقات دفعة تسوية مرحّلة بالفعل');
      }

      const [updatedDisc] = await tx
        .update(settlementDiscrepancies)
        .set({
          status: dto.status,
          resolutionNotes: dto.resolutionNotes,
          resolvedBy: context.userId,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(settlementDiscrepancies.id, discrepancyId))
        .returning();

      // Re-check if any OPEN or UNDER_REVIEW discrepancies remain on the batch
      const [openCountRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(settlementDiscrepancies)
        .where(
          and(
            eq(settlementDiscrepancies.tenantId, context.tenantId),
            eq(settlementDiscrepancies.batchId, batch.id),
            inArray(settlementDiscrepancies.status, [
              SettlementDiscrepancyStatus.OPEN,
              SettlementDiscrepancyStatus.UNDER_REVIEW,
            ])
          )
        );

      if ((openCountRow?.count ?? 0) === 0 && batch.status === SettlementBatchStatus.DISCREPANCY_PENDING) {
        await tx
          .update(settlementBatches)
          .set({ status: SettlementBatchStatus.RECONCILING, updatedAt: new Date() })
          .where(eq(settlementBatches.id, batch.id));
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SETTLEMENT_DISCREPANCY_RESOLVED',
          entityType: 'settlement_discrepancies',
          entityId: discrepancyId,
          beforeState: disc,
          afterState: updatedDisc,
        },
        tx
      );

      return updatedDisc;
    });
  }

  // ====================================================================
  // 4. Approve & Post Settlement Batch (Atomic PostingEngine + Bank)
  // ====================================================================

  async postSettlementBatch(
    context: TenantContext,
    batchId: string,
    dto: PostSettlementBatchRequest
  ) {
    return this.dbService.withTenantContext(context, async (tx) => {
      // Idempotency check by idempotencyKey first
      if (dto.idempotencyKey) {
        const [postedByKey] = await tx
          .select()
          .from(settlementBatches)
          .where(
            and(
              eq(settlementBatches.tenantId, context.tenantId),
              eq(settlementBatches.idempotencyKey, dto.idempotencyKey),
              eq(settlementBatches.status, SettlementBatchStatus.POSTED)
            )
          )
          .limit(1);
        if (postedByKey) {
          return { ...postedByKey, idempotent: true };
        }
      }

      const [batch] = await tx
        .select()
        .from(settlementBatches)
        .where(
          and(
            eq(settlementBatches.tenantId, context.tenantId),
            eq(settlementBatches.id, batchId)
          )
        )
        .limit(1);
      if (!batch) {
        throw new NotFoundException('دفعة التسوية غير موجودة');
      }

      this.checkScope(context, batch.legalEntityId, batch.branchId ?? undefined);

      // Idempotent return if same batch already posted with same idempotencyKey
      if (batch.status === SettlementBatchStatus.POSTED) {
        if (dto.idempotencyKey && batch.idempotencyKey === dto.idempotencyKey) {
          return { ...batch, idempotent: true };
        }
        throw new ConflictException(`دفعة التسوية #${batch.batchNumber} مرحّلة ومغلقة مسبقاً`);
      }

      if (batch.status === SettlementBatchStatus.CANCELLED) {
        throw new BadRequestException('لا يمكن ترحيل دفعة تسوية ملغاة');
      }

      const [provider] = await tx
        .select()
        .from(settlementProviders)
        .where(eq(settlementProviders.id, batch.providerId))
        .limit(1);
      if (!provider) {
        throw new NotFoundException('مزود التسوية المرتبط غير موجود');
      }

      // Check unresolved discrepancies
      const openDiscs = await tx
        .select()
        .from(settlementDiscrepancies)
        .where(
          and(
            eq(settlementDiscrepancies.tenantId, context.tenantId),
            eq(settlementDiscrepancies.batchId, batch.id),
            inArray(settlementDiscrepancies.status, [
              SettlementDiscrepancyStatus.OPEN,
              SettlementDiscrepancyStatus.UNDER_REVIEW,
            ])
          )
        );

      if (openDiscs.length > 0) {
        const nonWithheldOpen = openDiscs.filter(
          (d) => d.discrepancyType !== SettlementDiscrepancyType.WITHHELD_AMOUNT
        );
        if (!dto.allowSuspensePosting || nonWithheldOpen.length > 0) {
          throw new BadRequestException(
            `لا يمكن اعتماد وترحيل الدفعة لوجود (${openDiscs.length}) فروقات غير معالجة. يرجى مراجعتها وتسويتها أولاً.`
          );
        }
      }

      // Validate Bank Account ownership & branch access
      const [bank] = await tx
        .select()
        .from(bankAccounts)
        .where(
          and(
            eq(bankAccounts.tenantId, context.tenantId),
            eq(bankAccounts.legalEntityId, batch.legalEntityId),
            eq(bankAccounts.id, dto.bankAccountId)
          )
        )
        .limit(1);
      if (!bank) {
        throw new ForbiddenException('الحساب البنكي المحدد غير موجود أو لا يتبع المنشأة القانونية');
      }
      if (bank.status !== 'ACTIVE') {
        throw new BadRequestException(`الحساب البنكي (${bank.bankName}) غير نشط`);
      }

      if (batch.branchId) {
        const branchRules = await tx
          .select()
          .from(bankAccountBranchAccess)
          .where(
            and(
              eq(bankAccountBranchAccess.tenantId, context.tenantId),
              eq(bankAccountBranchAccess.bankAccountId, bank.id),
              eq(bankAccountBranchAccess.isActive, true)
            )
          );
        if (branchRules.length > 0 && !branchRules.some((r) => r.branchId === batch.branchId)) {
          throw new ForbiddenException('الحساب البنكي غير مصرح باستخدامه لهذا الفرع');
        }
      }

      // Fetch lines to calculate exact settled clearing total
      const lines = await tx
        .select()
        .from(settlementBatchLines)
        .where(eq(settlementBatchLines.batchId, batch.id));

      const grossAmount = parseFloat(batch.grossAmount);
      const restDiscount = parseFloat(batch.restaurantDiscountAmount);
      const deliveryFee = parseFloat(batch.deliveryFeeAmount);
      const feeAmount = parseFloat(batch.feeAmount);
      const feeTaxAmount = parseFloat(batch.feeTaxAmount);
      const withheldAmount = parseFloat(batch.withheldAmount);
      const bankReceived = parseFloat(dto.bankReceivedAmount);

      const isAggregator = provider.category === SettlementProviderCategory.DELIVERY_AGGREGATOR;
      const clearingCreditTotal = this.round4(grossAmount + (isAggregator ? deliveryFee : 0));

      // VAT Input Eligibility Check
      const vatEligible = Boolean(
        dto.hasValidTaxInvoice && dto.isVatRecoverable && feeTaxAmount > 0.0001
      );
      const vatInputDebit = vatEligible ? feeTaxAmount : 0;
      const feeExpenseDebit = vatEligible ? feeAmount : this.round4(feeAmount + feeTaxAmount);

      // Suspense / Withheld handling
      const suspenseDiscs = await tx
        .select()
        .from(settlementDiscrepancies)
        .where(
          and(
            eq(settlementDiscrepancies.tenantId, context.tenantId),
            eq(settlementDiscrepancies.batchId, batch.id),
            eq(settlementDiscrepancies.status, SettlementDiscrepancyStatus.RESOLVED_SUSPENSE)
          )
        );
      const resolvedSuspenseTotal = suspenseDiscs.reduce((s, d) => s + parseFloat(d.amount), 0);

      // Expected Debit = bankReceived + feeExpenseDebit + vatInputDebit + restDiscount + withheldAmount
      const baseDebits = this.round4(
        bankReceived + feeExpenseDebit + vatInputDebit + (isAggregator ? restDiscount : 0) + withheldAmount
      );
      const residual = this.round4(clearingCreditTotal - baseDebits);

      if (Math.abs(residual) > 0.02 && !dto.allowSuspensePosting && resolvedSuspenseTotal === 0) {
        throw new BadRequestException(
          `عدم توازن التسوية: إجمالي التسوية (${clearingCreditTotal.toFixed(2)}) لا يطابق مجموع التحويل البنكي والعمولات والمحتجز (${baseDebits.toFixed(2)})، الفرق: ${residual.toFixed(2)}`
        );
      }

      const suspenseDebit = this.round4(withheldAmount + (residual > 0.0001 ? residual : 0));
      const suspenseCredit = residual < -0.0001 ? Math.abs(residual) : 0;

      const journalLinesInput: PostingLineInput[] = [];

      // 1. Debit Bank Account
      if (bankReceived > 0.0001) {
        journalLinesInput.push({
          accountId: bank.accountId,
          branchId: batch.branchId ?? undefined,
          debit: bankReceived.toFixed(4),
          credit: '0.0000',
          description: `إيداع تسوية ${provider.nameAr} - مرجع بنكي ${dto.bankReference}`,
        });
      }

      // 2. Debit Gateway Fee / Aggregator Commission
      if (feeExpenseDebit > 0.0001) {
        journalLinesInput.push({
          mappingKey: provider.feeMappingKey,
          branchId: batch.branchId ?? undefined,
          debit: feeExpenseDebit.toFixed(4),
          credit: '0.0000',
          description: `عمولة ورسوم ${provider.nameAr} (${batch.batchNumber})`,
        });
      }

      // 3. Debit VAT Input ONLY if valid tax invoice & recoverable
      if (vatInputDebit > 0.0001) {
        journalLinesInput.push({
          mappingKey: DefaultAccountMappingKey.VAT_INPUT,
          branchId: batch.branchId ?? undefined,
          debit: vatInputDebit.toFixed(4),
          credit: '0.0000',
          description: `ضريبة مدخلات على عمولة ${provider.nameAr} - فاتورة ضريبية ${dto.taxInvoiceNumber || ''}`,
        });
      }

      // 4. Debit Sales Discounts borne by restaurant (Aggregators)
      if (isAggregator && restDiscount > 0.0001) {
        journalLinesInput.push({
          mappingKey: DefaultAccountMappingKey.SALES_DISCOUNTS,
          branchId: batch.branchId ?? undefined,
          debit: restDiscount.toFixed(4),
          credit: '0.0000',
          description: `خصومات يتحملها المطعم عبر ${provider.nameAr} (${batch.batchNumber})`,
        });
      }

      // 5. Debit/Credit AGGREGATOR_SUSPENSE for withheld / approved suspense differences
      if (suspenseDebit > 0.0001) {
        journalLinesInput.push({
          mappingKey: DefaultAccountMappingKey.AGGREGATOR_SUSPENSE,
          branchId: batch.branchId ?? undefined,
          debit: suspenseDebit.toFixed(4),
          credit: '0.0000',
          description: `مبالغ محتجزة / معلقة قيد التسوية - ${provider.nameAr} (${batch.batchNumber})`,
        });
      }
      if (suspenseCredit > 0.0001) {
        journalLinesInput.push({
          mappingKey: DefaultAccountMappingKey.AGGREGATOR_SUSPENSE,
          branchId: batch.branchId ?? undefined,
          debit: '0.0000',
          credit: suspenseCredit.toFixed(4),
          description: `تسوية زيادة/فرق معلق - ${provider.nameAr} (${batch.batchNumber})`,
        });
      }

      // 6. Credit Provider Clearing / Aggregator Receivable Account
      if (clearingCreditTotal > 0.0001) {
        journalLinesInput.push({
          mappingKey: provider.clearingMappingKey,
          branchId: batch.branchId ?? undefined,
          debit: '0.0000',
          credit: clearingCreditTotal.toFixed(4),
          description: `إقفال وسيط / ذمم ${provider.nameAr} للدفعة ${batch.batchNumber}`,
        });
      }

      if (journalLinesInput.length < 2) {
        throw new BadRequestException('لا توجد مبالغ مالية صالحة لإنشاء قيد التسوية');
      }

      const jvNumber = `JV-STL-${provider.code}-${Date.now().toString().slice(-6)}`;
      const journal = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: batch.legalEntityId,
          branchId: batch.branchId ?? undefined,
          journalNumber: jvNumber,
          journalType: JournalType.BANK,
          sourceType: 'settlement_batch',
          sourceId: batch.id,
          description: `قيد تسوية ${provider.nameAr} - دفعة #${batch.batchNumber}`,
          notes: dto.notes,
          lines: journalLinesInput,
        },
        tx
      );

      // Update Bank Account balance atomically
      const newBankBal = this.round4(parseFloat(bank.balance) + bankReceived).toFixed(4);
      await tx
        .update(bankAccounts)
        .set({ balance: newBankBal })
        .where(eq(bankAccounts.id, bank.id));

      // Record explicit Bank Settlement Transaction
      await tx.insert(bankSettlementTransactions).values({
        tenantId: context.tenantId,
        legalEntityId: batch.legalEntityId,
        branchId: batch.branchId ?? null,
        batchId: batch.id,
        bankAccountId: bank.id,
        bankReference: dto.bankReference,
        receivedAmount: bankReceived.toFixed(4),
        receivedDate: new Date(),
        journalEntryId: journal.id,
        createdBy: context.userId,
      });

      // Update matched payments' settlementStatus & settledAmount
      for (const line of lines) {
        if (
          line.matchedPaymentId &&
          parseFloat(line.settledAmount) > 0 &&
          line.matchStatus !== SettlementLineMatchStatus.DUPLICATE &&
          line.matchStatus !== SettlementLineMatchStatus.CANCELLED_OR_REFUNDED
        ) {
          const [p] = await tx
            .select({ id: payments.id, amount: payments.amount, settledAmount: payments.settledAmount })
            .from(payments)
            .where(eq(payments.id, line.matchedPaymentId))
            .limit(1);
          if (p) {
            const totalPay = parseFloat(p.amount);
            const newSettled = Math.min(
              totalPay,
              this.round4(parseFloat(p.settledAmount || '0') + parseFloat(line.settledAmount))
            );
            const newPayStatus =
              newSettled >= totalPay - 0.01
                ? PaymentSettlementStatus.SETTLED
                : PaymentSettlementStatus.PARTIALLY_SETTLED;
            await tx
              .update(payments)
              .set({
                settledAmount: newSettled.toFixed(4),
                settlementStatus: newPayStatus,
              })
              .where(eq(payments.id, p.id));
          }
        }
      }

      const [postedBatch] = await tx
        .update(settlementBatches)
        .set({
          bankAccountId: bank.id,
          bankReceivedAmount: bankReceived.toFixed(4),
          bankReference: dto.bankReference,
          hasValidTaxInvoice: dto.hasValidTaxInvoice,
          taxInvoiceNumber: dto.taxInvoiceNumber ?? null,
          isVatRecoverable: dto.isVatRecoverable,
          varianceAmount: this.round4(bankReceived - parseFloat(batch.netExpectedAmount)).toFixed(4),
          status: SettlementBatchStatus.POSTED,
          journalEntryId: journal.id,
          idempotencyKey: dto.idempotencyKey ?? batch.idempotencyKey,
          approvedBy: context.userId,
          approvedAt: new Date(),
          postedBy: context.userId,
          postedAt: new Date(),
          notes: dto.notes ?? batch.notes,
          updatedAt: new Date(),
        })
        .where(eq(settlementBatches.id, batch.id))
        .returning();
      if (!postedBatch) throw new BadRequestException('فشل ترحيل دفعة التسوية');

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SETTLEMENT_BATCH_POSTED',
          entityType: 'settlement_batches',
          entityId: batch.id,
          afterState: {
            batchNumber: postedBatch.batchNumber,
            journalEntryId: journal.id,
            bankAccountId: bank.id,
            bankReceivedAmount: bankReceived.toFixed(4),
            vatInputDebit: vatInputDebit.toFixed(4),
          },
        },
        tx
      );

      return { ...postedBatch, idempotent: false };
    });
  }

  // ====================================================================
  // 5. Server-Side Paginated Queries & Reconciliation Dashboard
  // ====================================================================

  async listBatches(
    context: TenantContext,
    query: {
      legalEntityId?: string;
      branchId?: string;
      providerId?: string;
      settlementType?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
      page?: number;
      limit?: number;
    }
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const offset = (page - 1) * limit;

    return this.dbService.withTenantContext(context, async (tx) => {
      const conditions: any[] = [eq(settlementBatches.tenantId, context.tenantId)];
      if (query.legalEntityId) {
        this.checkScope(context, query.legalEntityId, query.branchId);
        conditions.push(eq(settlementBatches.legalEntityId, query.legalEntityId));
      }
      if (query.branchId) {
        conditions.push(eq(settlementBatches.branchId, query.branchId));
      } else {
        const branchScopeId = this.getBranchScopeFilter(context);
        if (branchScopeId) {
          conditions.push(eq(settlementBatches.branchId, branchScopeId));
        }
      }
      if (query.providerId) conditions.push(eq(settlementBatches.providerId, query.providerId));
      if (query.settlementType) conditions.push(eq(settlementBatches.settlementType, query.settlementType));
      if (query.status) conditions.push(eq(settlementBatches.status, query.status));
      if (query.dateFrom) conditions.push(gte(settlementBatches.settlementDate, new Date(query.dateFrom)));
      if (query.dateTo) conditions.push(lte(settlementBatches.settlementDate, new Date(query.dateTo)));
      if (query.search) {
        conditions.push(
          or(
            ilike(settlementBatches.batchNumber, `%${query.search}%`),
            ilike(settlementBatches.bankReference, `%${query.search}%`)
          )
        );
      }

      const [totalRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(settlementBatches)
        .where(and(...conditions));
      const total = totalRow?.total ?? 0;

      const items = await tx
        .select({
          batch: settlementBatches,
          providerCode: settlementProviders.code,
          providerNameAr: settlementProviders.nameAr,
          providerNameEn: settlementProviders.nameEn,
          bankName: bankAccounts.bankName,
          branchName: branches.name,
        })
        .from(settlementBatches)
        .innerJoin(settlementProviders, eq(settlementBatches.providerId, settlementProviders.id))
        .leftJoin(bankAccounts, eq(settlementBatches.bankAccountId, bankAccounts.id))
        .leftJoin(branches, eq(settlementBatches.branchId, branches.id))
        .where(and(...conditions))
        .orderBy(desc(settlementBatches.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        items: items.map((r) => ({
          ...r.batch,
          providerCode: r.providerCode,
          providerNameAr: r.providerNameAr,
          providerNameEn: r.providerNameEn,
          bankName: r.bankName,
          branchName: r.branchName,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  async getBatchDetails(
    context: TenantContext,
    batchId: string,
    lineQuery?: { page?: number; limit?: number; matchStatus?: string }
  ) {
    const page = Math.max(1, Number(lineQuery?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(lineQuery?.limit || 50)));
    const offset = (page - 1) * limit;

    return this.dbService.withTenantContext(context, async (tx) => {
      const [batch] = await tx
        .select()
        .from(settlementBatches)
        .where(
          and(
            eq(settlementBatches.tenantId, context.tenantId),
            eq(settlementBatches.id, batchId)
          )
        )
        .limit(1);
      if (!batch) {
        throw new NotFoundException('دفعة التسوية غير موجودة');
      }
      this.checkScope(context, batch.legalEntityId, batch.branchId ?? undefined);

      const [provider] = await tx
        .select()
        .from(settlementProviders)
        .where(eq(settlementProviders.id, batch.providerId))
        .limit(1);

      const lineConditions: any[] = [
        eq(settlementBatchLines.tenantId, context.tenantId),
        eq(settlementBatchLines.batchId, batch.id),
      ];
      if (lineQuery?.matchStatus) {
        lineConditions.push(eq(settlementBatchLines.matchStatus, lineQuery.matchStatus));
      }

      const [totalLinesRow] = await tx
        .select({ totalLines: sql<number>`count(*)::int` })
        .from(settlementBatchLines)
        .where(and(...lineConditions));
      const totalLines = totalLinesRow?.totalLines ?? 0;

      const lines = await tx
        .select()
        .from(settlementBatchLines)
        .where(and(...lineConditions))
        .orderBy(settlementBatchLines.lineNumber)
        .limit(limit)
        .offset(offset);

      const discrepancies = await tx
        .select()
        .from(settlementDiscrepancies)
        .where(
          and(
            eq(settlementDiscrepancies.tenantId, context.tenantId),
            eq(settlementDiscrepancies.batchId, batch.id)
          )
        )
        .orderBy(desc(settlementDiscrepancies.createdAt));

      let journalEntry = null;
      if (batch.journalEntryId) {
        const [je] = await tx
          .select()
          .from(journalEntries)
          .where(eq(journalEntries.id, batch.journalEntryId))
          .limit(1);
        const jLines = await tx
          .select({
            id: journalLines.id,
            accountId: journalLines.accountId,
            accountCode: chartOfAccounts.accountCode,
            accountName: chartOfAccounts.nameAr,
            debit: journalLines.debit,
            credit: journalLines.credit,
            description: journalLines.description,
          })
          .from(journalLines)
          .innerJoin(chartOfAccounts, eq(journalLines.accountId, chartOfAccounts.id))
          .where(eq(journalLines.journalEntryId, batch.journalEntryId));
        journalEntry = je ? { ...je, lines: jLines } : null;
      }

      return {
        batch,
        provider,
        lines,
        linesPagination: { page, limit, total: totalLines, totalPages: Math.ceil(totalLines / limit) },
        discrepancies,
        journalEntry,
      };
    });
  }

  async listDiscrepancies(
    context: TenantContext,
    query: { legalEntityId?: string; batchId?: string; status?: string; page?: number; limit?: number }
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 25)));
    const offset = (page - 1) * limit;

    return this.dbService.withTenantContext(context, async (tx) => {
      const conditions: any[] = [eq(settlementDiscrepancies.tenantId, context.tenantId)];
      if (query.legalEntityId) {
        this.checkScope(context, query.legalEntityId);
        conditions.push(eq(settlementDiscrepancies.legalEntityId, query.legalEntityId));
      }
      if (query.batchId) conditions.push(eq(settlementDiscrepancies.batchId, query.batchId));
      if (query.status) conditions.push(eq(settlementDiscrepancies.status, query.status));
      const branchScopeId = this.getBranchScopeFilter(context);
      if (branchScopeId) {
        conditions.push(eq(settlementDiscrepancies.branchId, branchScopeId));
      }

      const [totalRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(settlementDiscrepancies)
        .where(and(...conditions));
      const total = totalRow?.total ?? 0;

      const items = await tx
        .select({
          discrepancy: settlementDiscrepancies,
          batchNumber: settlementBatches.batchNumber,
        })
        .from(settlementDiscrepancies)
        .innerJoin(settlementBatches, eq(settlementDiscrepancies.batchId, settlementBatches.id))
        .where(and(...conditions))
        .orderBy(desc(settlementDiscrepancies.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        items: items.map((r) => ({ ...r.discrepancy, batchNumber: r.batchNumber })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async getReconciliationSummary(context: TenantContext, legalEntityId: string) {
    this.checkScope(context, legalEntityId);

    return this.dbService.withTenantContext(context, async (tx) => {
      const [unsettledAgg] = await tx
        .select({
          totalUnsettledCount: sql<number>`count(*)::int`,
          totalUnsettledAmount: sql<string>`COALESCE(SUM(${payments.amount} - ${payments.settledAmount}), 0)::numeric(14,4)`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, context.tenantId),
            eq(payments.legalEntityId, legalEntityId),
            eq(payments.status, PaymentStatus.CAPTURED),
            sql`${payments.paymentMethod} != 'CASH'`,
            sql`${payments.settlementStatus} != ${PaymentSettlementStatus.SETTLED}`
          )
        );

      const [batchAgg] = await tx
        .select({
          pendingBatches: sql<number>`count(*) FILTER (WHERE ${settlementBatches.status} IN ('RECONCILING', 'DISCREPANCY_PENDING'))::int`,
          postedBatches: sql<number>`count(*) FILTER (WHERE ${settlementBatches.status} = 'POSTED')::int`,
          totalPostedNetBank: sql<string>`COALESCE(SUM(${settlementBatches.bankReceivedAmount}) FILTER (WHERE ${settlementBatches.status} = 'POSTED'), 0)::numeric(14,4)`,
          totalFees: sql<string>`COALESCE(SUM(${settlementBatches.feeAmount}) FILTER (WHERE ${settlementBatches.status} = 'POSTED'), 0)::numeric(14,4)`,
          totalWithheld: sql<string>`COALESCE(SUM(${settlementBatches.withheldAmount}) FILTER (WHERE ${settlementBatches.status} = 'POSTED'), 0)::numeric(14,4)`,
        })
        .from(settlementBatches)
        .where(
          and(
            eq(settlementBatches.tenantId, context.tenantId),
            eq(settlementBatches.legalEntityId, legalEntityId)
          )
        );

      const [openDiscAgg] = await tx
        .select({
          openDiscrepancies: sql<number>`count(*)::int`,
          openDiscrepancyAmount: sql<string>`COALESCE(SUM(${settlementDiscrepancies.amount}), 0)::numeric(14,4)`,
        })
        .from(settlementDiscrepancies)
        .where(
          and(
            eq(settlementDiscrepancies.tenantId, context.tenantId),
            eq(settlementDiscrepancies.legalEntityId, legalEntityId),
            inArray(settlementDiscrepancies.status, [
              SettlementDiscrepancyStatus.OPEN,
              SettlementDiscrepancyStatus.UNDER_REVIEW,
            ])
          )
        );

      return {
        unsettledCount: unsettledAgg?.totalUnsettledCount ?? 0,
        unsettledAmount: unsettledAgg?.totalUnsettledAmount ?? '0.0000',
        pendingBatches: batchAgg?.pendingBatches ?? 0,
        postedBatches: batchAgg?.postedBatches ?? 0,
        totalPostedNetBank: batchAgg?.totalPostedNetBank ?? '0.0000',
        totalFees: batchAgg?.totalFees ?? '0.0000',
        totalWithheld: batchAgg?.totalWithheld ?? '0.0000',
        openDiscrepancies: openDiscAgg?.openDiscrepancies ?? 0,
        openDiscrepancyAmount: openDiscAgg?.openDiscrepancyAmount ?? '0.0000',
      };
    });
  }
}
