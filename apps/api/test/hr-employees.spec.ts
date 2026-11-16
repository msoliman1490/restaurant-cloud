import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { MediaService } from '../src/modules/media/media.service';
import { HrService } from '../src/modules/hr/hr.service';
import { HrController } from '../src/modules/hr/hr.controller';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { TenantContext, AccountType } from '@restaurant-cloud/domain-kernel';
import {
  tenants,
  legalEntities,
  branches,
  employees,
  employeeBranchAssignments,
  employeeShiftSchedules,
  employeeAttendanceLogs,
  employeeLeaveRequests,
  employeeDocuments,
  employeeAdvances,
  employeeAdvanceTransactions,
  employeeCustodies,
  chartOfAccounts,
  cashVaults,
  fiscalYears,
  fiscalPeriods,
} from '@restaurant-cloud/database';
import { eq } from 'drizzle-orm';

describe('Restaurant Cloud — HR & Employees Module (Non-Payroll)', { timeout: 90000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let postingEngine: PostingEngineService;
  let mediaService: MediaService;
  let hrService: HrService;
  let vaultAccountId: string;
  let advanceAccountId: string;
  let cashVaultId: string;

  let tenantAId: string;
  let tenantBId: string;
  let leA1Id: string;
  let leA2Id: string;
  let leB1Id: string;
  let branchA1Id: string;
  let branchA2Id: string;
  let branchB1Id: string;
  let userAId: string;
  let userBId: string;

  let ctxA: TenantContext;
  let ctxB: TenantContext;

  beforeAll(async () => {
    const envPath = path.resolve(process.cwd(), '../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
    dbService = new DatabaseService();
    await dbService.onModuleInit();
    auditService = new AuditService(dbService);
    postingEngine = new PostingEngineService(dbService, auditService);
    mediaService = new MediaService(dbService);
    hrService = new HrService(dbService, auditService, postingEngine, mediaService);
    vaultAccountId = randomUUID();
    advanceAccountId = randomUUID();
    cashVaultId = randomUUID();

    tenantAId = randomUUID();
    tenantBId = randomUUID();
    leA1Id = randomUUID();
    leA2Id = randomUUID();
    leB1Id = randomUUID();
    branchA1Id = randomUUID();
    branchA2Id = randomUUID();
    branchB1Id = randomUUID();
    userAId = randomUUID();
    userBId = randomUUID();

    ctxA = {
      tenantId: tenantAId,
      userId: userAId,
      legalEntityId: leA1Id,
      branchId: branchA1Id,
      permissions: ['*'],
      correlationId: `hr-test-${Date.now()}`,
    };
    ctxB = {
      tenantId: tenantBId,
      userId: userBId,
      legalEntityId: leB1Id,
      branchId: branchB1Id,
      permissions: ['*'],
      correlationId: `hr-test-b-${Date.now()}`,
    };

    const db = dbService.db;
    const suffix = Date.now();
    await db.insert(tenants).values([
      { id: tenantAId, code: `hr-a-${suffix}`, displayName: 'HR Tenant A', status: 'ACTIVE' },
      { id: tenantBId, code: `hr-b-${suffix}`, displayName: 'HR Tenant B', status: 'ACTIVE' },
    ]);
    await dbService.withTenantContext(ctxA, async (tx) => {
      await tx.insert(legalEntities).values([
        {
          id: leA1Id,
          tenantId: tenantAId,
          legalName: 'Entity A1',
          vatNumber: '310111111111113',
        },
        {
          id: leA2Id,
          tenantId: tenantAId,
          legalName: 'Entity A2',
          vatNumber: '310222222222223',
        },
      ]);
      await tx.insert(branches).values([
        {
          id: branchA1Id,
          tenantId: tenantAId,
          legalEntityId: leA1Id,
          code: 'BR-A1',
          name: 'Branch A1',
        },
        {
          id: branchA2Id,
          tenantId: tenantAId,
          legalEntityId: leA1Id,
          code: 'BR-A2',
          name: 'Branch A2',
        },
      ]);

      const fyId = randomUUID();
      const now = new Date();
      await tx.insert(fiscalYears).values({
        id: fyId,
        tenantId: tenantAId,
        legalEntityId: leA1Id,
        yearCode: String(now.getUTCFullYear()),
        yearName: String(now.getUTCFullYear()),
        startDate: new Date(now.getUTCFullYear(), 0, 1),
        endDate: new Date(now.getUTCFullYear(), 11, 31, 23, 59, 59),
        status: 'OPEN',
      });
      await tx.insert(fiscalPeriods).values({
        tenantId: tenantAId,
        legalEntityId: leA1Id,
        fiscalYearId: fyId,
        periodNumber: now.getUTCMonth() + 1,
        periodName: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
        startDate: new Date(now.getUTCFullYear(), now.getUTCMonth(), 1),
        endDate: new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
        status: 'OPEN',
      });
      await tx.insert(chartOfAccounts).values([
        {
          id: vaultAccountId,
          tenantId: tenantAId,
          legalEntityId: leA1Id,
          accountCode: '1101',
          name: 'HR Cash Vault',
          nameAr: 'خزينة الموارد البشرية',
          accountType: AccountType.ASSET,
          isPostable: true,
          status: 'ACTIVE',
        },
        {
          id: advanceAccountId,
          tenantId: tenantAId,
          legalEntityId: leA1Id,
          accountCode: '1141',
          name: 'Employee Advances',
          nameAr: 'سلف الموظفين',
          accountType: AccountType.ASSET,
          isPostable: true,
          status: 'ACTIVE',
        },
      ]);
      await tx.insert(cashVaults).values({
        id: cashVaultId,
        tenantId: tenantAId,
        legalEntityId: leA1Id,
        branchId: branchA1Id,
        code: 'VAULT-HR-A',
        nameAr: 'خزينة الرواتب والسلف',
        accountId: vaultAccountId,
        balance: '5000.0000',
        status: 'ACTIVE',
      });
    });
    await dbService.withTenantContext(ctxB, async (tx) => {
      await tx.insert(legalEntities).values([
        {
          id: leB1Id,
          tenantId: tenantBId,
          legalName: 'Entity B1',
          vatNumber: '310333333333333',
        },
      ]);
      await tx.insert(branches).values([
        {
          id: branchB1Id,
          tenantId: tenantBId,
          legalEntityId: leB1Id,
          code: 'BR-B1',
          name: 'Branch B1',
        },
      ]);
    });
  });

  afterAll(async () => {
    try {
      for (const [tid, ctx] of [
        [tenantAId, ctxA],
        [tenantBId, ctxB],
      ] as const) {
        await dbService.withTenantContext(ctx, async (tx) => {
          await tx.delete(employeeCustodies).where(eq(employeeCustodies.tenantId, tid));
          await tx.delete(employeeAdvanceTransactions).where(eq(employeeAdvanceTransactions.tenantId, tid));
          await tx.delete(employeeAdvances).where(eq(employeeAdvances.tenantId, tid));
          await tx.delete(employeeDocuments).where(eq(employeeDocuments.tenantId, tid));
          await tx.delete(employeeLeaveRequests).where(eq(employeeLeaveRequests.tenantId, tid));
          await tx.delete(employeeAttendanceLogs).where(eq(employeeAttendanceLogs.tenantId, tid));
          await tx.delete(employeeShiftSchedules).where(eq(employeeShiftSchedules.tenantId, tid));
          await tx
            .delete(employeeBranchAssignments)
            .where(eq(employeeBranchAssignments.tenantId, tid));
          await tx.delete(employees).where(eq(employees.tenantId, tid));
        });
      }
    } catch {
      // Immutable ledger/audit entries remain protected in Staging
    }
    await dbService.onModuleDestroy();
  }, 30000);

  it('1. Creates employee, creates primary branch assignment, and never leaks posPinHash', async () => {
    const created = await hrService.createEmployee(ctxA, {
      legalEntityId: leA1Id,
      primaryBranchId: branchA1Id,
      employeeCode: 'EMP-001',
      fullNameAr: 'أحمد العتيبي',
      fullNameEn: 'Ahmed Alotaibi',
      phone: '0501112233',
      jobTitle: 'CASHIER',
      hireDate: '2026-11-01',
      posPin: '4321',
    });

    expect(created.employeeCode).toBe('EMP-001');
    expect((created as any).posPinHash).toBeUndefined();

    const list = await hrService.listEmployees(ctxA, { search: 'أحمد' });
    expect(list.total).toBe(1);
    expect((list.items[0] as any).posPinHash).toBeUndefined();

    const assignments = await hrService.listBranchAssignments(ctxA, created.id);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].branchId).toBe(branchA1Id);
    expect(assignments[0].isPrimary).toBe(true);

    // Duplicate employee code rejected
    await expect(
      hrService.createEmployee(ctxA, {
        legalEntityId: leA1Id,
        primaryBranchId: branchA1Id,
        employeeCode: 'EMP-001',
        fullNameAr: 'مكرر',
        hireDate: '2026-11-01',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('2. Assigns employee to additional branch and blocks cross-entity/cross-tenant assignment', async () => {
    const emp = await hrService.createEmployee(ctxA, {
      legalEntityId: leA1Id,
      primaryBranchId: branchA1Id,
      employeeCode: 'EMP-002',
      fullNameAr: 'خالد الحربي',
      jobTitle: 'DRIVER',
      hireDate: '2026-11-01',
    });

    const assigned = await hrService.assignBranch(ctxA, emp.id, {
      branchId: branchA2Id,
      roleLabel: 'DRIVER',
      isPrimary: true,
    });
    expect(assigned.branchId).toBe(branchA2Id);
    expect(assigned.isPrimary).toBe(true);

    const assignments = await hrService.listBranchAssignments(ctxA, emp.id);
    expect(assignments).toHaveLength(2);

    // Cross-tenant branch rejected
    await expect(
      hrService.assignBranch(ctxA, emp.id, { branchId: branchB1Id }),
    ).rejects.toThrow(BadRequestException);
  });

  it('3. Manages shift schedules and attendance check-in/check-out with duplicate open check-in guard', async () => {
    const emp = await hrService.createEmployee(ctxA, {
      legalEntityId: leA1Id,
      primaryBranchId: branchA1Id,
      employeeCode: 'EMP-003',
      fullNameAr: 'سعد الشهري',
      jobTitle: 'CHEF',
      hireDate: '2026-11-01',
    });

    const sched = await hrService.createShiftSchedule(ctxA, {
      employeeId: emp.id,
      branchId: branchA1Id,
      shiftDate: '2026-11-14',
      startTime: '09:00',
      endTime: '17:00',
      shiftType: 'MORNING',
    });
    expect(sched.status).toBe('SCHEDULED');

    const checkIn = await hrService.checkIn(ctxA, {
      employeeId: emp.id,
      branchId: branchA1Id,
      scheduleId: sched.id,
      source: 'MANUAL',
    });
    expect(checkIn.status).toBe('CHECKED_IN');

    // Duplicate open check-in prevented
    await expect(
      hrService.checkIn(ctxA, { employeeId: emp.id, branchId: branchA1Id }),
    ).rejects.toThrow(ConflictException);

    const checkOut = await hrService.checkOut(ctxA, { employeeId: emp.id });
    expect(checkOut.status).toBe('CHECKED_OUT');
    expect(checkOut.workedMinutes).toBeGreaterThanOrEqual(0);
  });

  it('4. Manages leave request submission and approval workflow', async () => {
    const emp = await hrService.createEmployee(ctxA, {
      legalEntityId: leA1Id,
      primaryBranchId: branchA1Id,
      employeeCode: 'EMP-004',
      fullNameAr: 'فهد القحطاني',
      jobTitle: 'WAITER',
      hireDate: '2026-11-01',
    });

    const req = await hrService.createLeaveRequest(ctxA, {
      employeeId: emp.id,
      leaveType: 'ANNUAL',
      startDate: '2026-12-01',
      endDate: '2026-12-03',
      reason: 'إجازة سنوية',
    });
    expect(req.daysCount).toBe(3);
    expect(req.status).toBe('PENDING');

    const approved = await hrService.reviewLeaveRequest(ctxA, req.id, {
      decision: 'APPROVED',
      reviewNote: 'موافق',
    });
    expect(approved.status).toBe('APPROVED');

    // Cannot review twice
    await expect(
      hrService.reviewLeaveRequest(ctxA, req.id, { decision: 'REJECTED' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('5. Enforces strict Tenant & RLS isolation and RBAC permission decorators', async () => {
    const empA = await hrService.createEmployee(ctxA, {
      legalEntityId: leA1Id,
      primaryBranchId: branchA1Id,
      employeeCode: 'EMP-ISO-1',
      fullNameAr: 'موظف معزول',
      hireDate: '2026-11-01',
    });

    const listB = await hrService.listEmployees(ctxB);
    expect(listB.total).toBe(0);

    await expect(
      hrService.updateEmployee(ctxB, empA.id, { fullNameAr: 'اختراق' }),
    ).rejects.toThrow(NotFoundException);

    const perms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      HrController.prototype.createEmployee,
    );
    expect(perms).toContain('hr.employee.manage');
  });

  it('6. Uploads, lists with DB pagination, and archives employee documents with RBAC & RLS', async () => {
    const emp = await hrService.createEmployee(ctxA, {
      legalEntityId: leA1Id,
      primaryBranchId: branchA1Id,
      employeeCode: 'EMP-DOC-1',
      fullNameAr: 'موظف مستندات',
      hireDate: '2026-11-01',
    });

    const doc = await hrService.uploadEmployeeDocument(ctxA, {
      employeeId: emp.id,
      documentType: 'IQAMA',
      documentNumber: '2450011223',
      title: 'صورة الإقامة',
      originalName: 'iqama.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 sample document bytes'),
      expiryDate: '2028-01-01',
    });
    expect(doc.status).toBe('ACTIVE');
    expect(doc.fileUrl).toContain('/api/v1/media/file/');

    const paged = await hrService.listEmployeeDocuments(ctxA, {
      employeeId: emp.id,
      page: 1,
      limit: 10,
    });
    expect(paged.total).toBe(1);
    expect(paged.items.length).toBe(1);

    const listB = await hrService.listEmployeeDocuments(ctxB, { page: 1, limit: 10 });
    expect(listB.total).toBe(0);

    const archived = await hrService.archiveEmployeeDocument(ctxA, doc.id);
    expect(archived?.status).toBe('ARCHIVED');

    const uploadPerms = Reflect.getMetadata(PERMISSIONS_KEY, HrController.prototype.uploadDocument);
    expect(uploadPerms).toContain('hr.document.upload');
  });

  it('7. Disburses and recovers employee advances via PostingEngine with idempotency & balance guard', async () => {
    const emp = await hrService.createEmployee(ctxA, {
      legalEntityId: leA1Id,
      primaryBranchId: branchA1Id,
      employeeCode: 'EMP-ADV-1',
      fullNameAr: 'موظف سلف',
      hireDate: '2026-11-01',
    });

    const advIdemp = `adv-${Date.now()}`;
    const adv = await hrService.disburseAdvance(ctxA, {
      employeeId: emp.id,
      cashVaultId,
      principalAmount: 1000,
      advanceAccountId,
      reason: 'سلفة طارئة',
      idempotencyKey: advIdemp,
    });
    expect(Number(adv.remainingAmount)).toBe(1000);
    expect(adv.disbursementJournalEntryId).toBeTruthy();

    // Idempotent retry must not disburse twice
    const retryAdv = await hrService.disburseAdvance(ctxA, {
      employeeId: emp.id,
      cashVaultId,
      principalAmount: 1000,
      advanceAccountId,
      idempotencyKey: advIdemp,
    });
    expect(retryAdv.id).toBe(adv.id);

    // Partial recovery
    const recIdemp = `rec-${Date.now()}`;
    const part = await hrService.recoverAdvance(ctxA, adv.id, {
      amount: 400,
      idempotencyKey: recIdemp,
    });
    expect(part?.status).toBe('PARTIALLY_RECOVERED');
    expect(Number(part?.remainingAmount)).toBe(600);

    // Cannot over-recover
    await expect(
      hrService.recoverAdvance(ctxA, adv.id, { amount: 700 }),
    ).rejects.toThrow(BadRequestException);

    // Full recovery of remaining 600
    const settled = await hrService.recoverAdvance(ctxA, adv.id, { amount: 600 });
    expect(settled?.status).toBe('SETTLED');
    expect(Number(settled?.remainingAmount)).toBe(0);

    const txs = await hrService.getAdvanceTransactions(ctxA, adv.id, { page: 1, limit: 10 });
    expect(txs.total).toBe(3); // 1 DISBURSEMENT + 2 RECOVERY
  });

  it('8. Manages employee custody handover, idempotency, return, and duplicate return guard', async () => {
    const emp = await hrService.createEmployee(ctxA, {
      legalEntityId: leA1Id,
      primaryBranchId: branchA1Id,
      employeeCode: 'EMP-CUST-1',
      fullNameAr: 'موظف عهدة',
      hireDate: '2026-11-01',
    });

    const custIdemp = `cust-${Date.now()}`;
    const cust = await hrService.handoverCustody(ctxA, {
      employeeId: emp.id,
      custodyCode: 'CUST-POS-01',
      itemName: 'جهاز نقاط بيع متنقل',
      category: 'DEVICE',
      serialNumber: 'SN-998877',
      estimatedValue: 1800,
      idempotencyKey: custIdemp,
    });
    expect(cust.status).toBe('HANDED_OVER');

    // Idempotent handover
    const retryCust = await hrService.handoverCustody(ctxA, {
      employeeId: emp.id,
      custodyCode: 'CUST-POS-01',
      itemName: 'جهاز نقاط بيع متنقل',
      idempotencyKey: custIdemp,
    });
    expect(retryCust.id).toBe(cust.id);

    const returned = await hrService.returnCustody(ctxA, cust.id, {
      conditionOnReturn: 'GOOD',
      status: 'RETURNED',
    });
    expect(returned?.status).toBe('RETURNED');

    // Duplicate return blocked
    await expect(
      hrService.returnCustody(ctxA, cust.id, { status: 'RETURNED' }),
    ).rejects.toThrow(ConflictException);

    const custPerms = Reflect.getMetadata(PERMISSIONS_KEY, HrController.prototype.handoverCustody);
    expect(custPerms).toContain('hr.custody.handover');
  });
});
