import { z } from 'zod';
import {
  OrderType,
  OrderChannel,
  PaymentMethod,
  PaymentStatus,
  ShiftStatus,
  BusinessType,
  DeploymentMode,
  ScopeType,
  ProductType,
  TrackingPolicy,
  CostingMethod,
  UomCategory,
  TransferStatus,
  AdjustmentReason,
  MovementType,
  MovementDirection,
  PurchaseRequestStatus,
  PurchaseOrderStatus,
  GoodsReceiptStatus,
  SupplierInvoiceStatus,
  PurchaseReturnStatus,
  RecipeStatus,
  ProductionBatchStatus,
  TableStatus,
  AccountType,
  NormalBalance,
  JournalType,
  JournalStatus,
  ShiftCashTransactionType,
  FiscalPeriodStatus,
  SupplierPaymentMethod,
  IndustryType,
  IndustryPackStatus,
  SubscriptionPlanCode,
  SubscriptionStatus,
} from '@restaurant-cloud/domain-kernel';

// ====================================================================
// 1. Identity, Tenancy & Organization Contracts
// ====================================================================

export const CreateTenantRequestSchema = z.object({
  code: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/, 'Code must be lowercase alphanumeric and hyphens'),
  displayName: z.string().min(2).max(255),
  deploymentMode: z.nativeEnum(DeploymentMode).default(DeploymentMode.SHARED),
  primaryLocale: z.string().default('ar-SA'),
  timezone: z.string().default('Asia/Riyadh'),
  primaryIndustry: z.nativeEnum(IndustryType).optional().default(IndustryType.RESTAURANT),
  initialLegalEntity: z.object({
    legalName: z.string().min(2).max(255),
    vatNumber: z.string().regex(/^\d{15}$/, 'Saudi VAT number must be 15 digits'),
    crNumber: z.string().optional(),
    functionalCurrency: z.string().length(3).default('SAR'),
  }),
  initialAdminUser: z.object({
    email: z.string().email(),
    displayName: z.string().min(2),
    phone: z.string().optional(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }),
});

export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

export const ActivateIndustryPackRequestSchema = z.object({
  industry: z.nativeEnum(IndustryType),
  settings: z.record(z.any()).optional(),
});

export type ActivateIndustryPackRequest = z.infer<typeof ActivateIndustryPackRequestSchema>;

export const DeactivateIndustryPackRequestSchema = z.object({
  industry: z.nativeEnum(IndustryType),
  reason: z.string().optional(),
});

export type DeactivateIndustryPackRequest = z.infer<typeof DeactivateIndustryPackRequestSchema>;

export const UpdateSubscriptionPlanRequestSchema = z.object({
  planCode: z.nativeEnum(SubscriptionPlanCode),
  maxBranches: z.number().int().positive().optional(),
  maxDevices: z.number().int().positive().optional(),
  maxUsers: z.number().int().positive().optional(),
});

export type UpdateSubscriptionPlanRequest = z.infer<typeof UpdateSubscriptionPlanRequestSchema>;

export const CreateLegalEntityRequestSchema = z.object({
  groupId: z.string().uuid().optional(),
  legalName: z.string().min(2).max(255),
  commercialName: z.string().max(255).optional(),
  crNumber: z.string().optional(),
  vatNumber: z.string().regex(/^\d{15}$/, 'Saudi VAT number must be 15 digits'),
  functionalCurrency: z.string().length(3).default('SAR'),
  timezone: z.string().default('Asia/Riyadh'),
});

export type CreateLegalEntityRequest = z.infer<typeof CreateLegalEntityRequestSchema>;

export const CreateBranchRequestSchema = z.object({
  legalEntityId: z.string().uuid(),
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(255),
  businessType: z.nativeEnum(BusinessType).default(BusinessType.RESTAURANT),
  timezone: z.string().default('Asia/Riyadh'),
});

export type CreateBranchRequest = z.infer<typeof CreateBranchRequestSchema>;

export const CreateWarehouseRequestSchema = z.object({
  branchId: z.string().uuid().optional(),
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(255),
});

export type CreateWarehouseRequest = z.infer<typeof CreateWarehouseRequestSchema>;

export const RegisterDeviceRequestSchema = z.object({
  branchId: z.string().uuid(),
  deviceCode: z.string().min(2).max(50),
  deviceType: z.enum(['POS', 'KDS', 'KIOSK', 'WAITER_TABLET', 'BRANCH_SERVER']).default('POS'),
  publicKeyFingerprint: z.string().optional(),
});

export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantCode: z.string().optional(),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const CreateUserRequestSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(255),
  phone: z.string().optional(),
  password: z.string().min(8),
  roleId: z.string().uuid(),
  scopes: z.array(
    z.object({
      scopeType: z.nativeEnum(ScopeType),
      scopeId: z.string().uuid(),
    })
  ).default([]),
});

export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

// ====================================================================
// 2. Order Contracts
// ====================================================================
export const OrderLineCreateSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a valid positive decimal quantity'),
  uomId: z.string().uuid(),
  unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  discountAmount: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  notes: z.string().max(255).optional(),
  modifiers: z.array(z.string().uuid()).optional(),
});

export const CreateOrderRequestSchema = z.object({
  branchId: z.string().uuid(),
  deviceId: z.string().uuid(),
  orderType: z.nativeEnum(OrderType),
  channel: z.nativeEnum(OrderChannel),
  tableId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  currency: z.string().length(3).default('SAR'),
  lines: z.array(OrderLineCreateSchema).min(1),
  notes: z.string().max(500).optional(),
});

export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

// ====================================================================
// 3. Payment Contracts
// ====================================================================
export const CreatePaymentRequestSchema = z.object({
  orderId: z.string().uuid(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  currency: z.string().length(3).default('SAR'),
  providerCode: z.string().optional(),
  terminalId: z.string().optional(),
});

export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;

// ====================================================================
// 4. Shift Contracts
// ====================================================================
export const TenderCountSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  currency: z.string().length(3).default('SAR'),
});

export const CloseShiftRequestSchema = z.object({
  countedCash: z.string().regex(/^\d+(\.\d{1,4})?$/),
  tenderTotals: z.array(TenderCountSchema),
  varianceReason: z.string().max(500).optional(),
  expectedVersion: z.number().int().positive(),
  closingNotes: z.string().max(1000).optional(),
});

export type CloseShiftRequest = z.infer<typeof CloseShiftRequestSchema>;

// ====================================================================
// 5. Offline Quota Lease Contracts
// ====================================================================
export const OfflineQuotaLeaseSchema = z.object({
  leaseId: z.string().uuid(),
  tenantId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  itemId: z.string().uuid(),
  deviceId: z.string().uuid(),
  deviceEpoch: z.number().int().positive(),
  allocatedQty: z.string(),
  issuedAt: z.string().datetime(),
  validUntil: z.string().datetime(),
  signature: z.string(),
});

export type OfflineQuotaLease = z.infer<typeof OfflineQuotaLeaseSchema>;

// ====================================================================
// 6. Standard API Response Schemas
// ====================================================================
export const ApiSuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
    requestId: z.string().optional(),
  });

export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
  requestId: z.string().optional(),
});

// ====================================================================
// 7. Catalog Contracts
// ====================================================================

// Category Contracts
export const CreateCategoryRequestSchema = z.object({
  code: z.string().min(2).max(50),
  nameAr: z.string().min(2).max(255),
  nameEn: z.string().min(2).max(255),
  parentId: z.string().uuid().optional().nullable(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type CreateCategoryRequest = z.infer<typeof CreateCategoryRequestSchema>;

export const UpdateCategoryRequestSchema = CreateCategoryRequestSchema.partial();
export type UpdateCategoryRequest = z.infer<typeof UpdateCategoryRequestSchema>;

export const CategoryListQuerySchema = z.object({
  parentId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
  search: z.string().optional(),
});
export type CategoryListQuery = z.infer<typeof CategoryListQuerySchema>;

// UoM Contracts
export const CreateUomRequestSchema = z.object({
  code: z.string().min(1).max(20),
  nameAr: z.string().min(1).max(100),
  nameEn: z.string().min(1).max(100),
  category: z.nativeEnum(UomCategory).default(UomCategory.UNIT),
  isBase: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type CreateUomRequest = z.infer<typeof CreateUomRequestSchema>;

export const CreateUomConversionRequestSchema = z.object({
  fromUomId: z.string().uuid(),
  toUomId: z.string().uuid(),
  multiplier: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Must be a valid positive decimal multiplier'),
});
export type CreateUomConversionRequest = z.infer<typeof CreateUomConversionRequestSchema>;

// Product / Item Contracts
export const CreateItemRequestSchema = z.object({
  legalEntityOwnerId: z.string().uuid(),
  categoryId: z.string().uuid().optional().nullable(),
  baseUomId: z.string().uuid(),
  sku: z.string().min(2).max(50),
  barcode: z.string().max(100).optional().nullable(),
  nameAr: z.string().min(2).max(255),
  nameEn: z.string().min(2).max(255),
  productType: z.nativeEnum(ProductType).default(ProductType.STOCKED),
  trackingPolicy: z.nativeEnum(TrackingPolicy).default(TrackingPolicy.NONE),
  costingMethod: z.nativeEnum(CostingMethod).default(CostingMethod.WEIGHTED_AVERAGE),
  defaultCost: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
  defaultPrice: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
  taxRate: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.1500'),
  isSold: z.boolean().default(true),
  isPurchased: z.boolean().default(true),
  isActive: z.boolean().default(true),
});
export type CreateItemRequest = z.infer<typeof CreateItemRequestSchema>;

export const UpdateItemRequestSchema = CreateItemRequestSchema.partial().omit({ legalEntityOwnerId: true });
export type UpdateItemRequest = z.infer<typeof UpdateItemRequestSchema>;

export const ItemListQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  legalEntityOwnerId: z.string().uuid().optional(),
  search: z.string().optional(),
  isSold: z.boolean().optional(),
  isActive: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ItemListQuery = z.infer<typeof ItemListQuerySchema>;

// Item Variant Contracts
export const CreateItemVariantRequestSchema = z.object({
  itemId: z.string().uuid(),
  variantCode: z.string().min(1).max(50),
  nameAr: z.string().min(1).max(255),
  nameEn: z.string().min(1).max(255),
  sku: z.string().max(50).optional().nullable(),
  barcode: z.string().max(100).optional().nullable(),
  priceDelta: z.string().regex(/^-?\d+(\.\d{1,4})?$/).default('0.0000'),
  costDelta: z.string().regex(/^-?\d+(\.\d{1,4})?$/).default('0.0000'),
  isActive: z.boolean().default(true),
});
export type CreateItemVariantRequest = z.infer<typeof CreateItemVariantRequestSchema>;

export const UpdateItemVariantRequestSchema = CreateItemVariantRequestSchema.partial().omit({ itemId: true });
export type UpdateItemVariantRequest = z.infer<typeof UpdateItemVariantRequestSchema>;

// Branch Specific Price Contracts
export const SetBranchPriceRequestSchema = z.object({
  branchId: z.string().uuid(),
  itemId: z.string().uuid(),
  price: z.string().regex(/^\d+(\.\d{1,4})?$/),
  costOverride: z.string().regex(/^\d+(\.\d{1,4})?$/).optional().nullable(),
  isAvailable: z.boolean().default(true),
});
export type SetBranchPriceRequest = z.infer<typeof SetBranchPriceRequestSchema>;

// Supplier Contracts
export const CreateSupplierRequestSchema = z.object({
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(255),
  vatNumber: z.string().max(50).optional().nullable(),
  contactPerson: z.string().max(255).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
});
export type CreateSupplierRequest = z.infer<typeof CreateSupplierRequestSchema>;

export const UpdateSupplierRequestSchema = CreateSupplierRequestSchema.partial();
export type UpdateSupplierRequest = z.infer<typeof UpdateSupplierRequestSchema>;

// ====================================================================
// 8. Inventory Contracts
// ====================================================================

// Stock Transfer Contracts
export const StockTransferLineSchema = z.object({
  itemId: z.string().uuid(),
  uomId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a valid positive quantity'),
  unitCost: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
});
export type StockTransferLine = z.infer<typeof StockTransferLineSchema>;

export const CreateStockTransferRequestSchema = z.object({
  legalEntityId: z.string().uuid(),
  transferNumber: z.string().min(2).max(50),
  sourceWarehouseId: z.string().uuid(),
  destinationWarehouseId: z.string().uuid(),
  lines: z.array(StockTransferLineSchema).min(1),
  notes: z.string().max(500).optional(),
});
export type CreateStockTransferRequest = z.infer<typeof CreateStockTransferRequestSchema>;

export const DispatchTransferRequestSchema = z.object({
  dispatchedNotes: z.string().max(500).optional(),
});
export type DispatchTransferRequest = z.infer<typeof DispatchTransferRequestSchema>;

export const ReceiveTransferLineSchema = z.object({
  itemId: z.string().uuid(),
  receivedQuantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
});

export const ReceiveTransferRequestSchema = z.object({
  receivedLines: z.array(ReceiveTransferLineSchema).min(1),
  receivedNotes: z.string().max(500).optional(),
});
export type ReceiveTransferRequest = z.infer<typeof ReceiveTransferRequestSchema>;

// Stock Adjustment Contracts
export const StockAdjustmentLineSchema = z.object({
  itemId: z.string().uuid(),
  lotId: z.string().uuid().optional().nullable(),
  uomId: z.string().uuid(),
  countedQuantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
});
export type StockAdjustmentLine = z.infer<typeof StockAdjustmentLineSchema>;

export const CreateStockAdjustmentRequestSchema = z.object({
  legalEntityId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  adjustmentNumber: z.string().min(2).max(50),
  reason: z.nativeEnum(AdjustmentReason).default(AdjustmentReason.PHYSICAL_COUNT),
  notes: z.string().max(500).optional(),
  lines: z.array(StockAdjustmentLineSchema).min(1),
});
export type CreateStockAdjustmentRequest = z.infer<typeof CreateStockAdjustmentRequestSchema>;

// Stock Balance & Movements Queries
export const StockBalanceQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type StockBalanceQuery = z.infer<typeof StockBalanceQuerySchema>;

export const InventoryMovementQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  movementType: z.nativeEnum(MovementType).optional(),
  direction: z.nativeEnum(MovementDirection).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type InventoryMovementQuery = z.infer<typeof InventoryMovementQuerySchema>;

// ====================================================================
// 9. Purchasing Engine Contracts
// ====================================================================

// Purchase Requests
export const PurchaseRequestLineSchema = z.object({
  itemId: z.string().uuid(),
  uomId: z.string().uuid(),
  requestedQty: z.string().regex(/^\d+(\.\d{1,4})?$/),
  estimatedUnitCost: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
  notes: z.string().max(255).optional(),
});

export const CreatePurchaseRequestSchema = z.object({
  legalEntityId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  requestNumber: z.string().min(2).max(50),
  neededByDate: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(PurchaseRequestLineSchema).min(1),
});
export type CreatePurchaseRequest = z.infer<typeof CreatePurchaseRequestSchema>;

// Purchase Orders
export const PurchaseOrderLineSchema = z.object({
  itemId: z.string().uuid(),
  uomId: z.string().uuid(),
  orderedQty: z.string().regex(/^\d+(\.\d{1,4})?$/),
  unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/),
  taxRate: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.1500'),
});

export const CreatePurchaseOrderSchema = z.object({
  legalEntityId: z.string().uuid(),
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  orderNumber: z.string().min(2).max(50),
  expectedDeliveryDate: z.string().datetime().optional(),
  currency: z.string().length(3).default('SAR'),
  notes: z.string().max(500).optional(),
  lines: z.array(PurchaseOrderLineSchema).min(1),
});
export type CreatePurchaseOrder = z.infer<typeof CreatePurchaseOrderSchema>;

// Goods Receipts (GRN)
export const GoodsReceiptLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid().optional(),
  itemId: z.string().uuid(),
  uomId: z.string().uuid(),
  receivedQty: z.string().regex(/^\d+(\.\d{1,4})?$/),
  unitCost: z.string().regex(/^\d+(\.\d{1,4})?$/),
  lotNumber: z.string().max(100).optional(),
  expiryDate: z.string().datetime().optional(),
});

export const CreateGoodsReceiptSchema = z.object({
  legalEntityId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  receiptNumber: z.string().min(2).max(50),
  deliveryNoteNumber: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(GoodsReceiptLineSchema).min(1),
});
export type CreateGoodsReceipt = z.infer<typeof CreateGoodsReceiptSchema>;

// Supplier Invoices (3-Way Matching)
export const SupplierInvoiceLineSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
  unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/),
  taxRate: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.1500'),
});

export const CreateSupplierInvoiceSchema = z.object({
  legalEntityId: z.string().uuid(),
  supplierId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().optional(),
  goodsReceiptId: z.string().uuid().optional(),
  invoiceNumber: z.string().min(2).max(100),
  invoiceDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  currency: z.string().length(3).default('SAR'),
  notes: z.string().max(500).optional(),
  lines: z.array(SupplierInvoiceLineSchema).min(1),
});
export type CreateSupplierInvoice = z.infer<typeof CreateSupplierInvoiceSchema>;

// Purchase Returns
export const PurchaseReturnLineSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
  unitCost: z.string().regex(/^\d+(\.\d{1,4})?$/),
});

export const CreatePurchaseReturnSchema = z.object({
  legalEntityId: z.string().uuid(),
  supplierId: z.string().uuid(),
  goodsReceiptId: z.string().uuid().optional(),
  returnNumber: z.string().min(2).max(50),
  reason: z.string().min(2).max(255),
  lines: z.array(PurchaseReturnLineSchema).min(1),
});
export type CreatePurchaseReturn = z.infer<typeof CreatePurchaseReturnSchema>;

// ====================================================================
// 10. Recipe & Production Engine Contracts
// ====================================================================

export const RecipeIngredientSchema = z.object({
  ingredientItemId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
  uomId: z.string().uuid(),
  wastePercentage: z.string().regex(/^\d+(\.\d{1,2})?$/).default('0.00'),
  notes: z.string().max(255).optional(),
});

export const CreateRecipeSchema = z.object({
  legalEntityId: z.string().uuid(),
  outputItemId: z.string().uuid(),
  recipeCode: z.string().min(2).max(50),
  version: z.string().min(1).max(20).default('1.0'),
  yieldQuantity: z.string().regex(/^\d+(\.\d{1,4})?$/).default('1.0000'),
  yieldUomId: z.string().uuid(),
  preparationTimeMinutes: z.number().positive().optional(),
  instructions: z.string().max(2000).optional(),
  ingredients: z.array(RecipeIngredientSchema).min(1),
});
export type CreateRecipe = z.infer<typeof CreateRecipeSchema>;

export const CreateProductionBatchSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
  warehouseId: z.string().uuid(),
  recipeId: z.string().uuid(),
  batchNumber: z.string().min(2).max(50),
  plannedYield: z.string().regex(/^\d+(\.\d{1,4})?$/),
  notes: z.string().max(500).optional(),
});
export type CreateProductionBatch = z.infer<typeof CreateProductionBatchSchema>;

export const CompleteProductionBatchSchema = z.object({
  actualYield: z.string().regex(/^\d+(\.\d{1,4})?$/),
  consumedLines: z.array(
    z.object({
      ingredientItemId: z.string().uuid(),
      uomId: z.string().uuid(),
      actualQuantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
    })
  ).min(1),
  notes: z.string().max(500).optional(),
});
export type CompleteProductionBatch = z.infer<typeof CompleteProductionBatchSchema>;

export const CreateWasteRecordSchema = z.object({
  legalEntityId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  itemId: z.string().uuid(),
  uomId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
  unitCost: z.string().regex(/^\d+(\.\d{1,4})?$/),
  reason: z.string().min(2).max(50),
  notes: z.string().max(500).optional(),
});
export type CreateWasteRecord = z.infer<typeof CreateWasteRecordSchema>;

// ====================================================================
// 11. POS Dining Operations Contracts
// ====================================================================

export const CreateDiningTableSchema = z.object({
  branchId: z.string().uuid(),
  tableNumber: z.string().min(1).max(20),
  section: z.string().max(50).default('MAIN'),
  capacity: z.number().int().min(1).default(4),
});
export type CreateDiningTable = z.infer<typeof CreateDiningTableSchema>;

export const OpenTableSessionSchema = z.object({
  branchId: z.string().uuid(),
  tableId: z.string().uuid(),
  guestCount: z.number().int().min(1).default(1),
  serverUserId: z.string().uuid().optional(),
});
export type OpenTableSession = z.infer<typeof OpenTableSessionSchema>;

export const AddOrderLineModifierSchema = z.object({
  orderLineId: z.string().uuid(),
  modifierNameAr: z.string().min(1).max(100),
  modifierNameEn: z.string().min(1).max(100),
  priceDelta: z.string().regex(/^-?\d+(\.\d{1,4})?$/).default('0.0000'),
  quantity: z.number().int().min(1).default(1),
});
export type AddOrderLineModifier = z.infer<typeof AddOrderLineModifierSchema>;

export const VoidOrderLineSchema = z.object({
  legalEntityId: z.string().uuid(),
  orderId: z.string().uuid(),
  orderLineId: z.string().uuid().optional(),
  reason: z.string().min(2).max(100),
  voidAmount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  approvedBy: z.string().uuid(),
  notes: z.string().max(500).optional(),
});
export type VoidOrderLine = z.infer<typeof VoidOrderLineSchema>;

// ====================================================================
// 12. Accounting Foundation Contracts
// ====================================================================

export const CreateChartOfAccountSchema = z.object({
  legalEntityId: z.string().uuid(),
  accountCode: z.string().min(1).max(50),
  name: z.string().min(2).max(255),
  accountType: z.nativeEnum(AccountType).default(AccountType.ASSET),
  normalBalance: z.nativeEnum(NormalBalance).default(NormalBalance.DEBIT),
  parentId: z.string().uuid().optional().nullable(),
  isPostable: z.boolean().default(true),
});
export type CreateChartOfAccount = z.infer<typeof CreateChartOfAccountSchema>;

export const JournalLineCreateSchema = z.object({
  accountId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  debit: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
  credit: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
  currency: z.string().length(3).default('SAR'),
  description: z.string().max(255).optional(),
});

export const CreateJournalEntrySchema = z.object({
  legalEntityId: z.string().uuid(),
  journalNumber: z.string().min(2).max(50),
  journalType: z.nativeEnum(JournalType).default(JournalType.GENERAL),
  sourceType: z.string().min(2).max(50),
  sourceId: z.string().uuid(),
  lines: z.array(JournalLineCreateSchema).min(2),
}).refine(
  (data) => {
    // Validate balanced entry: Sum(debit) == Sum(credit)
    const totalDebit = data.lines.reduce((acc, l) => acc + parseFloat(l.debit || '0'), 0);
    const totalCredit = data.lines.reduce((acc, l) => acc + parseFloat(l.credit || '0'), 0);
    return Math.abs(totalDebit - totalCredit) < 0.0001;
  },
  {
    message: 'Double-entry accounting violation: Total Debits must strictly equal Total Credits',
    path: ['lines'],
  }
);
export type CreateJournalEntry = z.infer<typeof CreateJournalEntrySchema>;

// ====================================================================
// 13. POS Operations & Shift Management Contracts
// ====================================================================

export const OpenShiftSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid(),
  deviceId: z.string().uuid(),
  openingCash: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
});
export type OpenShiftRequest = z.infer<typeof OpenShiftSchema>;

export const ClosePosShiftSchema = z.object({
  shiftId: z.string().uuid(),
  countedCash: z.string().regex(/^\d+(\.\d{1,4})?$/),
  notes: z.string().max(500).optional(),
});
export type ClosePosShiftRequest = z.infer<typeof ClosePosShiftSchema>;

export const ShiftCashTransactionSchema = z.object({
  shiftId: z.string().uuid(),
  transactionType: z.nativeEnum(ShiftCashTransactionType),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  reason: z.string().min(2).max(255),
});
export type ShiftCashTransactionRequest = z.infer<typeof ShiftCashTransactionSchema>;

// ====================================================================
// 14. POS Sales Orders & Payments Contracts
// ====================================================================

export const OrderLineModifierInputSchema = z.object({
  modifierNameAr: z.string().min(1).max(100),
  modifierNameEn: z.string().min(1).max(100).default(''),
  priceDelta: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
  quantity: z.number().int().positive().default(1),
});
export type OrderLineModifierInput = z.infer<typeof OrderLineModifierInputSchema>;

export const OrderLineInputSchema = z.object({
  itemId: z.string().uuid(),
  uomId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
  unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/),
  discountAmount: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
  notes: z.string().max(255).optional(),
  modifiers: z.array(OrderLineModifierInputSchema).optional(),
});
export type OrderLineInput = z.infer<typeof OrderLineInputSchema>;

export const PaymentInputSchema = z.object({
  paymentMethod: z.nativeEnum(PaymentMethod),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  providerCode: z.string().max(50).optional(),
  providerTransactionRef: z.string().max(100).optional(),
  idempotencyKey: z.string().max(255).optional(),
});
export type PaymentInput = z.infer<typeof PaymentInputSchema>;

export const CreateSalesOrderSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid(),
  deviceId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  shiftId: z.string().uuid().optional(),
  tableId: z.string().uuid().optional(),
  orderNumber: z.string().min(2).max(50),
  orderType: z.nativeEnum(OrderType).default(OrderType.TAKEAWAY),
  channel: z.nativeEnum(OrderChannel).default(OrderChannel.POS),
  idempotencyKey: z.string().max(255).optional(),
  notes: z.string().max(500).optional(),
  lines: z.array(OrderLineInputSchema).min(1),
  payments: z.array(PaymentInputSchema).optional(),
});
export type CreateSalesOrderRequest = z.infer<typeof CreateSalesOrderSchema>;

export const TransferTableOrderSchema = z.object({
  orderId: z.string().uuid(),
  fromTableId: z.string().uuid(),
  toTableId: z.string().uuid(),
});
export type TransferTableOrderRequest = z.infer<typeof TransferTableOrderSchema>;

// ====================================================================
// 15. Supplier Payments Contracts
// ====================================================================

export const CreateSupplierPaymentSchema = z.object({
  legalEntityId: z.string().uuid(),
  supplierId: z.string().uuid(),
  invoiceId: z.string().uuid().optional().nullable(),
  paymentNumber: z.string().min(2).max(50),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  paymentMethod: z.nativeEnum(SupplierPaymentMethod).default(SupplierPaymentMethod.BANK_TRANSFER),
  referenceNumber: z.string().max(100).optional(),
  bankAccountId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
});
export type CreateSupplierPaymentRequest = z.infer<typeof CreateSupplierPaymentSchema>;

// ====================================================================
// 16. Fiscal Periods & Period Closing Contracts
// ====================================================================

export const CreateFiscalPeriodSchema = z.object({
  legalEntityId: z.string().uuid(),
  periodName: z.string().min(2).max(50),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});
export type CreateFiscalPeriodRequest = z.infer<typeof CreateFiscalPeriodSchema>;

export const CloseFiscalPeriodSchema = z.object({
  periodId: z.string().uuid(),
});
export type CloseFiscalPeriodRequest = z.infer<typeof CloseFiscalPeriodSchema>;

export const ReverseJournalEntrySchema = z.object({
  journalEntryId: z.string().uuid(),
  reversalReason: z.string().min(3).max(255),
  newJournalNumber: z.string().min(2).max(50),
});
export type ReverseJournalEntryRequest = z.infer<typeof ReverseJournalEntrySchema>;



