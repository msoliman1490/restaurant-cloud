import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { ProductionService } from '../production/production.service';
import { AccountingService } from '../accounting/accounting.service';
import { PostingEngineService, PostingLineInput } from '../accounting/posting-engine.service';
import { OperationsFrameworkService } from '../../common/operations/operations-framework.service';
import {
  salesOrders,
  orderLines,
  payments,
  posShifts,
  shiftCashTransactions,
  diningTables,
  orderLineModifiers,
  orderVoids,
  chartOfAccounts,
  cashVaults,
  vaultTransactions,
  devices,
  warehouses,
  businessPartners,
  partnerBalances,
  journalEntries,
  journalLines,
  branches,
  legalEntities,
  users,
} from '@restaurant-cloud/database';
import {
  OpenShiftRequest,
  ClosePosShiftRequest,
  ShiftCashTransactionRequest,
  CreateSalesOrderRequest,
  TransferTableOrderRequest,
} from '@restaurant-cloud/shared-contracts';
import {
  TenantContext,
  OrderStatus,
  OrderType,
  ShiftStatus,
  ShiftCashTransactionType,
  PaymentStatus,
  PaymentMethod,
  TableStatus,
  JournalType,
  DefaultAccountMappingKey,
} from '@restaurant-cloud/domain-kernel';
import { eq, and, or, ilike, inArray, sql, desc, asc, gte, lte } from 'drizzle-orm';

function resolvePagination(
  opts?: { page?: number; limit?: number; offset?: number },
  defaultLimit = 100,
  maxLimit = 200
): { limit: number; offset: number } {
  const rawLimit = opts?.limit;
  const limit =
    rawLimit !== undefined && Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), maxLimit)
      : defaultLimit;
  const offset =
    opts?.offset !== undefined && Number.isFinite(opts.offset)
      ? Math.max(Math.floor(opts.offset), 0)
      : opts?.page !== undefined && Number.isFinite(opts.page)
        ? (Math.max(Math.floor(opts.page), 1) - 1) * limit
        : 0;
  return { limit, offset };
}

@Injectable()
export class SalesService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly productionService: ProductionService,
    private readonly accountingService: AccountingService,
    private readonly postingEngine: PostingEngineService,
    private readonly opsFramework: OperationsFrameworkService
  ) {}

  getTenderMappingKey(paymentMethod: string): DefaultAccountMappingKey {
    const norm = (paymentMethod || '').toUpperCase().trim();
    switch (norm) {
      case 'CASH':
        return DefaultAccountMappingKey.CASH_VAULT;
      case 'MADA':
        return DefaultAccountMappingKey.MADA_CLEARING;
      case 'VISA':
      case 'MASTERCARD':
      case 'VISA_MC':
      case 'CARD':
      case 'CREDIT_CARD':
        return DefaultAccountMappingKey.VISA_CLEARING;
      case 'APPLE_PAY':
      case 'APPLEPAY':
        return DefaultAccountMappingKey.APPLE_PAY_CLEARING;
      case 'STC_PAY':
      case 'STCPAY':
        return DefaultAccountMappingKey.STC_PAY_CLEARING;
      case 'AGGREGATOR':
      case 'HUNGERSTATION':
      case 'JAHEZ':
      case 'TOYOU':
      case 'THE_CHEFZ':
      case 'NINJA':
        return DefaultAccountMappingKey.AGGREGATOR_RECEIVABLE;
      case 'BANK':
      case 'BANK_TRANSFER':
        return DefaultAccountMappingKey.BANK;
      case 'CREDIT_ACCOUNT':
      case 'ON_ACCOUNT':
      default:
        return DefaultAccountMappingKey.ACCOUNTS_RECEIVABLE;
    }
  }

  // ==================================================================
  // 1. POS Shift Management & Cash Reconciliation
  // ==================================================================

  async openShift(context: TenantContext, dto: OpenShiftRequest) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId,
      });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // Validate POS Device scoping & ownership
      const [device] = await tx
        .select({
          id: devices.id,
          legalEntityId: devices.legalEntityId,
          branchId: devices.branchId,
          cashVaultId: devices.cashVaultId,
          status: devices.status,
        })
        .from(devices)
        .where(and(eq(devices.tenantId, context.tenantId), eq(devices.id, dto.deviceId)))
        .limit(1);

      if (!device) {
        throw new NotFoundException(`جهاز نقاط البيع '${dto.deviceId}' غير موجود`);
      }
      if (device.legalEntityId !== dto.legalEntityId || device.branchId !== dto.branchId) {
        throw new BadRequestException('جهاز نقاط البيع لا ينتمي إلى المنشأة القانونية أو الفرع المحدد');
      }

      // Validate linked cash vault if configured
      if (device.cashVaultId) {
        const [vault] = await tx
          .select({
            id: cashVaults.id,
            legalEntityId: cashVaults.legalEntityId,
            branchId: cashVaults.branchId,
            status: cashVaults.status,
          })
          .from(cashVaults)
          .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, device.cashVaultId)))
          .limit(1);

        if (!vault) {
          throw new NotFoundException('الخزينة المرتبطة بجهاز نقاط البيع غير موجودة');
        }
        if (vault.legalEntityId !== dto.legalEntityId || (vault.branchId && vault.branchId !== dto.branchId)) {
          throw new BadRequestException('الخزينة المرتبطة بالجهاز لا تنتمي إلى نفس المنشأة القانونية أو الفرع');
        }
        if (vault.status !== 'ACTIVE') {
          throw new BadRequestException('الخزينة المرتبطة بالجهاز غير نشطة');
        }
      }

      // Check if device already has an OPEN shift
      const [activeShift] = await tx
        .select()
        .from(posShifts)
        .where(
          and(
            eq(posShifts.tenantId, context.tenantId),
            eq(posShifts.deviceId, dto.deviceId),
            eq(posShifts.status, ShiftStatus.OPEN)
          )
        )
        .limit(1);

      if (activeShift) {
        throw new ConflictException(
          `هذا الجهاز لديه وردية مفتوحة بالفعل (#${activeShift.id})`
        );
      }

      const [shift] = await tx
        .insert(posShifts)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          deviceId: dto.deviceId,
          cashVaultId: device.cashVaultId || null,
          cashierId: context.userId,
          openingCash: dto.openingCash,
          status: ShiftStatus.OPEN,
        })
        .returning();

      if (!shift) throw new Error('Failed to open POS shift');

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'POS_SHIFT_OPENED',
          entityType: 'pos_shift',
          entityId: shift.id,
          afterState: shift,
        },
        tx
      );

      return shift;
    });
  }

  async getActiveShift(context: TenantContext, deviceId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [shift] = await tx
        .select()
        .from(posShifts)
        .where(
          and(
            eq(posShifts.tenantId, context.tenantId),
            eq(posShifts.deviceId, deviceId),
            eq(posShifts.status, ShiftStatus.OPEN)
          )
        )
        .limit(1);

      if (!shift) return null;

      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: shift.legalEntityId,
          branchId: shift.branchId,
        });
      }

      return shift;
    });
  }

  /**
   * Computes exact expected cash breakdown for a shift according to:
   * Opening Cash
   * + Gross Cash Receipts
   * - Cash Refunds
   * - Cash Change Given
   * - Approved Cash Out / Expenses
   * + Approved Cash In / Inward Transfers
   * = Expected Cash
   *
   * Strictly excludes Mada, Visa/MC, Apple Pay, STC Pay, Credit Accounts, and Cancelled Orders.
   * Zero double counting: computes only from `payments` and `shift_cash_transactions`.
   */
  private async computeShiftCashBreakdownTx(
    tx: any,
    tenantId: string,
    shift: typeof posShifts.$inferSelect
  ) {
    const openingCash = parseFloat(shift.openingCash || '0');

    // 1. Approved Cash In / Out transfers & expenses linked to shift
    const cashTxs = await tx
      .select()
      .from(shiftCashTransactions)
      .where(
        and(
          eq(shiftCashTransactions.tenantId, tenantId),
          eq(shiftCashTransactions.shiftId, shift.id)
        )
      );

    let totalCashIn = 0;
    let totalCashOut = 0;
    for (const t of cashTxs) {
      const val = parseFloat(t.amount);
      if (t.transactionType === ShiftCashTransactionType.CASH_IN) {
        totalCashIn += val;
      } else {
        totalCashOut += val;
      }
    }

    // 2. Sales Orders linked to this shift (exclude DRAFT and CANCELLED orders)
    const ordersInShift = await tx
      .select({
        id: salesOrders.id,
        grandTotal: salesOrders.grandTotal,
        status: salesOrders.status,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.tenantId, tenantId),
          eq(salesOrders.shiftId, shift.id),
          sql`${salesOrders.status} NOT IN (${OrderStatus.DRAFT}, ${OrderStatus.CANCELLED})`
        )
      );

    let totalCashReceipts = 0;
    let totalCashRefunds = 0;
    let totalCashChange = 0;
    let totalNonCashSales = 0;

    if (ordersInShift.length > 0) {
      const orderIds = ordersInShift.map((o: any) => o.id);
      const allPayments = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, tenantId),
            inArray(payments.orderId, orderIds)
          )
        );

      const paymentsByOrder = new Map<string, any[]>();
      for (const p of allPayments) {
        const list = paymentsByOrder.get(p.orderId) || [];
        list.push(p);
        paymentsByOrder.set(p.orderId, list);
      }

      for (const ord of ordersInShift) {
        const ordPayments = paymentsByOrder.get(ord.id) || [];
        let orderPositiveCash = 0;
        let orderNonCashPaid = 0;
        let orderCashRefunds = 0;

        for (const p of ordPayments) {
          const amt = parseFloat(p.amount);
          const method = (p.paymentMethod || '').toUpperCase().trim();

          if (p.status === PaymentStatus.CAPTURED) {
            if (method === PaymentMethod.CASH) {
              if (amt > 0) orderPositiveCash += amt;
            } else {
              // Strictly exclude MADA, CARD, VISA_MC, APPLE_PAY, STC_PAY, CREDIT, etc. from cash drawer
              if (amt > 0) orderNonCashPaid += amt;
            }
          } else if (p.status === PaymentStatus.REFUNDED) {
            if (method === PaymentMethod.CASH) {
              orderCashRefunds += Math.abs(amt);
            }
          }
        }

        const orderGrandTotal = parseFloat(ord.grandTotal || '0');
        const orderTotalPaid = orderPositiveCash + orderNonCashPaid;
        const excessPaid = Math.max(0, orderTotalPaid - orderGrandTotal);
        // Cash change given to customer cannot exceed physical cash tendered
        const orderCashChange = Math.min(orderPositiveCash, excessPaid);

        totalCashReceipts += orderPositiveCash;
        totalCashChange += orderCashChange;
        totalCashRefunds += orderCashRefunds;
        totalNonCashSales += orderNonCashPaid;
      }
    }

    const expectedCash = Number(
      (
        openingCash +
        totalCashReceipts -
        totalCashRefunds -
        totalCashChange -
        totalCashOut +
        totalCashIn
      ).toFixed(4)
    );

    return {
      openingCash: Number(openingCash.toFixed(4)),
      totalCashReceipts: Number(totalCashReceipts.toFixed(4)),
      totalCashRefunds: Number(totalCashRefunds.toFixed(4)),
      totalCashChange: Number(totalCashChange.toFixed(4)),
      totalCashIn: Number(totalCashIn.toFixed(4)),
      totalCashOut: Number(totalCashOut.toFixed(4)),
      totalNonCashSales: Number(totalNonCashSales.toFixed(4)),
      netCashFromSales: Number((totalCashReceipts - totalCashChange - totalCashRefunds).toFixed(4)),
      expectedCash,
    };
  }

  async getShiftSummary(context: TenantContext, shiftId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [row] = await tx
        .select({
          shift: posShifts,
          branchName: branches.name,
          deviceCode: devices.deviceCode,
          deviceName: devices.name,
          deviceVaultId: devices.cashVaultId,
          cashierName: users.displayName,
          cashierEmail: users.email,
        })
        .from(posShifts)
        .leftJoin(branches, eq(posShifts.branchId, branches.id))
        .leftJoin(devices, eq(posShifts.deviceId, devices.id))
        .leftJoin(users, eq(posShifts.cashierId, users.id))
        .where(and(eq(posShifts.tenantId, context.tenantId), eq(posShifts.id, shiftId)))
        .limit(1);

      if (!row) {
        throw new NotFoundException(`الوردية '${shiftId}' غير موجودة`);
      }

      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: row.shift.legalEntityId,
          branchId: row.shift.branchId,
        });
      }

      const effectiveVaultId = row.shift.cashVaultId || row.deviceVaultId;
      let vaultInfo = null;
      if (effectiveVaultId) {
        const [v] = await tx
          .select({
            id: cashVaults.id,
            code: cashVaults.code,
            nameAr: cashVaults.nameAr,
            balance: cashVaults.balance,
          })
          .from(cashVaults)
          .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, effectiveVaultId)))
          .limit(1);
        vaultInfo = v || null;
      }

      let journalInfo = null;
      if (row.shift.closeJournalEntryId) {
        const [jv] = await tx
          .select({
            id: journalEntries.id,
            journalNumber: journalEntries.journalNumber,
            status: journalEntries.status,
            debitTotal: journalEntries.debitTotal,
            creditTotal: journalEntries.creditTotal,
          })
          .from(journalEntries)
          .where(and(eq(journalEntries.tenantId, context.tenantId), eq(journalEntries.id, row.shift.closeJournalEntryId)))
          .limit(1);
        journalInfo = jv || null;
      }

      const breakdown = await this.computeShiftCashBreakdownTx(tx, context.tenantId, row.shift);

      return {
        ...row.shift,
        branchName: row.branchName,
        deviceCode: row.deviceCode,
        deviceName: row.deviceName,
        cashierName: row.cashierName || row.cashierEmail,
        vault: vaultInfo,
        journalEntry: journalInfo,
        breakdown,
      };
    });
  }

  async listShifts(
    context: TenantContext,
    filters: {
      legalEntityId?: string;
      branchId?: string;
      deviceId?: string;
      cashierId?: string;
      cashVaultId?: string;
      status?: string;
      fromDate?: string;
      toDate?: string;
      search?: string;
      page?: number;
      limit?: number;
      offset?: number;
    }
  ) {
    if (context.userScopes && filters.legalEntityId && filters.branchId) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: filters.legalEntityId,
        branchId: filters.branchId,
      });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions: any[] = [eq(posShifts.tenantId, context.tenantId)];

      if (filters.legalEntityId) conditions.push(eq(posShifts.legalEntityId, filters.legalEntityId));
      if (filters.branchId) conditions.push(eq(posShifts.branchId, filters.branchId));
      if (filters.deviceId) conditions.push(eq(posShifts.deviceId, filters.deviceId));
      if (filters.cashierId) conditions.push(eq(posShifts.cashierId, filters.cashierId));
      if (filters.cashVaultId) {
        conditions.push(sql`COALESCE(${posShifts.cashVaultId}, ${devices.cashVaultId}) = ${filters.cashVaultId}`);
      }
      if (filters.status && filters.status !== 'ALL') conditions.push(eq(posShifts.status, filters.status));
      if (filters.fromDate) conditions.push(gte(posShifts.openedAt, new Date(filters.fromDate)));
      if (filters.toDate) {
        const end = new Date(filters.toDate);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(posShifts.openedAt, end));
      }

      // Enforce branch-level isolation if userScopes are branch-restricted
      if (context.userScopes && context.userScopes.length > 0) {
        const hasGlobalOrTenant = context.userScopes.some(
          (s) => s.scopeType === 'TENANT' || s.scopeType === 'GROUP'
        );
        if (!hasGlobalOrTenant) {
          const allowedBranchIds = context.userScopes
            .filter((s) => s.scopeType === 'BRANCH' && s.scopeId)
            .map((s) => s.scopeId as string);
          const allowedEntityIds = context.userScopes
            .filter((s) => s.scopeType === 'LEGAL_ENTITY' && s.scopeId)
            .map((s) => s.scopeId as string);

          if (allowedBranchIds.length > 0 && allowedEntityIds.length === 0) {
            conditions.push(inArray(posShifts.branchId, allowedBranchIds));
          } else if (allowedEntityIds.length > 0 && allowedBranchIds.length === 0) {
            conditions.push(inArray(posShifts.legalEntityId, allowedEntityIds));
          } else if (allowedBranchIds.length > 0 || allowedEntityIds.length > 0) {
            const scopeOr: any[] = [];
            if (allowedBranchIds.length > 0) scopeOr.push(inArray(posShifts.branchId, allowedBranchIds));
            if (allowedEntityIds.length > 0) scopeOr.push(inArray(posShifts.legalEntityId, allowedEntityIds));
            conditions.push(or(...scopeOr));
          }
        }
      }

      if (filters.search && filters.search.trim().length > 0) {
        const pattern = `%${filters.search.trim()}%`;
        conditions.push(
          or(
            ilike(sql`${posShifts.id}::text`, pattern),
            ilike(branches.name, pattern),
            ilike(devices.deviceCode, pattern),
            ilike(devices.name, pattern),
            ilike(users.displayName, pattern),
            ilike(users.email, pattern),
            ilike(cashVaults.nameAr, pattern),
            ilike(journalEntries.journalNumber, pattern)
          )
        );
      }

      const { limit, offset } = resolvePagination(filters, 200, 200);

      const rows = await tx
        .select({
          id: posShifts.id,
          tenantId: posShifts.tenantId,
          legalEntityId: posShifts.legalEntityId,
          branchId: posShifts.branchId,
          branchName: branches.name,
          deviceId: posShifts.deviceId,
          deviceCode: devices.deviceCode,
          deviceName: devices.name,
          cashVaultId: sql<string | null>`COALESCE(${posShifts.cashVaultId}, ${devices.cashVaultId})`,
          vaultName: cashVaults.nameAr,
          vaultCode: cashVaults.code,
          cashierId: posShifts.cashierId,
          cashierName: users.displayName,
          cashierEmail: users.email,
          closedBy: posShifts.closedBy,
          openedAt: posShifts.openedAt,
          closedAt: posShifts.closedAt,
          openingCash: posShifts.openingCash,
          totalCashReceipts: posShifts.totalCashReceipts,
          totalCashRefunds: posShifts.totalCashRefunds,
          totalCashChange: posShifts.totalCashChange,
          totalCashIn: posShifts.totalCashIn,
          totalCashOut: posShifts.totalCashOut,
          expectedCash: posShifts.expectedCash,
          countedCash: posShifts.countedCash,
          variance: posShifts.variance,
          status: posShifts.status,
          closeJournalEntryId: posShifts.closeJournalEntryId,
          journalNumber: journalEntries.journalNumber,
          notes: posShifts.notes,
        })
        .from(posShifts)
        .leftJoin(branches, eq(posShifts.branchId, branches.id))
        .leftJoin(devices, eq(posShifts.deviceId, devices.id))
        .leftJoin(cashVaults, sql`COALESCE(${posShifts.cashVaultId}, ${devices.cashVaultId}) = ${cashVaults.id}`)
        .leftJoin(users, eq(posShifts.cashierId, users.id))
        .leftJoin(journalEntries, eq(posShifts.closeJournalEntryId, journalEntries.id))
        .where(and(...conditions))
        .orderBy(desc(posShifts.openedAt))
        .limit(limit)
        .offset(offset);

      return rows;
    });
  }

  async recordShiftCashTransaction(
    context: TenantContext,
    dto: ShiftCashTransactionRequest
  ) {
    const amt = parseFloat(dto.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [shift] = await tx
        .select()
        .from(posShifts)
        .where(
          and(eq(posShifts.tenantId, context.tenantId), eq(posShifts.id, dto.shiftId))
        )
        .limit(1);

      if (!shift || shift.status !== ShiftStatus.OPEN) {
        throw new BadRequestException('لا يمكن تسجيل حركات نقدية إلا على وردية مفتوحة ونشطة');
      }

      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: shift.legalEntityId,
          branchId: shift.branchId,
        });
      }

      const [txRecord] = await tx
        .insert(shiftCashTransactions)
        .values({
          tenantId: context.tenantId,
          shiftId: dto.shiftId,
          transactionType: dto.transactionType,
          amount: amt.toFixed(4),
          reason: dto.reason,
          performedBy: context.userId,
        })
        .returning();

      if (!txRecord) throw new Error('Failed to record cash transaction');

      // Synchronize with linked cash vault & GL via PostingEngine if vault is linked
      const [device] = await tx
        .select({ cashVaultId: devices.cashVaultId })
        .from(devices)
        .where(and(eq(devices.tenantId, context.tenantId), eq(devices.id, shift.deviceId)))
        .limit(1);

      const effectiveVaultId = shift.cashVaultId || device?.cashVaultId;
      if (effectiveVaultId) {
        const [vault] = await tx
          .select()
          .from(cashVaults)
          .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, effectiveVaultId)))
          .limit(1);

        if (!vault || vault.status !== 'ACTIVE') {
          throw new BadRequestException('الخزينة المرتبطة بالوردية غير موجودة أو غير نشطة');
        }
        if (vault.legalEntityId !== shift.legalEntityId || (vault.branchId && vault.branchId !== shift.branchId)) {
          throw new BadRequestException('الخزينة المرتبطة لا تطابق نطاق المنشأة القانونية أو الفرع');
        }

        const curBal = parseFloat(vault.balance);
        const delta = dto.transactionType === ShiftCashTransactionType.CASH_IN ? amt : -amt;
        const newBal = (curBal + delta).toFixed(4);

        await tx
          .update(cashVaults)
          .set({ balance: newBal })
          .where(eq(cashVaults.id, vault.id));

        await tx.insert(vaultTransactions).values({
          tenantId: context.tenantId,
          vaultId: vault.id,
          transactionType: dto.transactionType === ShiftCashTransactionType.CASH_IN ? 'TRANSFER_IN' : 'TRANSFER_OUT',
          amount: amt.toFixed(4),
          balanceAfter: newBal,
          sourceDocumentType: 'shift_cash_transactions',
          sourceDocumentId: txRecord.id,
          notes: `${dto.transactionType === ShiftCashTransactionType.CASH_IN ? 'تغذية/تحويل وارد للوردية' : 'مصروف/تحويل صادر من الوردية'}: ${dto.reason}`,
          performedBy: context.userId,
        });

        // Post GL journal entry through PostingEngineService
        const contraLine: PostingLineInput = dto.contraAccountId
          ? {
              accountId: dto.contraAccountId,
              branchId: shift.branchId,
              debit: dto.transactionType === ShiftCashTransactionType.CASH_OUT ? amt.toFixed(4) : '0.0000',
              credit: dto.transactionType === ShiftCashTransactionType.CASH_IN ? amt.toFixed(4) : '0.0000',
              description: dto.reason,
            }
          : {
              mappingKey:
                dto.mappingKey ||
                (dto.transactionType === ShiftCashTransactionType.CASH_IN
                  ? DefaultAccountMappingKey.CASH_IN_TRANSIT
                  : DefaultAccountMappingKey.GENERAL_EXPENSE),
              branchId: shift.branchId,
              debit: dto.transactionType === ShiftCashTransactionType.CASH_OUT ? amt.toFixed(4) : '0.0000',
              credit: dto.transactionType === ShiftCashTransactionType.CASH_IN ? amt.toFixed(4) : '0.0000',
              description: dto.reason,
            };

        const vaultLine: PostingLineInput = {
          accountId: vault.accountId,
          branchId: shift.branchId,
          debit: dto.transactionType === ShiftCashTransactionType.CASH_IN ? amt.toFixed(4) : '0.0000',
          credit: dto.transactionType === ShiftCashTransactionType.CASH_OUT ? amt.toFixed(4) : '0.0000',
          description: `حركة خزينة وردية (${dto.transactionType}) - ${dto.reason}`,
        };

        await this.postingEngine.postEntry(
          context,
          {
            legalEntityId: shift.legalEntityId,
            branchId: shift.branchId,
            journalNumber: `JV-SHFT-TX-${txRecord.id.slice(0, 8).toUpperCase()}-${Date.now().toString().slice(-4)}`,
            journalType: JournalType.CASH,
            sourceType: 'shift_cash_transactions',
            sourceId: txRecord.id,
            description: `حركة نقدية للوردية (${dto.transactionType}): ${dto.reason}`,
            lines: [vaultLine, contraLine],
          },
          tx
        );
      }

      return txRecord;
    });
  }

  async closeShift(context: TenantContext, dto: ClosePosShiftRequest) {
    const countedCash = parseFloat(dto.countedCash);
    if (!Number.isFinite(countedCash) || countedCash < 0) {
      throw new BadRequestException('قيمة النقد الفعلي المعدود غير صالحة');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [shift] = await tx
        .select()
        .from(posShifts)
        .where(
          and(eq(posShifts.tenantId, context.tenantId), eq(posShifts.id, dto.shiftId))
        )
        .limit(1);

      if (!shift) {
        throw new NotFoundException(`الوردية '${dto.shiftId}' غير موجودة`);
      }

      // 1. Scope & Permission Check (Strict Branch/Entity Isolation)
      if (context.userScopes) {
        this.opsFramework.verifyScope(context, context.userScopes, {
          legalEntityId: shift.legalEntityId,
          branchId: shift.branchId,
        });
      }

      // 2. Idempotent Retry Protection
      if (
        dto.idempotencyKey &&
        shift.idempotencyKey === dto.idempotencyKey &&
        shift.status === ShiftStatus.CLOSED
      ) {
        let existingJv = null;
        if (shift.closeJournalEntryId) {
          const [jv] = await tx
            .select()
            .from(journalEntries)
            .where(eq(journalEntries.id, shift.closeJournalEntryId))
            .limit(1);
          existingJv = jv || null;
        }
        return {
          ...shift,
          journalEntry: existingJv,
          isIdempotentReplay: true,
        };
      }

      // 3. Duplicate Close Prevention
      if (shift.status !== ShiftStatus.OPEN) {
        throw new BadRequestException('الوردية مقفلة مسبقاً ولا يمكن إقفالها مرتين أو تعديلها');
      }

      // 4. Validate Device & Cash Vault Isolation
      const [device] = await tx
        .select({
          id: devices.id,
          legalEntityId: devices.legalEntityId,
          branchId: devices.branchId,
          cashVaultId: devices.cashVaultId,
        })
        .from(devices)
        .where(and(eq(devices.tenantId, context.tenantId), eq(devices.id, shift.deviceId)))
        .limit(1);

      if (!device) {
        throw new NotFoundException(`جهاز نقاط البيع المرتبط بالوردية '${shift.deviceId}' غير موجود`);
      }
      if (device.legalEntityId !== shift.legalEntityId || device.branchId !== shift.branchId) {
        throw new BadRequestException('جهاز نقاط البيع لا يتطابق مع المنشأة القانونية أو فرع الوردية');
      }

      const effectiveVaultId = shift.cashVaultId || device.cashVaultId;
      let linkedVault: typeof cashVaults.$inferSelect | null = null;

      if (effectiveVaultId) {
        const [vault] = await tx
          .select()
          .from(cashVaults)
          .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, effectiveVaultId)))
          .limit(1);

        if (!vault) {
          throw new NotFoundException('الخزينة المرتبطة بجهاز نقاط البيع غير موجودة');
        }
        if (vault.legalEntityId !== shift.legalEntityId) {
          throw new BadRequestException('الخزينة المحددة تتبع منشأة قانونية أخرى ولا يمكن الإقفال عليها');
        }
        if (vault.branchId && vault.branchId !== shift.branchId) {
          throw new BadRequestException('الخزينة المحددة تتبع فرعاً آخر ولا يمكن الإقفال عليها');
        }
        if (vault.status !== 'ACTIVE') {
          throw new BadRequestException('الخزينة المرتبطة بالوردية غير نشطة ولا يمكن الترحيل إليها');
        }
        linkedVault = vault;
      }

      // 5. Ensure no duplicate closing journal exists for this shift
      const [existingClosingJv] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, context.tenantId),
            eq(journalEntries.legalEntityId, shift.legalEntityId),
            eq(journalEntries.sourceType, 'pos_shift_close'),
            eq(journalEntries.sourceId, shift.id)
          )
        )
        .limit(1);

      if (existingClosingJv) {
        throw new ConflictException('يوجد قيد إقفال مسجل مسبقاً لهذه الوردية');
      }

      // 6. Compute Exact Expected Cash & Variance
      const breakdown = await this.computeShiftCashBreakdownTx(tx, context.tenantId, shift);
      const rawVariance = countedCash - breakdown.expectedCash;
      const variance = Math.abs(rawVariance) < 0.0001 ? 0 : Number(rawVariance.toFixed(4));

      // 7. Variance Accounting via PostingEngine & Vault Adjustment (Only if variance !== 0)
      let journalEntry = null;

      if (variance !== 0) {
        const absVarianceStr = Math.abs(variance).toFixed(4);
        const lines: PostingLineInput[] = [];

        if (variance < 0) {
          // Cash Deficit (عجز نقدي): Debit CASH_OVER_SHORT, Credit Cash Vault
          lines.push({
            mappingKey: DefaultAccountMappingKey.CASH_OVER_SHORT,
            branchId: shift.branchId,
            debit: absVarianceStr,
            credit: '0.0000',
            description: `عجز نقدي عند إقفال وردية نقاط البيع #${shift.id.slice(0, 8)}`,
          });
          lines.push({
            accountId: linkedVault ? linkedVault.accountId : undefined,
            mappingKey: linkedVault ? undefined : DefaultAccountMappingKey.CASH_VAULT,
            branchId: shift.branchId,
            debit: '0.0000',
            credit: absVarianceStr,
            description: `تسوية عجز نقدية الخزينة عند إقفال الوردية #${shift.id.slice(0, 8)}`,
          });
        } else {
          // Cash Surplus (فائض نقدي): Debit Cash Vault, Credit CASH_OVERAGE
          lines.push({
            accountId: linkedVault ? linkedVault.accountId : undefined,
            mappingKey: linkedVault ? undefined : DefaultAccountMappingKey.CASH_VAULT,
            branchId: shift.branchId,
            debit: absVarianceStr,
            credit: '0.0000',
            description: `تسوية فائض نقدية بالخزينة عند إقفال الوردية #${shift.id.slice(0, 8)}`,
          });
          lines.push({
            mappingKey: DefaultAccountMappingKey.CASH_OVERAGE,
            branchId: shift.branchId,
            debit: '0.0000',
            credit: absVarianceStr,
            description: `فائض نقدي عند إقفال وردية نقاط البيع #${shift.id.slice(0, 8)}`,
          });
        }

        const jvNumber = `JV-SHIFT-CLOSE-${shift.id.slice(0, 8).toUpperCase()}-${Date.now().toString().slice(-4)}`;
        journalEntry = await this.postingEngine.postEntry(
          context,
          {
            legalEntityId: shift.legalEntityId,
            branchId: shift.branchId,
            journalNumber: jvNumber,
            journalType: JournalType.CLOSING,
            sourceType: 'pos_shift_close',
            sourceId: shift.id,
            description: `قيد تسوية فرق إقفال وردية الكاشير #${shift.id.slice(0, 8)} (${variance < 0 ? 'عجز نقدي' : 'فائض نقدي'}: ${variance.toFixed(2)})`,
            notes: dto.notes,
            lines,
          },
          tx
        );

        // Update linked Cash Vault balance & record transaction atomically
        if (linkedVault) {
          const curVaultBal = parseFloat(linkedVault.balance);
          const newVaultBal = (curVaultBal + variance).toFixed(4);

          await tx
            .update(cashVaults)
            .set({ balance: newVaultBal })
            .where(eq(cashVaults.id, linkedVault.id));

          await tx.insert(vaultTransactions).values({
            tenantId: context.tenantId,
            vaultId: linkedVault.id,
            transactionType: 'COUNT_VARIANCE',
            amount: absVarianceStr,
            balanceAfter: newVaultBal,
            sourceDocumentType: 'pos_shifts',
            sourceDocumentId: shift.id,
            notes: `تسوية فرق جرد إقفال وردية POS (${variance < 0 ? 'عجز' : 'زيادة'}: ${variance.toFixed(4)}) - قيد ${jvNumber}`,
            performedBy: context.userId,
          });
        }
      }

      // 8. Finalize Shift Closure Metadata
      const [closedShift] = await tx
        .update(posShifts)
        .set({
          closedAt: new Date(),
          closedBy: context.userId,
          cashVaultId: linkedVault?.id || null,
          totalCashReceipts: breakdown.totalCashReceipts.toFixed(4),
          totalCashRefunds: breakdown.totalCashRefunds.toFixed(4),
          totalCashChange: breakdown.totalCashChange.toFixed(4),
          totalCashIn: breakdown.totalCashIn.toFixed(4),
          totalCashOut: breakdown.totalCashOut.toFixed(4),
          expectedCash: breakdown.expectedCash.toFixed(4),
          countedCash: countedCash.toFixed(4),
          variance: variance.toFixed(4),
          status: ShiftStatus.CLOSED,
          closeJournalEntryId: journalEntry?.id || null,
          idempotencyKey: dto.idempotencyKey || null,
          notes: dto.notes || null,
        })
        .where(eq(posShifts.id, shift.id))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'POS_SHIFT_CLOSED',
          entityType: 'pos_shift',
          entityId: shift.id,
          afterState: {
            shift: closedShift,
            breakdown,
            journalEntryId: journalEntry?.id || null,
          },
        },
        tx
      );

      return {
        ...closedShift,
        breakdown,
        journalEntry,
      };
    });
  }

  // ==================================================================
  // 2. Sales Order Lifecycle (BOM Consumption, Multi-Tender, RLS & Ledger)
  // ==================================================================

  async createSalesOrder(context: TenantContext, dto: CreateSalesOrderRequest) {
    if (context.userScopes) {
      this.opsFramework.verifyScope(context, context.userScopes, {
        legalEntityId: dto.legalEntityId,
        branchId: dto.branchId,
      });
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      // 1. Idempotency Check: prevent duplicate orders
      if (dto.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(salesOrders)
          .where(
            and(
              eq(salesOrders.tenantId, context.tenantId),
              eq(salesOrders.idempotencyKey, dto.idempotencyKey)
            )
          )
          .limit(1);

        if (existing) {
          if (existing.orderNumber !== dto.orderNumber) {
            throw new ConflictException(
              `Idempotency key '${dto.idempotencyKey}' already used for order '${existing.orderNumber}'`
            );
          }
          // Idempotent duplicate request: return existing order
          return existing;
        }
      }

      // Check unique order number in legal entity
      const [existingNumber] = await tx
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.tenantId, context.tenantId),
            eq(salesOrders.legalEntityId, dto.legalEntityId),
            eq(salesOrders.orderNumber, dto.orderNumber)
          )
        )
        .limit(1);

      if (existingNumber) {
        throw new ConflictException(
          `Sales order number '${dto.orderNumber}' already exists`
        );
      }

      // Validate device scoping & entity ownership
      const [device] = await tx
        .select({
          id: devices.id,
          cashVaultId: devices.cashVaultId,
          legalEntityId: devices.legalEntityId,
          branchId: devices.branchId,
        })
        .from(devices)
        .where(and(eq(devices.tenantId, context.tenantId), eq(devices.id, dto.deviceId)))
        .limit(1);

      if (!device) {
        throw new NotFoundException(`جهاز نقاط البيع '${dto.deviceId}' غير موجود`);
      }
      if (device.legalEntityId !== dto.legalEntityId || device.branchId !== dto.branchId) {
        throw new BadRequestException('جهاز نقاط البيع لا ينتمي إلى نفس المنشأة القانونية أو الفرع المحدد في الطلب');
      }

      // Validate warehouse scoping & entity ownership
      if (dto.warehouseId) {
        const [wh] = await tx
          .select({ id: warehouses.id, legalEntityId: warehouses.legalEntityId })
          .from(warehouses)
          .where(and(eq(warehouses.tenantId, context.tenantId), eq(warehouses.id, dto.warehouseId)))
          .limit(1);

        if (!wh) {
          throw new NotFoundException(`المستودع المحدد '${dto.warehouseId}' غير موجود`);
        }
        if (wh.legalEntityId && wh.legalEntityId !== dto.legalEntityId) {
          throw new BadRequestException('المستودع المحدد لا ينتمي إلى نفس المنشأة القانونية للطلب');
        }
      }

      // Validate customer partner (if provided)
      if (dto.customerId) {
        const [customer] = await tx
          .select({ id: businessPartners.id })
          .from(businessPartners)
          .where(
            and(
              eq(businessPartners.tenantId, context.tenantId),
              eq(businessPartners.id, dto.customerId)
            )
          )
          .limit(1);

        if (!customer) {
          throw new NotFoundException(`العميل المحدد '${dto.customerId}' غير موجود`);
        }
      }

      // 2. Compute Lines, Tax and Grand Total
      let subtotal = 0;
      let totalTax = 0;
      let totalDiscount = 0;

      const preparedLines = dto.lines.map((l) => {
        const qty = parseFloat(l.quantity);
        const unitPrice = parseFloat(l.unitPrice);
        const discount = parseFloat(l.discountAmount || '0.0000');
        const lineNet = Math.max(0, qty * unitPrice - discount);
        const lineTax = lineNet * 0.15; // 15% Saudi Standard VAT
        const lineTotal = lineNet + lineTax;

        subtotal += lineNet;
        totalTax += lineTax;
        totalDiscount += discount;

        return {
          itemId: l.itemId,
          uomId: l.uomId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountAmount: discount.toFixed(4),
          taxAmount: lineTax.toFixed(4),
          lineTotal: lineTotal.toFixed(4),
          modifiers: l.modifiers || [],
        };
      });

      const grandTotal = subtotal + totalTax;

      const paidTotal = dto.payments?.reduce((acc, p) => acc + parseFloat(p.amount), 0) || 0;
      const initialStatus =
        paidTotal >= grandTotal - 0.0001
          ? OrderStatus.PAID
          : OrderStatus.CONFIRMED;

      // 3. Insert Header
      const [order] = await tx
        .insert(salesOrders)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          deviceId: dto.deviceId,
          shiftId: dto.shiftId || null,
          tableId: dto.tableId || null,
          orderNumber: dto.orderNumber,
          orderType: dto.orderType,
          channel: dto.channel,
          status: initialStatus,
          currency: 'SAR',
          subtotal: subtotal.toFixed(4),
          discountTotal: totalDiscount.toFixed(4),
          taxTotal: totalTax.toFixed(4),
          grandTotal: grandTotal.toFixed(4),
          idempotencyKey: dto.idempotencyKey || null,
          notes: dto.notes || null,
        })
        .returning();

      if (!order) throw new Error('Failed to create sales order');

      // 4. Insert Order Lines and Modifiers + Recipe BOM Stock Consumption
      let totalConsumedCost = 0;

      for (const pl of preparedLines) {
        const [line] = await tx
          .insert(orderLines)
          .values({
            orderId: order.id,
            itemId: pl.itemId,
            uomId: pl.uomId,
            quantity: pl.quantity,
            unitPrice: pl.unitPrice,
            discountAmount: pl.discountAmount,
            taxAmount: pl.taxAmount,
            lineTotal: pl.lineTotal,
          })
          .returning();

        if (!line) throw new Error('Failed to create order line');

        if (pl.modifiers && pl.modifiers.length > 0) {
          await tx.insert(orderLineModifiers).values(
            pl.modifiers.map((m) => ({
              orderLineId: line.id,
              modifierNameAr: m.modifierNameAr,
              modifierNameEn: m.modifierNameEn || '',
              priceDelta: m.priceDelta,
              quantity: m.quantity,
            }))
          );
        }

        // Automatic Recipe / Stock Deduction
        if (dto.warehouseId) {
          const consumption = await this.productionService.consumeForSaleTx(tx, {
            tenantId: context.tenantId,
            legalEntityId: dto.legalEntityId,
            warehouseId: dto.warehouseId,
            itemId: pl.itemId,
            quantitySold: parseFloat(pl.quantity),
            orderId: order.id,
          });

          totalConsumedCost += consumption.totalCost;
        }
      }

      // 5. Look up Device linked Cash Vault (if configured)
      let deviceVaultAccountId: string | undefined;
      let linkedCashVaultId: string | undefined;

      if (device?.cashVaultId) {
        const [vault] = await tx
          .select({
            id: cashVaults.id,
            accountId: cashVaults.accountId,
            balance: cashVaults.balance,
            status: cashVaults.status,
          })
          .from(cashVaults)
          .where(and(eq(cashVaults.tenantId, context.tenantId), eq(cashVaults.id, device.cashVaultId)))
          .limit(1);

        if (vault && vault.status === 'ACTIVE') {
          deviceVaultAccountId = vault.accountId;
          linkedCashVaultId = vault.id;
        }
      }

      // 6. Record Payments & Tender Debits (with Cash Change & Excess Handling)
      const journalLines: Array<PostingLineInput> = [];
      let totalCashAmount = 0;

      // Validate electronic payments cannot exceed grandTotal
      let nonCashTotal = 0;
      if (dto.payments && dto.payments.length > 0) {
        for (const pmt of dto.payments) {
          if (pmt.paymentMethod.toUpperCase() !== 'CASH') {
            nonCashTotal += parseFloat(pmt.amount);
          }
        }
      }
      if (nonCashTotal > grandTotal + 0.0001) {
        throw new BadRequestException('مبلغ المدفوعات الإلكترونية لا يمكن أن يتجاوز إجمالي الفاتورة');
      }

      const cashChange = Math.max(0, paidTotal - grandTotal);

      if (dto.payments && dto.payments.length > 0) {
        for (const pmt of dto.payments) {
          const pmtAmt = parseFloat(pmt.amount);
          if (pmtAmt <= 0) continue;

          await tx.insert(payments).values({
            tenantId: context.tenantId,
            legalEntityId: dto.legalEntityId,
            orderId: order.id,
            paymentMethod: pmt.paymentMethod,
            amount: pmt.amount,
            currency: 'SAR',
            providerCode: pmt.providerCode || null,
            providerTransactionRef: pmt.providerTransactionRef || null,
            status: PaymentStatus.CAPTURED,
            idempotencyKey: pmt.idempotencyKey || null,
          });

          const normMethod = pmt.paymentMethod.toUpperCase();
          if (normMethod === 'CASH') {
            totalCashAmount += pmtAmt;
          } else {
            const tenderKey = this.getTenderMappingKey(normMethod);
            journalLines.push({
              mappingKey: tenderKey,
              branchId: dto.branchId,
              debit: pmtAmt.toFixed(4),
              credit: '0.0000',
              description: `تحصيل إلكتروني (${normMethod}) - فاتورة #${order.orderNumber}`,
            });
          }
        }
      }

      // Add net cash collected into journalLines (deducting customer change)
      const netCashCollected = Math.max(0, totalCashAmount - cashChange);
      if (netCashCollected > 0.0001) {
        journalLines.push({
          accountId: deviceVaultAccountId,
          mappingKey: deviceVaultAccountId ? undefined : DefaultAccountMappingKey.CASH_VAULT,
          branchId: dto.branchId,
          debit: netCashCollected.toFixed(4),
          credit: '0.0000',
          description: `تحصيل نقدي - فاتورة #${order.orderNumber}${cashChange > 0 ? ` (المقبوض ${totalCashAmount.toFixed(2)} - المتبقي للعميل ${cashChange.toFixed(2)})` : ''}`,
        });
      }

      // 7. Update Cash Vault balance & transaction with net cash collected
      if (netCashCollected > 0 && linkedCashVaultId) {
        const [v] = await tx
          .select({ balance: cashVaults.balance })
          .from(cashVaults)
          .where(eq(cashVaults.id, linkedCashVaultId))
          .for('update')
          .limit(1);

        if (v) {
          const curBal = parseFloat(v.balance);
          const newBal = (curBal + netCashCollected).toFixed(4);
          await tx
            .update(cashVaults)
            .set({ balance: newBal })
            .where(eq(cashVaults.id, linkedCashVaultId));

          await tx.insert(vaultTransactions).values({
            tenantId: context.tenantId,
            vaultId: linkedCashVaultId,
            transactionType: 'DEPOSIT',
            amount: netCashCollected.toFixed(4),
            balanceAfter: newBal,
            sourceDocumentType: 'sales_orders',
            sourceDocumentId: order.id,
            notes: `مقبوضات مبيعات الفاتورة #${order.orderNumber}`,
            performedBy: context.userId,
          });
        }
      }

      // 8. If payments < grandTotal: record remaining receivable (ذمم عملاء / مبيعات آجلة)
      const remainingUnpaid = grandTotal - Math.min(paidTotal, grandTotal);
      if (remainingUnpaid > 0.0001) {
        journalLines.push({
          mappingKey: DefaultAccountMappingKey.ACCOUNTS_RECEIVABLE,
          branchId: dto.branchId,
          partnerId: dto.customerId || null,
          partnerRole: dto.customerId ? 'CUSTOMER' : null,
          subledgerDocumentType: 'sales_orders',
          subledgerDocumentId: order.id,
          debit: remainingUnpaid.toFixed(4),
          credit: '0.0000',
          description: `مستحق مبيعات آجلة / ذمم عملاء - فاتورة #${order.orderNumber}`,
        });

        // Update customer balance if customerId provided
        if (dto.customerId) {
          const [curBal] = await tx
            .select()
            .from(partnerBalances)
            .where(
              and(
                eq(partnerBalances.tenantId, context.tenantId),
                eq(partnerBalances.legalEntityId, dto.legalEntityId),
                eq(partnerBalances.partnerId, dto.customerId)
              )
            )
            .for('update')
            .limit(1);

          if (curBal) {
            const newCustBal = (parseFloat(curBal.customerBalance) + remainingUnpaid).toFixed(4);
            await tx
              .update(partnerBalances)
              .set({
                customerBalance: newCustBal,
                lastTransactionAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(partnerBalances.id, curBal.id));
          } else {
            await tx.insert(partnerBalances).values({
              tenantId: context.tenantId,
              legalEntityId: dto.legalEntityId,
              partnerId: dto.customerId,
              currency: 'SAR',
              customerBalance: remainingUnpaid.toFixed(4),
            });
          }
        }
      }

      // 9. Revenue Credit Line
      journalLines.push({
        mappingKey: DefaultAccountMappingKey.SALES,
        branchId: dto.branchId,
        debit: '0.0000',
        credit: subtotal.toFixed(4),
        description: `إيراد مبيعات الفاتورة #${order.orderNumber}`,
      });

      // 10. VAT Credit Line (if tax > 0)
      if (totalTax > 0.0001) {
        journalLines.push({
          mappingKey: DefaultAccountMappingKey.VAT_OUTPUT,
          branchId: dto.branchId,
          debit: '0.0000',
          credit: totalTax.toFixed(4),
          description: `ضريبة القيمة المضافة المستحقة (15%) - فاتورة #${order.orderNumber}`,
        });
      }

      // 11. COGS & Inventory Stock Lines (if totalConsumedCost > 0)
      if (totalConsumedCost > 0.0001) {
        journalLines.push(
          {
            mappingKey: DefaultAccountMappingKey.COGS,
            branchId: dto.branchId,
            debit: totalConsumedCost.toFixed(4),
            credit: '0.0000',
            description: `تكلفة البضاعة المباعة - فاتورة #${order.orderNumber}`,
          },
          {
            mappingKey: DefaultAccountMappingKey.INVENTORY,
            branchId: dto.branchId,
            debit: '0.0000',
            credit: totalConsumedCost.toFixed(4),
            description: `منصرف مخزون مواد وأغذية للمبيعات - فاتورة #${order.orderNumber}`,
          }
        );
      }

      // 12. Post Immutable GL Journal Entry via PostingEngine INSIDE tx (ATOMIC)
      const jvNumber = `JV-SALE-${order.orderNumber}`;
      const journalEntry = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          journalNumber: jvNumber,
          journalType: JournalType.SALES,
          sourceType: 'sales_orders',
          sourceId: order.id,
          description: `قيد مبيعات نقاط البيع - الفاتورة #${order.orderNumber}`,
          lines: journalLines,
        },
        tx
      );

      // 13. Update Table Status if Dine-in
      if (dto.tableId) {
        await tx
          .update(diningTables)
          .set({
            status: TableStatus.OCCUPIED,
            currentOrderId: order.id,
          })
          .where(
            and(
              eq(diningTables.tenantId, context.tenantId),
              eq(diningTables.id, dto.tableId)
            )
          );
      }

      // 14. Audit Log
      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SALES_ORDER_CREATED',
          entityType: 'sales_orders',
          entityId: order.id,
          afterState: { order, totalConsumedCost, journalEntryId: journalEntry.id },
        },
        tx
      );

      return {
        ...order,
        totalConsumedCost: totalConsumedCost.toFixed(4),
        journalEntry,
      };
    });
  }

  // ==================================================================
  // 3. Table Transfer & Voids
  // ==================================================================

  async transferTableOrder(context: TenantContext, dto: TransferTableOrderRequest) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Free source table
      await tx
        .update(diningTables)
        .set({ status: TableStatus.AVAILABLE, currentOrderId: null })
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.id, dto.fromTableId)
          )
        );

      // Occupy destination table
      await tx
        .update(diningTables)
        .set({ status: TableStatus.OCCUPIED, currentOrderId: dto.orderId })
        .where(
          and(
            eq(diningTables.tenantId, context.tenantId),
            eq(diningTables.id, dto.toTableId)
          )
        );

      // Update order table reference
      await tx
        .update(salesOrders)
        .set({ tableId: dto.toTableId })
        .where(
          and(
            eq(salesOrders.tenantId, context.tenantId),
            eq(salesOrders.id, dto.orderId)
          )
        );

      return { success: true, orderId: dto.orderId, newTableId: dto.toTableId };
    });
  }

  async voidSalesOrder(
    context: TenantContext,
    orderId: string,
    reason: string,
    approvedBy: string,
    restockInventory = true
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [order] = await tx
        .select()
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.tenantId, context.tenantId),
            eq(salesOrders.id, orderId)
          )
        )
        .for('update')
        .limit(1);

      if (!order) throw new NotFoundException(`Order '${orderId}' not found`);

      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('الطلب ملغى مسبقاً');
      }

      // Update order status to CANCELLED
      await tx
        .update(salesOrders)
        .set({ status: OrderStatus.CANCELLED })
        .where(eq(salesOrders.id, order.id));

      // Free dining table if linked
      if (order.tableId) {
        await tx
          .update(diningTables)
          .set({ status: TableStatus.AVAILABLE, currentOrderId: null })
          .where(
            and(
              eq(diningTables.tenantId, context.tenantId),
              eq(diningTables.id, order.tableId)
            )
          );
      }

      // Record manager void
      const [voidRecord] = await tx
        .insert(orderVoids)
        .values({
          tenantId: context.tenantId,
          legalEntityId: order.legalEntityId,
          orderId: order.id,
          reason,
          voidAmount: order.grandTotal,
          voidedBy: context.userId,
          approvedBy,
        })
        .returning();

      // Check if original sales journal entry was posted for this order
      const [origJV] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, context.tenantId),
            eq(journalEntries.legalEntityId, order.legalEntityId),
            eq(journalEntries.sourceType, 'sales_orders'),
            eq(journalEntries.sourceId, order.id)
          )
        )
        .limit(1);

      let voidJournal = null;
      if (origJV) {
        // Query original journal lines
        const origLines = await tx
          .select()
          .from(journalLines)
          .where(eq(journalLines.journalEntryId, origJV.id));

        let candidateLines = origLines;
        if (restockInventory) {
          // Restore consumed inventory if stock movements exist
          await this.productionService.restoreForReturnTx(tx, {
            tenantId: context.tenantId,
            legalEntityId: order.legalEntityId,
            orderId: order.id,
            ratio: 1.0,
            reason: `إلغاء الطلب: ${reason}`,
          });
        } else {
          // Order was prepared/consumed: do NOT restock inventory and do NOT reverse COGS without physical movement
          candidateLines = origLines.filter(
            (l) =>
              !l.description?.includes('تكلفة البضاعة المباعة') &&
              !l.description?.includes('منصرف مخزون')
          );
        }

        const reversingLines = candidateLines.map((l) => ({
          accountId: l.accountId,
          branchId: l.branchId,
          costCenterId: l.costCenterId,
          debit: l.credit, // Invert credit to debit
          credit: l.debit, // Invert debit to credit
          currency: l.currency,
          description: `إلغاء وعكس قيد مبيعات الطلب #${order.orderNumber} (${reason})`,
        }));

        const jvVoidNumber = `JV-VOID-${order.orderNumber}`;
        voidJournal = await this.postingEngine.postEntry(
          context,
          {
            legalEntityId: order.legalEntityId,
            branchId: order.branchId,
            journalNumber: jvVoidNumber,
            journalType: JournalType.SALES,
            sourceType: 'sales_void',
            sourceId: order.id,
            description: `إلغاء وعكس قيد مبيعات الفاتورة #${order.orderNumber} - ${reason}`,
            lines: reversingLines,
          },
          tx
        );
      }

      // Deduct net cash previously deposited into vault for this voided order
      const [origVaultDeposit] = await tx
        .select()
        .from(vaultTransactions)
        .where(
          and(
            eq(vaultTransactions.tenantId, context.tenantId),
            eq(vaultTransactions.sourceDocumentType, 'sales_orders'),
            eq(vaultTransactions.sourceDocumentId, order.id),
            eq(vaultTransactions.transactionType, 'DEPOSIT')
          )
        )
        .limit(1);

      if (origVaultDeposit) {
        const depositAmt = parseFloat(origVaultDeposit.amount);
        const [vault] = await tx
          .select({ id: cashVaults.id, balance: cashVaults.balance })
          .from(cashVaults)
          .where(eq(cashVaults.id, origVaultDeposit.vaultId))
          .for('update')
          .limit(1);

        if (vault && depositAmt > 0) {
          const newBal = (parseFloat(vault.balance) - depositAmt).toFixed(4);
          await tx
            .update(cashVaults)
            .set({ balance: newBal })
            .where(eq(cashVaults.id, vault.id));

          await tx.insert(vaultTransactions).values({
            tenantId: context.tenantId,
            vaultId: vault.id,
            transactionType: 'WITHDRAWAL',
            amount: depositAmt.toFixed(4),
            balanceAfter: newBal,
            sourceDocumentType: 'sales_void',
            sourceDocumentId: order.id,
            notes: `عكس مقبوضات فاتورة ملغاة #${order.orderNumber} (${reason})`,
            performedBy: context.userId,
          });
        }
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SALES_ORDER_VOIDED',
          entityType: 'sales_orders',
          entityId: order.id,
          afterState: { voidRecord, voidJournalId: voidJournal?.id },
        },
        tx
      );

      return {
        ...voidRecord,
        voidJournal,
      };
    });
  }

  async refundSalesOrder(
    context: TenantContext,
    orderId: string,
    dto: {
      refundAmount?: string;
      reason: string;
      approvedBy?: string;
      paymentMethod?: string;
      refundMethod?: string;
      restockInventory?: boolean;
      idempotencyKey?: string;
      refundLines?: Array<{
        orderLineId?: string;
        itemId?: string;
        quantity: number | string;
        unitPrice?: number | string;
      }>;
    }
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      if (dto.idempotencyKey) {
        const [existingRefundPmt] = await tx
          .select({ id: payments.id, orderId: payments.orderId })
          .from(payments)
          .where(
            and(
              eq(payments.tenantId, context.tenantId),
              eq(payments.idempotencyKey, dto.idempotencyKey),
              eq(payments.status, PaymentStatus.REFUNDED),
            ),
          )
          .limit(1);

        if (existingRefundPmt) {
          if (existingRefundPmt.orderId !== orderId) {
            throw new ConflictException(
              `Idempotency key '${dto.idempotencyKey}' already used for another refund`,
            );
          }
          const [existingOrder] = await tx
            .select()
            .from(salesOrders)
            .where(and(eq(salesOrders.tenantId, context.tenantId), eq(salesOrders.id, orderId)))
            .limit(1);
          const [existingRefundJv] = await tx
            .select()
            .from(journalEntries)
            .where(
              and(
                eq(journalEntries.tenantId, context.tenantId),
                eq(journalEntries.sourceType, 'sales_refund'),
                eq(journalEntries.sourceId, orderId),
              ),
            )
            .limit(1);
          return {
            ...existingOrder,
            refundJournal: existingRefundJv || null,
          };
        }
      }

      const [order] = await tx
        .select()
        .from(salesOrders)
        .where(
          and(
            eq(salesOrders.tenantId, context.tenantId),
            eq(salesOrders.id, orderId)
          )
        )
        .for('update')
        .limit(1);

      if (!order) throw new NotFoundException(`Sales order '${orderId}' not found`);

      if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
        throw new BadRequestException(`Order is already ${order.status}`);
      }

      const grandTotal = parseFloat(order.grandTotal);
      let refundAmt: number;
      if (dto.refundAmount !== undefined) {
        refundAmt = parseFloat(dto.refundAmount);
      } else if (dto.refundLines && dto.refundLines.length > 0) {
        const existingLines = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.orderId, order.id));

        let computedLinesTotal = 0;
        for (const rl of dto.refundLines) {
          const qty = typeof rl.quantity === 'string' ? parseFloat(rl.quantity) : rl.quantity;
          const matchedLine = existingLines.find(
            (ol) => (rl.orderLineId && ol.id === rl.orderLineId) || (rl.itemId && ol.itemId === rl.itemId),
          );
          if (rl.unitPrice === undefined && matchedLine && parseFloat(matchedLine.quantity) > 0) {
            const perUnitTotal = parseFloat(matchedLine.lineTotal) / parseFloat(matchedLine.quantity);
            computedLinesTotal += qty * perUnitTotal;
          } else {
            const unitPrice =
              rl.unitPrice !== undefined
                ? typeof rl.unitPrice === 'string'
                  ? parseFloat(rl.unitPrice)
                  : rl.unitPrice
                : matchedLine
                  ? parseFloat(matchedLine.unitPrice)
                  : 0;
            const matchedNet = matchedLine ? parseFloat(matchedLine.unitPrice) * parseFloat(matchedLine.quantity) : 0;
            const taxRatio = matchedLine && matchedNet > 0 ? parseFloat(matchedLine.taxAmount) / matchedNet : 0.15;
            computedLinesTotal += qty * unitPrice * (1 + taxRatio);
          }
        }
        refundAmt = computedLinesTotal;
      } else {
        refundAmt = grandTotal;
      }

      // Query existing payments for this order first so we can enforce cumulative over-refund protection
      const orderPayments = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, context.tenantId),
            eq(payments.orderId, order.id)
          )
        );

      const alreadyRefunded = orderPayments
        .filter((p) => p.status === 'REFUNDED' || parseFloat(p.amount) < 0)
        .reduce((sum, p) => sum + Math.abs(parseFloat(p.amount)), 0);

      const effectivePaymentMethod = dto.paymentMethod || dto.refundMethod;
      if (refundAmt <= 0) {
        throw new BadRequestException('Refund amount must be greater than zero');
      }
      if (alreadyRefunded + refundAmt > grandTotal + 0.0001) {
        throw new BadRequestException(
          `Cumulative refund amount (${(alreadyRefunded + refundAmt).toFixed(2)}) cannot exceed order grand total (${grandTotal.toFixed(2)})`
        );
      }

      // Calculate net available refundable amount per payment method
      const tenderBalances = new Map<string, { netPaid: number; sample?: typeof orderPayments[0] }>();
      for (const p of orderPayments) {
        const amt = parseFloat(p.amount);
        const existing = tenderBalances.get(p.paymentMethod);
        if (!existing) {
          tenderBalances.set(p.paymentMethod, { netPaid: amt, sample: p });
        } else {
          existing.netPaid += amt;
        }
      }

      // Allocate refund amount across payment tenders
      const refundAllocations: Array<{ method: string; amount: number; sample?: typeof orderPayments[0] }> = [];
      let unallocated = refundAmt;

      if (effectivePaymentMethod && tenderBalances.has(effectivePaymentMethod)) {
        const info = tenderBalances.get(effectivePaymentMethod)!;
        const avail = Math.max(0, info.netPaid);
        const take = Math.min(unallocated, avail);
        if (take > 0) {
          refundAllocations.push({
            method: effectivePaymentMethod,
            amount: take,
            sample: info.sample,
          });
          unallocated -= take;
        }
      }

      // Allocate remaining refund across available original tenders
      for (const [method, info] of tenderBalances.entries()) {
        if (unallocated <= 0.0001) break;
        if (effectivePaymentMethod && method === effectivePaymentMethod) continue;
        const avail = Math.max(0, info.netPaid);
        const take = Math.min(unallocated, avail);
        if (take > 0) {
          refundAllocations.push({
            method,
            amount: take,
            sample: info.sample,
          });
          unallocated -= take;
        }
      }

      // If no recorded payments exist or all exhausted, fallback to CASH
      if (unallocated > 0.0001) {
        refundAllocations.push({
          method: effectivePaymentMethod || PaymentMethod.CASH,
          amount: unallocated,
          sample: orderPayments[0],
        });
      }

      // Insert refund records in payments table (negative amount, REFUNDED status)
      let cashRefundAmount = 0;
      for (let i = 0; i < refundAllocations.length; i++) {
        const alloc = refundAllocations[i]!;
        await tx.insert(payments).values({
          tenantId: context.tenantId,
          legalEntityId: order.legalEntityId,
          orderId: order.id,
          paymentMethod: alloc.method,
          amount: (-alloc.amount).toFixed(4),
          currency: 'SAR',
          providerCode: alloc.sample?.providerCode || null,
          providerTransactionRef: alloc.sample?.providerTransactionRef
            ? `REF-${alloc.sample.providerTransactionRef}`
            : null,
          status: PaymentStatus.REFUNDED,
          idempotencyKey: dto.idempotencyKey
            ? i === 0
              ? dto.idempotencyKey
              : `${dto.idempotencyKey}:${i}`
            : null,
        });

        if (alloc.method.toUpperCase() === 'CASH') {
          cashRefundAmount += alloc.amount;
        }
      }

      // Deduct from linked cash vault if cash refund occurred
      let linkedCashVaultAccountId: string | null = null;
      if (cashRefundAmount > 0 && order.deviceId) {
        const [device] = await tx
          .select({ cashVaultId: devices.cashVaultId })
          .from(devices)
          .where(eq(devices.id, order.deviceId))
          .limit(1);

        if (device?.cashVaultId) {
          const [vault] = await tx
            .select({
              id: cashVaults.id,
              balance: cashVaults.balance,
              accountId: cashVaults.accountId,
            })
            .from(cashVaults)
            .where(eq(cashVaults.id, device.cashVaultId))
            .for('update')
            .limit(1);

          if (vault) {
            linkedCashVaultAccountId = vault.accountId || null;
            const curBal = parseFloat(vault.balance);
            const newBal = Math.max(0, curBal - cashRefundAmount).toFixed(4);
            await tx
              .update(cashVaults)
              .set({ balance: newBal })
              .where(eq(cashVaults.id, vault.id));

            await tx.insert(vaultTransactions).values({
              tenantId: context.tenantId,
              vaultId: vault.id,
              transactionType: 'WITHDRAWAL',
              amount: cashRefundAmount.toFixed(4),
              balanceAfter: newBal,
              sourceDocumentType: 'sales_refund',
              sourceDocumentId: order.id,
              notes: `صرف مردودات مبيعات الفاتورة #${order.orderNumber}`,
              performedBy: context.userId,
            });
          }
        }
      }

      // Restock inventory and calculate restored cost if restockInventory = true
      let totalRestoredCost = 0;
      if (dto.restockInventory) {
        const ratio = grandTotal > 0 ? refundAmt / grandTotal : 1.0;
        const restockRes = await this.productionService.restoreForReturnTx(tx, {
          tenantId: context.tenantId,
          legalEntityId: order.legalEntityId,
          orderId: order.id,
          ratio,
          reason: dto.reason,
        });
        totalRestoredCost = restockRes.totalRestoredCost;
      }

      const isFullRefund = refundAmt >= grandTotal - 0.0001;
      const newStatus = isFullRefund ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED;

      const [updatedOrder] = await tx
        .update(salesOrders)
        .set({ status: newStatus })
        .where(eq(salesOrders.id, order.id))
        .returning();

      // Post Reversing / Refund Journal Entry matching tender disbursements via PostingEngine INSIDE tx
      const netRefund = refundAmt / 1.15;
      const vatRefund = refundAmt - netRefund;
      const refundJournalLines: Array<PostingLineInput> = [];

      // 1. Debit Sales Revenue (Reversal)
      refundJournalLines.push({
        mappingKey: DefaultAccountMappingKey.SALES,
        branchId: order.branchId,
        debit: netRefund.toFixed(4),
        credit: '0.0000',
        description: `Sales Revenue Refund for Order ${order.orderNumber} - ${dto.reason}`,
      });

      // 2. Debit VAT Output (Reversal)
      if (vatRefund > 0.0001) {
        refundJournalLines.push({
          mappingKey: DefaultAccountMappingKey.VAT_OUTPUT,
          branchId: order.branchId,
          debit: vatRefund.toFixed(4),
          credit: '0.0000',
          description: `15% VAT Output Reversal for Order ${order.orderNumber}`,
        });
      }

      // 3. Credit Tender Disbursements
      for (const alloc of refundAllocations) {
        const isCashTender = alloc.method.toUpperCase() === 'CASH';
        if (isCashTender && linkedCashVaultAccountId) {
          refundJournalLines.push({
            accountId: linkedCashVaultAccountId,
            branchId: order.branchId,
            debit: '0.0000',
            credit: alloc.amount.toFixed(4),
            description: `Refund Disbursement (${alloc.method}) for Order ${order.orderNumber}`,
          });
        } else {
          const tenderKey = this.getTenderMappingKey(alloc.method);
          refundJournalLines.push({
            mappingKey: tenderKey,
            branchId: order.branchId,
            debit: '0.0000',
            credit: alloc.amount.toFixed(4),
            description: `Refund Disbursement (${alloc.method}) for Order ${order.orderNumber}`,
          });
        }
      }

      // 4. Reverse COGS & Inventory if restocked
      if (totalRestoredCost > 0.0001) {
        refundJournalLines.push(
          {
            mappingKey: DefaultAccountMappingKey.INVENTORY,
            branchId: order.branchId,
            debit: totalRestoredCost.toFixed(4),
            credit: '0.0000',
            description: `إعادة إثبات مخزون مسترد من مردودات الفاتورة #${order.orderNumber}`,
          },
          {
            mappingKey: DefaultAccountMappingKey.COGS,
            branchId: order.branchId,
            debit: '0.0000',
            credit: totalRestoredCost.toFixed(4),
            description: `عكس تكلفة بضاعة مباعة لمردودات الفاتورة #${order.orderNumber}`,
          }
        );
      }

      const jvNumber = `JV-REFUND-${order.orderNumber}-${Date.now().toString().slice(-4)}`;
      const refundJournal = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: order.legalEntityId,
          branchId: order.branchId,
          journalNumber: jvNumber,
          journalType: JournalType.SALES,
          sourceType: 'sales_refund',
          sourceId: order.id,
          description: `قيد مردودات مبيعات - الفاتورة #${order.orderNumber}`,
          lines: refundJournalLines,
        },
        tx
      );

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'SALES_ORDER_REFUNDED',
          entityType: 'sales_orders',
          entityId: order.id,
          afterState: { updatedOrder, dto, refundJournalId: refundJournal.id },
        },
        tx
      );

      return {
        ...updatedOrder,
        refundJournal,
      };
    });
  }

  async getSalesOrders(
    context: TenantContext,
    branchId?: string,
    pagination?: { page?: number; limit?: number; offset?: number }
  ) {
    const { limit, offset } = resolvePagination(pagination, 100, 200);
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(salesOrders.tenantId, context.tenantId)];
      if (branchId) {
        conditions.push(eq(salesOrders.branchId, branchId));
      }

      return await tx
        .select()
        .from(salesOrders)
        .where(and(...conditions))
        .orderBy(desc(salesOrders.createdAt))
        .limit(limit)
        .offset(offset);
    });
  }
}
