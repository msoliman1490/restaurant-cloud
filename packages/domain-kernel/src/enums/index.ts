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
  PENDING_DISPATCH = 'PENDING_DISPATCH',
  IN_TRANSIT = 'IN_TRANSIT',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
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
  EXPENSE = 'EXPENSE',
}

export enum NormalBalance {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum JournalStatus {
  DRAFT = 'DRAFT',
  VALIDATED = 'VALIDATED',
  POSTED = 'POSTED',
  REVERSED = 'REVERSED',
}

export enum JournalType {
  GENERAL = 'GENERAL',
  SALES = 'SALES',
  PURCHASES = 'PURCHASES',
  CASH = 'CASH',
  BANK = 'BANK',
  INVENTORY = 'INVENTORY',
  CLOSING = 'CLOSING',
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


