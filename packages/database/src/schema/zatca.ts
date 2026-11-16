import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  ZatcaEnvironment,
  ZatcaCertificateStatus,
  ZatcaOutboxStatus,
  ZATCAComplianceStatus,
} from '@restaurant-cloud/domain-kernel';
import { tenants, legalEntities, branches, devices } from './tenants.js';
import { egsUnits } from './sales.js';
import { journalEntries } from './finance.js';

// 1. ZATCA Legal Entity Configuration (V1 remains active; V2 disabled in Production until final sign-off)
export const zatcaLegalEntityConfigs = pgTable(
  'zatca_legal_entity_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    v1Active: boolean('v1_active').notNull().default(true),
    v2Enabled: boolean('v2_enabled').notNull().default(false),
    environment: varchar('environment', { length: 30 }).notNull().default(ZatcaEnvironment.SANDBOX),
    sellerVatNumber: varchar('seller_vat_number', { length: 20 }).notNull(),
    sellerNameAr: varchar('seller_name_ar', { length: 255 }).notNull(),
    sellerNameEn: varchar('seller_name_en', { length: 255 }),
    crNumber: varchar('cr_number', { length: 50 }),
    streetName: varchar('street_name', { length: 255 }),
    buildingNumber: varchar('building_number', { length: 20 }),
    cityName: varchar('city_name', { length: 100 }),
    postalZone: varchar('postal_zone', { length: 20 }),
    districtName: varchar('district_name', { length: 100 }),
    countryCode: varchar('country_code', { length: 4 }).notNull().default('SA'),
    industrySector: varchar('industry_sector', { length: 100 }).notNull().default('Food & Beverage'),
    autoSubmitSimplified: boolean('auto_submit_simplified').notNull().default(true),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_zatca_le_config').on(table.tenantId, table.legalEntityId),
    index('idx_zatca_le_config_tenant').on(table.tenantId),
  ]
);

// 2. ZATCA EGS Certificates (Independent per POS / EGS Unit)
export const zatcaEgsCertificates = pgTable(
  'zatca_egs_certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    egsUnitId: uuid('egs_unit_id').notNull().references(() => egsUnits.id),
    deviceId: uuid('device_id').references(() => devices.id),
    environment: varchar('environment', { length: 30 }).notNull().default(ZatcaEnvironment.SANDBOX),
    certificateType: varchar('certificate_type', { length: 30 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default(ZatcaCertificateStatus.CSR_GENERATED),
    otpUsedHash: varchar('otp_used_hash', { length: 128 }),
    csrPem: text('csr_pem').notNull(),
    encryptedPrivateKey: text('encrypted_private_key').notNull(),
    privateKeyIv: varchar('private_key_iv', { length: 64 }).notNull(),
    privateKeyAuthTag: varchar('private_key_auth_tag', { length: 64 }).notNull(),
    publicKeyPem: text('public_key_pem').notNull(),
    certificatePem: text('certificate_pem'),
    certificateSerial: varchar('certificate_serial', { length: 128 }),
    binarySecurityToken: text('binary_security_token'),
    secretTokenEncrypted: text('secret_token_encrypted'),
    secretTokenIv: varchar('secret_token_iv', { length: 64 }),
    secretTokenAuthTag: varchar('secret_token_auth_tag', { length: 64 }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text('revocation_reason'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_zatca_certs_egs_unit').on(table.tenantId, table.egsUnitId, table.status),
    index('idx_zatca_certs_device').on(table.tenantId, table.deviceId),
  ]
);

// 3. ZATCA E-Invoice Documents Registry (UUID + ICV + PIH + UBL + QR TLV + Journal Link)
export const zatcaDocuments = pgTable(
  'zatca_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    egsUnitId: uuid('egs_unit_id').notNull().references(() => egsUnits.id),
    deviceId: uuid('device_id').references(() => devices.id),
    certificateId: uuid('certificate_id').notNull().references(() => zatcaEgsCertificates.id),
    sourceType: varchar('source_type', { length: 40 }).notNull(), // SALES_ORDER | AR_INVOICE
    sourceId: uuid('source_id').notNull(),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    documentNumber: varchar('document_number', { length: 80 }).notNull(),
    uuid: varchar('uuid', { length: 100 }).notNull(),
    icv: integer('icv').notNull(),
    pih: varchar('pih', { length: 255 }).notNull(),
    invoiceHash: varchar('invoice_hash', { length: 255 }).notNull(),
    invoiceTypeCode: varchar('invoice_type_code', { length: 10 }).notNull(), // 388 | 381 | 383
    invoiceSubtype: varchar('invoice_subtype', { length: 20 }).notNull(), // 0100000 | 0200000
    submissionType: varchar('submission_type', { length: 30 }).notNull(), // CLEARANCE | REPORTING
    complianceStatus: varchar('compliance_status', { length: 40 }).notNull().default(ZATCAComplianceStatus.SIGNED),
    issueTimestamp: varchar('issue_timestamp', { length: 40 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('SAR'),
    subtotal: numeric('subtotal', { precision: 14, scale: 4 }).notNull(),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 4 }).notNull(),
    grandTotal: numeric('grand_total', { precision: 14, scale: 4 }).notNull(),
    originalDocumentUuid: varchar('original_document_uuid', { length: 100 }),
    originalDocumentNumber: varchar('original_document_number', { length: 80 }),
    zatcaReasonCode: varchar('zatca_reason_code', { length: 20 }),
    ublXml: text('ubl_xml').notNull(),
    signedXml: text('signed_xml').notNull(),
    qrCodeTlvBase64: text('qr_code_tlv_base64').notNull(),
    signatureValue: text('signature_value').notNull(),
    zatcaRequestId: varchar('zatca_request_id', { length: 120 }),
    zatcaWarningsJson: jsonb('zatca_warnings_json'),
    zatcaErrorsJson: jsonb('zatca_errors_json'),
    clearedXml: text('cleared_xml'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    clearedOrReportedAt: timestamp('cleared_or_reported_at', { withTimezone: true }),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_zatca_doc_egs_icv').on(table.egsUnitId, table.icv),
    uniqueIndex('uq_zatca_doc_uuid').on(table.tenantId, table.uuid),
    uniqueIndex('uq_zatca_doc_idemp').on(table.tenantId, table.idempotencyKey),
    index('idx_zatca_doc_source').on(table.tenantId, table.sourceType, table.sourceId),
    index('idx_zatca_doc_status').on(table.tenantId, table.legalEntityId, table.complianceStatus),
  ]
);

// 4. ZATCA Transactional Outbox Queue (Retry + Exponential Backoff + Watchdog)
export const zatcaOutboxQueue = pgTable(
  'zatca_outbox_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    branchId: uuid('branch_id').notNull().references(() => branches.id),
    egsUnitId: uuid('egs_unit_id').notNull().references(() => egsUnits.id),
    zatcaDocumentId: uuid('zatca_document_id').notNull().references(() => zatcaDocuments.id),
    submissionType: varchar('submission_type', { length: 30 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default(ZatcaOutboxStatus.PENDING),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }).notNull().defaultNow(),
    lockedBy: varchar('locked_by', { length: 100 }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastHttpStatus: integer('last_http_status'),
    lastErrorCode: varchar('last_error_code', { length: 100 }),
    lastErrorMessage: text('last_error_message'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_zatca_outbox_idemp').on(table.tenantId, table.idempotencyKey),
    index('idx_zatca_outbox_poll').on(table.status, table.nextRetryAt),
    index('idx_zatca_outbox_tenant_doc').on(table.tenantId, table.zatcaDocumentId),
  ]
);

// 5. Immutable ZATCA Audit Logs (INSERT & SELECT only for rc_app_user)
export const zatcaAuditLogs = pgTable(
  'zatca_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    legalEntityId: uuid('legal_entity_id').notNull().references(() => legalEntities.id),
    egsUnitId: uuid('egs_unit_id').references(() => egsUnits.id),
    zatcaDocumentId: uuid('zatca_document_id').references(() => zatcaDocuments.id),
    action: varchar('action', { length: 60 }).notNull(),
    actorId: uuid('actor_id'),
    previousStatus: varchar('previous_status', { length: 40 }),
    newStatus: varchar('new_status', { length: 40 }),
    detailsJson: jsonb('details_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_zatca_audit_tenant_entity').on(table.tenantId, table.legalEntityId, table.createdAt),
    index('idx_zatca_audit_doc').on(table.zatcaDocumentId),
  ]
);
