import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { TenantContext, ZatcaEnvironment } from '@restaurant-cloud/domain-kernel';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequireAnyPermissions, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentContext } from '../../common/decorators/current-context.decorator';
import { RequiredLegalEntityIdPipe } from '../../common/pipes/legal-entity-id.pipe';
import { ZatcaV2Service } from './zatca-v2.service';

const UpsertZatcaConfigSchema = z.object({
  legalEntityId: z.string().uuid(),
  v2Enabled: z.boolean().optional(),
  environment: z.nativeEnum(ZatcaEnvironment).optional(),
  sellerVatNumber: z.string().regex(/^3\d{13}3$/),
  sellerNameAr: z.string().min(1).max(300),
  sellerNameEn: z.string().max(300).optional(),
  crNumber: z.string().max(50).optional(),
  streetName: z.string().max(200).optional(),
  buildingNumber: z.string().max(50).optional(),
  cityName: z.string().max(120).optional(),
  postalZone: z.string().max(20).optional(),
  districtName: z.string().max(120).optional(),
  industrySector: z.string().max(120).optional(),
  autoSubmitSimplified: z.boolean().optional(),
});

const RegisterEgsUnitSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid(),
  deviceId: z.string().uuid(),
  unitIdentifier: z.string().min(1).max(120),
  deviceAssetCode: z.string().max(120).optional(),
});

const OnboardOtpSchema = z.object({
  deviceId: z.string().uuid(),
  otp: z.string().regex(/^\d{6}$/),
  invoiceTypeMask: z.string().max(16).optional(),
});

const ComplianceChecksSchema = z
  .object({
    certificateId: z.string().uuid().optional(),
  })
  .optional()
  .default({});

const RevokeCertificateSchema = z.object({
  reason: z.string().min(1).max(500),
});

const GenerateZatcaDocumentSchema = z.object({
  egsUnitId: z.string().uuid(),
  sourceType: z.enum(['SALES_ORDER', 'AR_INVOICE']),
  sourceId: z.string().uuid(),
  invoiceType: z.string().max(64).optional(),
  invoiceSubtype: z.string().max(64).optional(),
  journalEntryId: z.string().uuid().optional(),
  idempotencyKey: z.string().max(128).optional(),
});

const ProcessOutboxBatchSchema = z.object({
  legalEntityId: z.string().uuid(),
  batchSize: z.number().int().positive().max(500).optional(),
});

const RunWatchdogSchema = z.object({
  legalEntityId: z.string().uuid(),
  staleMinutes: z.number().int().positive().max(1440).optional(),
});

@Controller('api/v1/zatca')
@UseGuards(TenantContextGuard, PermissionsGuard)
export class ZatcaController {
  constructor(private readonly zatcaService: ZatcaV2Service) {}

  @Post('config')
  @RequirePermissions('zatca.config.manage')
  async upsertConfig(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const validated = UpsertZatcaConfigSchema.parse(body);
    return this.zatcaService.upsertLegalEntityConfig(context, validated);
  }

  @Get('config')
  @RequireAnyPermissions('zatca.config.manage', 'zatca.view')
  async getConfig(@CurrentContext() context: TenantContext, @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string) {
    return this.zatcaService.getLegalEntityConfig(context, legalEntityId);
  }

  @Post('egs-units')
  @RequirePermissions('zatca.egs.manage')
  async registerEgsUnit(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const validated = RegisterEgsUnitSchema.parse(body);
    return this.zatcaService.registerEgsUnit(context, validated);
  }

  @Get('egs-units')
  @RequireAnyPermissions('zatca.egs.manage', 'zatca.view')
  async listEgsUnits(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.zatcaService.listEgsUnits(context, legalEntityId, branchId);
  }

  @Post('egs-units/:id/onboard-otp')
  @RequirePermissions('zatca.egs.manage')
  async onboardWithOtp(
    @CurrentContext() context: TenantContext,
    @Param('id') egsUnitId: string,
    @Body() body: unknown,
  ) {
    const validated = OnboardOtpSchema.parse(body);
    return this.zatcaService.onboardEgsWithOtp(context, { ...validated, egsUnitId });
  }

  @Post('egs-units/:id/compliance-checks')
  @RequirePermissions('zatca.egs.manage')
  async runComplianceChecks(
    @CurrentContext() context: TenantContext,
    @Param('id') egsUnitId: string,
    @Body() body: unknown,
  ) {
    const validated = ComplianceChecksSchema.parse(body);
    return this.zatcaService.runComplianceChecks(context, { egsUnitId, certificateId: validated.certificateId });
  }

  @Post('certificates/:id/issue-production')
  @RequirePermissions('zatca.egs.manage')
  async issueProductionCsid(
    @CurrentContext() context: TenantContext,
    @Param('id') certificateId: string,
  ) {
    return this.zatcaService.issueProductionCsid(context, certificateId);
  }

  @Post('certificates/:id/revoke')
  @RequirePermissions('zatca.egs.manage')
  async revokeCertificate(
    @CurrentContext() context: TenantContext,
    @Param('id') certificateId: string,
    @Body() body: unknown,
  ) {
    const validated = RevokeCertificateSchema.parse(body);
    return this.zatcaService.revokeCertificate(context, certificateId, validated.reason);
  }

  @Post('documents/generate')
  @RequirePermissions('zatca.documents.submit')
  async generateDocument(@CurrentContext() context: TenantContext, @Body() body: unknown) {
    const validated = GenerateZatcaDocumentSchema.parse(body);
    return this.zatcaService.generateZatcaDocument(context, validated);
  }

  @Get('documents')
  @RequireAnyPermissions('zatca.documents.submit', 'zatca.view')
  async listDocuments(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.zatcaService.getZatcaDocuments(context, {
      legalEntityId,
      status,
      branchId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('documents/:id/resubmit')
  @RequirePermissions('zatca.documents.submit')
  async resubmitDocument(@CurrentContext() context: TenantContext, @Param('id') id: string) {
    return this.zatcaService.resubmitDocument(context, id);
  }

  @Get('outbox')
  @RequireAnyPermissions('zatca.documents.submit', 'zatca.view')
  async getOutbox(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.zatcaService.getOutboxQueue(context, {
      legalEntityId,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('outbox/process-batch')
  @RequirePermissions('zatca.documents.submit')
  async processOutboxBatch(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown,
  ) {
    const validated = ProcessOutboxBatchSchema.parse(body);
    return this.zatcaService.runOutboxWorkerBatch(context, validated.legalEntityId, validated.batchSize);
  }

  @Post('outbox/watchdog')
  @RequirePermissions('zatca.documents.submit')
  async runWatchdog(
    @CurrentContext() context: TenantContext,
    @Body() body: unknown,
  ) {
    const validated = RunWatchdogSchema.parse(body);
    return this.zatcaService.runWatchdogRecovery(context, validated.legalEntityId, validated.staleMinutes);
  }

  @Get('reports/errors')
  @RequireAnyPermissions('zatca.view', 'accounting.reports.view')
  async getErrorReport(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.zatcaService.getZatcaErrorReport(context, {
      legalEntityId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('reports/reconciliation')
  @RequireAnyPermissions('zatca.view', 'accounting.reports.view')
  async getReconciliationReport(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
  ) {
    return this.zatcaService.getZatcaReconciliationReport(context, legalEntityId);
  }

  @Get('audit-logs')
  @RequireAnyPermissions('zatca.view', 'accounting.reports.view')
  async getAuditLogs(
    @CurrentContext() context: TenantContext,
    @Query('legalEntityId', RequiredLegalEntityIdPipe) legalEntityId: string,
    @Query('zatcaDocumentId') zatcaDocumentId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.zatcaService.getZatcaAuditLogs(context, {
      legalEntityId,
      zatcaDocumentId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
