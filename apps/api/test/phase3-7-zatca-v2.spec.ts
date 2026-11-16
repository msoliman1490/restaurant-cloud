import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import { ZatcaCryptoService } from '../src/modules/zatca/zatca-crypto.service';
import { ZatcaUblService } from '../src/modules/zatca/zatca-ubl.service';
import { ZatcaGatewayService } from '../src/modules/zatca/zatca-gateway.service';
import { ZatcaV2Service } from '../src/modules/zatca/zatca-v2.service';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  JournalType,
  EInvoiceType,
  ZATCAComplianceStatus,
  ZatcaEnvironment,
  ZatcaCertificateStatus,
  ZatcaOutboxStatus,
  ZatcaInvoiceSubtype,
} from '@restaurant-cloud/domain-kernel';
import {
  legalEntities,
  branches,
  devices,
  chartOfAccounts,
  salesOrders,
  orderLines,
  items,
  unitsOfMeasure,
  businessPartners,
  arInvoices,
  arInvoiceLines,
  zatcaDocuments,
  zatcaOutboxQueue,
  zatcaAuditLogs,
  zatcaLegalEntityConfigs,
  zatcaEgsCertificates,
} from '@restaurant-cloud/database';
import { eq, sql } from 'drizzle-orm';

describe(
  'Restaurant Cloud — Phase 3.7: ZATCA V2 Production Readiness',
  { timeout: 120000 },
  () => {
    let dbService: DatabaseService;
    let auditService: AuditService;
    let tenantService: TenantService;
    let postingEngine: PostingEngineService;
    let opsFramework: OperationsFrameworkService;
    let cryptoService: ZatcaCryptoService;
    let ublService: ZatcaUblService;
    let gatewayService: ZatcaGatewayService;
    let zatcaService: ZatcaV2Service;

    let tenantId: string;
    let tenantBId: string;
    let le1Id: string;
    let le2Id: string;
    let branch1Id: string;
    let branch2Id: string;
    let userId: string;

    let ctxAdmin: TenantContext;
    let ctxTenantB: TenantContext;
    let ctxBranch1Only: TenantContext;

    let pos1Id: string;
    let pos2Id: string;
    let posBr2Id: string;
    let egs1Id: string;
    let egs2Id: string;
    let cert1ProdId: string;
    let cert2CompId: string;

    let order1Id: string;
    let order2Id: string;
    let order3Id: string;
    let b2bInvoiceId: string;
    let creditNoteId: string;
    let debitNoteId: string;
    let cashAccId: string;
    let revAccId: string;
    let journal1Id: string;

    beforeAll(async () => {
      const envPath = path.resolve(__dirname, '../../../.env');
      if (fs.existsSync(envPath)) {
        process.loadEnvFile(envPath);
      }
      dbService = new DatabaseService();
      await dbService.onModuleInit();
      auditService = new AuditService(dbService);
      opsFramework = new OperationsFrameworkService(dbService);
      postingEngine = new PostingEngineService(dbService, auditService);
      cryptoService = new ZatcaCryptoService();
      ublService = new ZatcaUblService();
      gatewayService = new ZatcaGatewayService();
      zatcaService = new ZatcaV2Service(
        dbService,
        auditService,
        opsFramework,
        cryptoService,
        ublService,
        gatewayService,
      );
      tenantService = new TenantService(dbService, auditService);

      const suffix = Date.now().toString(36).slice(-6);
      const t1 = await tenantService.onboardTenant({
        code: `p37a-${suffix}`,
        displayName: `Phase 3.7 Alpha ${suffix}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'P37 Alpha Foods Co',
          commercialName: 'P37 Alpha',
          vatNumber: '310000000000103',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BR1',
          name: 'Main Branch',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `p37-admin-${suffix}@test.local`,
          displayName: 'P37 Admin',
          password: 'Password123!Secure',
        },
      } as any);

      tenantId = t1.tenant.id;
      le1Id = t1.legalEntity.id;
      branch1Id = t1.branch.id;
      userId = t1.user.id;

      ctxAdmin = {
        tenantId,
        userId,
        role: 'OWNER',
        scopes: ['*'],
        userScopes: [{ scopeType: 'TENANT', scopeEntityId: tenantId }],
      } as any;

      ctxBranch1Only = {
        tenantId,
        userId,
        role: 'BRANCH_MANAGER',
        scopes: ['zatca.view'],
        userScopes: [{ scopeType: 'BRANCH', scopeEntityId: branch1Id }],
      } as any;

      const t2 = await tenantService.onboardTenant({
        code: `p37b-${suffix}`,
        displayName: `Phase 3.7 Beta ${suffix}`,
        deploymentMode: 'SHARED' as any,
        primaryLocale: 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry: 'RESTAURANT' as any,
        initialLegalEntity: {
          legalName: 'P37 Beta Foods Co',
          commercialName: 'P37 Beta',
          vatNumber: '310000000000203',
          functionalCurrency: 'SAR',
          timezone: 'Asia/Riyadh',
        },
        initialBranch: {
          code: 'BRB1',
          name: 'Beta Branch',
          businessType: 'RESTAURANT' as any,
        },
        initialAdminUser: {
          email: `p37b-admin-${suffix}@test.local`,
          displayName: 'P37B Admin',
          password: 'Password123!Secure',
        },
      } as any);

      tenantBId = t2.tenant.id;
      ctxTenantB = {
        tenantId: tenantBId,
        userId: t2.user.id,
        role: 'OWNER',
        scopes: ['*'],
        userScopes: [{ scopeType: 'TENANT', scopeEntityId: tenantBId }],
      } as any;

      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        // Second Legal Entity in same tenant
        const [le2] = await tx
          .insert(legalEntities)
          .values({
            tenantId,
            legalName: 'P37 Second Legal Entity',
            commercialName: 'P37 Second',
            vatNumber: '310000000000303',
            functionalCurrency: 'SAR',
            timezone: 'Asia/Riyadh',
          })
          .returning();
        le2Id = le2.id;

        // Second Branch in le1Id
        const [b2] = await tx
          .insert(branches)
          .values({
            tenantId,
            legalEntityId: le1Id,
            code: 'BR2',
            name: 'Second Branch',
            businessType: 'RESTAURANT',
          })
          .returning();
        branch2Id = b2.id;

        // POS devices
        const [d1] = await tx
          .insert(devices)
          .values({ tenantId, branchId: branch1Id, deviceCode: `POS1-${suffix}`, name: 'POS 1', deviceType: 'POS' })
          .returning();
        pos1Id = d1.id;

        const [d2] = await tx
          .insert(devices)
          .values({ tenantId, branchId: branch1Id, deviceCode: `POS2-${suffix}`, name: 'POS 2', deviceType: 'POS' })
          .returning();
        pos2Id = d2.id;

        const [d3] = await tx
          .insert(devices)
          .values({ tenantId, branchId: branch2Id, deviceCode: `POSB2-${suffix}`, name: 'POS BR2', deviceType: 'POS' })
          .returning();
        posBr2Id = d3.id;

        // COA & Journal Entry
        const [cashAcc] = await tx
          .insert(chartOfAccounts)
          .values({
            tenantId,
            legalEntityId: le1Id,
            accountCode: '1101',
            name: 'Cash',
            nameAr: 'النقدية',
            accountType: AccountType.ASSET,
            normalBalance: NormalBalance.DEBIT,
            level: 1,
            isPostable: true,
            status: 'ACTIVE',
          })
          .returning();
        cashAccId = cashAcc.id;

        const [revAcc] = await tx
          .insert(chartOfAccounts)
          .values({
            tenantId,
            legalEntityId: le1Id,
            accountCode: '4101',
            name: 'Revenue',
            nameAr: 'الإيرادات',
            accountType: AccountType.REVENUE,
            normalBalance: NormalBalance.CREDIT,
            level: 1,
            isPostable: true,
            status: 'ACTIVE',
          })
          .returning();
        revAccId = revAcc.id;

        const [uom] = await tx
          .insert(unitsOfMeasure)
          .values({ tenantId, code: `EA-${suffix}`, nameAr: 'قطعة', nameEn: 'Each' })
          .returning();

        const [item] = await tx
          .insert(items)
          .values({
            tenantId,
            legalEntityOwnerId: le1Id,
            sku: `SKU-P37-${suffix}`,
            nameAr: 'صحن شاورما',
            nameEn: 'Shawarma Plate',
            baseUomId: uom.id,
          })
          .returning();

        // 3 POS Sales Orders
        const mkOrder = async (num: string, sub: string, tax: string, grand: string) => {
          const [o] = await tx
            .insert(salesOrders)
            .values({
              tenantId,
              legalEntityId: le1Id,
              branchId: branch1Id,
              deviceId: pos1Id,
              orderNumber: num,
              subtotal: sub,
              discountTotal: '0.0000',
              taxTotal: tax,
              grandTotal: grand,
            })
            .returning();
          await tx.insert(orderLines).values({
            tenantId,
            orderId: o.id,
            itemId: item.id,
            uomId: uom.id,
            quantity: '1.0000',
            unitPrice: sub,
            discountAmount: '0.0000',
            taxAmount: tax,
            lineTotal: grand,
          });
          return o.id;
        };

        order1Id = await mkOrder(`ORD-P37-1-${suffix}`, '100.0000', '15.0000', '115.0000');
        order2Id = await mkOrder(`ORD-P37-2-${suffix}`, '200.0000', '30.0000', '230.0000');
        order3Id = await mkOrder(`ORD-P37-3-${suffix}`, '300.0000', '45.0000', '345.0000');

        // B2B Partner & AR Invoices (Standard, Credit Note, Debit Note)
        const [partner] = await tx
          .insert(businessPartners)
          .values({
            tenantId,
            legalEntityId: le1Id,
            partnerNumber: `CUST-P37-${suffix}`,
            partnerType: 'CUSTOMER',
            legalNameAr: 'شركة المشتري التجريبية',
            legalNameEn: 'Buyer Test Co',
            taxIdentificationNumber: '310000000000993',
          })
          .returning();

        const [b2b] = await tx
          .insert(arInvoices)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            partnerId: partner.id,
            invoiceNumber: `INV-B2B-${suffix}`,
            invoiceType: 'TAX_INVOICE',
            dueDate: '2026-12-31',
            subtotal: '1000.0000',
            discountAmount: '0.0000',
            taxableAmount: '1000.0000',
            taxAmount: '150.0000',
            grandTotal: '1150.0000',
            remainingAmount: '1150.0000',
          })
          .returning();
        b2bInvoiceId = b2b.id;

        await tx.insert(arInvoiceLines).values({
          tenantId,
          invoiceId: b2b.id,
          itemId: item.id,
          uomId: uom.id,
          quantity: '10.0000',
          unitPrice: '100.0000',
          taxRate: '0.1500',
          taxAmount: '150.0000',
          lineTotal: '1150.0000',
        });

        const [cn] = await tx
          .insert(arInvoices)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            partnerId: partner.id,
            invoiceNumber: `CN-B2B-${suffix}`,
            invoiceType: 'CREDIT_NOTE',
            originalInvoiceId: b2b.id,
            originalInvoiceNumber: b2b.invoiceNumber,
            originalInvoiceUuid: randomUUID(),
            zatcaReasonCode: 'C01',
            dueDate: '2026-12-31',
            subtotal: '100.0000',
            discountAmount: '0.0000',
            taxableAmount: '100.0000',
            taxAmount: '15.0000',
            grandTotal: '115.0000',
            remainingAmount: '115.0000',
          })
          .returning();
        creditNoteId = cn.id;

        await tx.insert(arInvoiceLines).values({
          tenantId,
          invoiceId: cn.id,
          itemId: item.id,
          uomId: uom.id,
          quantity: '1.0000',
          unitPrice: '100.0000',
          taxRate: '0.1500',
          taxAmount: '15.0000',
          lineTotal: '115.0000',
        });

        const [dn] = await tx
          .insert(arInvoices)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            partnerId: partner.id,
            invoiceNumber: `DN-B2B-${suffix}`,
            invoiceType: 'DEBIT_NOTE',
            originalInvoiceId: b2b.id,
            originalInvoiceNumber: b2b.invoiceNumber,
            originalInvoiceUuid: randomUUID(),
            zatcaReasonCode: 'D01',
            dueDate: '2026-12-31',
            subtotal: '50.0000',
            discountAmount: '0.0000',
            taxableAmount: '50.0000',
            taxAmount: '7.5000',
            grandTotal: '57.5000',
            remainingAmount: '57.5000',
          })
          .returning();
        debitNoteId = dn.id;

        await tx.insert(arInvoiceLines).values({
          tenantId,
          invoiceId: dn.id,
          itemId: item.id,
          uomId: uom.id,
          quantity: '1.0000',
          unitPrice: '50.0000',
          taxRate: '0.1500',
          taxAmount: '7.5000',
          lineTotal: '57.5000',
        });
      });

      // Create linked journal entry for order1 (after outer tx commits)
      const suffix2 = Date.now().toString(36).slice(-5);
      const je = await postingEngine.postEntry(ctxAdmin, {
        legalEntityId: le1Id,
        branchId: branch1Id,
        journalNumber: `JE-P37-${suffix2}`,
        journalType: JournalType.SALES,
        sourceType: 'SALES_ORDER',
        sourceId: order1Id,
        entryDate: new Date(),
        description: 'POS Order 1 Journal',
        lines: [
          { accountId: cashAccId, debit: '115.0000', credit: '0.0000' },
          { accountId: revAccId, debit: '0.0000', credit: '115.0000' },
        ],
      });
      journal1Id = je.id;
    }, 120000);

    afterAll(async () => {
      gatewayService.setTransportAdapter(null);
      await dbService.onModuleDestroy();
    }, 30000);

    it('1. Configures multi-entity ZATCA V2 on Sandbox/Simulation while keeping V1 active & blocking Production', async () => {
      await expect(
        zatcaService.upsertLegalEntityConfig(ctxAdmin, {
          legalEntityId: le1Id,
          environment: ZatcaEnvironment.PRODUCTION,
          sellerVatNumber: '310000000000103',
          sellerNameAr: 'شركة ألفا',
        }),
      ).rejects.toThrow(ForbiddenException);

      const cfg1 = await zatcaService.upsertLegalEntityConfig(ctxAdmin, {
        legalEntityId: le1Id,
        v2Enabled: true,
        environment: ZatcaEnvironment.SANDBOX,
        sellerVatNumber: '310000000000103',
        sellerNameAr: 'شركة ألفا للأغذية',
        sellerNameEn: 'Alpha Foods Co',
        crNumber: '1010123456',
      });
      expect(cfg1.v1Active).toBe(true);
      expect(cfg1.v2Enabled).toBe(true);
      expect(cfg1.environment).toBe(ZatcaEnvironment.SANDBOX);

      const cfg2 = await zatcaService.upsertLegalEntityConfig(ctxAdmin, {
        legalEntityId: le2Id,
        v2Enabled: false,
        environment: ZatcaEnvironment.SIMULATION,
        sellerVatNumber: '310000000000303',
        sellerNameAr: 'شركة بيتا الثانية',
      });
      expect(cfg2.v1Active).toBe(true);
      expect(cfg2.v2Enabled).toBe(false);
    });

    it('2. Registers independent POS EGS units, onboards with OTP, encrypts keys, and issues Production CSID', async () => {
      const suffix = Date.now().toString(36).slice(-5);
      const u1 = await zatcaService.registerEgsUnit(ctxAdmin, {
        legalEntityId: le1Id,
        branchId: branch1Id,
        deviceId: pos1Id,
        unitIdentifier: `EGS-POS1-${suffix}`,
      });
      egs1Id = u1.id;

      const u2 = await zatcaService.registerEgsUnit(ctxAdmin, {
        legalEntityId: le1Id,
        branchId: branch1Id,
        deviceId: pos2Id,
        unitIdentifier: `EGS-POS2-${suffix}`,
      });
      egs2Id = u2.id;

      // Invalid OTP rejected
      await expect(
        zatcaService.onboardEgsWithOtp(ctxAdmin, {
          egsUnitId: egs1Id,
          deviceId: pos1Id,
          otp: '123',
        }),
      ).rejects.toThrow(BadRequestException);

      const comp1 = await zatcaService.onboardEgsWithOtp(ctxAdmin, {
        egsUnitId: egs1Id,
        deviceId: pos1Id,
        otp: '123456',
      });
      expect(comp1.status).toBe(ZatcaCertificateStatus.COMPLIANCE_ACTIVE);
      expect(comp1.otpUsedHash).toBeDefined();
      expect((comp1 as any).encryptedPrivateKey).toBeUndefined();
      expect((comp1 as any).secretTokenEncrypted).toBeUndefined();

      const prod1 = await zatcaService.issueProductionCsid(ctxAdmin, comp1.id);
      expect(prod1.status).toBe(ZatcaCertificateStatus.PRODUCTION_ACTIVE);
      cert1ProdId = prod1.id;

      const comp2 = await zatcaService.onboardEgsWithOtp(ctxAdmin, {
        egsUnitId: egs2Id,
        deviceId: pos2Id,
        otp: '654321',
      });
      cert2CompId = comp2.id;
      expect(comp2.certificateSerial).not.toBe(prod1.certificateSerial);
    });

    it('3. Generates UBL 2.1 documents with monotonic ICV/PIH chain, ECDSA signature, 9-tag QR TLV, and journal link', async () => {
      const res1 = await zatcaService.generateZatcaDocument(ctxAdmin, {
        egsUnitId: egs1Id,
        sourceType: 'SALES_ORDER',
        sourceId: order1Id,
        idempotencyKey: 'zatca-ord1-v1',
      });
      expect(res1.idempotentHit).toBe(false);
      expect(res1.document.icv).toBe(1);
      expect(res1.document.pih).toBe(cryptoService.getGenesisPih());
      expect(res1.document.journalEntryId).toBe(journal1Id);
      expect(res1.document.submissionType).toBe('REPORTING');

      // Verify 9-tag QR TLV
      const qrCheck = cryptoService.verifyQrTlv(res1.document.qrCodeTlvBase64, {
        vatNumber: '310000000000103',
        invoiceTotal: '115.00',
        vatTotal: '15.00',
        invoiceHashBase64: res1.document.invoiceHash,
      });
      expect(qrCheck.valid).toBe(true);
      expect(qrCheck.tagsPresent).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

      // Idempotent retry does not increment ICV
      const retry1 = await zatcaService.generateZatcaDocument(ctxAdmin, {
        egsUnitId: egs1Id,
        sourceType: 'SALES_ORDER',
        sourceId: order1Id,
        idempotencyKey: 'zatca-ord1-v1',
      });
      expect(retry1.idempotentHit).toBe(true);
      expect(retry1.document.icv).toBe(1);

      // Second document on egs1Id chains PIH to doc1.invoiceHash and ICV=2
      const res2 = await zatcaService.generateZatcaDocument(ctxAdmin, {
        egsUnitId: egs1Id,
        sourceType: 'SALES_ORDER',
        sourceId: order2Id,
        idempotencyKey: 'zatca-ord2-v1',
      });
      expect(res2.document.icv).toBe(2);
      expect(res2.document.pih).toBe(res1.document.invoiceHash);

      // Independent POS egs2Id starts at ICV=1 with genesis PIH
      const resPos2 = await zatcaService.generateZatcaDocument(ctxAdmin, {
        egsUnitId: egs2Id,
        sourceType: 'SALES_ORDER',
        sourceId: order3Id,
        idempotencyKey: 'zatca-ord3-pos2-v1',
      });
      expect(resPos2.document.icv).toBe(1);
      expect(resPos2.document.pih).toBe(cryptoService.getGenesisPih());

      // Standard B2B, Credit Note (381), Debit Note (383)
      const b2bRes = await zatcaService.generateZatcaDocument(ctxAdmin, {
        egsUnitId: egs1Id,
        sourceType: 'AR_INVOICE',
        sourceId: b2bInvoiceId,
        invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
      });
      expect(b2bRes.document.submissionType).toBe('CLEARANCE');
      expect(b2bRes.document.invoiceTypeCode).toBe('388');

      const cnRes = await zatcaService.generateZatcaDocument(ctxAdmin, {
        egsUnitId: egs1Id,
        sourceType: 'AR_INVOICE',
        sourceId: creditNoteId,
        invoiceType: EInvoiceType.CREDIT_NOTE,
        invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
      });
      expect(cnRes.document.invoiceTypeCode).toBe('381');
      expect(cnRes.document.ublXml).toContain('<cac:BillingReference>');
      expect(cnRes.document.ublXml).toContain('C01');

      const dnRes = await zatcaService.generateZatcaDocument(ctxAdmin, {
        egsUnitId: egs1Id,
        sourceType: 'AR_INVOICE',
        sourceId: debitNoteId,
        invoiceType: EInvoiceType.DEBIT_NOTE,
        invoiceSubtype: ZatcaInvoiceSubtype.STANDARD_B2B,
      });
      expect(dnRes.document.invoiceTypeCode).toBe('383');
    });

    it('4. Handles submission success, BR-KSA rejection, network outage retries, dead-letter, watchdog, and resubmission', async () => {
      // A. Success batch
      gatewayService.setTransportAdapter(null);
      const batchRes = await zatcaService.runOutboxWorkerBatch(ctxAdmin, le1Id, 10);
      expect(batchRes.processedCount).toBeGreaterThanOrEqual(5);

      const docsAfterSuccess = await zatcaService.getZatcaDocuments(ctxAdmin, {
        legalEntityId: le1Id,
        page: 1,
        limit: 10,
      });
      const clearedOrReported = docsAfterSuccess.data.filter(
        (d: any) =>
          d.complianceStatus === ZATCAComplianceStatus.CLEARED ||
          d.complianceStatus === ZATCAComplianceStatus.REPORTED,
      );
      expect(clearedOrReported.length).toBeGreaterThanOrEqual(5);

      // B. Rejection scenario (422) on a new doc
      let rejectOrderId = '';
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const [o] = await tx
          .insert(salesOrders)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            deviceId: pos1Id,
            orderNumber: `ORD-REJ-${Date.now()}`,
            subtotal: '100.0000',
            discountTotal: '0.0000',
            taxTotal: '15.0000',
            grandTotal: '115.0000',
          })
          .returning();
        const [uom] = await tx.select().from(unitsOfMeasure).where(eq(unitsOfMeasure.tenantId, tenantId)).limit(1);
        const [it] = await tx.select().from(items).where(eq(items.tenantId, tenantId)).limit(1);
        await tx.insert(orderLines).values({
          tenantId,
          orderId: o.id,
          itemId: it!.id,
          uomId: uom!.id,
          quantity: '1.0000',
          unitPrice: '100.0000',
          discountAmount: '0.0000',
          taxAmount: '15.0000',
          lineTotal: '115.0000',
        });
        rejectOrderId = o.id;
      });

      const genRej = await zatcaService.generateZatcaDocument(ctxAdmin, {
        egsUnitId: egs1Id,
        sourceType: 'SALES_ORDER',
        sourceId: rejectOrderId,
      });
      const rejectDocId = genRej.document.id;
      const rejectOutboxId = genRej.outbox!.id;

      gatewayService.setTransportAdapter({
        submitInvoice: async () => ({
          ok: false,
          httpStatus: 422,
          status: 'REJECTED',
          warnings: [],
          errors: [{ code: 'BR-KSA-EN16931', message: 'Simulated ZATCA rejection' }],
          retryable: false,
        }),
      });
      const rejRes = await zatcaService.processOutboxItem(ctxAdmin, rejectOutboxId);
      expect(rejRes.document?.complianceStatus).toBe(ZATCAComplianceStatus.REJECTED);
      expect(rejRes.outbox.status).toBe(ZatcaOutboxStatus.DEAD_LETTER);

      // Error report includes the rejected doc
      const errRep = await zatcaService.getZatcaErrorReport(ctxAdmin, { legalEntityId: le1Id });
      expect(errRep.total).toBeGreaterThanOrEqual(1);

      // C. Resubmit after fixing -> succeeds
      gatewayService.setTransportAdapter(null);
      const resubOutbox = await zatcaService.resubmitDocument(ctxAdmin, rejectDocId);
      const resubProc = await zatcaService.processOutboxItem(ctxAdmin, resubOutbox.id);
      expect(resubProc.document?.complianceStatus).toBe(ZATCAComplianceStatus.REPORTED);

      // D. Network outage -> FAILED_RETRYABLE + Watchdog recovery
      let netOrderId = '';
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        const [o] = await tx
          .insert(salesOrders)
          .values({
            tenantId,
            legalEntityId: le1Id,
            branchId: branch1Id,
            deviceId: pos1Id,
            orderNumber: `ORD-NET-${Date.now()}`,
            subtotal: '100.0000',
            discountTotal: '0.0000',
            taxTotal: '15.0000',
            grandTotal: '115.0000',
          })
          .returning();
        const [uom] = await tx.select().from(unitsOfMeasure).where(eq(unitsOfMeasure.tenantId, tenantId)).limit(1);
        const [it] = await tx.select().from(items).where(eq(items.tenantId, tenantId)).limit(1);
        await tx.insert(orderLines).values({
          tenantId,
          orderId: o.id,
          itemId: it!.id,
          uomId: uom!.id,
          quantity: '1.0000',
          unitPrice: '100.0000',
          discountAmount: '0.0000',
          taxAmount: '15.0000',
          lineTotal: '115.0000',
        });
        netOrderId = o.id;
      });
      const genNet = await zatcaService.generateZatcaDocument(ctxAdmin, {
        egsUnitId: egs1Id,
        sourceType: 'SALES_ORDER',
        sourceId: netOrderId,
      });
      const netOutboxId = genNet.outbox!.id;

      gatewayService.setTransportAdapter({
        submitInvoice: async () => {
          throw new Error('ETIMEDOUT');
        },
      });
      const netRes = await zatcaService.processOutboxItem(ctxAdmin, netOutboxId);
      expect(netRes.outbox.status).toBe(ZatcaOutboxStatus.FAILED_RETRYABLE);
      expect(netRes.outbox.attemptCount).toBe(1);

      // Simulate stuck PROCESSING item and recover via Watchdog
      await dbService.withTenantContext(ctxAdmin, async (tx) => {
        await tx
          .update(zatcaOutboxQueue)
          .set({
            status: ZatcaOutboxStatus.PROCESSING,
            lockedBy: 'crashed-worker',
            lockedAt: new Date(Date.now() - 15 * 60_000),
          })
          .where(eq(zatcaOutboxQueue.id, netOutboxId));
      });
      const wdRes = await zatcaService.runWatchdogRecovery(ctxAdmin, le1Id, 5);
      expect(wdRes.recoveredCount).toBe(1);

      gatewayService.setTransportAdapter(null);
      const recoveredProc = await zatcaService.processOutboxItem(ctxAdmin, netOutboxId);
      expect(recoveredProc.outbox.status).toBe(ZatcaOutboxStatus.COMPLETED);
    });

    it('5. Enforces Tenant, LegalEntity, Branch/POS isolation, RLS, and immutable zatca_audit_logs', async () => {
      // Cross-tenant isolation
      await expect(
        zatcaService.getLegalEntityConfig(ctxTenantB, le1Id),
      ).rejects.toThrow(NotFoundException);

      // Branch isolation: branch1 user cannot register EGS unit in branch2
      await expect(
        zatcaService.registerEgsUnit(ctxBranch1Only, {
          legalEntityId: le1Id,
          branchId: branch2Id,
          deviceId: posBr2Id,
          unitIdentifier: `EGS-BR2-BLOCKED-${Date.now()}`,
        }),
      ).rejects.toThrow(ForbiddenException);

      // Direct RLS isolation across all 5 tables
      await dbService.withTenantContext(ctxTenantB, async (tx) => {
        expect((await tx.select().from(zatcaLegalEntityConfigs).where(eq(zatcaLegalEntityConfigs.legalEntityId, le1Id))).length).toBe(0);
        expect((await tx.select().from(zatcaEgsCertificates).where(eq(zatcaEgsCertificates.legalEntityId, le1Id))).length).toBe(0);
        expect((await tx.select().from(zatcaDocuments).where(eq(zatcaDocuments.legalEntityId, le1Id))).length).toBe(0);
        expect((await tx.select().from(zatcaOutboxQueue).where(eq(zatcaOutboxQueue.legalEntityId, le1Id))).length).toBe(0);
        expect((await tx.select().from(zatcaAuditLogs).where(eq(zatcaAuditLogs.legalEntityId, le1Id))).length).toBe(0);
      });

      // Immutable zatca_audit_logs for rc_app_user
      await expect(
        dbService.withTenantContext(ctxAdmin, async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE rc_app_user`);
          await tx
            .update(zatcaAuditLogs)
            .set({ action: 'TAMPERED' })
            .where(eq(zatcaAuditLogs.legalEntityId, le1Id));
        }),
      ).rejects.toThrow();

      // Reconciliation report & audit log pagination
      const recon = await zatcaService.getZatcaReconciliationReport(ctxAdmin, le1Id);
      expect(recon.deadLetterQueueCount).toBe(1);
      const logs = await zatcaService.getZatcaAuditLogs(ctxAdmin, {
        legalEntityId: le1Id,
        page: 1,
        limit: 5,
      });
      expect(logs.total).toBeGreaterThanOrEqual(5);

      // Ensure no private keys, secrets, or plaintext OTP appear in audit logs
      const logsJson = JSON.stringify(logs.data);
      expect(logsJson).not.toContain('BEGIN EC PRIVATE KEY');
      expect(logsJson).not.toContain('BEGIN PRIVATE KEY');
      expect(logsJson).not.toContain('123456');
    });

    it('6. Runs 4-type Compliance Checks, verifies real HTTP transport to ZATCA Simulation & timeout handling', async () => {
      // A. Run 4-type compliance checks (Standard, Simplified, Credit Note, Debit Note)
      const compCheck = await zatcaService.runComplianceChecks(ctxAdmin, {
        egsUnitId: egs2Id,
        certificateId: cert2CompId,
      });
      expect(compCheck.allPassed).toBe(true);
      expect(compCheck.results.map((r: any) => r.scenario)).toEqual([
        'STANDARD_TAX_INVOICE',
        'SIMPLIFIED_TAX_INVOICE',
        'CREDIT_NOTE',
        'DEBIT_NOTE',
      ]);

      // B. Production URL strictly blocked
      expect(() => gatewayService.getBaseUrl(ZatcaEnvironment.PRODUCTION)).toThrow(ForbiddenException);

      // C. Real HTTP timeout handling (on SANDBOX; SIMULATION strictly rejects non-CSID tokens)
      const timeoutRes = await gatewayService.submitInvoice({
        environment: ZatcaEnvironment.SANDBOX,
        submissionType: 'REPORTING',
        binarySecurityToken: 'test',
        secret: 'test',
        invoiceHash: 'test',
        uuid: randomUUID(),
        signedXmlBase64: Buffer.from('<Invoice/>').toString('base64'),
        forceLiveHttp: true,
        timeoutMs: 1,
      });
      expect(timeoutRes.ok).toBe(false);
      expect(timeoutRes.retryable).toBe(true);
      expect(timeoutRes.httpStatus).toBe(504);

      // D. Real HTTPS probe against ZATCA Simulation /compliance using our DER PKCS#10 CSR
      const kp = cryptoService.generateEcdsaKeyPair();
      const csrPem = cryptoService.buildZatcaCsrPem({
        commonName: '310000000000103',
        serialNumber: '1-RC|2-POS1|3-00000001',
        organizationIdentifier: '310000000000103',
        organizationUnitName: 'Riyadh Branch',
        organizationName: 'Alpha Foods Co',
        countryName: 'SA',
        invoiceType: '1100',
        locationAddress: 'Riyadh',
        industryBusinessCategory: 'Food & Beverage',
        publicKeyDerBase64: kp.publicKeyDerBase64,
        privateKeyPem: kp.privateKeyPem,
        environment: ZatcaEnvironment.SIMULATION,
      });

      let liveError: any = null;
      try {
        await gatewayService.requestComplianceCsid({
          environment: ZatcaEnvironment.SIMULATION,
          csrPem,
          otp: '000000',
          unitIdentifier: 'LIVE-PROBE',
          forceLiveHttp: true,
          timeoutMs: 12000,
        });
      } catch (err: any) {
        liveError = err;
      }
      // Without a portal-issued OTP, ZATCA Simulation responds with HTTP 400/401
      expect(liveError).not.toBeNull();
      const resp = liveError?.getResponse?.() || {};
      expect([400, 401]).toContain(resp.httpStatus);
      // Verify ZATCA accepted the CSR format (i.e. did NOT reject with Invalid-CSR)
      expect(resp.zatcaResponse?.errorCategory).not.toBe('Invalid-CSR');
    });
  },
);
