// 1. Tenancy & Organization
export enum TenantStatus {
  PENDING = 'PENDING',
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

export enum DeploymentMode {
  SHARED = 'SHARED',
  DEDICATED = 'DEDICATED',
}

export enum BusinessType {
  RESTAURANT = 'RESTAURANT',
  CAFE = 'CAFE',
  GROCERY = 'GROCERY',
  MIXED = 'MIXED',
}

export enum IndustryType {
  RESTAURANT = 'RESTAURANT',
  CAFE = 'CAFE',
  GROCERY = 'GROCERY',
  BAKERY = 'BAKERY',
  CATERING = 'CATERING',
  RETAIL = 'RETAIL',
}

export enum IndustryPackStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  TRIAL = 'TRIAL',
  SUSPENDED = 'SUSPENDED',
}

export enum SubscriptionPlanCode {
  FREE_TRIAL = 'FREE_TRIAL',
  STARTER = 'STARTER',
  GROWTH = 'GROWTH',
  ENTERPRISE = 'ENTERPRISE',
  CUSTOM = 'CUSTOM',
}

export enum SubscriptionStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export const INDUSTRY_CAPABILITIES: Record<IndustryType, string[]> = {
  [IndustryType.RESTAURANT]: [
    'dining.tables',
    'dining.floor_plan',
    'production.recipes',
    'production.kitchen_kds',
    'inventory.recipe_costing',
    'sales.order_modifiers',
    'pos.dine_in',
  ],
  [IndustryType.CAFE]: [
    'sales.customizations',
    'sales.beverage_sizes',
    'production.quick_recipes',
    'sales.loyalty_points',
    'pos.quick_counter',
  ],
  [IndustryType.GROCERY]: [
    'pos.barcode_scanner',
    'pos.weight_scale',
    'catalog.expiry_tracking',
    'catalog.batch_numbers',
    'inventory.retail_packaging',
    'inventory.fast_replenishment',
  ],
  [IndustryType.BAKERY]: [
    'production.batch_baking',
    'catalog.daily_fresh_expiration',
    'production.waste_tracking',
  ],
  [IndustryType.CATERING]: [
    'sales.banquet_events',
    'sales.contract_orders',
    'production.large_scale_bom',
  ],
  [IndustryType.RETAIL]: [
    'catalog.matrix_variants',
    'pos.gift_cards',
    'sales.customer_accounts',
  ],
};

export enum ScopeType {
  TENANT = 'TENANT',
  GROUP = 'GROUP',
  LEGAL_ENTITY = 'LEGAL_ENTITY',
  BRANCH = 'BRANCH',
  WAREHOUSE = 'WAREHOUSE',
  DEVICE = 'DEVICE',
}

// 2. Catalog & Pricing
export enum ProductType {
  STOCKED = 'STOCKED',
  SERVICE = 'SERVICE',
  RAW_MATERIAL = 'RAW_MATERIAL',
  PACKAGING = 'PACKAGING',
  READY_MEAL = 'READY_MEAL',
  SEMI_FINISHED = 'SEMI_FINISHED',
  CONSUMABLE = 'CONSUMABLE',
  NON_STOCKED = 'NON_STOCKED',
  SALEABLE = 'SALEABLE',
  MANUFACTURED = 'MANUFACTURED',
  COMPOSITE_BUNDLE = 'COMPOSITE_BUNDLE',
  NON_INVENTORY = 'NON_INVENTORY',
}

export enum TrackingPolicy {
  NONE = 'NONE',
  LOT = 'LOT',
  EXPIRY = 'EXPIRY',
  SERIAL = 'SERIAL',
}

export enum UomCategory {
  UNIT = 'UNIT',
  WEIGHT = 'WEIGHT',
  VOLUME = 'VOLUME',
  LENGTH = 'LENGTH',
  TIME = 'TIME',
}

export enum TransferStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  PENDING_DISPATCH = 'PENDING_DISPATCH',
  PICKING = 'PICKING',
  SHIPPED = 'SHIPPED',
  IN_TRANSIT = 'IN_TRANSIT',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  RECEIVED = 'RECEIVED',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  RETURNED = 'RETURNED',
  DISPUTED = 'DISPUTED',
}

export enum WarehouseType {
  MAIN = 'MAIN',
  BRANCH = 'BRANCH',
  RAW_MATERIALS = 'RAW_MATERIALS',
  FINISHED_GOODS = 'FINISHED_GOODS',
  PACKAGING = 'PACKAGING',
  DAMAGED_RETURNS = 'DAMAGED_RETURNS',
  INSPECTION_QUARANTINE = 'INSPECTION_QUARANTINE',
  IN_TRANSIT = 'IN_TRANSIT',
}

export enum AdjustmentReason {
  PHYSICAL_COUNT = 'PHYSICAL_COUNT',
  DAMAGE = 'DAMAGE',
  EXPIRY = 'EXPIRY',
  WASTE = 'WASTE',
  THEFT = 'THEFT',
  INTERNAL_USE = 'INTERNAL_USE',
  INITIAL_BALANCE = 'INITIAL_BALANCE',
}

// 3. Sales & Orders
export enum OrderType {
  DINE_IN = 'DINE_IN',
  TAKEAWAY = 'TAKEAWAY',
  DELIVERY = 'DELIVERY',
}

export enum OrderChannel {
  POS = 'POS',
  ONLINE = 'ONLINE',
  AGGREGATOR = 'AGGREGATOR',
  DRIVE_THRU = 'DRIVE_THRU',
}

export enum OrderStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  IN_PREPARATION = 'IN_PREPARATION',
  READY = 'READY',
  SERVED = 'SERVED',
  DISPATCHED = 'DISPATCHED',
  PAID = 'PAID',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  REFUNDED = 'REFUNDED',
}

export enum ShiftStatus {
  OPEN = 'OPEN',
  CLOSING_REQUESTED = 'CLOSING_REQUESTED',
  RECONCILIATION_PENDING = 'RECONCILIATION_PENDING',
  CLOSED = 'CLOSED',
}

// 4. Payments
export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  MADA = 'MADA',
  VISA_MC = 'VISA_MC',
  APPLE_PAY = 'APPLE_PAY',
  POINTS = 'POINTS',
  CREDIT = 'CREDIT',
  SPLIT = 'SPLIT',
}

export enum PaymentStatus {
  INITIATED = 'INITIATED',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  VOIDED = 'VOIDED',
}

// 5. Inventory & Costing
export enum MovementType {
  PURCHASE_RECEIPT = 'PURCHASE_RECEIPT',
  SALE_ISSUE = 'SALE_ISSUE',
  TRANSFER_OUT = 'TRANSFER_OUT',
  TRANSFER_IN = 'TRANSFER_IN',
  STOCK_ADJUSTMENT = 'STOCK_ADJUSTMENT',
  PRODUCTION_CONSUMPTION = 'PRODUCTION_CONSUMPTION',
  PRODUCTION_OUTPUT = 'PRODUCTION_OUTPUT',
  WASTE_SPOILAGE = 'WASTE_SPOILAGE',
  RETURN_IN = 'RETURN_IN',
  SUPPLIER_RETURN = 'SUPPLIER_RETURN',
  INTERNAL_CONSUMPTION = 'INTERNAL_CONSUMPTION',
  SAMPLE_INTERNAL = 'SAMPLE_INTERNAL',
  OPENING_BALANCE = 'OPENING_BALANCE',
  INTERCOMPANY_TRANSFER = 'INTERCOMPANY_TRANSFER',
  EXPIRY = 'EXPIRY',
}

export enum MovementDirection {
  IN = 'IN',
  OUT = 'OUT',
}

export enum CostingMethod {
  FIFO = 'FIFO',
  WEIGHTED_AVERAGE = 'WEIGHTED_AVERAGE',
}

// 6. Accounting
export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
  COGS = 'COGS',
  EXPENSE = 'EXPENSE',
  OTHER_INCOME = 'OTHER_INCOME',
  OTHER_EXPENSE = 'OTHER_EXPENSE',
}

export enum NormalBalance {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum JournalStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  VALIDATED = 'VALIDATED',
  POSTED = 'POSTED',
  REVERSED = 'REVERSED',
  REJECTED = 'REJECTED',
}

export enum JournalType {
  GENERAL = 'GENERAL',
  SALES = 'SALES',
  PURCHASES = 'PURCHASES',
  CASH = 'CASH',
  BANK = 'BANK',
  INVENTORY = 'INVENTORY',
  CLOSING = 'CLOSING',
  OPENING = 'OPENING',
  ADJUSTMENT = 'ADJUSTMENT',
  RECURRING = 'RECURRING',
  REVERSAL = 'REVERSAL',
  RECLASSIFICATION = 'RECLASSIFICATION',
  ACCRUAL = 'ACCRUAL',
  DEPRECIATION = 'DEPRECIATION',
  FOREX = 'FOREX',
  CORRECTION = 'CORRECTION',
}

export enum VoucherStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  POSTED = 'POSTED',
  REVERSED = 'REVERSED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentVoucherType {
  VENDOR_PAYMENT = 'VENDOR_PAYMENT',
  OPERATING_EXPENSE = 'OPERATING_EXPENSE',
  RENT = 'RENT',
  SALARY = 'SALARY',
  EMPLOYEE_CUSTODY = 'EMPLOYEE_CUSTODY',
  CUSTODY_SETTLEMENT = 'CUSTODY_SETTLEMENT',
  ADVANCE_PAYMENT = 'ADVANCE_PAYMENT',
  BANK_FEES = 'BANK_FEES',
  TAX_PAYMENT = 'TAX_PAYMENT',
  INTERNAL_TRANSFER = 'INTERNAL_TRANSFER',
  OTHER = 'OTHER',
}

export enum ReceiptVoucherType {
  CUSTOMER_PAYMENT = 'CUSTOMER_PAYMENT',
  CASH_SALE = 'CASH_SALE',
  INVOICE_COLLECTION = 'INVOICE_COLLECTION',
  ADVANCE_PAYMENT = 'ADVANCE_PAYMENT',
  OTHER_INCOME = 'OTHER_INCOME',
  VAULT_TRANSFER = 'VAULT_TRANSFER',
  CUSTODY_RETURN = 'CUSTODY_RETURN',
  OTHER = 'OTHER',
}

export enum DefaultAccountMappingKey {
  SALES = 'SALES',
  SALES_RETURNS = 'SALES_RETURNS',
  SALES_DISCOUNTS = 'SALES_DISCOUNTS',
  COGS = 'COGS',
  INVENTORY = 'INVENTORY',
  VAT_OUTPUT = 'VAT_OUTPUT',
  VAT_INPUT = 'VAT_INPUT',
  ACCOUNTS_RECEIVABLE = 'ACCOUNTS_RECEIVABLE',
  ACCOUNTS_PAYABLE = 'ACCOUNTS_PAYABLE',
  CASH_VAULT = 'CASH_VAULT',
  BANK = 'BANK',
  GENERAL_EXPENSE = 'GENERAL_EXPENSE',
  RETAINED_EARNINGS = 'RETAINED_EARNINGS',
  ROUNDING_DIFFERENCE = 'ROUNDING_DIFFERENCE',
  DISCOUNTS_RECEIVED = 'DISCOUNTS_RECEIVED',
}

// 7. ZATCA E-Invoicing
export enum EInvoiceType {
  TAX_INVOICE = '388', // B2B Standard Tax Invoice
  SIMPLIFIED = '381',  // B2C Simplified Tax Invoice
  CREDIT_NOTE = '383', // Debit/Credit Note
  DEBIT_NOTE = '384',
}

export enum ZATCAComplianceStatus {
  DRAFT = 'DRAFT',
  GENERATED = 'GENERATED',
  SIGNED = 'SIGNED',
  PENDING_CLEARANCE = 'PENDING_CLEARANCE',
  CLEARED = 'CLEARED',
  PENDING_REPORTING = 'PENDING_REPORTING',
  REPORTED = 'REPORTED',
  REJECTED = 'REJECTED',
  RECONCILIATION_REQUIRED = 'RECONCILIATION_REQUIRED',
}

export enum SubmissionType {
  CLEARANCE = 'CLEARANCE',
  REPORTING = 'REPORTING',
}

// 8. Purchasing & Procurement
export enum PurchaseRequestStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum PurchaseOrderStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum GoodsReceiptStatus {
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

export enum SupplierInvoiceStatus {
  DRAFT = 'DRAFT',
  MATCHED = 'MATCHED',
  DISCREPANCY = 'DISCREPANCY',
  APPROVED = 'APPROVED',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

export enum PurchaseReturnStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  DISPATCHED = 'DISPATCHED',
  COMPLETED = 'COMPLETED',
}

// 9. Recipe & Production
export enum RecipeStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum ProductionBatchStatus {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

// 10. Dining & POS Operations
export enum TableStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  RESERVED = 'RESERVED',
  DIRTY = 'DIRTY',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
}

// 11. Additional Operational & Accounting Enums
export enum ShiftCashTransactionType {
  CASH_IN = 'CASH_IN',
  CASH_OUT = 'CASH_OUT',
}

export enum FiscalPeriodStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  LOCKED = 'LOCKED',
}

export enum SupplierPaymentMethod {
  BANK_TRANSFER = 'BANK_TRANSFER',
  CHEQUE = 'CHEQUE',
  CASH = 'CASH',
}


