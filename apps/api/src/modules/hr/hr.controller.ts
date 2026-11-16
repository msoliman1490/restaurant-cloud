import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  Req,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { HrService } from './hr.service';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import { TenantContext } from '@restaurant-cloud/domain-kernel';

const CreateEmployeeSchema = z.object({
  legalEntityId: z.string().uuid(),
  primaryBranchId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  employeeCode: z.string().min(1).max(40),
  fullNameAr: z.string().min(2).max(160),
  fullNameEn: z.string().max(160).nullable().optional(),
  nationalId: z.string().max(40).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  jobTitle: z.string().min(2).max(50).optional(),
  department: z.string().max(80).nullable().optional(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  posPin: z.string().min(4).max(12).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const UpdateEmployeeSchema = z.object({
  primaryBranchId: z.string().uuid().optional(),
  userId: z.string().uuid().nullable().optional(),
  fullNameAr: z.string().min(2).max(160).optional(),
  fullNameEn: z.string().max(160).nullable().optional(),
  nationalId: z.string().max(40).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  jobTitle: z.string().min(2).max(50).optional(),
  department: z.string().max(80).nullable().optional(),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED']).optional(),
  terminationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  posPin: z.string().min(4).max(12).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const AssignBranchSchema = z.object({
  branchId: z.string().uuid(),
  roleLabel: z.string().max(80).optional(),
  isPrimary: z.boolean().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const CreateShiftScheduleSchema = z.object({
  employeeId: z.string().uuid(),
  branchId: z.string().uuid(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().min(4).max(10),
  endTime: z.string().min(4).max(10),
  shiftType: z.enum(['MORNING', 'EVENING', 'NIGHT', 'FULL_DAY']).optional(),
  notes: z.string().optional(),
});

const CheckInSchema = z.object({
  employeeId: z.string().uuid(),
  branchId: z.string().uuid(),
  scheduleId: z.string().uuid().optional(),
  source: z.enum(['MANUAL', 'POS_PIN', 'MANAGER']).optional(),
  notes: z.string().optional(),
});

const CheckOutSchema = z.object({
  employeeId: z.string().uuid(),
  notes: z.string().optional(),
});

const CreateLeaveRequestSchema = z.object({
  employeeId: z.string().uuid(),
  leaveType: z.enum(['ANNUAL', 'SICK', 'EMERGENCY', 'UNPAID']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().optional(),
});

const ReviewLeaveSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().optional(),
});

@Controller('api/v1/hr')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class HrController {
  constructor(private readonly hrService: HrService) {}

  @Post('employees')
  @RequirePermissions('hr.employee.manage')
  async createEmployee(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = CreateEmployeeSchema.parse(body);
    return { success: true, data: await this.hrService.createEmployee(context, dto) };
  }

  @Get('employees')
  @RequirePermissions('hr.employee.read')
  async listEmployees(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId') legalEntityId?: string,
    @Query('branchId') branchId?: string,
    @Query('jobTitle') jobTitle?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      success: true,
      data: await this.hrService.listEmployees(context, {
        legalEntityId,
        branchId,
        jobTitle,
        status,
        search,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    };
  }

  @Put('employees/:id')
  @RequirePermissions('hr.employee.manage')
  async updateEmployee(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const dto = UpdateEmployeeSchema.parse(body);
    return { success: true, data: await this.hrService.updateEmployee(context, id, dto) };
  }

  @Post('employees/:id/branches')
  @RequirePermissions('hr.employee.manage')
  async assignBranch(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const dto = AssignBranchSchema.parse(body);
    return { success: true, data: await this.hrService.assignBranch(context, id, dto) };
  }

  @Get('employees/:id/branches')
  @RequirePermissions('hr.employee.read')
  async listBranchAssignments(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
  ) {
    return { success: true, data: await this.hrService.listBranchAssignments(context, id) };
  }

  @Post('schedules')
  @RequirePermissions('hr.attendance.manage')
  async createShiftSchedule(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = CreateShiftScheduleSchema.parse(body);
    return { success: true, data: await this.hrService.createShiftSchedule(context, dto) };
  }

  @Get('schedules')
  @RequirePermissions('hr.attendance.read')
  async listShiftSchedules(
    @CurrentContext() context: TenantContext,
    @Query('branchId') branchId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('shiftDate') shiftDate?: string,
  ) {
    return {
      success: true,
      data: await this.hrService.listShiftSchedules(context, {
        branchId,
        employeeId,
        shiftDate,
      }),
    };
  }

  @Post('attendance/check-in')
  @RequirePermissions('hr.attendance.manage')
  async checkIn(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = CheckInSchema.parse(body);
    return { success: true, data: await this.hrService.checkIn(context, dto) };
  }

  @Post('attendance/check-out')
  @RequirePermissions('hr.attendance.manage')
  async checkOut(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = CheckOutSchema.parse(body);
    return { success: true, data: await this.hrService.checkOut(context, dto) };
  }

  @Get('attendance')
  @RequirePermissions('hr.attendance.read')
  async listAttendanceLogs(
    @CurrentContext() context: TenantContext,
    @Query('branchId') branchId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('attendanceDate') attendanceDate?: string,
  ) {
    return {
      success: true,
      data: await this.hrService.listAttendanceLogs(context, {
        branchId,
        employeeId,
        attendanceDate,
      }),
    };
  }

  @Post('leaves')
  @RequirePermissions('hr.employee.read')
  async createLeaveRequest(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const dto = CreateLeaveRequestSchema.parse(body);
    return { success: true, data: await this.hrService.createLeaveRequest(context, dto) };
  }

  @Post('leaves/:id/review')
  @RequirePermissions('hr.leave.manage')
  async reviewLeaveRequest(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const dto = ReviewLeaveSchema.parse(body);
    return { success: true, data: await this.hrService.reviewLeaveRequest(context, id, dto) };
  }

  @Get('leaves')
  @RequirePermissions('hr.employee.read')
  async listLeaveRequests(
    @CurrentContext() context: TenantContext,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ) {
    return {
      success: true,
      data: await this.hrService.listLeaveRequests(context, { employeeId, status }),
    };
  }

  // ==================== DOCUMENTS ====================

  @Post('documents')
  @RequirePermissions('hr.document.upload')
  async uploadDocument(
    @CurrentContext() context: TenantContext,
    @Req() request: any,
    @Body() body: unknown,
  ) {
    if (request?.isMultipart && request.isMultipart()) {
      const data = await request.file();
      if (!data) {
        throw new BadRequestException('لم يتم إرفاق أي ملف');
      }
      const buffer = await data.toBuffer();
      const employeeId = data.fields?.employeeId?.value;
      const documentType = data.fields?.documentType?.value || 'OTHER';
      const title = data.fields?.title?.value || data.filename;
      const documentNumber = data.fields?.documentNumber?.value;
      const issueDate = data.fields?.issueDate?.value;
      const expiryDate = data.fields?.expiryDate?.value;
      const notes = data.fields?.notes?.value;
      if (!employeeId) {
        throw new BadRequestException('معرّف الموظف مطلوب');
      }
      return {
        success: true,
        data: await this.hrService.uploadEmployeeDocument(context, {
          employeeId,
          documentType,
          documentNumber,
          title,
          originalName: data.filename,
          mimeType: data.mimetype,
          buffer,
          issueDate,
          expiryDate,
          notes,
        }),
      };
    }

    const UploadDocSchema = z.object({
      employeeId: z.string().uuid(),
      documentType: z.string().min(2).max(40),
      documentNumber: z.string().max(80).optional(),
      title: z.string().min(1).max(160),
      originalName: z.string().min(1).max(255),
      mimeType: z.string().min(1).max(100),
      base64Data: z.string().min(1),
      issueDate: z.string().optional(),
      expiryDate: z.string().optional(),
      notes: z.string().optional(),
    });
    const dto = UploadDocSchema.parse(body);
    const rawBase64 = (dto.base64Data.includes(',') ? dto.base64Data.split(',')[1] : dto.base64Data) || '';
    const buffer = Buffer.from(rawBase64, 'base64');

    return {
      success: true,
      data: await this.hrService.uploadEmployeeDocument(context, {
        employeeId: dto.employeeId,
        documentType: dto.documentType,
        documentNumber: dto.documentNumber,
        title: dto.title,
        originalName: dto.originalName,
        mimeType: dto.mimeType,
        buffer,
        issueDate: dto.issueDate,
        expiryDate: dto.expiryDate,
        notes: dto.notes,
      }),
    };
  }

  @Get('documents')
  @RequirePermissions('hr.document.view')
  async listDocuments(
    @CurrentContext() context: TenantContext,
    @Query('employeeId') employeeId?: string,
    @Query('documentType') documentType?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      success: true,
      data: await this.hrService.listEmployeeDocuments(context, {
        employeeId,
        documentType,
        status,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    };
  }

  @Post('documents/:id/archive')
  @RequirePermissions('hr.document.delete')
  async archiveDocument(@CurrentContext() context: TenantContext, @Param('id') id: string) {
    return {
      success: true,
      data: await this.hrService.archiveEmployeeDocument(context, id),
    };
  }

  // ==================== ADVANCES ====================

  @Post('advances')
  @RequirePermissions('hr.advance.disburse')
  async disburseAdvance(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const schema = z.object({
      employeeId: z.string().uuid(),
      cashVaultId: z.string().uuid(),
      principalAmount: z.number().positive(),
      advanceAccountId: z.string().uuid().optional(),
      reason: z.string().optional(),
      idempotencyKey: z.string().max(255).optional(),
    });
    const dto = schema.parse(body);
    return { success: true, data: await this.hrService.disburseAdvance(context, dto) };
  }

  @Post('advances/:id/recover')
  @RequirePermissions('hr.advance.recover')
  async recoverAdvance(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const schema = z.object({
      amount: z.number().positive(),
      cashVaultId: z.string().uuid().optional(),
      notes: z.string().optional(),
      idempotencyKey: z.string().max(255).optional(),
    });
    const dto = schema.parse(body);
    return { success: true, data: await this.hrService.recoverAdvance(context, id, dto) };
  }

  @Get('advances')
  @RequirePermissions('hr.advance.view')
  async listAdvances(
    @CurrentContext() context: TenantContext,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      success: true,
      data: await this.hrService.listAdvances(context, {
        employeeId,
        status,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    };
  }

  @Get('advances/:id/transactions')
  @RequirePermissions('hr.advance.view')
  async getAdvanceTransactions(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      success: true,
      data: await this.hrService.getAdvanceTransactions(context, id, {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    };
  }

  // ==================== CUSTODY ====================

  @Post('custodies')
  @RequirePermissions('hr.custody.handover')
  async handoverCustody(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const schema = z.object({
      employeeId: z.string().uuid(),
      custodyCode: z.string().min(1).max(60),
      itemName: z.string().min(1).max(180),
      category: z.string().max(40).optional(),
      serialNumber: z.string().max(120).optional(),
      estimatedValue: z.number().nonnegative().optional(),
      conditionOnHandover: z.string().max(30).optional(),
      responsibilityAccepted: z.boolean().optional(),
      notes: z.string().optional(),
      idempotencyKey: z.string().max(255).optional(),
    });
    const dto = schema.parse(body);
    return { success: true, data: await this.hrService.handoverCustody(context, dto) };
  }

  @Post('custodies/:id/return')
  @RequirePermissions('hr.custody.return')
  async returnCustody(
    @CurrentContext() context: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const schema = z.object({
      conditionOnReturn: z.string().max(30).optional(),
      status: z.enum(['RETURNED', 'DAMAGED', 'LOST']).optional(),
      notes: z.string().optional(),
    });
    const dto = schema.parse(body || {});
    return { success: true, data: await this.hrService.returnCustody(context, id, dto) };
  }

  @Get('custodies')
  @RequirePermissions('hr.custody.view')
  async listCustodies(
    @CurrentContext() context: TenantContext,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      success: true,
      data: await this.hrService.listCustodies(context, {
        employeeId,
        status,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    };
  }
}
