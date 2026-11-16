-- HR & Employees Module (Non-Payroll: Employees, Branch Assignments, Shift Schedules, Attendance, Leaves)
-- Enforces FORCE ROW LEVEL SECURITY for all 5 tables

CREATE TABLE IF NOT EXISTS "employees" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "primary_branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "user_id" uuid REFERENCES "users"("id"),
  "employee_code" varchar(40) NOT NULL,
  "full_name_ar" varchar(160) NOT NULL,
  "full_name_en" varchar(160),
  "national_id" varchar(40),
  "phone" varchar(30),
  "email" varchar(160),
  "job_title" varchar(50) NOT NULL DEFAULT 'STAFF',
  "department" varchar(80),
  "hire_date" date NOT NULL,
  "termination_date" date,
  "status" varchar(30) NOT NULL DEFAULT 'ACTIVE',
  "pos_pin_hash" varchar(128),
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_employees_tenant_code" ON "employees" ("tenant_id", "employee_code");
CREATE INDEX IF NOT EXISTS "idx_employees_tenant_entity_branch" ON "employees" ("tenant_id", "legal_entity_id", "primary_branch_id");
CREATE INDEX IF NOT EXISTS "idx_employees_user" ON "employees" ("user_id");

CREATE TABLE IF NOT EXISTS "employee_branch_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id"),
  "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "role_label" varchar(80),
  "is_primary" boolean NOT NULL DEFAULT false,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_emp_branch_assignment" ON "employee_branch_assignments" ("employee_id", "branch_id");
CREATE INDEX IF NOT EXISTS "idx_emp_branch_tenant" ON "employee_branch_assignments" ("tenant_id", "branch_id");

CREATE TABLE IF NOT EXISTS "employee_shift_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id"),
  "shift_date" date NOT NULL,
  "start_time" varchar(10) NOT NULL,
  "end_time" varchar(10) NOT NULL,
  "shift_type" varchar(30) NOT NULL DEFAULT 'MORNING',
  "status" varchar(30) NOT NULL DEFAULT 'SCHEDULED',
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_emp_shifts_tenant_branch_date" ON "employee_shift_schedules" ("tenant_id", "branch_id", "shift_date");
CREATE INDEX IF NOT EXISTS "idx_emp_shifts_employee_date" ON "employee_shift_schedules" ("employee_id", "shift_date");

CREATE TABLE IF NOT EXISTS "employee_attendance_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id"),
  "schedule_id" uuid REFERENCES "employee_shift_schedules"("id"),
  "attendance_date" date NOT NULL,
  "check_in_at" timestamp with time zone NOT NULL,
  "check_out_at" timestamp with time zone,
  "worked_minutes" integer,
  "status" varchar(30) NOT NULL DEFAULT 'CHECKED_IN',
  "source" varchar(30) NOT NULL DEFAULT 'MANUAL',
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_emp_attendance_tenant_date" ON "employee_attendance_logs" ("tenant_id", "branch_id", "attendance_date");
CREATE INDEX IF NOT EXISTS "idx_emp_attendance_employee" ON "employee_attendance_logs" ("employee_id", "attendance_date");

CREATE TABLE IF NOT EXISTS "employee_leave_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id"),
  "legal_entity_id" uuid NOT NULL REFERENCES "legal_entities"("id"),
  "branch_id" uuid NOT NULL REFERENCES "branches"("id"),
  "employee_id" uuid NOT NULL REFERENCES "employees"("id"),
  "leave_type" varchar(30) NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "days_count" integer NOT NULL,
  "status" varchar(30) NOT NULL DEFAULT 'PENDING',
  "reason" text,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_emp_leaves_tenant_status" ON "employee_leave_requests" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_emp_leaves_employee" ON "employee_leave_requests" ("employee_id", "start_date");

-- RLS & FORCE RLS
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_employees" ON "employees";
CREATE POLICY "tenant_isolation_employees" ON "employees"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "employee_branch_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_branch_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_employee_branch_assignments" ON "employee_branch_assignments";
CREATE POLICY "tenant_isolation_employee_branch_assignments" ON "employee_branch_assignments"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "employee_shift_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_shift_schedules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_employee_shift_schedules" ON "employee_shift_schedules";
CREATE POLICY "tenant_isolation_employee_shift_schedules" ON "employee_shift_schedules"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "employee_attendance_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_attendance_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_employee_attendance_logs" ON "employee_attendance_logs";
CREATE POLICY "tenant_isolation_employee_attendance_logs" ON "employee_attendance_logs"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE "employee_leave_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_leave_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_employee_leave_requests" ON "employee_leave_requests";
CREATE POLICY "tenant_isolation_employee_leave_requests" ON "employee_leave_requests"
  AS PERMISSIVE FOR ALL TO "rc_app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "employees" TO "rc_app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "employee_branch_assignments" TO "rc_app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "employee_shift_schedules" TO "rc_app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "employee_attendance_logs" TO "rc_app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "employee_leave_requests" TO "rc_app_user";
