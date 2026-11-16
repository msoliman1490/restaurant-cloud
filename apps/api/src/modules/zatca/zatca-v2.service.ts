import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, and, desc, asc, sql, inArray, lte } from 'drizzle-orm';
import {
  TenantContext,
  EInvoiceType,
  SubmissionType,
  ZATCAComplianceStatus,
  ZatcaEnvironment,
  ZatcaCertificateType,
  ZatcaCertificateStatus,
  ZatcaOutboxStatus,
  ZatcaInvoiceSubtype,
} from '@restaurant-cloud/domain-kernel';
import {
  legalEntities,
  branches,
  devices,
  egsUnits,
  salesOrders,
  orderLines,
  arInvoices,
  arInvoiceLines,
  businessPartners,
  journalEntries,
  zatcaLegalEntityConfigs,
  zatcaEgsCertificates,
  zatcaDocuments,
  zatcaOutboxQueue,
  zatcaAuditLogs,
} from '@restaurant-cloud/database';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OperationsFrameworkService } from '../../common/operations/operations-framework.service';
import { ZatcaCryptoService } from './zatca-crypto.service';
import { ZatcaUblService, ZatcaUblLineInput } from './zatca-ubl.service';
import { ZatcaGatewayService } from './zatca-gateway.service';

@Injectable()
export class ZatcaV2Service {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly opsFramework: OperationsFrameworkService,
    private readonly cryptoService: ZatcaCryptoService,
    private readonly ublService: ZatcaUblService,
    private readonly gatewayService: ZatcaGatewayService,
  ) {}

  private async verifyEntityScope(
    tx: any,
    context: TenantContext,
    legalEntityId: string,
    branchId?: string,
  ) {
    const [le] = await tx
      .select()
      .from(legalEntities)
      .where(and(eq(legalEntities.tenantId, context.tenantId), eq(legalEntities.id, legalEntityId)))
      .limit(1);
    if (!le) {
      throw new NotFoundException(`المنشأة القانونية '${legalEntityId}' غير موجودة`);
    }

    if (branchId) {
      const [br] = await tx
        .select()
        .from(branches)
        .where(and(eq(branches.tenantId, context.tenantId), eq(branches.id, branchId)))
        .limit(1);
      if (!br || br.legalEntityId !== legalEntityId) {
        throw new BadRequestException('الفرع المحدد لا ينتمي للمنشأة القانونية المحددة');
      }
    }

    await this.opsFramework.verifyScope(context, context.userScopes || [], {
      legalEntityId,
      branchId,
    });

    return le;
  }

  private sanitizeCertificate(cert: any) {
    if (!cert) return cert;
    const {
      encryptedPrivateKey: _epk,
      privateKeyIv: _piv,
      privateKeyAuthTag: _pat,
      secretTokenEncrypted: _ste,
      secretTokenIv: _sti,
      secretTokenAuthTag: _stat,
      ...safe
    } = cert;
    return safe;
  }

  private async writeZatcaAudit(
    tx: any,
    params: {
      tenantId: string;
      legalEntityId: string;
      egsUnitId?: string | null;
      zatcaDocumentId?: string | null;
      action: string;
      actorId?: string | null;
      previousStatus?: string | null;
      newStatus?: string | null;
      detailsJson?: any;
    },
  ) {
    await tx.insert(zatcaAuditLogs).values({
      tenantId: params.tenantId,
      legalEntityId: params.legalEntityId,
      egsUnitId: params.egsUnitId ?? null,
      zatcaDocumentId: params.zatcaDocumentId ?? null,
      action: params.action,
      actorId: params.actorId ?? null,
      previousStatus: params.previousStatus ?? null,
      newStatus: params.newStatus ?? null,
      detailsJson: params.detailsJson ?? null,
    });
  }

  // =========================================================================
  // 1. Legal Entity ZATCA V2 Configuration (V1 stays active; V2 guarded)
  // =========================================================================

  async upsertLegalEntityConfig(
    context: TenantContext,
    dto: {
      legalEntityId: string;
      v2Enabled?: boolean;
      environment?: ZatcaEnvironment;
      sellerVatNumber: string;
      sellerNameAr: string;
      sellerNameEn?: string;
      crNumber?: string;
      streetName?: string;
      buildingNumber?: string;
      cityName?: string;
      postalZone?: string;
      districtName?: string;
      industrySector?: string;
      autoSubmitSimplified?: boolean;
    },
  ) {
    if (!/^3\d{13}3$/.test(dto.sellerVatNumber || '')) {
      throw new BadRequestException('الرقم الضريبي للمنشأة يجب أن يتكون من 15 رقماً ويبدأ وينتهي بـ 3');
    }

    const env = dto.environment || ZatcaEnvironment.SANDBOX;
    const isProdEnv = process.env.NODE_ENV === 'production';
    if (
      (env === ZatcaEnvironment.PRODUCTION || dto.v2Enabled === true) &&
      isProdEnv &&
      process.env.ZATCA_PRODUCTION_APPROVED !== 'true'
    ) {
      throw new ForbiddenException('تفعيل ZATCA V2 على بيئة الإنتاج ممنوع قبل اجتياز القبول النهائي.');
    }
    if (
      env === ZatcaEnvironment.PRODUCTION &&
      (process.env.ZATCA_ALLOW_PRODUCTION_CALLS !== 'true' ||
        process.env.ZATCA_PRODUCTION_APPROVED !== 'true')
    ) {
      throw new ForbiddenException('بيئة ZATCA Production مقفلة؛ استخدم SANDBOX أو SIMULATION.');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, dto.legalEntityId);

      const [existing] = await tx
        .select()
        .from(zatcaLegalEntityConfigs)
        .where(
          and(
            eq(zatcaLegalEntityConfigs.tenantId, context.tenantId),
            eq(zatcaLegalEntityConfigs.legalEntityId, dto.legalEntityId),
          ),
        )
        .limit(1);

      let config: any;
      if (existing) {
        [config] = await tx
          .update(zatcaLegalEntityConfigs)
          .set({
            v1Active: true, // ZATCA V1 always stays active
            v2Enabled: dto.v2Enabled ?? existing.v2Enabled,
            environment: env,
            sellerVatNumber: dto.sellerVatNumber,
            sellerNameAr: dto.sellerNameAr,
            sellerNameEn: dto.sellerNameEn ?? existing.sellerNameEn,
            crNumber: dto.crNumber ?? existing.crNumber,
            streetName: dto.streetName ?? existing.streetName,
            buildingNumber: dto.buildingNumber ?? existing.buildingNumber,
            cityName: dto.cityName ?? existing.cityName,
            postalZone: dto.postalZone ?? existing.postalZone,
            districtName: dto.districtName ?? existing.districtName,
            industrySector: dto.industrySector ?? existing.industrySector,
            autoSubmitSimplified: dto.autoSubmitSimplified ?? existing.autoSubmitSimplified,
            updatedBy: context.userId,
            updatedAt: new Date(),
          })
          .where(eq(zatcaLegalEntityConfigs.id, existing.id))
          .returning();
      } else {
        [config] = await tx
          .insert(zatcaLegalEntityConfigs)
          .values({
            tenantId: context.tenantId,
            legalEntityId: dto.legalEntityId,
            v1Active: true,
            v2Enabled: dto.v2Enabled ?? false,
            environment: env,
            sellerVatNumber: dto.sellerVatNumber,
            sellerNameAr: dto.sellerNameAr,
            sellerNameEn: dto.sellerNameEn || null,
            crNumber: dto.crNumber || null,
            streetName: dto.streetName || null,
            buildingNumber: dto.buildingNumber || null,
            cityName: dto.cityName || null,
            postalZone: dto.postalZone || null,
            districtName: dto.districtName || null,
            industrySector: dto.industrySector || 'Food & Beverage',
            autoSubmitSimplified: dto.autoSubmitSimplified ?? true,
            updatedBy: context.userId,
          })
          .returning();
      }

      await this.writeZatcaAudit(tx, {
        tenantId: context.tenantId,
        legalEntityId: dto.legalEntityId,
        action: 'ZATCA_CONFIG_UPSERTED',
        actorId: context.userId,
        newStatus: config.v2Enabled ? 'V2_ENABLED' : 'V2_DISABLED',
        detailsJson: { environment: config.environment, v1Active: config.v1Active, v2Enabled: config.v2Enabled },
      });

      return config;
    });
  }

  async getLegalEntityConfig(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, legalEntityId);
      const [config] = await tx
        .select()
        .from(zatcaLegalEntityConfigs)
        .where(
          and(
            eq(zatcaLegalEntityConfigs.tenantId, context.tenantId),
            eq(zatcaLegalEntityConfigs.legalEntityId, legalEntityId),
          ),
        )
        .limit(1);
      return config || null;
    });
  }

  // =========================================================================
  // 2. POS / EGS Unit Registration & OTP Certificate Onboarding
  // =========================================================================

  async registerEgsUnit(
    context: TenantContext,
    dto: {
      legalEntityId: string;
      branchId: string;
      deviceId: string;
      unitIdentifier: string;
      deviceAssetCode?: string;
    },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, dto.legalEntityId, dto.branchId);

      // Verify POS device belongs to tenant & branch
      const [dev] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.tenantId, context.tenantId), eq(devices.id, dto.deviceId)))
        .limit(1);
      if (!dev || dev.branchId !== dto.branchId) {
        throw new BadRequestException('جهاز نقطة البيع (POS) غير موجود أو لا يتبع للفرع المحدد');
      }

      const [existingUnit] = await tx
        .select()
        .from(egsUnits)
        .where(eq(egsUnits.unitIdentifier, dto.unitIdentifier))
        .limit(1);
      if (existingUnit) {
        throw new ConflictException(`معرف وحدة EGS '${dto.unitIdentifier}' مستخدم مسبقاً`);
      }

      const [unit] = await tx
        .insert(egsUnits)
        .values({
          tenantId: context.tenantId,
          legalEntityId: dto.legalEntityId,
          branchId: dto.branchId,
          unitIdentifier: dto.unitIdentifier,
          deviceAssetCode: dto.deviceAssetCode || dev.deviceCode,
          status: 'ACTIVE',
          icvCurrent: 0,
          lastHash: this.cryptoService.getGenesisPih(),
        })
        .returning();

      if (!unit) {
        throw new BadRequestException('فشل تسجيل وحدة EGS');
      }

      await this.writeZatcaAudit(tx, {
        tenantId: context.tenantId,
        legalEntityId: dto.legalEntityId,
        egsUnitId: unit.id,
        action: 'EGS_UNIT_REGISTERED',
        actorId: context.userId,
        newStatus: 'ACTIVE',
        detailsJson: { deviceId: dto.deviceId, unitIdentifier: dto.unitIdentifier },
      });

      return unit;
    });
  }

  async listEgsUnits(context: TenantContext, legalEntityId: string, branchId?: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, legalEntityId, branchId);
      const conds = [
        eq(egsUnits.tenantId, context.tenantId),
        eq(egsUnits.legalEntityId, legalEntityId),
      ];
      if (branchId) conds.push(eq(egsUnits.branchId, branchId));

      const units = await tx
        .select()
        .from(egsUnits)
        .where(and(...conds))
        .orderBy(desc(egsUnits.createdAt));

      const certs = await tx
        .select()
        .from(zatcaEgsCertificates)
        .where(
          and(
            eq(zatcaEgsCertificates.tenantId, context.tenantId),
            eq(zatcaEgsCertificates.legalEntityId, legalEntityId),
          ),
        )
        .orderBy(desc(zatcaEgsCertificates.createdAt));

      return units.map((u) => ({
        ...u,
        certificates: certs.filter((c) => c.egsUnitId === u.id).map((c) => this.sanitizeCertificate(c)),
      }));
    });
  }

  async onboardEgsWithOtp(
    context: TenantContext,
    dto: {
      egsUnitId: string;
      deviceId: string;
      otp: string;
      invoiceTypeMask?: string; // '1100'
    },
  ) {
    if (!dto.otp || !/^\d{6}$/.test(dto.otp.trim())) {
      throw new BadRequestException('رمز OTP غير صالح؛ يجب أن يتكون من 6 أرقام');
    }

    return await this.dbService.withTenantContext(context, async (tx) => {
      const [unit] = await tx
        .select()
        .from(egsUnits)
        .where(and(eq(egsUnits.tenantId, context.tenantId), eq(egsUnits.id, dto.egsUnitId)))
        .limit(1);
      if (!unit) {
        throw new NotFoundException('وحدة EGS غير موجودة');
      }

      const [br] = await tx
        .select()
        .from(branches)
        .where(and(eq(branches.tenantId, context.tenantId), eq(branches.id, unit.branchId!)))
        .limit(1);
      await this.verifyEntityScope(tx, context, unit.legalEntityId, unit.branchId || undefined);

      const [dev] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.tenantId, context.tenantId), eq(devices.id, dto.deviceId)))
        .limit(1);
      if (!dev || dev.branchId !== unit.branchId) {
        throw new BadRequestException('جهاز POS المحدد لا يتبع لنفس فرع وحدة EGS');
      }

      const [config] = await tx
        .select()
        .from(zatcaLegalEntityConfigs)
        .where(
          and(
            eq(zatcaLegalEntityConfigs.tenantId, context.tenantId),
            eq(zatcaLegalEntityConfigs.legalEntityId, unit.legalEntityId),
          ),
        )
        .limit(1);
      if (!config) {
        throw new BadRequestException('يجب إعداد بيانات ZATCA للمنشأة القانونية أولاً قبل ربط OTP');
      }

      // Generate independent ECDSA prime256v1 keypair & CSR for this POS
      const keyPair = this.cryptoService.generateEcdsaKeyPair();
      const csrPem = this.cryptoService.buildZatcaCsrPem({
        commonName: `${unit.unitIdentifier}-${dev.deviceCode}`,
        serialNumber: `1-RC|2-${dev.deviceCode}|3-${unit.id}`,
        organizationIdentifier: config.sellerVatNumber,
        organizationUnitName: br?.name || 'Main Branch',
        organizationName: config.sellerNameEn || config.sellerNameAr,
        countryName: config.countryCode || 'SA',
        invoiceType: dto.invoiceTypeMask || '1100',
        locationAddress: `${config.cityName || 'Riyadh'} ${config.streetName || ''}`.trim(),
        industryBusinessCategory: config.industrySector || 'Food & Beverage',
        publicKeyDerBase64: keyPair.publicKeyDerBase64,
        privateKeyPem: keyPair.privateKeyPem,
        environment: config.environment,
      });

      const csidRes = await this.gatewayService.requestComplianceCsid({
        environment: config.environment,
        csrPem,
        otp: dto.otp,
        unitIdentifier: unit.unitIdentifier,
      });

      const encKey = this.cryptoService.encryptSecret(keyPair.privateKeyPem);
      const encSec = this.cryptoService.encryptSecret(csidRes.secret);

      const [cert] = await tx
        .insert(zatcaEgsCertificates)
        .values({
          tenantId: context.tenantId,
          legalEntityId: unit.legalEntityId,
          branchId: unit.branchId!,
          egsUnitId: unit.id,
          deviceId: dev.id,
          environment: config.environment,
          certificateType: ZatcaCertificateType.COMPLIANCE_CSID,
          status: ZatcaCertificateStatus.COMPLIANCE_ACTIVE,
          otpUsedHash: this.cryptoService.hashOtp(dto.otp),
          csrPem,
          encryptedPrivateKey: encKey.ciphertext,
          privateKeyIv: encKey.iv,
          privateKeyAuthTag: encKey.authTag,
          publicKeyPem: keyPair.publicKeyPem,
          certificatePem: csidRes.certificatePem,
          certificateSerial: csidRes.certificateSerial,
          binarySecurityToken: csidRes.binarySecurityToken,
          secretTokenEncrypted: encSec.ciphertext,
          secretTokenIv: encSec.iv,
          secretTokenAuthTag: encSec.authTag,
          issuedAt: new Date(),
          expiresAt: new Date(csidRes.expiresAt),
          createdBy: context.userId,
        })
        .returning();

      await tx
        .update(egsUnits)
        .set({ csidReference: csidRes.certificateSerial })
        .where(eq(egsUnits.id, unit.id));

      await this.writeZatcaAudit(tx, {
        tenantId: context.tenantId,
        legalEntityId: unit.legalEntityId,
        egsUnitId: unit.id,
        action: 'EGS_COMPLIANCE_CSID_ISSUED',
        actorId: context.userId,
        newStatus: ZatcaCertificateStatus.COMPLIANCE_ACTIVE,
        detailsJson: {
          deviceId: dev.id,
          certificateSerial: csidRes.certificateSerial,
          environment: config.environment,
        },
      });

      return this.sanitizeCertificate(cert);
    });
  }

  async issueProductionCsid(context: TenantContext, complianceCertificateId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [compCert] = await tx
        .select()
        .from(zatcaEgsCertificates)
        .where(
          and(
            eq(zatcaEgsCertificates.tenantId, context.tenantId),
            eq(zatcaEgsCertificates.id, complianceCertificateId),
          ),
        )
        .limit(1);
      if (!compCert) {
        throw new NotFoundException('شهادة الامتثال غير موجودة');
      }
      await this.verifyEntityScope(tx, context, compCert.legalEntityId, compCert.branchId);

      if (compCert.status !== ZatcaCertificateStatus.COMPLIANCE_ACTIVE) {
        throw new BadRequestException('يجب أن تكون شهادة الامتثال نشطة لإصدار شهادة الإنتاج');
      }

      const [unit] = await tx
        .select()
        .from(egsUnits)
        .where(eq(egsUnits.id, compCert.egsUnitId))
        .limit(1);

      const compSecret = this.cryptoService.decryptSecret(
        compCert.secretTokenEncrypted!,
        compCert.secretTokenIv!,
        compCert.secretTokenAuthTag!,
      );

      const prodRes = await this.gatewayService.requestProductionCsid({
        environment: compCert.environment,
        complianceRequestId: compCert.certificateSerial || compCert.id,
        binarySecurityToken: compCert.binarySecurityToken!,
        secret: compSecret,
        unitIdentifier: unit?.unitIdentifier || compCert.egsUnitId,
      });

      const encSec = this.cryptoService.encryptSecret(prodRes.secret);

      const [prodCert] = await tx
        .insert(zatcaEgsCertificates)
        .values({
          tenantId: context.tenantId,
          legalEntityId: compCert.legalEntityId,
          branchId: compCert.branchId,
          egsUnitId: compCert.egsUnitId,
          deviceId: compCert.deviceId,
          environment: compCert.environment,
          certificateType: ZatcaCertificateType.PRODUCTION_CSID,
          status: ZatcaCertificateStatus.PRODUCTION_ACTIVE,
          csrPem: compCert.csrPem,
          encryptedPrivateKey: compCert.encryptedPrivateKey,
          privateKeyIv: compCert.privateKeyIv,
          privateKeyAuthTag: compCert.privateKeyAuthTag,
          publicKeyPem: compCert.publicKeyPem,
          certificatePem: prodRes.certificatePem,
          certificateSerial: prodRes.certificateSerial,
          binarySecurityToken: prodRes.binarySecurityToken,
          secretTokenEncrypted: encSec.ciphertext,
          secretTokenIv: encSec.iv,
          secretTokenAuthTag: encSec.authTag,
          issuedAt: new Date(),
          expiresAt: new Date(prodRes.expiresAt),
          createdBy: context.userId,
        })
        .returning();

      await tx
        .update(egsUnits)
        .set({ csidReference: prodRes.certificateSerial })
        .where(eq(egsUnits.id, compCert.egsUnitId));

      await this.writeZatcaAudit(tx, {
        tenantId: context.tenantId,
        legalEntityId: compCert.legalEntityId,
        egsUnitId: compCert.egsUnitId,
        action: 'EGS_PRODUCTION_CSID_ISSUED',
        actorId: context.userId,
        newStatus: ZatcaCertificateStatus.PRODUCTION_ACTIVE,
        detailsJson: { certificateSerial: prodRes.certificateSerial },
      });

      return this.sanitizeCertificate(prodCert);
    });
  }

  async revokeCertificate(context: TenantContext, certificateId: string, reason: string) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('يجب إدخال سبب إلغاء الشهادة (5 أحرف على الأقل)');
    }
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [cert] = await tx
        .select()
        .from(zatcaEgsCertificates)
        .where(
          and(
            eq(zatcaEgsCertificates.tenantId, context.tenantId),
            eq(zatcaEgsCertificates.id, certificateId),
          ),
        )
        .limit(1);
      if (!cert) throw new NotFoundException('الشهادة غير موجودة');
      await this.verifyEntityScope(tx, context, cert.legalEntityId, cert.branchId);

      const [updated] = await tx
        .update(zatcaEgsCertificates)
        .set({
          status: ZatcaCertificateStatus.REVOKED,
          revokedAt: new Date(),
          revocationReason: reason.trim(),
        })
        .where(eq(zatcaEgsCertificates.id, cert.id))
        .returning();

      await this.writeZatcaAudit(tx, {
        tenantId: context.tenantId,
        legalEntityId: cert.legalEntityId,
        egsUnitId: cert.egsUnitId,
        action: 'EGS_CERTIFICATE_REVOKED',
        actorId: context.userId,
        previousStatus: cert.status,
        newStatus: ZatcaCertificateStatus.REVOKED,
        detailsJson: { certificateId: cert.id, reason: reason.trim() },
      });

      return this.sanitizeCertificate(updated);
    });
  }

  /**
   * Runs official ZATCA Compliance Checks (/compliance/invoices) for:
   * 1. Standard Tax Invoice (388 / 0100000)
   * 2. Simplified Tax Invoice (388 / 0200000)
   * 3. Credit Note (381 / 0100000)
   * 4. Debit Note (383 / 0100000)
   */
  async runComplianceChecks(
    context: TenantContext,
    dto: { egsUnitId: string; certificateId?: string },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [unit] = await tx
        .select()
        .from(egsUnits)
        .where(and(eq(egsUnits.tenantId, context.tenantId), eq(egsUnits.id, dto.egsUnitId)))
        .limit(1);
      if (!unit) throw new NotFoundException('وحدة EGS غير موجودة');
      await this.verifyEntityScope(tx, context, unit.legalEntityId, unit.branchId || undefined);

      const [config] = await tx
        .select()
        .from(zatcaLegalEntityConfigs)
        .where(
          and(
            eq(zatcaLegalEntityConfigs.tenantId, context.tenantId),
            eq(zatcaLegalEntityConfigs.legalEntityId, unit.legalEntityId),
          ),
        )
        .limit(1);
      if (!config) throw new BadRequestException('إعدادات ZATCA للمنشأة غير موجودة');

      const [cert] = await tx
        .select()
        .from(zatcaEgsCertificates)
        .where(
          dto.certificateId
            ? and(
                eq(zatcaEgsCertificates.tenantId, context.tenantId),
                eq(zatcaEgsCertificates.id, dto.certificateId),
              )
            : and(
                eq(zatcaEgsCertificates.tenantId, context.tenantId),
                eq(zatcaEgsCertificates.egsUnitId, unit.id),
                eq(zatcaEgsCertificates.status, ZatcaCertificateStatus.COMPLIANCE_ACTIVE),
              ),
        )
        .orderBy(desc(zatcaEgsCertificates.createdAt))
        .limit(1);
      if (!cert) throw new BadRequestException('لا توجد شهادة امتثال (Compliance CSID) نشطة لهذه الوحدة');

      const privateKeyPem = this.cryptoService.decryptSecret(
        cert.encryptedPrivateKey,
        cert.privateKeyIv,
        cert.privateKeyAuthTag,
      );
      const secret = this.cryptoService.decryptSecret(
        cert.secretTokenEncrypted!,
        cert.secretTokenIv!,
        cert.secretTokenAuthTag!,
      );
      const publicKeyDer = Buffer.from(
        cert.publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, ''),
        'base64',
      ).toString('base64');

      const scenarios = [
        {
          label: 'STANDARD_TAX_INVOICE',
          invoiceTypeCode: '388',
          invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
          submissionType: SubmissionType.CLEARANCE,
        },
        {
          label: 'SIMPLIFIED_TAX_INVOICE',
          invoiceTypeCode: '388',
          invoiceSubtype: ZatcaInvoiceSubtype.SIMPLIFIED_B2C,
          submissionType: SubmissionType.REPORTING,
        },
        {
          label: 'CREDIT_NOTE',
          invoiceTypeCode: '381',
          invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
          submissionType: SubmissionType.CLEARANCE,
          originalDocumentNumber: 'INV-COMP-REF-001',
          originalDocumentUuid: randomUUID(),
          zatcaReasonCode: 'C01',
        },
        {
          label: 'DEBIT_NOTE',
          invoiceTypeCode: '383',
          invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
          submissionType: SubmissionType.CLEARANCE,
          originalDocumentNumber: 'INV-COMP-REF-001',
          originalDocumentUuid: randomUUID(),
          zatcaReasonCode: 'D01',
        },
      ];

      const results: any[] = [];
      let prevHash = this.cryptoService.getGenesisPih();

      for (let i = 0; i < scenarios.length; i++) {
        const sc = scenarios[i]!;
        const now = new Date();
        const docUuid = randomUUID();
        const ublInput = {
          uuid: docUuid,
          documentNumber: `COMP-${sc.label}-${Date.now()}-${i + 1}`,
          issueDate: now.toISOString().slice(0, 10),
          issueTime: now.toISOString().slice(11, 19),
          invoiceTypeCode: sc.invoiceTypeCode,
          invoiceSubtype: sc.invoiceSubtype,
          currency: 'SAR',
          icv: i + 1,
          pih: prevHash,
          seller: {
            vatNumber: config.sellerVatNumber,
            name: config.sellerNameEn || config.sellerNameAr,
            crNumber: config.crNumber,
            streetName: config.streetName,
            buildingNumber: config.buildingNumber,
            cityName: config.cityName,
            postalZone: config.postalZone,
            districtName: config.districtName,
            countryCode: config.countryCode,
          },
          buyer:
            sc.invoiceSubtype === ZatcaInvoiceSubtype.STANDARD_B2B
              ? { name: 'ZATCA Compliance Buyer', vatNumber: '310000000000993', countryCode: 'SA' }
              : { name: 'Walk-in Customer', countryCode: 'SA' },
          originalDocumentNumber: sc.originalDocumentNumber,
          originalDocumentUuid: sc.originalDocumentUuid,
          zatcaReasonCode: sc.zatcaReasonCode,
          subtotal: 100,
          discountTotal: 0,
          taxAmount: 15,
          grandTotal: 115,
          lines: [{ id: '1', name: 'Compliance Item', quantity: 1, unitPrice: 100, taxRate: 15 }],
        };

        const isSandboxMock =
          cert.environment === ZatcaEnvironment.SANDBOX &&
          !this.gatewayService.isLiveHttpEnabled();
        if (!isSandboxMock) {
          this.cryptoService.validateCsidCertificateTrust({
            certificatePemOrBase64: cert.binarySecurityToken || '',
            expectedBinding: {
              vatNumber: config.sellerVatNumber,
              unitSerialNumber: unit.unitIdentifier,
            },
          });
        }

        const validation = this.ublService.validateUblAndBrKsa(ublInput);
        const ublXml = this.ublService.buildUblXml(ublInput);
        const xadesResult = this.cryptoService.signZatcaXades({
          ublXml,
          privateKeyPem,
          certificatePemOrBase64: cert.binarySecurityToken ?? undefined,
          signingTimeIso: now.toISOString(),
          allowSelfSignedFallback: isSandboxMock,
        });
        const { invoiceHashBase64, signatureBase64 } = xadesResult;
        const qrBase64 = this.cryptoService.encodeQrTlv({
          sellerName: config.sellerNameAr,
          vatNumber: config.sellerVatNumber,
          timestamp: now.toISOString(),
          invoiceTotal: '115.00',
          vatTotal: '15.00',
          invoiceHashBase64,
          ecdsaSignatureBase64: signatureBase64,
          publicKeyBase64: publicKeyDer,
          certificateSignatureBase64:
            sc.invoiceSubtype === ZatcaInvoiceSubtype.SIMPLIFIED_B2C
              ? xadesResult.certificateSignatureBase64
              : undefined,
        });
        const signedXml = this.ublService.injectSignatureAndQr(
          ublXml,
          qrBase64,
          signatureBase64,
          xadesResult,
        );

        const gwRes = await this.gatewayService.submitInvoice({
          environment: cert.environment,
          submissionType: sc.submissionType,
          binarySecurityToken: cert.binarySecurityToken!,
          secret,
          invoiceHash: invoiceHashBase64,
          uuid: docUuid,
          signedXmlBase64: Buffer.from(signedXml, 'utf8').toString('base64'),
          complianceCheck: true,
        });

        prevHash = invoiceHashBase64;
        results.push({
          scenario: sc.label,
          brKsaValid: validation.valid,
          httpStatus: gwRes.httpStatus,
          status: gwRes.status,
          ok: gwRes.ok,
          liveHttp: Boolean(gwRes.liveHttp),
          warnings: gwRes.warnings,
          errors: gwRes.errors,
        });
      }

      await this.writeZatcaAudit(tx, {
        tenantId: context.tenantId,
        legalEntityId: unit.legalEntityId,
        egsUnitId: unit.id,
        action: 'ZATCA_COMPLIANCE_CHECKS_EXECUTED',
        actorId: context.userId,
        newStatus: results.every((r) => r.ok) ? 'COMPLIANCE_PASSED' : 'COMPLIANCE_FAILED',
        detailsJson: { results },
      });

      return {
        egsUnitId: unit.id,
        certificateId: cert.id,
        environment: cert.environment,
        allPassed: results.every((r) => r.ok),
        results,
      };
    });
  }

  // =========================================================================
  // 3. Document Generation (UUID + ICV + PIH + UBL + BR-KSA + Sign + QR + Outbox)
  // =========================================================================

  async generateZatcaDocument(
    context: TenantContext,
    dto: {
      egsUnitId: string;
      sourceType: 'SALES_ORDER' | 'AR_INVOICE';
      sourceId: string;
      invoiceType?: EInvoiceType | string;
      invoiceSubtype?: ZatcaInvoiceSubtype | string;
      journalEntryId?: string;
      idempotencyKey?: string;
    },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      // Idempotency check
      if (dto.idempotencyKey) {
        const [existingByIdemp] = await tx
          .select()
          .from(zatcaDocuments)
          .where(
            and(
              eq(zatcaDocuments.tenantId, context.tenantId),
              eq(zatcaDocuments.idempotencyKey, dto.idempotencyKey),
            ),
          )
          .limit(1);
        if (existingByIdemp) {
          return { document: existingByIdemp, idempotentHit: true };
        }
      }

      // Lock EGS Unit FOR UPDATE to guarantee gapless, race-free ICV & PIH chain
      const lockedUnits = await tx.execute(
        sql`SELECT * FROM egs_units WHERE tenant_id = ${context.tenantId}::uuid AND id = ${dto.egsUnitId}::uuid FOR UPDATE`,
      );
      const unit: any = (lockedUnits as any)?.[0];
      if (!unit) {
        throw new NotFoundException('وحدة EGS غير موجودة');
      }
      if (unit.status !== 'ACTIVE') {
        throw new BadRequestException('وحدة EGS غير نشطة');
      }
      await this.verifyEntityScope(tx, context, unit.legal_entity_id, unit.branch_id || undefined);

      const [config] = await tx
        .select()
        .from(zatcaLegalEntityConfigs)
        .where(
          and(
            eq(zatcaLegalEntityConfigs.tenantId, context.tenantId),
            eq(zatcaLegalEntityConfigs.legalEntityId, unit.legal_entity_id),
          ),
        )
        .limit(1);
      if (!config) {
        throw new BadRequestException('إعدادات ZATCA غير مكتملة لهذه المنشأة القانونية');
      }

      // Find active certificate for this EGS unit (prefer PRODUCTION_ACTIVE, fallback COMPLIANCE_ACTIVE)
      const activeCerts = await tx
        .select()
        .from(zatcaEgsCertificates)
        .where(
          and(
            eq(zatcaEgsCertificates.tenantId, context.tenantId),
            eq(zatcaEgsCertificates.egsUnitId, unit.id),
            inArray(zatcaEgsCertificates.status, [
              ZatcaCertificateStatus.PRODUCTION_ACTIVE,
              ZatcaCertificateStatus.COMPLIANCE_ACTIVE,
            ]),
          ),
        )
        .orderBy(desc(zatcaEgsCertificates.createdAt));

      const cert =
        activeCerts.find((c) => c.status === ZatcaCertificateStatus.PRODUCTION_ACTIVE) ||
        activeCerts[0];
      if (!cert) {
        throw new BadRequestException('لا توجد شهادة ZATCA نشطة لهذه الوحدة (POS EGS)');
      }

      // Load source document (SALES_ORDER or AR_INVOICE)
      let docNumber = '';
      let currency = 'SAR';
      let subtotal = 0;
      let discountTotal = 0;
      let taxAmount = 0;
      let grandTotal = 0;
      let journalEntryId = dto.journalEntryId || null;
      let originalDocumentNumber: string | null = null;
      let originalDocumentUuid: string | null = null;
      let zatcaReasonCode: string | null = null;
      let buyer: any = { name: 'Walk-in Customer', countryCode: 'SA' };
      let ublLines: ZatcaUblLineInput[] = [];
      let defaultSubtype = ZatcaInvoiceSubtype.SIMPLIFIED_B2C;
      let defaultTypeCode = EInvoiceType.TAX_INVOICE;

      if (dto.sourceType === 'SALES_ORDER') {
        const [order] = await tx
          .select()
          .from(salesOrders)
          .where(and(eq(salesOrders.tenantId, context.tenantId), eq(salesOrders.id, dto.sourceId)))
          .limit(1);
        if (!order) throw new NotFoundException('أمر البيع غير موجود');
        if (order.legalEntityId !== unit.legal_entity_id || order.branchId !== unit.branch_id) {
          throw new ForbiddenException('أمر البيع لا يتبع لنفس المنشأة أو الفرع الخاص بوحدة EGS');
        }
        docNumber = order.orderNumber;
        currency = order.currency;
        subtotal = parseFloat(order.subtotal || '0');
        discountTotal = parseFloat(order.discountTotal || '0');
        taxAmount = parseFloat(order.taxTotal || '0');
        grandTotal = parseFloat(order.grandTotal || '0');

        const lines = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.orderId, order.id));
        ublLines = lines.map((l, idx) => ({
          id: String(idx + 1),
          name: `Item ${l.itemId.slice(0, 8)}`,
          quantity: parseFloat(l.quantity || '1'),
          unitPrice: parseFloat(l.unitPrice || '0'),
          discountAmount: parseFloat(l.discountAmount || '0'),
          taxRate: 15,
          taxCategoryCode: 'S',
        }));

        if (!journalEntryId) {
          const [je] = await tx
            .select({ id: journalEntries.id })
            .from(journalEntries)
            .where(
              and(
                eq(journalEntries.tenantId, context.tenantId),
                eq(journalEntries.sourceId, order.id),
              ),
            )
            .limit(1);
          journalEntryId = je?.id || null;
        }
      } else {
        const [inv] = await tx
          .select()
          .from(arInvoices)
          .where(and(eq(arInvoices.tenantId, context.tenantId), eq(arInvoices.id, dto.sourceId)))
          .limit(1);
        if (!inv) throw new NotFoundException('فاتورة العملاء غير موجودة');
        if (inv.legalEntityId !== unit.legal_entity_id) {
          throw new ForbiddenException('الفاتورة لا تتبع لنفس المنشأة القانونية لوحدة EGS');
        }
        if (inv.branchId && unit.branch_id && inv.branchId !== unit.branch_id) {
          throw new ForbiddenException('الفاتورة لا تتبع لنفس فرع وحدة EGS');
        }

        docNumber = inv.invoiceNumber;
        currency = inv.currency;
        subtotal = parseFloat(inv.subtotal || '0');
        discountTotal = parseFloat(inv.discountAmount || '0');
        taxAmount = parseFloat(inv.taxAmount || '0');
        grandTotal = parseFloat(inv.grandTotal || '0');
        journalEntryId = journalEntryId || inv.journalEntryId || null;
        originalDocumentNumber = inv.originalInvoiceNumber || null;
        originalDocumentUuid = inv.originalInvoiceUuid || null;
        zatcaReasonCode = inv.zatcaReasonCode || null;
        defaultSubtype = ZatcaInvoiceSubtype.STANDARD_B2B;
        if (inv.invoiceType === 'CREDIT_NOTE') defaultTypeCode = EInvoiceType.CREDIT_NOTE;
        else if (inv.invoiceType === 'DEBIT_NOTE') defaultTypeCode = EInvoiceType.DEBIT_NOTE;

        const [partner] = await tx
          .select()
          .from(businessPartners)
          .where(eq(businessPartners.id, inv.partnerId))
          .limit(1);
        if (partner) {
          buyer = {
            name: partner.legalNameEn || partner.legalNameAr,
            vatNumber: partner.taxIdentificationNumber,
            countryCode: 'SA',
          };
        }

        const lines = await tx
          .select()
          .from(arInvoiceLines)
          .where(eq(arInvoiceLines.invoiceId, inv.id));
        ublLines = lines.map((l: any, idx: number) => ({
          id: String(idx + 1),
          name: l.description || `Item ${idx + 1}`,
          quantity: parseFloat(l.quantity || '1'),
          unitPrice: parseFloat(l.unitPrice || '0'),
          discountAmount: parseFloat(l.discountAmount || '0'),
          taxRate: 15,
          taxCategoryCode: 'S',
        }));
      }

      const invoiceSubtype = (dto.invoiceSubtype || defaultSubtype) as string;
      const ublTypeCode = this.ublService.resolveUblTypeCode(dto.invoiceType || defaultTypeCode);
      const submissionType =
        invoiceSubtype === ZatcaInvoiceSubtype.STANDARD_B2B
          ? SubmissionType.CLEARANCE
          : SubmissionType.REPORTING;

      const nextIcv = Number(unit.icv_current || 0) + 1;
      const pih = unit.last_hash || this.cryptoService.getGenesisPih();
      const docUuid = randomUUID();
      const now = new Date();
      const issueDate = now.toISOString().slice(0, 10);
      const issueTime = now.toISOString().slice(11, 19);
      const issueTimestamp = now.toISOString();

      const ublInput = {
        uuid: docUuid,
        documentNumber: docNumber,
        issueDate,
        issueTime,
        invoiceTypeCode: ublTypeCode,
        invoiceSubtype,
        currency,
        icv: nextIcv,
        pih,
        seller: {
          vatNumber: config.sellerVatNumber,
          name: config.sellerNameEn || config.sellerNameAr,
          crNumber: config.crNumber,
          streetName: config.streetName,
          buildingNumber: config.buildingNumber,
          cityName: config.cityName,
          postalZone: config.postalZone,
          districtName: config.districtName,
          countryCode: config.countryCode,
        },
        buyer,
        originalDocumentNumber,
        originalDocumentUuid,
        zatcaReasonCode,
        subtotal,
        discountTotal,
        taxAmount,
        grandTotal,
        lines: ublLines,
      };

      const validation = this.ublService.validateUblAndBrKsa(ublInput);
      if (!validation.valid) {
        throw new BadRequestException({
          message: 'فشل التحقق من قواعد UBL 2.1 / BR-KSA',
          errors: validation.errors,
        });
      }

      const isSandboxMock =
        cert.environment === ZatcaEnvironment.SANDBOX &&
        !this.gatewayService.isLiveHttpEnabled();
      if (!isSandboxMock) {
        this.cryptoService.validateCsidCertificateTrust({
          certificatePemOrBase64: cert.binarySecurityToken || '',
          expectedBinding: {
            vatNumber: config.sellerVatNumber,
            unitSerialNumber: unit.unit_identifier,
          },
        });
      }

      const ublXml = this.ublService.buildUblXml(ublInput);
      const privateKeyPem = this.cryptoService.decryptSecret(
        cert.encryptedPrivateKey,
        cert.privateKeyIv,
        cert.privateKeyAuthTag,
      );
      const xadesResult = this.cryptoService.signZatcaXades({
        ublXml,
        privateKeyPem,
        certificatePemOrBase64: cert.binarySecurityToken ?? undefined,
        signingTimeIso: issueTimestamp,
        allowSelfSignedFallback: isSandboxMock,
      });
      const { invoiceHashBase64, signatureBase64 } = xadesResult;

      const publicKeyDer = Buffer.from(
        cert.publicKeyPem
          .replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, ''),
        'base64',
      ).toString('base64');

      const qrBase64 = this.cryptoService.encodeQrTlv({
        sellerName: config.sellerNameAr,
        vatNumber: config.sellerVatNumber,
        timestamp: issueTimestamp,
        invoiceTotal: grandTotal.toFixed(2),
        vatTotal: taxAmount.toFixed(2),
        invoiceHashBase64,
        ecdsaSignatureBase64: signatureBase64,
        publicKeyBase64: publicKeyDer,
        certificateSignatureBase64:
          invoiceSubtype === ZatcaInvoiceSubtype.SIMPLIFIED_B2C
            ? xadesResult.certificateSignatureBase64
            : undefined,
      });

      const signedXml = this.ublService.injectSignatureAndQr(
        ublXml,
        qrBase64,
        signatureBase64,
        xadesResult,
      );
      const initialComplianceStatus =
        submissionType === SubmissionType.CLEARANCE
          ? ZATCAComplianceStatus.PENDING_CLEARANCE
          : ZATCAComplianceStatus.PENDING_REPORTING;

      const [doc] = await tx
        .insert(zatcaDocuments)
        .values({
          tenantId: context.tenantId,
          legalEntityId: unit.legal_entity_id,
          branchId: unit.branch_id!,
          egsUnitId: unit.id,
          deviceId: cert.deviceId,
          certificateId: cert.id,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          journalEntryId,
          documentNumber: docNumber,
          uuid: docUuid,
          icv: nextIcv,
          pih,
          invoiceHash: invoiceHashBase64,
          invoiceTypeCode: ublTypeCode,
          invoiceSubtype,
          submissionType,
          complianceStatus: initialComplianceStatus,
          issueTimestamp,
          currency,
          subtotal: subtotal.toFixed(4),
          taxAmount: taxAmount.toFixed(4),
          grandTotal: grandTotal.toFixed(4),
          originalDocumentUuid,
          originalDocumentNumber,
          zatcaReasonCode,
          ublXml,
          signedXml,
          qrCodeTlvBase64: qrBase64,
          signatureValue: signatureBase64,
          idempotencyKey: dto.idempotencyKey || null,
        })
        .returning();

      if (!doc) {
        throw new BadRequestException('فشل إنشاء مستند ZATCA');
      }

      // Update EGS unit ICV & lastHash atomically
      await tx
        .update(egsUnits)
        .set({ icvCurrent: nextIcv, lastHash: invoiceHashBase64 })
        .where(eq(egsUnits.id, unit.id));

      // Mirror UUID/Hash back onto ar_invoices if source is AR_INVOICE
      if (dto.sourceType === 'AR_INVOICE') {
        await tx
          .update(arInvoices)
          .set({
            zatcaUuid: docUuid,
            zatcaHash: invoiceHashBase64,
            previousInvoiceHash: pih,
          })
          .where(eq(arInvoices.id, dto.sourceId));
      }

      // Enqueue in transactional outbox
      const [outbox] = await tx
        .insert(zatcaOutboxQueue)
        .values({
          tenantId: context.tenantId,
          legalEntityId: unit.legal_entity_id,
          branchId: unit.branch_id!,
          egsUnitId: unit.id,
          zatcaDocumentId: doc.id,
          submissionType,
          status: ZatcaOutboxStatus.PENDING,
          attemptCount: 0,
          maxAttempts: 5,
          nextRetryAt: new Date(),
          idempotencyKey: dto.idempotencyKey ? `outbox-${dto.idempotencyKey}` : `outbox-${doc.id}`,
        })
        .returning();

      await this.writeZatcaAudit(tx, {
        tenantId: context.tenantId,
        legalEntityId: unit.legal_entity_id,
        egsUnitId: unit.id,
        zatcaDocumentId: doc.id,
        action: 'ZATCA_DOCUMENT_GENERATED_AND_QUEUED',
        actorId: context.userId,
        newStatus: initialComplianceStatus,
        detailsJson: { icv: nextIcv, uuid: docUuid, submissionType, journalEntryId },
      });

      return { document: doc, outbox, idempotentHit: false };
    });
  }

  // =========================================================================
  // 4. Outbox Processing, Retries, Watchdog & Resubmission
  // =========================================================================

  async processOutboxItem(context: TenantContext, outboxId: string, workerId = 'zatca-worker-1') {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const locked = await tx.execute(
        sql`SELECT * FROM zatca_outbox_queue WHERE tenant_id = ${context.tenantId}::uuid AND id = ${outboxId}::uuid FOR UPDATE SKIP LOCKED`,
      );
      const item: any = (locked as any)?.[0];
      if (!item) {
        throw new NotFoundException('عنصر Outbox غير موجود أو قيد المعالجة حالياً');
      }
      if (item.status === ZatcaOutboxStatus.COMPLETED) {
        return { outbox: item, alreadyCompleted: true };
      }

      await this.verifyEntityScope(tx, context, item.legal_entity_id, item.branch_id);

      await tx
        .update(zatcaOutboxQueue)
        .set({ status: ZatcaOutboxStatus.PROCESSING, lockedBy: workerId, lockedAt: new Date(), updatedAt: new Date() })
        .where(eq(zatcaOutboxQueue.id, item.id));

      const [doc] = await tx
        .select()
        .from(zatcaDocuments)
        .where(eq(zatcaDocuments.id, item.zatca_document_id))
        .limit(1);
      const [cert] = await tx
        .select()
        .from(zatcaEgsCertificates)
        .where(eq(zatcaEgsCertificates.id, doc!.certificateId))
        .limit(1);

      const secret = this.cryptoService.decryptSecret(
        cert!.secretTokenEncrypted!,
        cert!.secretTokenIv!,
        cert!.secretTokenAuthTag!,
      );

      let gwRes;
      try {
        gwRes = await this.gatewayService.submitInvoice({
          environment: cert!.environment,
          submissionType: doc!.submissionType,
          binarySecurityToken: cert!.binarySecurityToken!,
          secret,
          invoiceHash: doc!.invoiceHash,
          uuid: doc!.uuid,
          signedXmlBase64: Buffer.from(doc!.signedXml, 'utf8').toString('base64'),
        });
      } catch (err: any) {
        gwRes = {
          ok: false,
          httpStatus: 503,
          status: 'RETRYABLE_ERROR' as const,
          warnings: [],
          errors: [{ code: 'NETWORK_ERROR', message: err?.message || 'Network failure' }],
          retryable: true,
        };
      }

      const nextAttempts = Number(item.attempt_count || 0) + 1;

      if (gwRes.ok) {
        const finalDocStatus =
          gwRes.status === 'CLEARED' ? ZATCAComplianceStatus.CLEARED : ZATCAComplianceStatus.REPORTED;

        const [updatedDoc] = await tx
          .update(zatcaDocuments)
          .set({
            complianceStatus: finalDocStatus,
            zatcaRequestId: gwRes.requestId || null,
            clearedXml: gwRes.clearedXml || null,
            zatcaWarningsJson: gwRes.warnings,
            zatcaErrorsJson: null,
            submittedAt: new Date(),
            clearedOrReportedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(zatcaDocuments.id, doc!.id))
          .returning();

        const [updatedOutbox] = await tx
          .update(zatcaOutboxQueue)
          .set({
            status: ZatcaOutboxStatus.COMPLETED,
            attemptCount: nextAttempts,
            lastHttpStatus: gwRes.httpStatus,
            lockedBy: null,
            lockedAt: null,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(zatcaOutboxQueue.id, item.id))
          .returning();

        await this.writeZatcaAudit(tx, {
          tenantId: context.tenantId,
          legalEntityId: doc!.legalEntityId,
          egsUnitId: doc!.egsUnitId,
          zatcaDocumentId: doc!.id,
          action: 'ZATCA_SUBMISSION_SUCCEEDED',
          actorId: context.userId,
          previousStatus: doc!.complianceStatus,
          newStatus: finalDocStatus,
          detailsJson: { requestId: gwRes.requestId, httpStatus: gwRes.httpStatus },
        });

        return { outbox: updatedOutbox, document: updatedDoc, alreadyCompleted: false };
      }

      // Rejected (non-retryable 4xx) vs Retryable (5xx / network)
      if (!gwRes.retryable) {
        const [updatedDoc] = await tx
          .update(zatcaDocuments)
          .set({
            complianceStatus: ZATCAComplianceStatus.REJECTED,
            zatcaErrorsJson: gwRes.errors,
            zatcaWarningsJson: gwRes.warnings,
            submittedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(zatcaDocuments.id, doc!.id))
          .returning();

        const [updatedOutbox] = await tx
          .update(zatcaOutboxQueue)
          .set({
            status: ZatcaOutboxStatus.DEAD_LETTER,
            attemptCount: nextAttempts,
            lastHttpStatus: gwRes.httpStatus,
            lastErrorCode: gwRes.errors[0]?.code || 'ZATCA_REJECTED',
            lastErrorMessage: gwRes.errors[0]?.message || 'Rejected by ZATCA',
            lockedBy: null,
            lockedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(zatcaOutboxQueue.id, item.id))
          .returning();

        await this.writeZatcaAudit(tx, {
          tenantId: context.tenantId,
          legalEntityId: doc!.legalEntityId,
          egsUnitId: doc!.egsUnitId,
          zatcaDocumentId: doc!.id,
          action: 'ZATCA_SUBMISSION_REJECTED',
          actorId: context.userId,
          previousStatus: doc!.complianceStatus,
          newStatus: ZATCAComplianceStatus.REJECTED,
          detailsJson: { httpStatus: gwRes.httpStatus, errors: gwRes.errors },
        });

        return { outbox: updatedOutbox, document: updatedDoc, alreadyCompleted: false };
      }

      // Retryable error -> exponential backoff or DEAD_LETTER + RECONCILIATION_REQUIRED
      const exhausted = nextAttempts >= Number(item.max_attempts || 5);
      const backoffMs = Math.min(3600_000, Math.pow(2, nextAttempts) * 1000);
      const nextRetryAt = new Date(Date.now() + backoffMs);

      const [updatedOutbox] = await tx
        .update(zatcaOutboxQueue)
        .set({
          status: exhausted ? ZatcaOutboxStatus.DEAD_LETTER : ZatcaOutboxStatus.FAILED_RETRYABLE,
          attemptCount: nextAttempts,
          nextRetryAt,
          lastHttpStatus: gwRes.httpStatus,
          lastErrorCode: gwRes.errors[0]?.code || 'NETWORK_ERROR',
          lastErrorMessage: gwRes.errors[0]?.message || 'Retryable gateway failure',
          lockedBy: null,
          lockedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(zatcaOutboxQueue.id, item.id))
        .returning();

      let updatedDoc: any = doc!;
      if (exhausted) {
        [updatedDoc] = await tx
          .update(zatcaDocuments)
          .set({
            complianceStatus: ZATCAComplianceStatus.RECONCILIATION_REQUIRED,
            zatcaErrorsJson: gwRes.errors,
            updatedAt: new Date(),
          })
          .where(eq(zatcaDocuments.id, doc!.id))
          .returning();
      }

      await this.writeZatcaAudit(tx, {
        tenantId: context.tenantId,
        legalEntityId: doc!.legalEntityId,
        egsUnitId: doc!.egsUnitId,
        zatcaDocumentId: doc!.id,
        action: exhausted ? 'ZATCA_OUTBOX_DEAD_LETTER' : 'ZATCA_SUBMISSION_RETRY_SCHEDULED',
        actorId: context.userId,
        previousStatus: doc!.complianceStatus,
        newStatus: updatedDoc.complianceStatus,
        detailsJson: { attemptCount: nextAttempts, exhausted, errors: gwRes.errors },
      });

      return { outbox: updatedOutbox, document: updatedDoc, alreadyCompleted: false };
    });
  }

  async runOutboxWorkerBatch(context: TenantContext, legalEntityId: string, batchSize = 20) {
    const candidateIds: string[] = await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, legalEntityId);
      const rows = await tx
        .select({ id: zatcaOutboxQueue.id })
        .from(zatcaOutboxQueue)
        .where(
          and(
            eq(zatcaOutboxQueue.tenantId, context.tenantId),
            eq(zatcaOutboxQueue.legalEntityId, legalEntityId),
            inArray(zatcaOutboxQueue.status, [ZatcaOutboxStatus.PENDING, ZatcaOutboxStatus.FAILED_RETRYABLE]),
            lte(zatcaOutboxQueue.nextRetryAt, new Date()),
          ),
        )
        .orderBy(asc(zatcaOutboxQueue.nextRetryAt))
        .limit(batchSize);
      return rows.map((r) => r.id);
    });

    const results: any[] = [];
    for (const id of candidateIds) {
      results.push(await this.processOutboxItem(context, id));
    }
    return { processedCount: results.length, results };
  }

  async runWatchdogRecovery(context: TenantContext, legalEntityId: string, staleMinutes = 5) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, legalEntityId);
      const cutoff = new Date(Date.now() - staleMinutes * 60_000);

      const stuckRows = await tx
        .select()
        .from(zatcaOutboxQueue)
        .where(
          and(
            eq(zatcaOutboxQueue.tenantId, context.tenantId),
            eq(zatcaOutboxQueue.legalEntityId, legalEntityId),
            eq(zatcaOutboxQueue.status, ZatcaOutboxStatus.PROCESSING),
            lte(zatcaOutboxQueue.lockedAt, cutoff),
          ),
        );

      const recovered: any[] = [];
      for (const row of stuckRows) {
        const [upd] = await tx
          .update(zatcaOutboxQueue)
          .set({
            status: ZatcaOutboxStatus.FAILED_RETRYABLE,
            lockedBy: null,
            lockedAt: null,
            nextRetryAt: new Date(),
            lastErrorCode: 'WATCHDOG_TIMEOUT',
            lastErrorMessage: `Recovered stuck PROCESSING job older than ${staleMinutes} minutes`,
            updatedAt: new Date(),
          })
          .where(eq(zatcaOutboxQueue.id, row.id))
          .returning();
        recovered.push(upd);

        await this.writeZatcaAudit(tx, {
          tenantId: context.tenantId,
          legalEntityId,
          egsUnitId: row.egsUnitId,
          zatcaDocumentId: row.zatcaDocumentId,
          action: 'ZATCA_WATCHDOG_RECOVERED',
          actorId: context.userId,
          previousStatus: ZatcaOutboxStatus.PROCESSING,
          newStatus: ZatcaOutboxStatus.FAILED_RETRYABLE,
          detailsJson: { outboxId: row.id, staleMinutes },
        });
      }

      return { recoveredCount: recovered.length, recovered };
    });
  }

  async resubmitDocument(context: TenantContext, zatcaDocumentId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      const [doc] = await tx
        .select()
        .from(zatcaDocuments)
        .where(and(eq(zatcaDocuments.tenantId, context.tenantId), eq(zatcaDocuments.id, zatcaDocumentId)))
        .limit(1);
      if (!doc) throw new NotFoundException('مستند ZATCA غير موجود');
      await this.verifyEntityScope(tx, context, doc.legalEntityId, doc.branchId);

      if (
        doc.complianceStatus === ZATCAComplianceStatus.CLEARED ||
        doc.complianceStatus === ZATCAComplianceStatus.REPORTED
      ) {
        throw new BadRequestException('المستند معتمد/مبلغ بالفعل لدى ZATCA ولا يمكن إعادة إرساله');
      }

      const [outbox] = await tx
        .insert(zatcaOutboxQueue)
        .values({
          tenantId: context.tenantId,
          legalEntityId: doc.legalEntityId,
          branchId: doc.branchId,
          egsUnitId: doc.egsUnitId,
          zatcaDocumentId: doc.id,
          submissionType: doc.submissionType,
          status: ZatcaOutboxStatus.PENDING,
          attemptCount: 0,
          maxAttempts: 5,
          nextRetryAt: new Date(),
          idempotencyKey: `resubmit-${doc.id}-${Date.now()}`,
        })
        .returning();

      if (!outbox) {
        throw new BadRequestException('فشل إعادة جدولة مستند ZATCA');
      }

      const nextStatus =
        doc.submissionType === SubmissionType.CLEARANCE
          ? ZATCAComplianceStatus.PENDING_CLEARANCE
          : ZATCAComplianceStatus.PENDING_REPORTING;

      await tx
        .update(zatcaDocuments)
        .set({ complianceStatus: nextStatus, updatedAt: new Date() })
        .where(eq(zatcaDocuments.id, doc.id));

      await this.writeZatcaAudit(tx, {
        tenantId: context.tenantId,
        legalEntityId: doc.legalEntityId,
        egsUnitId: doc.egsUnitId,
        zatcaDocumentId: doc.id,
        action: 'ZATCA_DOCUMENT_RESUBMITTED',
        actorId: context.userId,
        previousStatus: doc.complianceStatus,
        newStatus: nextStatus,
        detailsJson: { outboxId: outbox.id },
      });

      return outbox;
    });
  }

  // =========================================================================
  // 5. Reports, Reconciliation & Audit Logs (Server-Side Paginated)
  // =========================================================================

  async getZatcaDocuments(
    context: TenantContext,
    params: { legalEntityId: string; status?: string; branchId?: string; page?: number; limit?: number },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, params.legalEntityId, params.branchId);
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const offset = (page - 1) * limit;

      const conds = [
        eq(zatcaDocuments.tenantId, context.tenantId),
        eq(zatcaDocuments.legalEntityId, params.legalEntityId),
      ];
      if (params.branchId) conds.push(eq(zatcaDocuments.branchId, params.branchId));
      if (params.status) conds.push(eq(zatcaDocuments.complianceStatus, params.status));

      const countRows = await tx
        .select({ cnt: sql<number>`count(*)::int` })
        .from(zatcaDocuments)
        .where(and(...conds));
      const total = countRows[0]?.cnt ?? 0;

      const rows = await tx
        .select()
        .from(zatcaDocuments)
        .where(and(...conds))
        .orderBy(desc(zatcaDocuments.createdAt))
        .limit(limit)
        .offset(offset);

      return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async getOutboxQueue(
    context: TenantContext,
    params: { legalEntityId: string; status?: string; page?: number; limit?: number },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, params.legalEntityId);
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const offset = (page - 1) * limit;

      const conds = [
        eq(zatcaOutboxQueue.tenantId, context.tenantId),
        eq(zatcaOutboxQueue.legalEntityId, params.legalEntityId),
      ];
      if (params.status) conds.push(eq(zatcaOutboxQueue.status, params.status));

      const countRows = await tx
        .select({ cnt: sql<number>`count(*)::int` })
        .from(zatcaOutboxQueue)
        .where(and(...conds));
      const total = countRows[0]?.cnt ?? 0;

      const rows = await tx
        .select()
        .from(zatcaOutboxQueue)
        .where(and(...conds))
        .orderBy(desc(zatcaOutboxQueue.createdAt))
        .limit(limit)
        .offset(offset);

      return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async getZatcaErrorReport(
    context: TenantContext,
    params: { legalEntityId: string; page?: number; limit?: number },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, params.legalEntityId);
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const offset = (page - 1) * limit;

      const conds = and(
        eq(zatcaDocuments.tenantId, context.tenantId),
        eq(zatcaDocuments.legalEntityId, params.legalEntityId),
        inArray(zatcaDocuments.complianceStatus, [
          ZATCAComplianceStatus.REJECTED,
          ZATCAComplianceStatus.RECONCILIATION_REQUIRED,
        ]),
      );

      const countRows = await tx
        .select({ cnt: sql<number>`count(*)::int` })
        .from(zatcaDocuments)
        .where(conds);
      const total = countRows[0]?.cnt ?? 0;

      const rows = await tx
        .select()
        .from(zatcaDocuments)
        .where(conds)
        .orderBy(desc(zatcaDocuments.updatedAt))
        .limit(limit)
        .offset(offset);

      return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async getZatcaReconciliationReport(context: TenantContext, legalEntityId: string) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, legalEntityId);

      const statusCounts = await tx
        .select({
          status: zatcaDocuments.complianceStatus,
          cnt: sql<number>`count(*)::int`,
          totalTax: sql<string>`COALESCE(SUM(${zatcaDocuments.taxAmount}), 0)::numeric(14,4)::text`,
          totalGrand: sql<string>`COALESCE(SUM(${zatcaDocuments.grandTotal}), 0)::numeric(14,4)::text`,
        })
        .from(zatcaDocuments)
        .where(
          and(
            eq(zatcaDocuments.tenantId, context.tenantId),
            eq(zatcaDocuments.legalEntityId, legalEntityId),
          ),
        )
        .groupBy(zatcaDocuments.complianceStatus);

      const unlinkedDocs = await tx
        .select({ cnt: sql<number>`count(*)::int` })
        .from(zatcaDocuments)
        .where(
          and(
            eq(zatcaDocuments.tenantId, context.tenantId),
            eq(zatcaDocuments.legalEntityId, legalEntityId),
            sql`${zatcaDocuments.journalEntryId} IS NULL`,
          ),
        );

      const deadLetterOutbox = await tx
        .select({ cnt: sql<number>`count(*)::int` })
        .from(zatcaOutboxQueue)
        .where(
          and(
            eq(zatcaOutboxQueue.tenantId, context.tenantId),
            eq(zatcaOutboxQueue.legalEntityId, legalEntityId),
            eq(zatcaOutboxQueue.status, ZatcaOutboxStatus.DEAD_LETTER),
          ),
        );

      return {
        legalEntityId,
        byStatus: statusCounts,
        unlinkedJournalDocumentsCount: unlinkedDocs[0]?.cnt ?? 0,
        deadLetterQueueCount: deadLetterOutbox[0]?.cnt ?? 0,
      };
    });
  }

  async getZatcaAuditLogs(
    context: TenantContext,
    params: { legalEntityId: string; zatcaDocumentId?: string; page?: number; limit?: number },
  ) {
    return await this.dbService.withTenantContext(context, async (tx) => {
      await this.verifyEntityScope(tx, context, params.legalEntityId);
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const offset = (page - 1) * limit;

      const conds = [
        eq(zatcaAuditLogs.tenantId, context.tenantId),
        eq(zatcaAuditLogs.legalEntityId, params.legalEntityId),
      ];
      if (params.zatcaDocumentId) {
        conds.push(eq(zatcaAuditLogs.zatcaDocumentId, params.zatcaDocumentId));
      }

      const countRows = await tx
        .select({ cnt: sql<number>`count(*)::int` })
        .from(zatcaAuditLogs)
        .where(and(...conds));
      const total = countRows[0]?.cnt ?? 0;

      const rows = await tx
        .select()
        .from(zatcaAuditLogs)
        .where(and(...conds))
        .orderBy(desc(zatcaAuditLogs.createdAt))
        .limit(limit)
        .offset(offset);

      return { data: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }
}
