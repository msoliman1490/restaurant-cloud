import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  documentSequences,
  documentNumberAllocations,
  legalEntities,
  branches,
  fiscalPeriods,
} from '@restaurant-cloud/database';
import { FiscalPeriodStatus, TenantContext } from '@restaurant-cloud/domain-kernel';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../../modules/audit/audit.service';

export const DEFAULT_PREFIX_MAP: Record<string, string> = {
  SALES_INVOICE: 'INV',
  POS_TRANSACTION: 'POS',
  PURCHASE_INVOICE: 'SINV',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
  JOURNAL_ENTRY: 'JV',
  RECEIPT: 'RCP',
  PAYMENT: 'PAY',
  PURCHASE_ORDER: 'PO',
  PURCHASE_REQUEST: 'PR',
  GOODS_RECEIPT: 'GRN',
  DELIVERY_NOTE: 'DLV',
  STOCK_TRANSFER: 'TRN',
  STOCK_ADJUSTMENT: 'ADJ',
};

@Injectable()
export class DocumentNumberingService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService
  ) {}

  private formatNumber(
    prefix: string,
    num: number,
    padding: number,
    fiscalYearFormat: string,
    yearStr: string
  ): string {
    const padded = String(num).padStart(Math.max(1, Math.min(12, padding)), '0');
    if (fiscalYearFormat === 'YYYY' && yearStr) {
      return `${prefix}-${yearStr}-${padded}`;
    }
    if (fiscalYearFormat === 'YY' && yearStr) {
      return `${prefix}-${yearStr.slice(-2)}-${padded}`;
    }
    return `${prefix}-${padded}`;
  }

  async listSequences(
    context: TenantContext,
    filters?: { legalEntityId?: string; branchId?: string; documentType?: string }
  ) {
    return this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(documentSequences.tenantId, context.tenantId)];
      if (filters?.legalEntityId) {
        conditions.push(eq(documentSequences.legalEntityId, filters.legalEntityId));
      }
      if (filters?.branchId) {
        conditions.push(eq(documentSequences.branchId, filters.branchId));
      }
      if (filters?.documentType) {
        conditions.push(eq(documentSequences.documentType, filters.documentType.toUpperCase()));
      }
      return tx
        .select()
        .from(documentSequences)
        .where(and(...conditions))
        .orderBy(desc(documentSequences.updatedAt));
    });
  }

  async listAllocations(
    context: TenantContext,
    filters?: { legalEntityId?: string; documentType?: string; limit?: number }
  ) {
    return this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(documentNumberAllocations.tenantId, context.tenantId)];
      if (filters?.legalEntityId) {
        conditions.push(eq(documentNumberAllocations.legalEntityId, filters.legalEntityId));
      }
      if (filters?.documentType) {
        conditions.push(
          eq(documentNumberAllocations.documentType, filters.documentType.toUpperCase())
        );
      }
      return tx
        .select()
        .from(documentNumberAllocations)
        .where(and(...conditions))
        .orderBy(desc(documentNumberAllocations.allocatedAt))
        .limit(Math.min(200, filters?.limit || 50));
    });
  }

  async upsertSequenceConfig(
    context: TenantContext,
    dto: {
      legalEntityId: string;
      branchId?: string | null;
      documentType: string;
      periodKey?: string;
      prefix: string;
      startingNumber?: number;
      padding?: number;
      fiscalYearFormat?: 'YYYY' | 'YY' | 'NONE';
      annualResetPolicy?: 'ANNUAL' | 'NEVER';
      isActive?: boolean;
      reason?: string;
    }
  ) {
    const documentType = dto.documentType.trim().toUpperCase();
    const annualResetPolicy = dto.annualResetPolicy ?? 'ANNUAL';
    const fiscalYearFormat = dto.fiscalYearFormat ?? 'YYYY';
    const periodKey =
      dto.periodKey?.trim() ||
      (annualResetPolicy === 'NEVER' ? 'GLOBAL' : String(new Date().getFullYear()));
    const prefix = dto.prefix.trim().toUpperCase();
    const startingNumber = dto.startingNumber ?? 1;
    const padding = dto.padding ?? 6;
    const branchId = dto.branchId || null;

    return this.dbService.withTenantContext(context, async (tx) => {
      // Verify legal entity & optional branch belong to tenant
      const [entity] = await tx
        .select({ id: legalEntities.id })
        .from(legalEntities)
        .where(
          and(
            eq(legalEntities.id, dto.legalEntityId),
            eq(legalEntities.tenantId, context.tenantId)
          )
        )
        .limit(1);
      if (!entity) {
        throw new NotFoundException('Legal entity not found in active tenant');
      }

      if (branchId) {
        const [br] = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(
            and(
              eq(branches.id, branchId),
              eq(branches.tenantId, context.tenantId),
              eq(branches.legalEntityId, dto.legalEntityId)
            )
          )
          .limit(1);
        if (!br) {
          throw new NotFoundException('Branch not found under the specified legal entity');
        }
      }

      const [existing] = await tx
        .select()
        .from(documentSequences)
        .where(
          and(
            eq(documentSequences.tenantId, context.tenantId),
            eq(documentSequences.legalEntityId, dto.legalEntityId),
            branchId
              ? eq(documentSequences.branchId, branchId)
              : isNull(documentSequences.branchId),
            eq(documentSequences.documentType, documentType),
            eq(documentSequences.periodKey, periodKey)
          )
        )
        .for('update')
        .limit(1);

      if (existing) {
        // Lock check: once used, cannot be modified while any OPEN fiscal period exists for this entity
        if (existing.isLockedByUsage) {
          const openPeriods = await tx
            .select({ id: fiscalPeriods.id, periodName: fiscalPeriods.periodName })
            .from(fiscalPeriods)
            .where(
              and(
                eq(fiscalPeriods.tenantId, context.tenantId),
                eq(fiscalPeriods.legalEntityId, dto.legalEntityId),
                eq(fiscalPeriods.status, FiscalPeriodStatus.OPEN)
              )
            )
            .limit(1);

          if (openPeriods.length > 0) {
            throw new ConflictException(
              `Sequence '${documentType}' (${periodKey}) is locked after usage during open fiscal period '${openPeriods[0]!.periodName}'. Close the period before modifying future numbering settings.`
            );
          }

          // Even after period close, prevent collision with any historical/cancelled/failed allocated number
          if (startingNumber <= existing.currentValue && prefix === existing.prefix) {
            throw new ConflictException(
              `New starting number (${startingNumber}) must be greater than last allocated value (${existing.currentValue}) when keeping the same prefix.`
            );
          }
        }

        const [updated] = await tx
          .update(documentSequences)
          .set({
            prefix,
            startingNumber,
            padding,
            fiscalYearFormat,
            annualResetPolicy,
            isActive: dto.isActive ?? existing.isActive,
            updatedAt: new Date(),
          })
          .where(eq(documentSequences.id, existing.id))
          .returning();

        await this.auditService.log(
          {
            tenantId: context.tenantId,
            actorId: context.userId,
            action: 'DOCUMENT_SEQUENCE_UPDATED',
            entityType: 'document_sequence',
            entityId: existing.id,
            beforeState: {
              prefix: existing.prefix,
              startingNumber: existing.startingNumber,
              padding: existing.padding,
              fiscalYearFormat: existing.fiscalYearFormat,
              annualResetPolicy: existing.annualResetPolicy,
            },
            afterState: {
              prefix,
              startingNumber,
              padding,
              fiscalYearFormat,
              annualResetPolicy,
              reason: dto.reason || 'Updated sequence configuration',
            },
          },
          tx
        );

        return updated;
      }

      const [created] = await tx
        .insert(documentSequences)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId,
          documentType,
          periodKey,
          prefix,
          startingNumber,
          currentValue: 0,
          padding,
          fiscalYearFormat,
          annualResetPolicy,
          isActive: dto.isActive ?? true,
          isLockedByUsage: false,
        })
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'DOCUMENT_SEQUENCE_CREATED',
          entityType: 'document_sequence',
          entityId: created!.id,
          afterState: {
            legalEntityId: dto.legalEntityId,
            branchId,
            documentType,
            periodKey,
            prefix,
            startingNumber,
            padding,
          },
        },
        tx
      );

      return created;
    });
  }

  /**
   * Allocates the next commercial document number in an independent autonomous transaction
   * with advisory + FOR UPDATE locking so concurrent requests never collide and failed
   * outer business transactions NEVER cause number reuse.
   */
  async allocateNextNumber(
    context: TenantContext,
    params: {
      legalEntityId: string;
      branchId?: string | null;
      documentType: string;
      documentDate?: Date;
      sourceType?: string;
      sourceId?: string;
    }
  ) {
    const documentType = params.documentType.trim().toUpperCase();
    const docDate = params.documentDate ?? new Date();
    const yearStr = String(docDate.getFullYear());
    const branchId = params.branchId || null;

    return this.dbService.withTenantContext(context, async (tx) => {
      const lockScope = `${context.tenantId}:${params.legalEntityId}:${branchId || 'GLOBAL'}:${documentType}:${yearStr}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockScope}))`);

      // Prefer branch-specific sequence if configured, otherwise entity-level sequence
      let seq = branchId
        ? (
            await tx
              .select()
              .from(documentSequences)
              .where(
                and(
                  eq(documentSequences.tenantId, context.tenantId),
                  eq(documentSequences.legalEntityId, params.legalEntityId),
                  eq(documentSequences.branchId, branchId),
                  eq(documentSequences.documentType, documentType),
                  eq(documentSequences.isActive, true)
                )
              )
              .orderBy(desc(documentSequences.updatedAt))
              .for('update')
              .limit(1)
          )[0]
        : undefined;

      if (!seq) {
        const entitySeqs = await tx
          .select()
          .from(documentSequences)
          .where(
            and(
              eq(documentSequences.tenantId, context.tenantId),
              eq(documentSequences.legalEntityId, params.legalEntityId),
              isNull(documentSequences.branchId),
              eq(documentSequences.documentType, documentType),
              eq(documentSequences.isActive, true)
            )
          )
          .for('update');

        seq =
          entitySeqs.find((s) => s.periodKey === yearStr) ??
          entitySeqs.find((s) => s.periodKey === 'GLOBAL') ??
          entitySeqs[0];
      }

      if (!seq) {
        const defaultPrefix = DEFAULT_PREFIX_MAP[documentType] || documentType.slice(0, 4);
        const [inserted] = await tx
          .insert(documentSequences)
          .values({
            tenantId: context.tenantId,
            legalEntityId: params.legalEntityId,
            branchId: null,
            documentType,
            periodKey: yearStr,
            prefix: defaultPrefix,
            startingNumber: 1,
            currentValue: 0,
            padding: 6,
            fiscalYearFormat: 'YYYY',
            annualResetPolicy: 'ANNUAL',
            isActive: true,
            isLockedByUsage: false,
          })
          .onConflictDoNothing()
          .returning();

        seq =
          inserted ??
          (
            await tx
              .select()
              .from(documentSequences)
              .where(
                and(
                  eq(documentSequences.tenantId, context.tenantId),
                  eq(documentSequences.legalEntityId, params.legalEntityId),
                  isNull(documentSequences.branchId),
                  eq(documentSequences.documentType, documentType),
                  eq(documentSequences.periodKey, yearStr)
                )
              )
              .for('update')
              .limit(1)
          )[0];
      }

      if (!seq) {
        throw new BadRequestException(`Could not resolve document sequence for '${documentType}'`);
      }

      const effectivePeriodKey = seq.annualResetPolicy === 'NEVER' ? 'GLOBAL' : yearStr;
      if (seq.annualResetPolicy === 'ANNUAL' && seq.periodKey !== yearStr) {
        // Annual reset: spin up new year sequence inheriting config
        const [yearSeq] = await tx
          .select()
          .from(documentSequences)
          .where(
            and(
              eq(documentSequences.tenantId, context.tenantId),
              eq(documentSequences.legalEntityId, params.legalEntityId),
              seq.branchId
                ? eq(documentSequences.branchId, seq.branchId)
                : isNull(documentSequences.branchId),
              eq(documentSequences.documentType, documentType),
              eq(documentSequences.periodKey, yearStr)
            )
          )
          .for('update')
          .limit(1);

        if (yearSeq) {
          seq = yearSeq;
        } else {
          const [newYearSeq] = await tx
            .insert(documentSequences)
            .values({
              tenantId: context.tenantId,
              legalEntityId: params.legalEntityId,
              branchId: seq.branchId,
              documentType,
              periodKey: yearStr,
              prefix: seq.prefix,
              startingNumber: 1,
              currentValue: 0,
              padding: seq.padding,
              fiscalYearFormat: seq.fiscalYearFormat,
              annualResetPolicy: seq.annualResetPolicy,
              isActive: true,
              isLockedByUsage: false,
            })
            .returning();
          seq = newYearSeq!;
        }
      }

      const nextVal = Math.max(seq.currentValue + 1, seq.startingNumber);
      const formattedNumber = this.formatNumber(
        seq.prefix,
        nextVal,
        seq.padding,
        seq.fiscalYearFormat,
        effectivePeriodKey === 'GLOBAL' ? yearStr : effectivePeriodKey
      );

      const now = new Date();
      await tx
        .update(documentSequences)
        .set({
          currentValue: nextVal,
          isLockedByUsage: true,
          lastAllocatedAt: now,
          updatedAt: now,
        })
        .where(eq(documentSequences.id, seq.id));

      const [allocation] = await tx
        .insert(documentNumberAllocations)
        .values({
          tenantId: context.tenantId,
          sequenceId: seq.id,
          legalEntityId: params.legalEntityId,
          branchId: seq.branchId,
          documentType,
          periodKey: effectivePeriodKey,
          allocatedNumber: nextVal,
          formattedNumber,
          sourceType: params.sourceType || null,
          sourceId: params.sourceId || null,
          status: 'ALLOCATED',
          allocatedBy: context.userId,
          allocatedAt: now,
        })
        .returning();

      return {
        allocationId: allocation!.id,
        sequenceId: seq.id,
        allocatedNumber: nextVal,
        formattedNumber,
        periodKey: effectivePeriodKey,
      };
    });
  }

  async markAllocationStatus(
    context: TenantContext,
    formattedNumber: string,
    documentType: string,
    legalEntityId: string,
    status: 'USED' | 'CANCELLED' | 'FAILED_TX',
    sourceId?: string
  ) {
    return this.dbService.withTenantContext(context, async (tx) => {
      await tx
        .update(documentNumberAllocations)
        .set({ status, ...(sourceId ? { sourceId } : {}) })
        .where(
          and(
            eq(documentNumberAllocations.tenantId, context.tenantId),
            eq(documentNumberAllocations.legalEntityId, legalEntityId),
            eq(documentNumberAllocations.documentType, documentType.toUpperCase()),
            eq(documentNumberAllocations.formattedNumber, formattedNumber)
          )
        );
    });
  }
}
