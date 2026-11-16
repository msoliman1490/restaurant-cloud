import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { DatabaseService } from '../src/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { TenantService } from '../src/modules/tenant/tenant.service';
import { PostingEngineService } from '../src/modules/accounting/posting-engine.service';
import { AccountingService } from '../src/modules/accounting/accounting.service';
import { FinancialResourcesService } from '../src/modules/accounting/financial-resources.service';
import { OperationsFrameworkService } from '../src/common/operations/operations-framework.service';
import { ProductionService } from '../src/modules/production/production.service';
import { SalesService } from '../src/modules/sales/sales.service';
import {
  TenantContext,
  AccountType,
  NormalBalance,
  DefaultAccountMappingKey,
  OrderStatus,
  OrderType,
  OrderChannel,
  PaymentMethod,
  RecipeStatus,
  MovementType,
  MovementDirection,
} from '@restaurant-cloud/domain-kernel';
import {
  salesOrders,
  payments,
  orderLines,
  inventoryBalances,
  inventoryMovements,
  cashVaults,
  vaultTransactions,
  journalEntries,
  journalLines,
  items,
  unitsOfMeasure,
  warehouses,
  recipes,
  recipeIngredients,
  businessPartners,
  partnerRoles,
  partnerBalances,
  devices,
} from '@restaurant-cloud/database';
import { eq, and } from 'drizzle-orm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('Restaurant Cloud — Phase 3.4A: POS Sales, Multi-Tender, Returns & COGS Integration Spec', { timeout: 90000 }, () => {
  let dbService: DatabaseService;
  let auditService: AuditService;
  let tenantService: TenantService;
  let postingEngine: PostingEngineService;
  let accountingService: AccountingService;
  let financialResourcesService: FinancialResourcesService;
  let opsFramework: OperationsFrameworkService;
  let productionService: ProductionService;
  let salesService: SalesService;

  let tenantId: string;
  let adminUserId: string;
  let legalEntity1Id: string;
  let legalEntity2Id: string;
  let branch1Id: string;
  let warehouse1Id: string;
  let device1Id: string;
  let vault1Id: string;
  let vaultAccountId: string;

  let branch2Id: string;
  let device2Id: string;
  let branchLE2Id: string;
  let warehouseLE2Id: string;
  let deviceLE2Id: string;
  let customerPartnerId: string;

  let uomKgId: string;
  let uomPcsId: string;
  let burgerItemId: string;
  let pattyItemId: string;

  let sysCtx: TenantContext;
  const tenantCode = `p34a-${Date.now().toString(36).slice(-6)}`;

  beforeAll(async () => {
    const envPath = path.resolve(__dirname, '../../../.env');
    if (fs.existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }

    dbService = new DatabaseService();
    await dbService.onModuleInit();

    auditService = new AuditService(dbService);
    tenantService = new TenantService(dbService, auditService);
    postingEngine = new PostingEngineService(dbService, auditService);
    opsFramework = new OperationsFrameworkService(dbService);
    accountingService = new AccountingService(dbService, auditService, postingEngine, opsFramework);
    financialResourcesService = new FinancialResourcesService(dbService, auditService, opsFramework);
    productionService = new ProductionService(dbService, auditService);
    salesService = new SalesService(
      dbService,
      auditService,
      productionService,
      accountingService,
      postingEngine,
      opsFramework
    );

    // 1. Onboard Tenant
    const tenantResult = await tenantService.onboardTenant({
      code: tenantCode,
      displayName: `منشأة مبيعات نقاط البيع ${tenantCode}`,
      deploymentMode: 'SHARED' as any,
      primaryLocale: 'ar-SA',
      timezone: 'Asia/Riyadh',
      primaryIndustry: 'RESTAURANT' as any,
      initialLegalEntity: {
        legalName: 'شركة تشغيل المطاعم المتقدمة ذ.م.م',
        commercialName: 'Advanced POS Operating LLC',
        vatNumber: '310987654300003',
        functionalCurrency: 'SAR',
        timezone: 'Asia/Riyadh',
      },
      initialBranch: {
        code: 'BR-POS-01',
        name: 'فرع العليا الرئيسي',
        businessType: 'RESTAURANT' as any,
      },
      initialAdminUser: {
        email: `admin-${tenantCode}@restaurant-cloud.test`,
        displayName: 'مدير العمليات ونقاط البيع',
        password: 'Password123!Secure',
      },
    });

    tenantId = tenantResult.tenant.id;
    adminUserId = tenantResult.user.id;
    legalEntity1Id = tenantResult.legalEntity.id;
    branch1Id = tenantResult.branch.id;

    sysCtx = {
      tenantId,
      userId: adminUserId,
      email: `admin-${tenantCode}@restaurant-cloud.test`,
      role: 'SUPER_ADMIN',
      scopes: ['*'],
    };

    // 2. Onboard Second Legal Entity for multi-company isolation tests
    const le2 = await tenantService.createLegalEntity(sysCtx, {
      legalName: 'شركة المطاعم الشقيقة ذ.م.م',
      commercialName: 'Sister Entity LLC',
      vatNumber: '310888888800003',
      functionalCurrency: 'SAR',
      timezone: 'Asia/Riyadh',
    });
    legalEntity2Id = le2.id;

    // 3. Create Open Fiscal Period for Legal Entity 1
    const currentYear = new Date().getFullYear();
    await accountingService.createFiscalPeriod(sysCtx, {
      legalEntityId: legalEntity1Id,
      periodName: `FY-${currentYear}`,
      startDate: `${currentYear}-01-01T00:00:00.000Z`,
      endDate: `${currentYear}-12-31T23:59:59.000Z`,
    });

    // 4. Create Standard COA Accounts for Legal Entity 1
    const salesAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '411000',
      name: 'إيراد مبيعات الأطعمة والمشروبات',
      accountType: AccountType.REVENUE,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });

    const vatAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '211200',
      name: 'ضريبة القيمة المضافة المستحقة (مخرجات)',
      accountType: AccountType.LIABILITY,
      normalBalance: NormalBalance.CREDIT,
      isPostable: true,
    });

    const cogsAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '511000',
      name: 'تكلفة البضاعة المباعة (أغذية ومشروبات)',
      accountType: AccountType.COGS,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });

    const invAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '112000',
      name: 'مخزون المواد الغذائية والمكونات',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });

    const vaultAcc = await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '111100',
      name: 'نقدية الصندوق والخزينة المركزية',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });
    vaultAccountId = vaultAcc.id;

    await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '111300',
      name: 'وسيط مدفوعات شبكة مدى (Mada Clearing)',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });

    await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '111400',
      name: 'وسيط بطاقات الائتمان (Visa/Mastercard Clearing)',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });

    await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '111500',
      name: 'وسيط أبل باي (Apple Pay Clearing)',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });

    await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '113200',
      name: 'مدينو منصات التوصيل (Aggregator Receivable)',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });

    await accountingService.createAccount(sysCtx, {
      legalEntityId: legalEntity1Id,
      accountCode: '113100',
      name: 'العملاء والذمم المدينة (Accounts Receivable)',
      accountType: AccountType.ASSET,
      normalBalance: NormalBalance.DEBIT,
      isPostable: true,
    });

    // 5. Create Cash Vault & POS Device linked to it
    const vault = await financialResourcesService.createCashVault(sysCtx, {
      legalEntityId: legalEntity1Id,
      branchId: branch1Id,
      code: `VLT-${Date.now().toString().slice(-4)}`,
      nameAr: 'خزينة كاشير 1 فرع العليا',
      accountId: vaultAccountId,
    });
    vault1Id = vault.id;

    // Set initial vault balance to 500.0000
    await dbService.withTenantContext(sysCtx, async (tx) => {
      await tx
        .update(cashVaults)
        .set({ balance: '500.0000' })
        .where(eq(cashVaults.id, vault1Id));
    });

    const dev = await financialResourcesService.createPosDevice(sysCtx, {
      legalEntityId: legalEntity1Id,
      branchId: branch1Id,
      deviceCode: `POS-${Date.now().toString().slice(-4)}`,
      name: 'جهاز كاشير نقاط البيع الرئيسي',
      deviceType: 'POS',
      cashVaultId: vault1Id,
    });
    device1Id = dev.id;

    // Branch 2 in Legal Entity 1
    const b2 = await tenantService.createBranch(sysCtx, {
      legalEntityId: legalEntity1Id,
      code: `BR-SUL-${Date.now().toString().slice(-4)}`,
      name: 'فرع السليمانية',
      businessType: 'RESTAURANT' as any,
    });
    branch2Id = b2.id;

    const dev2 = await financialResourcesService.createPosDevice(sysCtx, {
      legalEntityId: legalEntity1Id,
      branchId: branch2Id,
      deviceCode: `POS-BR2-${Date.now().toString().slice(-4)}`,
      name: 'جهاز كاشير فرع السليمانية',
      deviceType: 'POS',
    });
    device2Id = dev2.id;

    // Branch in Legal Entity 2
    const bLE2 = await tenantService.createBranch(sysCtx, {
      legalEntityId: legalEntity2Id,
      code: `BR-LE2-${Date.now().toString().slice(-4)}`,
      name: 'فرع الشركة الشقيقة',
      businessType: 'RESTAURANT' as any,
    });
    branchLE2Id = bLE2.id;

    // Device in Legal Entity 2
    const dLE2 = await financialResourcesService.createPosDevice(sysCtx, {
      legalEntityId: legalEntity2Id,
      branchId: branchLE2Id,
      deviceCode: `POS-LE2-${Date.now().toString().slice(-4)}`,
      name: 'جهاز الشركة الشقيقة',
      deviceType: 'POS',
    });
    deviceLE2Id = dLE2.id;

    // 6. Create UOMs, Warehouse, Items and Recipe BOM
    await dbService.withTenantContext(sysCtx, async (tx) => {
      // Warehouse 1 in Legal Entity 1
      const [wh] = await tx
        .insert(warehouses)
        .values({
          tenantId,
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          code: `WH-POS-${Date.now().toString().slice(-4)}`,
          name: 'مستودع تشغيل فرع العليا',
          type: 'STORAGE',
        })
        .returning();
      warehouse1Id = wh.id;

      // Warehouse in Legal Entity 2 (for cross-entity rejection tests)
      const [whLE2] = await tx
        .insert(warehouses)
        .values({
          tenantId,
          legalEntityId: legalEntity2Id,
          branchId: branchLE2Id,
          code: `WH-LE2-${Date.now().toString().slice(-4)}`,
          name: 'مستودع الشركة الشقيقة',
          type: 'STORAGE',
        })
        .returning();
      warehouseLE2Id = whLE2.id;

      // Customer Business Partner in Legal Entity 1
      const [cust] = await tx
        .insert(businessPartners)
        .values({
          tenantId,
          partnerNumber: `CUST-${Date.now().toString().slice(-6)}`,
          partnerType: 'CORPORATE',
          legalNameAr: 'شركة كبار العملاء للتموين والإعاشة',
          tradeNameAr: 'VIP Catering LLC',
          taxIdentificationNumber: '310998877112233',
          primaryEmail: 'orders@vipcatering.sa',
          primaryPhone: '0509988776',
        })
        .returning();
      customerPartnerId = cust.id;

      await tx.insert(partnerRoles).values({
        tenantId,
        partnerId: cust.id,
        roleType: 'CUSTOMER',
      });

      // UOMs
      const [uKg] = await tx
        .insert(unitsOfMeasure)
        .values({
          tenantId,
          code: `KG-${Date.now().toString().slice(-4)}`,
          nameAr: 'كيلوجرام',
          nameEn: 'Kilogram',
          category: 'MASS',
          isBase: true,
        })
        .returning();
      uomKgId = uKg.id;

      const [uPcs] = await tx
        .insert(unitsOfMeasure)
        .values({
          tenantId,
          code: `PCS-${Date.now().toString().slice(-4)}`,
          nameAr: 'حبة',
          nameEn: 'Piece',
          category: 'UNIT',
          isBase: true,
        })
        .returning();
      uomPcsId = uPcs.id;

      // Raw Material: Beef Patty (unit cost = 10.0000)
      const [patty] = await tx
        .insert(items)
        .values({
          tenantId,
          legalEntityOwnerId: legalEntity1Id,
          sku: `RAW-PATTY-${Date.now().toString().slice(-4)}`,
          nameAr: 'شريحة لحم برجر بقري 150جم',
          nameEn: 'Beef Patty 150g',
          baseUomId: uomPcsId,
          defaultCost: '10.0000',
        })
        .returning();
      pattyItemId = patty.id;

      // Output Item: Classic Burger
      const [burger] = await tx
        .insert(items)
        .values({
          tenantId,
          legalEntityOwnerId: legalEntity1Id,
          sku: `MENU-BURGER-${Date.now().toString().slice(-4)}`,
          nameAr: 'وجبة كلاسيك برجر',
          nameEn: 'Classic Burger Meal',
          baseUomId: uomPcsId,
          defaultCost: '10.0000',
        })
        .returning();
      burgerItemId = burger.id;

      // Recipe BOM: 1 Classic Burger consumes 1 Beef Patty
      const [rec] = await tx
        .insert(recipes)
        .values({
          tenantId,
          legalEntityId: legalEntity1Id,
          outputItemId: burgerItemId,
          recipeCode: `RCP-BURGER-${Date.now().toString().slice(-4)}`,
          yieldQuantity: '1.0000',
          yieldUomId: uomPcsId,
          status: RecipeStatus.ACTIVE,
          isCurrent: true,
        })
        .returning();

      await tx.insert(recipeIngredients).values({
        recipeId: rec.id,
        ingredientItemId: pattyItemId,
        quantity: '1.0000',
        uomId: uomPcsId,
        wastePercentage: '0.0000',
      });

      // Seed initial stock of 100 Patties in Warehouse 1
      await tx.insert(inventoryBalances).values({
        tenantId,
        legalEntityOwnerId: legalEntity1Id,
        warehouseId: warehouse1Id,
        itemId: pattyItemId,
        onHandQty: '100.0000',
        allocatedQty: '0.0000',
      });
    });
  }, 90000);

  afterAll(async () => {
    if (dbService) {
      await dbService.onModuleDestroy();
    }
  }, 30000);

  // =========================================================================
  // 1. Cash Sales with Recipe Consumption & Synchronized COGS/Inventory
  // =========================================================================
  describe('1. Cash Sales with Recipe Consumption & Synchronized COGS/Inventory', () => {
    it('1.1 should create sales order, consume recipe stock, update vault, and post balanced GL entries', async () => {
      const orderNumber = `ORD-CSH-${Date.now().toString().slice(-6)}`;

      const orderResult = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        warehouseId: warehouse1Id,
        orderNumber,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '2.0000',
            unitPrice: '30.0000', // 2 * 30 = 60 SAR subtotal + 9 SAR VAT (15%) = 69 SAR grand total
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.CASH,
            amount: '69.0000',
          },
        ],
      });

      expect(orderResult.id).toBeDefined();
      expect(orderResult.status).toBe(OrderStatus.PAID);
      expect(orderResult.subtotal).toBe('60.0000');
      expect(orderResult.taxTotal).toBe('9.0000');
      expect(orderResult.grandTotal).toBe('69.0000');
      expect(orderResult.totalConsumedCost).toBe('20.0000'); // 2 patties * 10 SAR = 20 SAR

      // 1. Verify Stock Deduction (100 - 2 = 98)
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.warehouseId, warehouse1Id),
              eq(inventoryBalances.itemId, pattyItemId)
            )
          );
        expect(bal).toBeDefined();
        expect(parseFloat(bal.onHandQty)).toBe(98);
      });

      // 2. Verify Linked Cash Vault updated (500 + 69 = 569)
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [vault] = await tx.select().from(cashVaults).where(eq(cashVaults.id, vault1Id));
        expect(parseFloat(vault.balance)).toBe(569);

        const [txLog] = await tx
          .select()
          .from(vaultTransactions)
          .where(
            and(
              eq(vaultTransactions.vaultId, vault1Id),
              eq(vaultTransactions.sourceDocumentId, orderResult.id)
            )
          );
        expect(txLog).toBeDefined();
        expect(txLog.transactionType).toBe('DEPOSIT');
        expect(parseFloat(txLog.amount)).toBe(69);
      });

      // 3. Verify Journal Entry
      const jv = orderResult.journalEntry;
      expect(jv).toBeDefined();
      expect(jv.journalType).toBe('SALES');
      expect(jv.lines.length).toBe(5); // Cash Vault, Sales Revenue, Output VAT, COGS, Inventory

      const debitLines = jv.lines.filter((l: any) => parseFloat(l.debit) > 0);
      const creditLines = jv.lines.filter((l: any) => parseFloat(l.credit) > 0);

      const totalDebit = debitLines.reduce((acc: number, l: any) => acc + parseFloat(l.debit), 0);
      const totalCredit = creditLines.reduce((acc: number, l: any) => acc + parseFloat(l.credit), 0);

      // Debits (69 Cash + 20 COGS = 89) == Credits (60 Sales + 9 VAT + 20 Inventory = 89)
      expect(totalDebit).toBeCloseTo(89.0, 4);
      expect(totalCredit).toBeCloseTo(89.0, 4);
    });
  });

  // =========================================================================
  // 2. Multi-Tender & Split Payments (Cash + Mada + Apple Pay)
  // =========================================================================
  describe('2. Multi-Tender & Split Payment Routing', () => {
    it('2.1 should route each payment tender to its dedicated clearing account in balanced GL entry', async () => {
      const orderNumber = `ORD-SPLIT-${Date.now().toString().slice(-6)}`;

      // 100 SAR subtotal + 15 SAR VAT = 115 SAR grand total
      const orderResult = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        orderNumber,
        orderType: OrderType.DINE_IN,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '3.3333',
            unitPrice: '30.0003',
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.CASH,
            amount: '15.0000',
          },
          {
            paymentMethod: PaymentMethod.MADA,
            amount: '50.0000',
          },
          {
            paymentMethod: PaymentMethod.APPLE_PAY,
            amount: '50.0000',
          },
        ],
      });

      expect(orderResult.id).toBeDefined();
      const jv = orderResult.journalEntry;
      expect(jv).toBeDefined();

      // Check lines contain separate debits for Cash, Mada, Apple Pay
      const lines = jv.lines;
      const cashLine = lines.find((l: any) => parseFloat(l.debit) === 15);
      const madaLine = lines.find((l: any) => parseFloat(l.debit) === 50 && l.description?.includes('MADA'));
      const appleLine = lines.find((l: any) => parseFloat(l.debit) === 50 && l.description?.includes('APPLE_PAY'));

      expect(cashLine).toBeDefined();
      expect(madaLine).toBeDefined();
      expect(appleLine).toBeDefined();
    });
  });

  // =========================================================================
  // 3. Delivery Aggregator Channel Integration (Receivables)
  // =========================================================================
  describe('3. Delivery Aggregators Channel Integration', () => {
    it('3.1 should route delivery aggregator orders to AGGREGATOR_RECEIVABLE account', async () => {
      const orderNumber = `ORD-AGG-${Date.now().toString().slice(-6)}`;

      const orderResult = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        orderNumber,
        orderType: OrderType.DELIVERY,
        channel: OrderChannel.AGGREGATOR,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '40.0000', // 40 subtotal + 6 VAT = 46 grand total
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: 'HUNGERSTATION' as any,
            amount: '46.0000',
          },
        ],
      });

      expect(orderResult.id).toBeDefined();
      const jv = orderResult.journalEntry;

      // Receivable line must exist with 46 SAR debit
      const receivableLine = jv.lines.find((l: any) => parseFloat(l.debit) === 46.0);
      expect(receivableLine).toBeDefined();
      expect(receivableLine.description).toContain('HUNGERSTATION');
    });
  });

  // =========================================================================
  // 4. Partial Payment / On Account (Unpaid Receivables Routing)
  // =========================================================================
  describe('4. Partial Payment / On Account (Unpaid Receivables)', () => {
    it('4.1 should route unpaid balance to ACCOUNTS_RECEIVABLE and set CONFIRMED status', async () => {
      const orderNumber = `ORD-ONACC-${Date.now().toString().slice(-6)}`;

      // 100 subtotal + 15 tax = 115 grand total. Paid 40, unpaid 75.
      const orderResult = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        orderNumber,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '100.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.MADA,
            amount: '40.0000',
          },
        ],
      });

      expect(orderResult.status).toBe(OrderStatus.CONFIRMED);

      const jv = orderResult.journalEntry;
      const madaDebit = jv.lines.find((l: any) => parseFloat(l.debit) === 40);
      const arDebit = jv.lines.find((l: any) => parseFloat(l.debit) === 75);

      expect(madaDebit).toBeDefined();
      expect(arDebit).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Sales Returns with Restocking and Reversing GL Entries
  // =========================================================================
  describe('5. Sales Returns with Restocking & COGS Reversal', () => {
    it('5.1 should refund order, reverse sales/VAT, restore inventory and reverse COGS when restockInventory = true', async () => {
      const orderNumber = `ORD-REF-${Date.now().toString().slice(-6)}`;

      // Initial sale: 2 burgers @ 30 SAR = 60 + 9 tax = 69 SAR
      const sale = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        warehouseId: warehouse1Id,
        orderNumber,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '2.0000',
            unitPrice: '30.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.CASH,
            amount: '69.0000',
          },
        ],
      });

      // Verify stock before refund: (initial was 98 before test 1.1, then -2 in test 1.1 = 98, now -2 = 96)
      let stockBeforeRefund: number;
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.warehouseId, warehouse1Id),
              eq(inventoryBalances.itemId, pattyItemId)
            )
          );
        stockBeforeRefund = parseFloat(bal.onHandQty);
      });

      // Refund full 69 SAR with restockInventory = true
      const refundResult = await salesService.refundSalesOrder(sysCtx, sale.id, {
        refundAmount: '69.0000',
        reason: 'Customer changed mind - packaged sealed',
        approvedBy: adminUserId,
        restockInventory: true,
      });

      expect(refundResult.status).toBe(OrderStatus.REFUNDED);

      // Verify stock restored by +2
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.warehouseId, warehouse1Id),
              eq(inventoryBalances.itemId, pattyItemId)
            )
          );
        expect(parseFloat(bal.onHandQty)).toBe(stockBeforeRefund + 2);
      });

      // Verify refund journal entry reverses revenue, tax, cash and COGS
      const refundJV = refundResult.refundJournal;
      expect(refundJV).toBeDefined();

      const debitSales = refundJV.lines.find((l: any) => parseFloat(l.debit) === 60);
      const debitVat = refundJV.lines.find((l: any) => parseFloat(l.debit) === 9);
      const creditCash = refundJV.lines.find((l: any) => parseFloat(l.credit) === 69);
      const debitInventory = refundJV.lines.find((l: any) => parseFloat(l.debit) === 20);
      const creditCogs = refundJV.lines.find((l: any) => parseFloat(l.credit) === 20);

      expect(debitSales).toBeDefined();
      expect(debitVat).toBeDefined();
      expect(creditCash).toBeDefined();
      expect(debitInventory).toBeDefined();
      expect(creditCogs).toBeDefined();
    });
  });

  // =========================================================================
  // 6. Void Sales Orders with Reversing Journal
  // =========================================================================
  describe('6. Void Sales Orders Reversal', () => {
    it('6.1 should mark order CANCELLED, restore inventory and post full reversing journal entry when cancelled before prep (restockInventory = true)', async () => {
      const orderNumber = `ORD-VOID-${Date.now().toString().slice(-6)}`;

      let stockBefore = 0;
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.warehouseId, warehouse1Id),
              eq(inventoryBalances.itemId, pattyItemId)
            )
          );
        stockBefore = parseFloat(bal.onHandQty);
      });

      const sale = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        warehouseId: warehouse1Id,
        orderNumber,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '30.0000', // 30 + 4.5 = 34.5
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.MADA,
            amount: '34.5000',
          },
        ],
      });

      const voidResult = await salesService.voidSalesOrder(
        sysCtx,
        sale.id,
        'Manager void before meal prep',
        adminUserId,
        true // restockInventory
      );

      expect(voidResult.voidJournal).toBeDefined();
      expect(voidResult.voidJournal.journalType).toBe('SALES');
      expect(voidResult.voidJournal.sourceType).toBe('sales_void');

      // Verify order status CANCELLED in database
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [ord] = await tx.select().from(salesOrders).where(eq(salesOrders.id, sale.id));
        expect(ord.status).toBe(OrderStatus.CANCELLED);

        // Verify stock is restored
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.warehouseId, warehouse1Id),
              eq(inventoryBalances.itemId, pattyItemId)
            )
          );
        expect(parseFloat(bal.onHandQty)).toBe(stockBefore);
      });

      // Verify reversing journal reverses Revenue, VAT, Tender, and COGS/Inventory
      const lines = voidResult.voidJournal.lines;
      const debitRev = lines.find((l: any) => parseFloat(l.debit) === 30);
      const debitVat = lines.find((l: any) => parseFloat(l.debit) === 4.5);
      const creditMada = lines.find((l: any) => parseFloat(l.credit) === 34.5);
      const debitInv = lines.find((l: any) => parseFloat(l.debit) === 10);
      const creditCogs = lines.find((l: any) => parseFloat(l.credit) === 10);

      expect(debitRev).toBeDefined();
      expect(debitVat).toBeDefined();
      expect(creditMada).toBeDefined();
      expect(debitInv).toBeDefined();
      expect(creditCogs).toBeDefined();
    });

    it('6.2 should void order without restocking inventory or reversing COGS when cancelled after preparation/consumption (restockInventory = false)', async () => {
      const orderNumber = `ORD-VOID-NOPREP-${Date.now().toString().slice(-6)}`;

      let stockBefore = 0;
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.warehouseId, warehouse1Id),
              eq(inventoryBalances.itemId, pattyItemId)
            )
          );
        stockBefore = parseFloat(bal.onHandQty);
      });

      const sale = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        warehouseId: warehouse1Id,
        orderNumber,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '30.0000', // 30 + 4.5 = 34.5
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.MADA,
            amount: '34.5000',
          },
        ],
      });

      // Stock should have decreased by 1
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.warehouseId, warehouse1Id),
              eq(inventoryBalances.itemId, pattyItemId)
            )
          );
        expect(parseFloat(bal.onHandQty)).toBe(stockBefore - 1);
      });

      // Void without restocking (food prepared and wasted / not returnable)
      const voidResult = await salesService.voidSalesOrder(
        sysCtx,
        sale.id,
        'Food burned during preparation - non returnable',
        adminUserId,
        false // restockInventory = false
      );

      expect(voidResult.voidJournal).toBeDefined();

      // Verify stock was NOT restored (onHand remains stockBefore - 1)
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.warehouseId, warehouse1Id),
              eq(inventoryBalances.itemId, pattyItemId)
            )
          );
        expect(parseFloat(bal.onHandQty)).toBe(stockBefore - 1);

        // Verify NO RETURN_IN movement was generated
        const returnMoves = await tx
          .select()
          .from(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.tenantId, tenantId),
              eq(inventoryMovements.movementType, MovementType.RETURN_IN),
              eq(inventoryMovements.notes, 'إلغاء الطلب: Food burned during preparation - non returnable')
            )
          );
        expect(returnMoves.length).toBe(0);
      });

      // Verify reversal journal does NOT contain COGS or Inventory lines
      const lines = voidResult.voidJournal.lines;
      const cogsLine = lines.find((l: any) => l.description?.includes('تكلفة البضاعة المباعة'));
      const invLine = lines.find((l: any) => l.description?.includes('منصرف مخزون'));
      expect(cogsLine).toBeUndefined();
      expect(invLine).toBeUndefined();

      // Verify reversal journal is strictly balanced (Debit Revenue 30 + Debit VAT 4.5 = Credit Mada 34.5)
      const debitRev = lines.find((l: any) => parseFloat(l.debit) === 30);
      const debitVat = lines.find((l: any) => parseFloat(l.debit) === 4.5);
      const creditMada = lines.find((l: any) => parseFloat(l.credit) === 34.5);
      expect(debitRev).toBeDefined();
      expect(debitVat).toBeDefined();
      expect(creditMada).toBeDefined();
    });
  });

  // =========================================================================
  // 7. Full Atomic Rollback on Any Failure
  // =========================================================================
  describe('7. Full Atomic Rollback on Failure', () => {
    it('7.1 should rollback order, payments, and stock completely if accounting posting fails', async () => {
      const orderNumber = `ORD-FAIL-${Date.now().toString().slice(-6)}`;

      // Record current stock
      let stockBefore: number;
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.warehouseId, warehouse1Id),
              eq(inventoryBalances.itemId, pattyItemId)
            )
          );
        stockBefore = parseFloat(bal.onHandQty);
      });

      // Attempt creating an order with an unconfigured/incompatible legal entity (legalEntity2Id has no COA mapping or period)
      await expect(
        salesService.createSalesOrder(sysCtx, {
          legalEntityId: legalEntity2Id, // Legal Entity 2 has NO fiscal period and no COA mappings
          branchId: branch1Id,
          deviceId: device1Id,
          warehouseId: warehouse1Id,
          orderNumber,
          orderType: OrderType.TAKEAWAY,
          channel: OrderChannel.POS,
          lines: [
            {
              itemId: burgerItemId,
              uomId: uomPcsId,
              quantity: '1.0000',
              unitPrice: '30.0000',
              discountAmount: '0.0000',
            },
          ],
          payments: [
            {
              paymentMethod: PaymentMethod.CASH,
              amount: '34.5000',
            },
          ],
        })
      ).rejects.toThrow();

      // Verify that NO order was committed
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [ord] = await tx
          .select()
          .from(salesOrders)
          .where(
            and(
              eq(salesOrders.tenantId, tenantId),
              eq(salesOrders.orderNumber, orderNumber)
            )
          );
        expect(ord).toBeUndefined();
      });

      // Verify that stock was NOT deducted
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.warehouseId, warehouse1Id),
              eq(inventoryBalances.itemId, pattyItemId)
            )
          );
        expect(parseFloat(bal.onHandQty)).toBe(stockBefore);
      });
    });
  });

  // =========================================================================
  // 8. Idempotency Protection Against Duplicate Invoices & Journals
  // =========================================================================
  describe('8. Idempotency Verification', () => {
    it('8.1 should return existing order without creating duplicate journals or deducting stock twice', async () => {
      const orderNumber = `ORD-IDEM-${Date.now().toString().slice(-6)}`;
      const idempotencyKey = `idem-key-${Date.now()}`;

      // First request
      const firstResult = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        orderNumber,
        idempotencyKey,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '20.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.CASH,
            amount: '23.0000',
          },
        ],
      });

      expect(firstResult.id).toBeDefined();

      // Duplicate retry with exact same idempotencyKey
      const retryResult = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        orderNumber,
        idempotencyKey,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '20.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.CASH,
            amount: '23.0000',
          },
        ],
      });

      expect(retryResult.id).toBe(firstResult.id);

      // Verify only ONE journal entry exists for this order
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const jvs = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.tenantId, tenantId),
              eq(journalEntries.sourceId, firstResult.id)
            )
          );
        expect(jvs.length).toBe(1);
      });
    });

    it('8.2 should reject idempotency key reused for a different order payload', async () => {
      const idempotencyKey = `idem-conflict-${Date.now()}`;

      await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        orderNumber: `ORD-A-${Date.now().toString().slice(-5)}`,
        idempotencyKey,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '20.0000',
            discountAmount: '0.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.CASH,
            amount: '23.0000',
          },
        ],
      });

      // Same idempotency key with different orderNumber
      await expect(
        salesService.createSalesOrder(sysCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          deviceId: device1Id,
          orderNumber: `ORD-B-${Date.now().toString().slice(-5)}`,
          idempotencyKey,
          orderType: OrderType.TAKEAWAY,
          channel: OrderChannel.POS,
          lines: [
            {
              itemId: burgerItemId,
              uomId: uomPcsId,
              quantity: '1.0000',
              unitPrice: '20.0000',
              discountAmount: '0.0000',
            },
          ],
        })
      ).rejects.toThrow(ConflictException);
    });
  });

  // =========================================================================
  // 9. Tenant / Legal Entity / Branch Isolation & Zero Partial Changes
  // =========================================================================
  describe('9. Tenant / Legal Entity / Branch Isolation', () => {
    it('9.1 should reject sales order creation if deviceId belongs to another legal entity', async () => {
      const orderNumber = `ORD-ISO-DEV-${Date.now().toString().slice(-5)}`;

      await expect(
        salesService.createSalesOrder(sysCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          deviceId: deviceLE2Id, // Device belongs to Legal Entity 2!
          warehouseId: warehouse1Id,
          orderNumber,
          orderType: OrderType.TAKEAWAY,
          channel: OrderChannel.POS,
          lines: [
            {
              itemId: burgerItemId,
              uomId: uomPcsId,
              quantity: '1.0000',
              unitPrice: '20.0000',
            },
          ],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('9.2 should reject sales order creation if warehouseId belongs to another legal entity', async () => {
      const orderNumber = `ORD-ISO-WH-${Date.now().toString().slice(-5)}`;

      await expect(
        salesService.createSalesOrder(sysCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          deviceId: device1Id,
          warehouseId: warehouseLE2Id, // Warehouse belongs to Legal Entity 2!
          orderNumber,
          orderType: OrderType.TAKEAWAY,
          channel: OrderChannel.POS,
          lines: [
            {
              itemId: burgerItemId,
              uomId: uomPcsId,
              quantity: '1.0000',
              unitPrice: '20.0000',
            },
          ],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('9.3 should reject sales order if user scope is restricted to Branch 1 and attempts order on Branch 2', async () => {
      const scopedUserCtx: TenantContext = {
        tenantId,
        userId: randomUUID(),
        email: 'cashier-branch1@restaurant-cloud.test',
        role: 'BRANCH_CASHIER',
        scopes: ['pos.sales.create'], // Explicit permission without wildcard '*'
        userScopes: [
          {
            scopeType: 'BRANCH' as any,
            legalEntityId: legalEntity1Id,
            branchId: branch1Id, // Restricted strictly to Branch 1!
          },
        ],
      };

      const orderNumber = `ORD-SCOPE-${Date.now().toString().slice(-5)}`;

      await expect(
        salesService.createSalesOrder(scopedUserCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch2Id, // User attempts Branch 2!
          deviceId: device2Id, // Device belongs to Branch 2
          warehouseId: warehouse1Id,
          orderNumber,
          orderType: OrderType.TAKEAWAY,
          channel: OrderChannel.POS,
          lines: [
            {
              itemId: burgerItemId,
              uomId: uomPcsId,
              quantity: '1.0000',
              unitPrice: '20.0000',
            },
          ],
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('9.4 should enforce cross-tenant RLS isolation: Tenant B cannot access Tenant A orders or vaults', async () => {
      const tenantBContext: TenantContext = {
        tenantId: randomUUID(), // Completely foreign Tenant B
        userId: randomUUID(),
        email: 'attacker@tenant-b.com',
        role: 'SUPER_ADMIN',
        scopes: ['*'],
      };

      await dbService.withTenantContext(tenantBContext, async (tx) => {
        // Querying sales_orders from Tenant B should return 0 rows
        const orders = await tx.select().from(salesOrders);
        expect(orders.length).toBe(0);

        // Querying cash_vaults from Tenant B should return 0 rows
        const vaults = await tx.select().from(cashVaults);
        expect(vaults.length).toBe(0);

        // Querying journal_entries from Tenant B should return 0 rows
        const entries = await tx.select().from(journalEntries);
        expect(entries.length).toBe(0);
      });
    });

    it('9.5 should ensure rejected operations leave zero partial records in the database (atomicity)', async () => {
      const orderNumber = `ORD-FAIL-ATOMIC-${Date.now().toString().slice(-5)}`;

      // Attempt invalid order with mismatched device
      await expect(
        salesService.createSalesOrder(sysCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          deviceId: deviceLE2Id,
          warehouseId: warehouse1Id,
          orderNumber,
          orderType: OrderType.TAKEAWAY,
          channel: OrderChannel.POS,
          lines: [
            {
              itemId: burgerItemId,
              uomId: uomPcsId,
              quantity: '1.0000',
              unitPrice: '20.0000',
            },
          ],
          payments: [
            {
              paymentMethod: PaymentMethod.CASH,
              amount: '23.0000',
            },
          ],
        })
      ).rejects.toThrow(BadRequestException);

      // Verify ZERO records created
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [ord] = await tx
          .select()
          .from(salesOrders)
          .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.orderNumber, orderNumber)));
        expect(ord).toBeUndefined();

        const jvs = await tx
          .select()
          .from(journalEntries)
          .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.description, `قيد مبيعات نقاط البيع - الفاتورة #${orderNumber}`)));
        expect(jvs.length).toBe(0);
      });
    });
  });

  // =========================================================================
  // 10. AR & Partial Payments, Excess Tenders & Immutability
  // =========================================================================
  describe('10. AR & Partial Payments, Excess Tenders & Immutability', () => {
    it('10.1 should handle partial payment with valid customer partner, tag AR line, and update partner balance', async () => {
      const orderNumber = `ORD-AR-PART-${Date.now().toString().slice(-6)}`;

      // Grand total = 20 * 1.15 = 23.0000 SAR
      // Payment = 10.0000 SAR (Mada)
      // Remaining unpaid = 13.0000 SAR (ACCOUNTS_RECEIVABLE)
      const order = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        warehouseId: warehouse1Id,
        customerId: customerPartnerId,
        orderNumber,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '20.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.MADA,
            amount: '10.0000',
          },
        ],
      });

      expect(order.status).toBe(OrderStatus.CONFIRMED);

      // Verify journal entry lines
      const jv = order.journalEntry;
      expect(jv).toBeDefined();

      const arLine = jv.lines.find((l: any) => parseFloat(l.debit) === 13);
      expect(arLine).toBeDefined();
      expect(arLine.partnerId).toBe(customerPartnerId);
      expect(arLine.partnerRole).toBe('CUSTOMER');

      // Verify customer balance updated in partner_balances
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [bal] = await tx
          .select()
          .from(partnerBalances)
          .where(
            and(
              eq(partnerBalances.tenantId, tenantId),
              eq(partnerBalances.partnerId, customerPartnerId)
            )
          );
        expect(bal).toBeDefined();
        expect(parseFloat(bal.customerBalance)).toBeGreaterThanOrEqual(13);
      });
    });

    it('10.2 should mark order as PAID with zero receivable line when paid in full', async () => {
      const orderNumber = `ORD-FULL-${Date.now().toString().slice(-6)}`;

      const order = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        warehouseId: warehouse1Id,
        orderNumber,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '20.0000', // 23 SAR total
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.CASH,
            amount: '23.0000',
          },
        ],
      });

      expect(order.status).toBe(OrderStatus.PAID);

      const arLine = order.journalEntry.lines.find(
        (l: any) => l.description?.includes('مستحق مبيعات آجلة')
      );
      expect(arLine).toBeUndefined();
    });

    it('10.3 should handle excess cash tendered by computing change and recording only net cash collected in vault and journal', async () => {
      const orderNumber = `ORD-CHANGE-${Date.now().toString().slice(-6)}`;

      // Grand total = 20 * 1.15 = 23.0000 SAR
      // Customer tenders 50.0000 SAR cash
      // Change due to customer = 27.0000 SAR
      // Net cash collected = 23.0000 SAR
      let vaultBalBefore = 0;
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [v] = await tx.select().from(cashVaults).where(eq(cashVaults.id, vault1Id));
        vaultBalBefore = parseFloat(v.balance);
      });

      const order = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        warehouseId: warehouse1Id,
        orderNumber,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '20.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.CASH,
            amount: '50.0000', // Excess cash tendered
          },
        ],
      });

      expect(order.status).toBe(OrderStatus.PAID);

      // Verify vault balance increased by NET collected (23.0000 SAR), NOT 50.0000 SAR
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [v] = await tx.select().from(cashVaults).where(eq(cashVaults.id, vault1Id));
        expect(parseFloat(v.balance)).toBe(vaultBalBefore + 23);
      });

      // Verify GL journal debit for Cash Vault is exactly 23.0000 SAR (Balanced: 23 = 20 + 3)
      const jv = order.journalEntry;
      const cashDebitLine = jv.lines.find((l: any) => parseFloat(l.debit) === 23);
      expect(cashDebitLine).toBeDefined();

      const totalDebit = jv.lines.reduce((s: number, l: any) => s + parseFloat(l.debit), 0);
      const totalCredit = jv.lines.reduce((s: number, l: any) => s + parseFloat(l.credit), 0);
      expect(totalDebit).toBe(totalCredit);
    });

    it('10.4 should reject excess electronic payments exceeding order grand total', async () => {
      const orderNumber = `ORD-EXCESS-ELEC-${Date.now().toString().slice(-6)}`;

      // Grand total = 23.0000 SAR, but customer attempts 50.0000 SAR on Mada
      await expect(
        salesService.createSalesOrder(sysCtx, {
          legalEntityId: legalEntity1Id,
          branchId: branch1Id,
          deviceId: device1Id,
          warehouseId: warehouse1Id,
          orderNumber,
          orderType: OrderType.TAKEAWAY,
          channel: OrderChannel.POS,
          lines: [
            {
              itemId: burgerItemId,
              uomId: uomPcsId,
              quantity: '1.0000',
              unitPrice: '20.0000',
            },
          ],
          payments: [
            {
              paymentMethod: PaymentMethod.MADA,
              amount: '50.0000',
            },
          ],
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('10.5 should ensure historical journal entries remain strictly immutable after refunds and voids', async () => {
      const orderNumber = `ORD-IMMUT-${Date.now().toString().slice(-6)}`;

      const order = await salesService.createSalesOrder(sysCtx, {
        legalEntityId: legalEntity1Id,
        branchId: branch1Id,
        deviceId: device1Id,
        warehouseId: warehouse1Id,
        orderNumber,
        orderType: OrderType.TAKEAWAY,
        channel: OrderChannel.POS,
        lines: [
          {
            itemId: burgerItemId,
            uomId: uomPcsId,
            quantity: '1.0000',
            unitPrice: '20.0000',
          },
        ],
        payments: [
          {
            paymentMethod: PaymentMethod.CASH,
            amount: '23.0000',
          },
        ],
      });

      const origJvId = order.journalEntry.id;
      let origDebitTotal = 0;
      let origCreditTotal = 0;
      let origLineCount = 0;

      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [orig] = await tx.select().from(journalEntries).where(eq(journalEntries.id, origJvId));
        origDebitTotal = parseFloat(orig.debitTotal);
        origCreditTotal = parseFloat(orig.creditTotal);
        const lines = await tx.select().from(journalLines).where(eq(journalLines.journalEntryId, origJvId));
        origLineCount = lines.length;
      });

      // Void the order
      await salesService.voidSalesOrder(sysCtx, order.id, 'Immutability audit check', adminUserId);

      // Verify original journal entry and lines were NOT modified, updated or deleted
      await dbService.withTenantContext(sysCtx, async (tx) => {
        const [origAfter] = await tx.select().from(journalEntries).where(eq(journalEntries.id, origJvId));
        expect(origAfter).toBeDefined();
        expect(parseFloat(origAfter.debitTotal)).toBe(origDebitTotal);
        expect(parseFloat(origAfter.creditTotal)).toBe(origCreditTotal);

        const linesAfter = await tx.select().from(journalLines).where(eq(journalLines.journalEntryId, origJvId));
        expect(linesAfter.length).toBe(origLineCount);
      });
    });
  });
});
