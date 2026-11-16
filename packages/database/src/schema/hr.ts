import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants, legalEntities, branches, users } from './tenants.js';

// 1. Employees (الموظفون - بدون رواتب)
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    primaryBranchId: uuid('primary_branch_id').notNull().references(() => branches.id),
    userId: uuid('user_id').references(() => users.id),
    employeeCode: varchar('employee_code', { length: 40 }).notNull(),
    fullNameAr: varchar('full_name_ar', { length: 160 }).notNull(),
    fullNameEn: varchar('full_name_en', { length: 160 }),
    nationalId: varchar('national_id', { length: 40 }),
    phone: varchar('phone', { length: 30 }),
    email: varchar('email', { length: 160 }),
    jobTitle: varchar('job_title', { length: 50 }).notNull().default('STAFF'),
    department: varchar('department', { length: 80 }),
    hireDate: date('hire_date').notNull(),
    terminationDate: date('termination_date'),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'),
    posPinHash: varchar('pos_pin_hash', { length: 128 }),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_employees_tenant_code').on(table.tenantId, table.employeeCode),
    index('idx_employees_tenant_entity_branch').on(
      table.tenantId,
      table.legalEntityId,
      table.primaryBranchId,
    ),
    index('idx_employees_user').on(table.userId),
  ],
);

// 2. Employee Branch Assignments (تعيين الموظفين على الفروع)
export const employeeBranchAssignments = pgTable(
  'employee_branch_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    employeeId: uuid('employee_id').notNull().references(() => employees.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    roleLabel: varchar('role_label', { length: 80 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_emp_branch_assignment').on(table.employeeId, table.branchId),
    index('idx_emp_branch_tenant').on(table.tenantId, table.branchId),
  ],
);

// 3. Employee Shift Schedules (جداول الورديات)
export const employeeShiftSchedules = pgTable(
  'employee_shift_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    employeeId: uuid('employee_id').notNull().references(() => employees.id),
    shiftDate: date('shift_date').notNull(),
    startTime: varchar('start_time', { length: 10 }).notNull(),
    endTime: varchar('end_time', { length: 10 }).notNull(),
    shiftType: varchar('shift_type', { length: 30 }).notNull().default('MORNING'),
    status: varchar('status', { length: 30 }).notNull().default('SCHEDULED'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_emp_shifts_tenant_branch_date').on(
      table.tenantId,
      table.branchId,
      table.shiftDate,
    ),
    index('idx_emp_shifts_employee_date').on(table.employeeId, table.shiftDate),
  ],
);

// 4. Employee Attendance Logs (سجلات الحضور والانصراف)
export const employeeAttendanceLogs = pgTable(
  'employee_attendance_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    employeeId: uuid('employee_id').notNull().references(() => employees.id),
    scheduleId: uuid('schedule_id').references(() => employeeShiftSchedules.id),
    attendanceDate: date('attendance_date').notNull(),
    checkInAt: timestamp('check_in_at', { withTimezone: true }).notNull(),
    checkOutAt: timestamp('check_out_at', { withTimezone: true }),
    workedMinutes: integer('worked_minutes'),
    status: varchar('status', { length: 30 }).notNull().default('CHECKED_IN'),
    source: varchar('source', { length: 30 }).notNull().default('MANUAL'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_emp_attendance_tenant_date').on(
      table.tenantId,
      table.branchId,
      table.attendanceDate,
    ),
    index('idx_emp_attendance_employee').on(table.employeeId, table.attendanceDate),
  ],
);

// 5. Employee Leave Requests (طلبات الإجازات)
export const employeeLeaveRequests = pgTable(
  'employee_leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    employeeId: uuid('employee_id').notNull().references(() => employees.id),
    leaveType: varchar('leave_type', { length: 30 }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    daysCount: integer('days_count').notNull(),
    status: varchar('status', { length: 30 }).notNull().default('PENDING'),
    reason: text('reason'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_emp_leaves_tenant_status').on(table.tenantId, table.status),
    index('idx_emp_leaves_employee').on(table.employeeId, table.startDate),
  ],
);

// 6. Employee Documents (ملفات ومستندات الموظفين)
export const employeeDocuments = pgTable(
  'employee_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    employeeId: uuid('employee_id').notNull().references(() => employees.id),
    documentType: varchar('document_type', { length: 40 }).notNull(), // NATIONAL_ID | PASSPORT | IQAMA | HEALTH_CERTIFICATE | CONTRACT | OTHER
    documentNumber: varchar('document_number', { length: 80 }),
    title: varchar('title', { length: 160 }).notNull(),
    mediaFileId: uuid('media_file_id'),
    fileUrl: text('file_url').notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    fileSize: integer('file_size').notNull(),
    issueDate: date('issue_date'),
    expiryDate: date('expiry_date'),
    status: varchar('status', { length: 30 }).notNull().default('ACTIVE'), // ACTIVE | EXPIRED | ARCHIVED
    notes: text('notes'),
    uploadedBy: uuid('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_emp_docs_tenant_employee').on(table.tenantId, table.employeeId),
    index('idx_emp_docs_tenant_expiry').on(table.tenantId, table.expiryDate),
  ],
);

// 7. Employee Advances (سلف الموظفين - بدون رواتب)
export const employeeAdvances = pgTable(
  'employee_advances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    employeeId: uuid('employee_id').notNull().references(() => employees.id),
    advanceNumber: varchar('advance_number', { length: 60 }).notNull(),
    principalAmount: numeric('principal_amount', { precision: 12, scale: 4 }).notNull(),
    recoveredAmount: numeric('recovered_amount', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    remainingAmount: numeric('remaining_amount', { precision: 12, scale: 4 }).notNull(),
    cashVaultId: uuid('cash_vault_id').notNull(),
    advanceAccountId: uuid('advance_account_id'),
    disbursementJournalEntryId: uuid('disbursement_journal_entry_id'),
    reason: text('reason'),
    status: varchar('status', { length: 30 }).notNull().default('DISBURSED'), // DISBURSED | PARTIALLY_RECOVERED | SETTLED
    disbursedAt: timestamp('disbursed_at', { withTimezone: true }).notNull().defaultNow(),
    disbursedBy: uuid('disbursed_by').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_emp_advances_tenant_number').on(table.tenantId, table.advanceNumber),
    uniqueIndex('uq_emp_advances_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_emp_advances_employee').on(table.tenantId, table.employeeId, table.status),
  ],
);

// 8. Employee Advance Transactions (سجل حركات السلف)
export const employeeAdvanceTransactions = pgTable(
  'employee_advance_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    advanceId: uuid('advance_id').notNull().references(() => employeeAdvances.id),
    employeeId: uuid('employee_id').notNull().references(() => employees.id),
    transactionType: varchar('transaction_type', { length: 30 }).notNull(), // DISBURSEMENT | RECOVERY
    amount: numeric('amount', { precision: 12, scale: 4 }).notNull(),
    balanceAfter: numeric('balance_after', { precision: 12, scale: 4 }).notNull(),
    cashVaultId: uuid('cash_vault_id'),
    journalEntryId: uuid('journal_entry_id'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    notes: text('notes'),
    performedBy: uuid('performed_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_emp_adv_tx_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_emp_adv_tx_advance').on(table.tenantId, table.advanceId, table.createdAt),
  ],
);

// 9. Employee Custodies (عهد الموظفين)
export const employeeCustodies = pgTable(
  'employee_custodies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    employeeId: uuid('employee_id').notNull().references(() => employees.id),
    custodyCode: varchar('custody_code', { length: 60 }).notNull(),
    itemName: varchar('item_name', { length: 180 }).notNull(),
    category: varchar('category', { length: 40 }).notNull().default('DEVICE'), // DEVICE | KEY | UNIFORM | CASH_FLOAT | VEHICLE | OTHER
    serialNumber: varchar('serial_number', { length: 120 }),
    estimatedValue: numeric('estimated_value', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    conditionOnHandover: varchar('condition_on_handover', { length: 30 }).notNull().default('GOOD'), // NEW | GOOD | FAIR | DAMAGED
    conditionOnReturn: varchar('condition_on_return', { length: 30 }),
    status: varchar('status', { length: 30 }).notNull().default('HANDED_OVER'), // HANDED_OVER | RETURNED | DAMAGED | LOST
    handedOverAt: timestamp('handed_over_at', { withTimezone: true }).notNull().defaultNow(),
    handedOverBy: uuid('handed_over_by').notNull(),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    returnedTo: uuid('returned_to'),
    responsibilityAccepted: boolean('responsibility_accepted').notNull().default(true),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_emp_custody_tenant_code').on(table.tenantId, table.custodyCode),
    uniqueIndex('uq_emp_custody_idempotency').on(table.tenantId, table.idempotencyKey),
    index('idx_emp_custody_employee_status').on(table.tenantId, table.employeeId, table.status),
  ],
);
