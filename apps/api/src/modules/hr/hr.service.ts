import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { eq, and, desc, asc, ilike, or, sql, isNull } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PostingEngineService } from '../accounting/posting-engine.service';
import { MediaService } from '../media/media.service';
import { TenantContext, JournalType } from '@restaurant-cloud/domain-kernel';
import {
  employees,
  employeeBranchAssignments,
  employeeShiftSchedules,
  employeeAttendanceLogs,
  employeeLeaveRequests,
  employeeDocuments,
  employeeAdvances,
  employeeAdvanceTransactions,
  employeeCustodies,
  cashVaults,
  vaultTransactions,
  legalEntities,
  branches,
  userMemberships,
} from '@restaurant-cloud/database';

export interface CreateEmployeeInput {
  legalEntityId: string;
  primaryBranchId: string;
  userId?: string | null;
  employeeCode: string;
  fullNameAr: string;
  fullNameEn?: string | null;
  nationalId?: string | null;
  phone?: string | null;
  email?: string | null;
  jobTitle?: string;
  department?: string | null;
  hireDate: string;
  posPin?: string | null;
  notes?: string | null;
}

export interface UpdateEmployeeInput {
  primaryBranchId?: string;
  userId?: string | null;
  fullNameAr?: string;
  fullNameEn?: string | null;
  nationalId?: string | null;
  phone?: string | null;
  email?: string | null;
  jobTitle?: string;
  department?: string | null;
  status?: string;
  terminationDate?: string | null;
  posPin?: string | null;
  notes?: string | null;
}

const SAFE_EMPLOYEE_COLUMNS = {
  id: employees.id,
  tenantId: employees.tenantId,
  legalEntityId: employees.legalEntityId,
  primaryBranchId: employees.primaryBranchId,
  userId: employees.userId,
  employeeCode: employees.employeeCode,
  fullNameAr: employees.fullNameAr,
  fullNameEn: employees.fullNameEn,
  nationalId: employees.nationalId,
  phone: employees.phone,
  email: employees.email,
  jobTitle: employees.jobTitle,
  department: employees.department,
  hireDate: employees.hireDate,
  terminationDate: employees.terminationDate,
  status: employees.status,
  notes: employees.notes,
  createdBy: employees.createdBy,
  createdAt: employees.createdAt,
  updatedAt: employees.updatedAt,
};

@Injectable()
export class HrService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly postingEngine: PostingEngineService,
    private readonly mediaService: MediaService,
  ) {}

  private hashPosPin(tenantId: string, pin: string): string {
    return crypto.createHash('sha256').update(`${tenantId}:${pin.trim()}`).digest('hex');
  }

  private async assertBranchInEntity(
    tx: any,
    tenantId: string,
    legalEntityId: string,
    branchId: string,
  ) {
    const [le] = await tx
      .select({ id: legalEntities.id })
      .from(legalEntities)
      .where(and(eq(legalEntities.id, legalEntityId), eq(legalEntities.tenantId, tenantId)));
    if (!le) {
      throw new NotFoundException('المنشأة القانونية غير موجودة ضمن المستأجر');
    }

    const [br] = await tx
      .select({ id: branches.id, legalEntityId: branches.legalEntityId })
      .from(branches)
      .where(
        and(
          eq(branches.id, branchId),
          eq(branches.tenantId, tenantId),
          eq(branches.legalEntityId, legalEntityId),
        ),
      );
    if (!br) {
      throw new BadRequestException('الفرع المحدد لا ينتمي إلى المنشأة القانونية المختارة');
    }
  }

  async createEmployee(context: TenantContext, dto: CreateEmployeeInput) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.assertBranchInEntity(
        tx,
        context.tenantId,
        dto.legalEntityId,
        dto.primaryBranchId,
      );

      if (dto.userId) {
        const [mem] = await tx
          .select({ id: userMemberships.id })
          .from(userMemberships)
          .where(
            and(
              eq(userMemberships.tenantId, context.tenantId),
              eq(userMemberships.userId, dto.userId),
            ),
          );
        if (!mem) {
          throw new BadRequestException('المستخدم المربوط لا ينتمي إلى هذا المستأجر');
        }
      }

      const [existingCode] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, context.tenantId),
            eq(employees.employeeCode, dto.employeeCode.trim()),
          ),
        );
      if (existingCode) {
        throw new ConflictException(`رمز الموظف ${dto.employeeCode} مستخدم مسبقًا`);
      }

      const posPinHash = dto.posPin?.trim()
        ? this.hashPosPin(context.tenantId, dto.posPin)
        : null;

      const [created] = await tx
        .insert(employees)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          primaryBranchId: dto.primaryBranchId,
          userId: dto.userId || null,
          employeeCode: dto.employeeCode.trim(),
          fullNameAr: dto.fullNameAr.trim(),
          fullNameEn: dto.fullNameEn?.trim() || null,
          nationalId: dto.nationalId?.trim() || null,
          phone: dto.phone?.trim() || null,
          email: dto.email?.trim() || null,
          jobTitle: dto.jobTitle || 'STAFF',
          department: dto.department?.trim() || null,
          hireDate: dto.hireDate,
          status: 'ACTIVE',
          posPinHash,
          notes: dto.notes || null,
          createdBy: context.userId,
        })
        .returning(SAFE_EMPLOYEE_COLUMNS);

      if (!created) {
        throw new BadRequestException('Failed to create employee record');
      }

      await tx.insert(employeeBranchAssignments).values({
        tenantId: context.tenantId,
        legalEntityId: dto.legalEntityId,
        employeeId: created.id,
        branchId: dto.primaryBranchId,
        roleLabel: dto.jobTitle || 'STAFF',
        isPrimary: true,
        effectiveFrom: dto.hireDate,
        isActive: true,
      });

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'HR_EMPLOYEE_CREATED',
          entityType: 'employee',
          entityId: created.id,
          afterState: { employeeCode: created.employeeCode, jobTitle: created.jobTitle },
        },
        tx,
      );

      return created;
    });
  }

  async listEmployees(
    context: TenantContext,
    filters: {
      legalEntityId?: string;
      branchId?: string;
      jobTitle?: string;
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = Math.max(1, Number(filters.page || 1));
    const limit = Math.min(100, Math.max(1, Number(filters.limit || 25)));
    const offset = (page - 1) * limit;

    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(employees.tenantId, context.tenantId)];
      if (filters.legalEntityId) {
        conditions.push(eq(employees.legalEntityId, filters.legalEntityId));
      }
      if (filters.branchId) {
        conditions.push(eq(employees.primaryBranchId, filters.branchId));
      }
      if (filters.jobTitle) {
        conditions.push(eq(employees.jobTitle, filters.jobTitle));
      }
      if (filters.status) {
        conditions.push(eq(employees.status, filters.status));
      }
      if (filters.search?.trim()) {
        const term = `%${filters.search.trim()}%`;
        conditions.push(
          or(
            ilike(employees.employeeCode, term),
            ilike(employees.fullNameAr, term),
            ilike(employees.fullNameEn, term),
            ilike(employees.phone, term),
          )!,
        );
      }

      const items = await tx
        .select(SAFE_EMPLOYEE_COLUMNS)
        .from(employees)
        .where(and(...conditions))
        .orderBy(desc(employees.createdAt))
        .limit(limit)
        .offset(offset);

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(employees)
        .where(and(...conditions));

      return { items, total: countRow?.count ?? 0, page, limit };
    });
  }

  async updateEmployee(context: TenantContext, id: string, dto: UpdateEmployeeInput) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select(SAFE_EMPLOYEE_COLUMNS)
        .from(employees)
        .where(and(eq(employees.id, id), eq(employees.tenantId, context.tenantId)));
      if (!existing) {
        throw new NotFoundException('الموظف غير موجود');
      }

      if (dto.primaryBranchId) {
        await this.assertBranchInEntity(
          tx,
          context.tenantId,
          existing.legalEntityId,
          dto.primaryBranchId,
        );
      }

      const updateValues: Record<string, any> = { updatedAt: new Date() };
      if (dto.primaryBranchId !== undefined) updateValues.primaryBranchId = dto.primaryBranchId;
      if (dto.userId !== undefined) updateValues.userId = dto.userId;
      if (dto.fullNameAr !== undefined) updateValues.fullNameAr = dto.fullNameAr.trim();
      if (dto.fullNameEn !== undefined) updateValues.fullNameEn = dto.fullNameEn?.trim() || null;
      if (dto.nationalId !== undefined) updateValues.nationalId = dto.nationalId?.trim() || null;
      if (dto.phone !== undefined) updateValues.phone = dto.phone?.trim() || null;
      if (dto.email !== undefined) updateValues.email = dto.email?.trim() || null;
      if (dto.jobTitle !== undefined) updateValues.jobTitle = dto.jobTitle;
      if (dto.department !== undefined) updateValues.department = dto.department?.trim() || null;
      if (dto.status !== undefined) updateValues.status = dto.status;
      if (dto.terminationDate !== undefined) updateValues.terminationDate = dto.terminationDate;
      if (dto.notes !== undefined) updateValues.notes = dto.notes;
      if (dto.posPin !== undefined) {
        updateValues.posPinHash = dto.posPin ? this.hashPosPin(context.tenantId, dto.posPin) : null;
      }

      const [updated] = await tx
        .update(employees)
        .set(updateValues)
        .where(and(eq(employees.id, id), eq(employees.tenantId, context.tenantId)))
        .returning(SAFE_EMPLOYEE_COLUMNS);

      if (!updated) {
        throw new NotFoundException('Employee not found');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'HR_EMPLOYEE_UPDATED',
          entityType: 'employee',
          entityId: id,
          afterState: { status: updated.status, jobTitle: updated.jobTitle },
        },
        tx,
      );

      return updated;
    });
  }

  async assignBranch(
    context: TenantContext,
    employeeId: string,
    dto: { branchId: string; roleLabel?: string; isPrimary?: boolean; effectiveFrom?: string },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [emp] = await tx
        .select(SAFE_EMPLOYEE_COLUMNS)
        .from(employees)
        .where(and(eq(employees.id, employeeId), eq(employees.tenantId, context.tenantId)));
      if (!emp) throw new NotFoundException('الموظف غير موجود');

      await this.assertBranchInEntity(tx, context.tenantId, emp.legalEntityId, dto.branchId);

      if (dto.isPrimary) {
        await tx
          .update(employeeBranchAssignments)
          .set({ isPrimary: false })
          .where(
            and(
              eq(employeeBranchAssignments.employeeId, employeeId),
              eq(employeeBranchAssignments.tenantId, context.tenantId),
            ),
          );
        await tx
          .update(employees)
          .set({ primaryBranchId: dto.branchId, updatedAt: new Date() })
          .where(and(eq(employees.id, employeeId), eq(employees.tenantId, context.tenantId)));
      }

      const [existing] = await tx
        .select()
        .from(employeeBranchAssignments)
        .where(
          and(
            eq(employeeBranchAssignments.employeeId, employeeId),
            eq(employeeBranchAssignments.branchId, dto.branchId),
          ),
        );

      if (existing) {
        const [updated] = await tx
          .update(employeeBranchAssignments)
          .set({
            roleLabel: dto.roleLabel ?? existing.roleLabel,
            isPrimary: dto.isPrimary ?? existing.isPrimary,
            isActive: true,
          })
          .where(eq(employeeBranchAssignments.id, existing.id))
          .returning();
        return updated;
      }

      const [inserted] = await tx
        .insert(employeeBranchAssignments)
        .values({
          tenantId: context.tenantId,
          legalEntityId: emp.legalEntityId,
          employeeId,
          branchId: dto.branchId,
          roleLabel: dto.roleLabel || emp.jobTitle,
          isPrimary: Boolean(dto.isPrimary),
          effectiveFrom: dto.effectiveFrom || new Date().toISOString().slice(0, 10),
          isActive: true,
        })
        .returning();
      return inserted;
    });
  }

  async listBranchAssignments(context: TenantContext, employeeId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      return await tx
        .select()
        .from(employeeBranchAssignments)
        .where(
          and(
            eq(employeeBranchAssignments.tenantId, context.tenantId),
            eq(employeeBranchAssignments.employeeId, employeeId),
          ),
        )
        .orderBy(desc(employeeBranchAssignments.isPrimary));
    });
  }

  async createShiftSchedule(
    context: TenantContext,
    dto: {
      employeeId: string;
      branchId: string;
      shiftDate: string;
      startTime: string;
      endTime: string;
      shiftType?: string;
      notes?: string;
    },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [emp] = await tx
        .select(SAFE_EMPLOYEE_COLUMNS)
        .from(employees)
        .where(and(eq(employees.id, dto.employeeId), eq(employees.tenantId, context.tenantId)));
      if (!emp) throw new NotFoundException('الموظف غير موجود');

      await this.assertBranchInEntity(tx, context.tenantId, emp.legalEntityId, dto.branchId);

      const [created] = await tx
        .insert(employeeShiftSchedules)
        .values({
          tenantId: context.tenantId,
          legalEntityId: emp.legalEntityId,
          branchId: dto.branchId,
          employeeId: dto.employeeId,
          shiftDate: dto.shiftDate,
          startTime: dto.startTime,
          endTime: dto.endTime,
          shiftType: dto.shiftType || 'MORNING',
          status: 'SCHEDULED',
          notes: dto.notes || null,
          createdBy: context.userId,
        })
        .returning();
      return created;
    });
  }

  async listShiftSchedules(
    context: TenantContext,
    filters: { branchId?: string; employeeId?: string; shiftDate?: string } = {},
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(employeeShiftSchedules.tenantId, context.tenantId)];
      if (filters.branchId) conditions.push(eq(employeeShiftSchedules.branchId, filters.branchId));
      if (filters.employeeId)
        conditions.push(eq(employeeShiftSchedules.employeeId, filters.employeeId));
      if (filters.shiftDate)
        conditions.push(eq(employeeShiftSchedules.shiftDate, filters.shiftDate));

      return await tx
        .select()
        .from(employeeShiftSchedules)
        .where(and(...conditions))
        .orderBy(desc(employeeShiftSchedules.shiftDate), asc(employeeShiftSchedules.startTime));
    });
  }

  async checkIn(
    context: TenantContext,
    dto: {
      employeeId: string;
      branchId: string;
      scheduleId?: string;
      source?: string;
      notes?: string;
    },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [emp] = await tx
        .select(SAFE_EMPLOYEE_COLUMNS)
        .from(employees)
        .where(and(eq(employees.id, dto.employeeId), eq(employees.tenantId, context.tenantId)));
      if (!emp) throw new NotFoundException('الموظف غير موجود');
      if (emp.status !== 'ACTIVE') {
        throw new BadRequestException('لا يمكن تسجيل حضور موظف غير نشط');
      }

      await this.assertBranchInEntity(tx, context.tenantId, emp.legalEntityId, dto.branchId);

      const [openAttendance] = await tx
        .select()
        .from(employeeAttendanceLogs)
        .where(
          and(
            eq(employeeAttendanceLogs.tenantId, context.tenantId),
            eq(employeeAttendanceLogs.employeeId, dto.employeeId),
            isNull(employeeAttendanceLogs.checkOutAt),
          ),
        );
      if (openAttendance) {
        throw new ConflictException('يوجد تسجيل حضور مفتوح لهذا الموظف لم يتم تسجيل انصرافه بعد');
      }

      const now = new Date();
      const [log] = await tx
        .insert(employeeAttendanceLogs)
        .values({
          tenantId: context.tenantId,
          legalEntityId: emp.legalEntityId,
          branchId: dto.branchId,
          employeeId: dto.employeeId,
          scheduleId: dto.scheduleId || null,
          attendanceDate: now.toISOString().slice(0, 10),
          checkInAt: now,
          status: 'CHECKED_IN',
          source: dto.source || 'MANUAL',
          notes: dto.notes || null,
        })
        .returning();
      return log;
    });
  }

  async checkOut(
    context: TenantContext,
    dto: { employeeId: string; notes?: string },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [openLog] = await tx
        .select()
        .from(employeeAttendanceLogs)
        .where(
          and(
            eq(employeeAttendanceLogs.tenantId, context.tenantId),
            eq(employeeAttendanceLogs.employeeId, dto.employeeId),
            isNull(employeeAttendanceLogs.checkOutAt),
          ),
        )
        .orderBy(desc(employeeAttendanceLogs.checkInAt))
        .limit(1);

      if (!openLog) {
        throw new NotFoundException('لا يوجد تسجيل حضور مفتوح لهذا الموظف');
      }

      const now = new Date();
      const workedMinutes = Math.max(
        0,
        Math.round((now.getTime() - new Date(openLog.checkInAt).getTime()) / 60000),
      );

      const [updated] = await tx
        .update(employeeAttendanceLogs)
        .set({
          checkOutAt: now,
          workedMinutes,
          status: 'CHECKED_OUT',
          notes: dto.notes ?? openLog.notes,
        })
        .where(eq(employeeAttendanceLogs.id, openLog.id))
        .returning();

      if (openLog.scheduleId) {
        await tx
          .update(employeeShiftSchedules)
          .set({ status: 'COMPLETED' })
          .where(eq(employeeShiftSchedules.id, openLog.scheduleId));
      }

      return updated;
    });
  }

  async listAttendanceLogs(
    context: TenantContext,
    filters: { branchId?: string; employeeId?: string; attendanceDate?: string } = {},
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(employeeAttendanceLogs.tenantId, context.tenantId)];
      if (filters.branchId) conditions.push(eq(employeeAttendanceLogs.branchId, filters.branchId));
      if (filters.employeeId)
        conditions.push(eq(employeeAttendanceLogs.employeeId, filters.employeeId));
      if (filters.attendanceDate)
        conditions.push(eq(employeeAttendanceLogs.attendanceDate, filters.attendanceDate));

      return await tx
        .select()
        .from(employeeAttendanceLogs)
        .where(and(...conditions))
        .orderBy(desc(employeeAttendanceLogs.checkInAt))
        .limit(100);
    });
  }

  async createLeaveRequest(
    context: TenantContext,
    dto: {
      employeeId: string;
      leaveType: string;
      startDate: string;
      endDate: string;
      reason?: string;
    },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [emp] = await tx
        .select(SAFE_EMPLOYEE_COLUMNS)
        .from(employees)
        .where(and(eq(employees.id, dto.employeeId), eq(employees.tenantId, context.tenantId)));
      if (!emp) throw new NotFoundException('الموظف غير موجود');

      const start = new Date(`${dto.startDate}T00:00:00Z`);
      const end = new Date(`${dto.endDate}T00:00:00Z`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
        throw new BadRequestException('نطاق تواريخ الإجازة غير صالح');
      }
      const daysCount = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;

      const [created] = await tx
        .insert(employeeLeaveRequests)
        .values({
          tenantId: context.tenantId,
          legalEntityId: emp.legalEntityId,
          branchId: emp.primaryBranchId,
          employeeId: dto.employeeId,
          leaveType: dto.leaveType,
          startDate: dto.startDate,
          endDate: dto.endDate,
          daysCount,
          status: 'PENDING',
          reason: dto.reason || null,
        })
        .returning();
      return created;
    });
  }

  async reviewLeaveRequest(
    context: TenantContext,
    id: string,
    dto: { decision: 'APPROVED' | 'REJECTED'; reviewNote?: string },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [req] = await tx
        .select()
        .from(employeeLeaveRequests)
        .where(
          and(eq(employeeLeaveRequests.id, id), eq(employeeLeaveRequests.tenantId, context.tenantId)),
        );
      if (!req) throw new NotFoundException('طلب الإجازة غير موجود');
      if (req.status !== 'PENDING') {
        throw new BadRequestException('تمت مراجعة طلب الإجازة مسبقًا');
      }

      const [updated] = await tx
        .update(employeeLeaveRequests)
        .set({
          status: dto.decision,
          reviewedBy: context.userId,
          reviewedAt: new Date(),
          reviewNote: dto.reviewNote || null,
        })
        .where(eq(employeeLeaveRequests.id, id))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: `HR_LEAVE_${dto.decision}`,
          entityType: 'employee_leave_request',
          entityId: id,
          afterState: { decision: dto.decision, employeeId: req.employeeId },
        },
        tx,
      );

      return updated;
    });
  }

  async listLeaveRequests(
    context: TenantContext,
    filters: { employeeId?: string; status?: string } = {},
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(employeeLeaveRequests.tenantId, context.tenantId)];
      if (filters.employeeId)
        conditions.push(eq(employeeLeaveRequests.employeeId, filters.employeeId));
      if (filters.status) conditions.push(eq(employeeLeaveRequests.status, filters.status));

      return await tx
        .select()
        .from(employeeLeaveRequests)
        .where(and(...conditions))
        .orderBy(desc(employeeLeaveRequests.createdAt))
        .limit(100);
    });
  }

  // ==================== 6. EMPLOYEE DOCUMENTS ====================

  async uploadEmployeeDocument(
    context: TenantContext,
    dto: {
      employeeId: string;
      documentType: string;
      documentNumber?: string;
      title: string;
      originalName: string;
      mimeType: string;
      buffer: Buffer;
      issueDate?: string;
      expiryDate?: string;
      notes?: string;
    },
  ) {
    const emp = await this.dbService.withTenantContext(context, async (tx) => {
      const [found] = await tx
        .select({
          id: employees.id,
          legalEntityId: employees.legalEntityId,
          primaryBranchId: employees.primaryBranchId,
        })
        .from(employees)
        .where(and(eq(employees.id, dto.employeeId), eq(employees.tenantId, context.tenantId)))
        .limit(1);
      if (!found) {
        throw new NotFoundException('الموظف غير موجود');
      }
      return found;
    });

    const media = await this.mediaService.uploadFile(context, {
      originalName: dto.originalName,
      mimeType: dto.mimeType,
      buffer: dto.buffer,
      entityType: 'employee_document',
      entityId: dto.employeeId,
    });
    if (!media) {
      throw new BadRequestException('تعذر حفظ الملف المرفق');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [created] = await tx
        .insert(employeeDocuments)
        .values({
          tenantId: context.tenantId,
          legalEntityId: emp.legalEntityId,
          branchId: emp.primaryBranchId,
          employeeId: dto.employeeId,
          documentType: dto.documentType,
          documentNumber: dto.documentNumber?.trim() || null,
          title: dto.title.trim(),
          mediaFileId: media.id,
          fileUrl: media.publicUrl,
          originalName: media.originalName,
          mimeType: media.mimeType,
          fileSize: media.fileSize,
          issueDate: dto.issueDate || null,
          expiryDate: dto.expiryDate || null,
          status: 'ACTIVE',
          notes: dto.notes || null,
          uploadedBy: context.userId,
        })
        .returning();

      if (!created) {
        throw new BadRequestException('تعذر حفظ مستند الموظف');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'HR_DOCUMENT_UPLOADED',
          entityType: 'employee_document',
          entityId: created.id,
          afterState: {
            employeeId: dto.employeeId,
            documentType: created.documentType,
            title: created.title,
            mediaFileId: media.id,
          },
        },
        tx,
      );

      return created;
    });
  }

  async listEmployeeDocuments(
    context: TenantContext,
    query: {
      employeeId?: string;
      documentType?: string;
      status?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(employeeDocuments.tenantId, context.tenantId)];
      if (query.employeeId) conditions.push(eq(employeeDocuments.employeeId, query.employeeId));
      if (query.documentType) conditions.push(eq(employeeDocuments.documentType, query.documentType));
      if (query.status) conditions.push(eq(employeeDocuments.status, query.status));

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(employeeDocuments)
        .where(and(...conditions));

      const items = await tx
        .select()
        .from(employeeDocuments)
        .where(and(...conditions))
        .orderBy(desc(employeeDocuments.createdAt))
        .limit(limit)
        .offset(offset);

      return { items, total: countRow?.total ?? 0, page, limit };
    });
  }

  async archiveEmployeeDocument(context: TenantContext, documentId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(employeeDocuments)
        .where(and(eq(employeeDocuments.id, documentId), eq(employeeDocuments.tenantId, context.tenantId)))
        .limit(1);
      if (!existing) {
        throw new NotFoundException('المستند غير موجود');
      }

      const [updated] = await tx
        .update(employeeDocuments)
        .set({ status: 'ARCHIVED', updatedAt: new Date() })
        .where(eq(employeeDocuments.id, documentId))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'HR_DOCUMENT_ARCHIVED',
          entityType: 'employee_document',
          entityId: documentId,
          beforeState: { status: existing.status },
          afterState: { status: 'ARCHIVED' },
        },
        tx,
      );

      return updated;
    });
  }

  // ==================== 7. EMPLOYEE ADVANCES (NO PAYROLL) ====================

  async disburseAdvance(
    context: TenantContext,
    dto: {
      employeeId: string;
      cashVaultId: string;
      principalAmount: number;
      advanceAccountId?: string;
      reason?: string;
      idempotencyKey?: string;
    },
  ) {
    const amount = Number(dto.principalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('مبلغ السلفة يجب أن يكون أكبر من صفر');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      if (dto.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(employeeAdvances)
          .where(
            and(
              eq(employeeAdvances.tenantId, context.tenantId),
              eq(employeeAdvances.idempotencyKey, dto.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          return existing;
        }
      }

      const [emp] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, dto.employeeId), eq(employees.tenantId, context.tenantId)))
        .limit(1);
      if (!emp || emp.status !== 'ACTIVE') {
        throw new NotFoundException('الموظف غير موجود أو غير نشط');
      }

      const [vault] = await tx
        .select()
        .from(cashVaults)
        .where(
          and(
            eq(cashVaults.id, dto.cashVaultId),
            eq(cashVaults.tenantId, context.tenantId),
            eq(cashVaults.legalEntityId, emp.legalEntityId),
          ),
        )
        .limit(1)
        .for('update');
      if (!vault || vault.status !== 'ACTIVE') {
        throw new NotFoundException('خزينة الصرف غير موجودة أو غير نشطة لهذه المنشأة');
      }
      if (Number(vault.balance) < amount) {
        throw new BadRequestException('رصيد الخزينة غير كافٍ لصرف السلفة');
      }

      const advanceNumber = `ADV-${Date.now().toString().slice(-7)}`;
      const jv = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: emp.legalEntityId,
          branchId: emp.primaryBranchId,
          journalNumber: `JV-${advanceNumber}`,
          journalType: JournalType.GENERAL,
          sourceType: 'hr_advance_disbursement',
          sourceId: emp.id,
          description: `صرف سلفة موظف: ${emp.fullNameAr} (${advanceNumber})`,
          lines: [
            {
              ...(dto.advanceAccountId
                ? { accountId: dto.advanceAccountId }
                : { mappingKey: 'EMPLOYEE_ADVANCES' }),
              branchId: emp.primaryBranchId,
              debit: amount.toFixed(4),
              credit: '0.0000',
              description: `ذمم سلف الموظف ${emp.fullNameAr}`,
            },
            {
              accountId: vault.accountId,
              branchId: emp.primaryBranchId,
              debit: '0.0000',
              credit: amount.toFixed(4),
              description: `صرف نقدي من ${vault.nameAr}`,
            },
          ],
        },
        tx,
      );

      const newVaultBalance = Number(vault.balance) - amount;
      await tx
        .update(cashVaults)
        .set({ balance: newVaultBalance.toFixed(4) })
        .where(eq(cashVaults.id, vault.id));

      const [created] = await tx
        .insert(employeeAdvances)
        .values({
          tenantId: context.tenantId,
          legalEntityId: emp.legalEntityId,
          branchId: emp.primaryBranchId,
          employeeId: emp.id,
          advanceNumber,
          principalAmount: amount.toFixed(4),
          recoveredAmount: '0.0000',
          remainingAmount: amount.toFixed(4),
          cashVaultId: vault.id,
          advanceAccountId: dto.advanceAccountId || null,
          disbursementJournalEntryId: jv.id,
          reason: dto.reason || null,
          status: 'DISBURSED',
          disbursedBy: context.userId,
          idempotencyKey: dto.idempotencyKey || null,
        })
        .returning();

      if (!created) {
        throw new BadRequestException('تعذر تسجيل السلفة');
      }

      await tx.insert(vaultTransactions).values({
        tenantId: context.tenantId,
        vaultId: vault.id,
        transactionType: 'WITHDRAWAL',
        amount: amount.toFixed(4),
        balanceAfter: newVaultBalance.toFixed(4),
        sourceDocumentType: 'EMPLOYEE_ADVANCE_DISBURSEMENT',
        sourceDocumentId: created.id,
        notes: `صرف سلفة موظف - ${advanceNumber}`,
        performedBy: context.userId,
      });

      await tx.insert(employeeAdvanceTransactions).values({
        tenantId: context.tenantId,
        legalEntityId: emp.legalEntityId,
        branchId: emp.primaryBranchId,
        advanceId: created.id,
        employeeId: emp.id,
        transactionType: 'DISBURSEMENT',
        amount: amount.toFixed(4),
        balanceAfter: amount.toFixed(4),
        cashVaultId: vault.id,
        journalEntryId: jv.id,
        idempotencyKey: dto.idempotencyKey ? `${dto.idempotencyKey}:disburse` : null,
        notes: dto.reason || 'صرف سلفة',
        performedBy: context.userId,
      });

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'HR_ADVANCE_DISBURSED',
          entityType: 'employee_advance',
          entityId: created.id,
          afterState: {
            employeeId: emp.id,
            advanceNumber,
            principalAmount: created.principalAmount,
            journalEntryId: jv.id,
          },
        },
        tx,
      );

      return created;
    });
  }

  async recoverAdvance(
    context: TenantContext,
    advanceId: string,
    dto: {
      amount: number;
      cashVaultId?: string;
      notes?: string;
      idempotencyKey?: string;
    },
  ) {
    const recoveryAmount = Number(dto.amount);
    if (!Number.isFinite(recoveryAmount) || recoveryAmount <= 0) {
      throw new BadRequestException('مبلغ الاسترداد يجب أن يكون أكبر من صفر');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      if (dto.idempotencyKey) {
        const [dupTx] = await tx
          .select()
          .from(employeeAdvanceTransactions)
          .where(
            and(
              eq(employeeAdvanceTransactions.tenantId, context.tenantId),
              eq(employeeAdvanceTransactions.idempotencyKey, dto.idempotencyKey),
            ),
          )
          .limit(1);
        if (dupTx) {
          const [adv] = await tx
            .select()
            .from(employeeAdvances)
            .where(eq(employeeAdvances.id, dupTx.advanceId));
          return adv;
        }
      }

      const [advance] = await tx
        .select()
        .from(employeeAdvances)
        .where(and(eq(employeeAdvances.id, advanceId), eq(employeeAdvances.tenantId, context.tenantId)))
        .limit(1)
        .for('update');
      if (!advance) {
        throw new NotFoundException('السلفة غير موجودة');
      }
      if (advance.status === 'SETTLED') {
        throw new ConflictException('تم سداد هذه السلفة بالكامل مسبقاً');
      }

      const currentRemaining = Number(advance.remainingAmount);
      if (recoveryAmount > currentRemaining + 0.0001) {
        throw new BadRequestException(
          `مبلغ الاسترداد (${recoveryAmount}) يتجاوز الرصيد المتبقي (${currentRemaining})`,
        );
      }

      const targetVaultId = dto.cashVaultId || advance.cashVaultId;
      const [vault] = await tx
        .select()
        .from(cashVaults)
        .where(
          and(
            eq(cashVaults.id, targetVaultId),
            eq(cashVaults.tenantId, context.tenantId),
            eq(cashVaults.legalEntityId, advance.legalEntityId),
          ),
        )
        .limit(1)
        .for('update');
      if (!vault || vault.status !== 'ACTIVE') {
        throw new NotFoundException('خزينة الاسترداد غير موجودة أو غير نشطة');
      }

      const jv = await this.postingEngine.postEntry(
        context,
        {
          legalEntityId: advance.legalEntityId,
          branchId: advance.branchId,
          journalNumber: `JV-REC-${Date.now().toString().slice(-6)}`,
          journalType: JournalType.GENERAL,
          sourceType: 'hr_advance_recovery',
          sourceId: advance.id,
          description: `استرداد سلفة موظف (${advance.advanceNumber})`,
          lines: [
            {
              accountId: vault.accountId,
              branchId: advance.branchId,
              debit: recoveryAmount.toFixed(4),
              credit: '0.0000',
              description: `إيداع استرداد سلفة في ${vault.nameAr}`,
            },
            {
              ...(advance.advanceAccountId
                ? { accountId: advance.advanceAccountId }
                : { mappingKey: 'EMPLOYEE_ADVANCES' }),
              branchId: advance.branchId,
              debit: '0.0000',
              credit: recoveryAmount.toFixed(4),
              description: `تخفيض ذمم سلفة ${advance.advanceNumber}`,
            },
          ],
        },
        tx,
      );

      const newVaultBalance = Number(vault.balance) + recoveryAmount;
      await tx
        .update(cashVaults)
        .set({ balance: newVaultBalance.toFixed(4) })
        .where(eq(cashVaults.id, vault.id));

      await tx.insert(vaultTransactions).values({
        tenantId: context.tenantId,
        vaultId: vault.id,
        transactionType: 'DEPOSIT',
        amount: recoveryAmount.toFixed(4),
        balanceAfter: newVaultBalance.toFixed(4),
        sourceDocumentType: 'EMPLOYEE_ADVANCE_RECOVERY',
        sourceDocumentId: advance.id,
        notes: dto.notes || `استرداد سلفة - ${advance.advanceNumber}`,
        performedBy: context.userId,
      });

      const newRecovered = Number(advance.recoveredAmount) + recoveryAmount;
      const newRemaining = Math.max(0, currentRemaining - recoveryAmount);
      const newStatus = newRemaining <= 0.0001 ? 'SETTLED' : 'PARTIALLY_RECOVERED';

      const [updated] = await tx
        .update(employeeAdvances)
        .set({
          recoveredAmount: newRecovered.toFixed(4),
          remainingAmount: newRemaining.toFixed(4),
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(employeeAdvances.id, advance.id))
        .returning();

      await tx.insert(employeeAdvanceTransactions).values({
        tenantId: context.tenantId,
        legalEntityId: advance.legalEntityId,
        branchId: advance.branchId,
        advanceId: advance.id,
        employeeId: advance.employeeId,
        transactionType: 'RECOVERY',
        amount: recoveryAmount.toFixed(4),
        balanceAfter: newRemaining.toFixed(4),
        cashVaultId: vault.id,
        journalEntryId: jv.id,
        idempotencyKey: dto.idempotencyKey || null,
        notes: dto.notes || 'استرداد سلفة',
        performedBy: context.userId,
      });

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'HR_ADVANCE_RECOVERED',
          entityType: 'employee_advance',
          entityId: advance.id,
          beforeState: { remainingAmount: advance.remainingAmount, status: advance.status },
          afterState: {
            recoveredAmount: newRecovered.toFixed(4),
            remainingAmount: newRemaining.toFixed(4),
            status: newStatus,
            journalEntryId: jv.id,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async listAdvances(
    context: TenantContext,
    query: { employeeId?: string; status?: string; page?: number; limit?: number } = {},
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(employeeAdvances.tenantId, context.tenantId)];
      if (query.employeeId) conditions.push(eq(employeeAdvances.employeeId, query.employeeId));
      if (query.status) conditions.push(eq(employeeAdvances.status, query.status));

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(employeeAdvances)
        .where(and(...conditions));

      const items = await tx
        .select()
        .from(employeeAdvances)
        .where(and(...conditions))
        .orderBy(desc(employeeAdvances.createdAt))
        .limit(limit)
        .offset(offset);

      return { items, total: countRow?.total ?? 0, page, limit };
    });
  }

  async getAdvanceTransactions(
    context: TenantContext,
    advanceId: string,
    query: { page?: number; limit?: number } = {},
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [
        eq(employeeAdvanceTransactions.tenantId, context.tenantId),
        eq(employeeAdvanceTransactions.advanceId, advanceId),
      ];

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(employeeAdvanceTransactions)
        .where(and(...conditions));

      const items = await tx
        .select()
        .from(employeeAdvanceTransactions)
        .where(and(...conditions))
        .orderBy(desc(employeeAdvanceTransactions.createdAt))
        .limit(limit)
        .offset(offset);

      return { items, total: countRow?.total ?? 0, page, limit };
    });
  }

  // ==================== 8. EMPLOYEE CUSTODY ====================

  async handoverCustody(
    context: TenantContext,
    dto: {
      employeeId: string;
      custodyCode: string;
      itemName: string;
      category?: string;
      serialNumber?: string;
      estimatedValue?: number;
      conditionOnHandover?: string;
      responsibilityAccepted?: boolean;
      notes?: string;
      idempotencyKey?: string;
    },
  ) {
    if (!dto.custodyCode?.trim() || !dto.itemName?.trim()) {
      throw new BadRequestException('كود العهدة واسم الصنف مطلوبان');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      if (dto.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(employeeCustodies)
          .where(
            and(
              eq(employeeCustodies.tenantId, context.tenantId),
              eq(employeeCustodies.idempotencyKey, dto.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          return existing;
        }
      }

      const [dupCode] = await tx
        .select({ id: employeeCustodies.id })
        .from(employeeCustodies)
        .where(
          and(
            eq(employeeCustodies.tenantId, context.tenantId),
            eq(employeeCustodies.custodyCode, dto.custodyCode.trim()),
          ),
        )
        .limit(1);
      if (dupCode) {
        throw new ConflictException(`كود العهدة مستخدم مسبقاً: ${dto.custodyCode}`);
      }

      const [emp] = await tx
        .select()
        .from(employees)
        .where(and(eq(employees.id, dto.employeeId), eq(employees.tenantId, context.tenantId)))
        .limit(1);
      if (!emp || emp.status !== 'ACTIVE') {
        throw new NotFoundException('الموظف غير موجود أو غير نشط');
      }

      const [created] = await tx
        .insert(employeeCustodies)
        .values({
          tenantId: context.tenantId,
          legalEntityId: emp.legalEntityId,
          branchId: emp.primaryBranchId,
          employeeId: emp.id,
          custodyCode: dto.custodyCode.trim(),
          itemName: dto.itemName.trim(),
          category: dto.category || 'DEVICE',
          serialNumber: dto.serialNumber?.trim() || null,
          estimatedValue: Number(dto.estimatedValue ?? 0).toFixed(4),
          conditionOnHandover: dto.conditionOnHandover || 'GOOD',
          status: 'HANDED_OVER',
          handedOverBy: context.userId,
          responsibilityAccepted: dto.responsibilityAccepted ?? true,
          idempotencyKey: dto.idempotencyKey || null,
          notes: dto.notes || null,
        })
        .returning();

      if (!created) {
        throw new BadRequestException('تعذر تسجيل تسليم العهدة');
      }

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'HR_CUSTODY_HANDED_OVER',
          entityType: 'employee_custody',
          entityId: created.id,
          afterState: {
            employeeId: emp.id,
            custodyCode: created.custodyCode,
            itemName: created.itemName,
            conditionOnHandover: created.conditionOnHandover,
          },
        },
        tx,
      );

      return created;
    });
  }

  async returnCustody(
    context: TenantContext,
    custodyId: string,
    dto: {
      conditionOnReturn?: string;
      status?: 'RETURNED' | 'DAMAGED' | 'LOST';
      notes?: string;
    } = {},
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [existing] = await tx
        .select()
        .from(employeeCustodies)
        .where(and(eq(employeeCustodies.id, custodyId), eq(employeeCustodies.tenantId, context.tenantId)))
        .limit(1);
      if (!existing) {
        throw new NotFoundException('سجل العهدة غير موجود');
      }
      if (existing.status !== 'HANDED_OVER') {
        throw new ConflictException(`تم إقفال هذه العهدة مسبقاً بالحالة: ${existing.status}`);
      }

      const finalStatus = dto.status || 'RETURNED';
      const now = new Date();
      const [updated] = await tx
        .update(employeeCustodies)
        .set({
          status: finalStatus,
          conditionOnReturn: dto.conditionOnReturn || (finalStatus === 'RETURNED' ? 'GOOD' : finalStatus),
          returnedAt: now,
          returnedTo: context.userId,
          notes: dto.notes ?? existing.notes,
          updatedAt: now,
        })
        .where(eq(employeeCustodies.id, custodyId))
        .returning();

      await this.auditService.log(
        {
          tenantId: context.tenantId,
          actorId: context.userId,
          action: 'HR_CUSTODY_RETURNED',
          entityType: 'employee_custody',
          entityId: custodyId,
          beforeState: { status: existing.status },
          afterState: {
            status: finalStatus,
            conditionOnReturn: updated?.conditionOnReturn,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async listCustodies(
    context: TenantContext,
    query: { employeeId?: string; status?: string; page?: number; limit?: number } = {},
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    return await this.dbService.withTenantContext(context, async (tx) => {
      const conditions = [eq(employeeCustodies.tenantId, context.tenantId)];
      if (query.employeeId) conditions.push(eq(employeeCustodies.employeeId, query.employeeId));
      if (query.status) conditions.push(eq(employeeCustodies.status, query.status));

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(employeeCustodies)
        .where(and(...conditions));

      const items = await tx
        .select()
        .from(employeeCustodies)
        .where(and(...conditions))
        .orderBy(desc(employeeCustodies.createdAt))
        .limit(limit)
        .offset(offset);

      return { items, total: countRow?.total ?? 0, page, limit };
    });
  }
}
