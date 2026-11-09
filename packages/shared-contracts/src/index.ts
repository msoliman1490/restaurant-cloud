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
  VoucherStatus,
  PaymentVoucherType,
  ReceiptVoucherType,
  DefaultAccountMappingKey,
  WarehouseType,
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

export const UpdateLegalEntityRequestSchema = z.object({
  legalName: z.string().min(2).max(255).optional(),
  commercialName: z.string().max(255).optional(),
  crNumber: z.string().optional(),
  vatNumber: z.string().regex(/^\d{15}$/, 'Saudi VAT number must be 15 digits').optional(),
  timezone: z.string().optional(),
});

export type UpdateLegalEntityRequest = z.infer<typeof UpdateLegalEntityRequestSchema>;

export const CreateBranchRequestSchema = z.object({
  legalEntityId: z.string().uuid(),
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(255),
  businessType: z.nativeEnum(BusinessType).default(BusinessType.RESTAURANT),
  timezone: z.string().default('Asia/Riyadh'),
});

export type CreateBranchRequest = z.infer<typeof CreateBranchRequestSchema>;

export const UpdateBranchRequestSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  code: z.string().min(2).max(50).optional(),
  businessType: z.nativeEnum(BusinessType).optional(),
  timezone: z.string().optional(),
});

export type UpdateBranchRequest = z.infer<typeof UpdateBranchRequestSchema>;

export const CreateWarehouseRequestSchema = z.object({
  legalEntityId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional().nullable(),
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(255),
  nameAr: z.string().min(2).max(255).optional(),
  nameEn: z.string().max(255).optional(),
  warehouseType: z.nativeEnum(WarehouseType).default(WarehouseType.BRANCH),
  managerId: z.string().uuid().optional().nullable(),
  address: z.string().max(500).optional(),
  allowReceiving: z.boolean().default(true),
  allowIssuing: z.boolean().default(true),
  allowTransfer: z.boolean().default(true),
});

export type CreateWarehouseRequest = z.infer<typeof CreateWarehouseRequestSchema>;

export const UpdateWarehouseRequestSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  nameAr: z.string().min(2).max(255).optional(),
  nameEn: z.string().max(255).optional(),
  managerId: z.string().uuid().optional().nullable(),
  address: z.string().max(500).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  allowReceiving: z.boolean().optional(),
  allowIssuing: z.boolean().optional(),
  allowTransfer: z.boolean().optional(),
});

export type UpdateWarehouseRequest = z.infer<typeof UpdateWarehouseRequestSchema>;

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

export const UpdateUserStatusRequestSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

export type UpdateUserStatusRequest = z.infer<typeof UpdateUserStatusRequestSchema>;

export const UpdateUserScopesRequestSchema = z.object({
  roleId: z.string().uuid().optional(),
  scopes: z.array(
    z.object({
      scopeType: z.nativeEnum(ScopeType),
      scopeId: z.string().uuid(),
    })
  ),
});

export type UpdateUserScopesRequest = z.infer<typeof UpdateUserScopesRequestSchema>;

export const CreateRoleRequestSchema = z.object({
  code: z.string().min(2).max(50),
  name: z.string().min(2).max(255),
  permissionIds: z.array(z.string().uuid()).min(1),
});

export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;

export const UpdateTenantSettingsRequestSchema = z.object({
  displayName: z.string().min(2).max(255).optional(),
  primaryLocale: z.string().max(10).optional(),
  timezone: z.string().max(50).optional(),
});

export type UpdateTenantSettingsRequest = z.infer<typeof UpdateTenantSettingsRequestSchema>;

export const AuditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  entityType: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().uuid().optional(),
});

export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

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
export const ItemBarcodeSchema = z.object({
  barcode: z.string().min(1).max(100),
  barcodeType: z.string().max(50).default('CODE128'),
  isPrimary: z.boolean().default(false),
});
export type ItemBarcode = z.infer<typeof ItemBarcodeSchema>;

export const CreateItemRequestSchema = z.object({
  legalEntityOwnerId: z.string().uuid(),
  categoryId: z.string().uuid().optional().nullable(),
  baseUomId: z.string().uuid(),
  sku: z.string().min(2).max(50),
  barcode: z.string().max(100).optional().nullable(),
  barcodes: z.array(ItemBarcodeSchema).optional(),
  nameAr: z.string().min(2).max(255),
  nameEn: z.string().min(2).max(255),
  description: z.string().max(2000).optional().nullable(),
  productType: z.nativeEnum(ProductType).default(ProductType.STOCKED),
  trackingPolicy: z.nativeEnum(TrackingPolicy).default(TrackingPolicy.NONE),
  costingMethod: z.nativeEnum(CostingMethod).default(CostingMethod.WEIGHTED_AVERAGE),
  defaultCost: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
  defaultPrice: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
  taxRate: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.1500'),
  minStockLevel: z.string().regex(/^\d+(\.\d{1,4})?$/).optional().nullable(),
  maxStockLevel: z.string().regex(/^\d+(\.\d{1,4})?$/).optional().nullable(),
  isSold: z.boolean().default(true),
  isPurchased: z.boolean().default(true),
  isRecipeIngredient: z.boolean().default(false),
  isActive: z.boolean().default(true),
  primaryImageUrl: z.string().optional().nullable(),
  mediaFileIds: z.array(z.string().uuid()).optional(),
  branchPrices: z.array(z.object({
    branchId: z.string().uuid(),
    price: z.string().regex(/^\d+(\.\d{1,4})?$/),
    costOverride: z.string().regex(/^\d+(\.\d{1,4})?$/).optional().nullable(),
  })).optional(),
});
export type CreateItemRequest = z.infer<typeof CreateItemRequestSchema>;

export const UpdateItemRequestSchema = CreateItemRequestSchema.partial().omit({ legalEntityOwnerId: true });
export type UpdateItemRequest = z.infer<typeof UpdateItemRequestSchema>;

export const ChangeItemPriceRequestSchema = z.object({
  defaultPrice: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be valid price decimal'),
  branchPrices: z.array(z.object({
    branchId: z.string().uuid(),
    price: z.string().regex(/^\d+(\.\d{1,4})?$/),
  })).optional(),
  reason: z.string().max(255).optional(),
});
export type ChangeItemPriceRequest = z.infer<typeof ChangeItemPriceRequestSchema>;

export const ChangeItemCostRequestSchema = z.object({
  defaultCost: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be valid cost decimal'),
  reason: z.string().max(255).optional(),
});
export type ChangeItemCostRequest = z.infer<typeof ChangeItemCostRequestSchema>;

export const ArchiveItemRequestSchema = z.object({
  reason: z.string().max(255).optional(),
});
export type ArchiveItemRequest = z.infer<typeof ArchiveItemRequestSchema>;

export const ItemListQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  legalEntityOwnerId: z.string().uuid().optional(),
  productType: z.nativeEnum(ProductType).optional(),
  isSold: z.boolean().optional(),
  isActive: z.boolean().optional(),
  isArchived: z.preprocess((val) => val === 'true' ? true : val === 'false' ? false : val, z.boolean().optional()),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ItemListQuery = z.infer<typeof ItemListQuerySchema>;

// Media Contracts
export const MediaFileResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  entityType: z.string().nullable(),
  entityId: z.string().uuid().nullable(),
  fileName: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  fileSize: z.number().int(),
  publicUrl: z.string(),
  isPrimary: z.boolean(),
  createdAt: z.string(),
});
export type MediaFileResponse = z.infer<typeof MediaFileResponseSchema>;

export const AttachMediaRequestSchema = z.object({
  entityType: z.string().min(1).max(50),
  entityId: z.string().uuid(),
  mediaFileIds: z.array(z.string().uuid()),
  primaryMediaId: z.string().uuid().optional(),
});
export type AttachMediaRequest = z.infer<typeof AttachMediaRequestSchema>;

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
  legalEntityId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  movementType: z.nativeEnum(MovementType).optional(),
  direction: z.nativeEnum(MovementDirection).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type InventoryMovementQuery = z.infer<typeof InventoryMovementQuerySchema>;

// Stock Receiving & Issuing Contracts (Phase A WMS)
export const ReceiveStockRequestSchema = z.object({
  legalEntityId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  itemId: z.string().uuid(),
  uomId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Quantity must be positive'),
  unitCost: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Unit cost must be positive'),
  movementType: z.nativeEnum(MovementType).default(MovementType.PURCHASE_RECEIPT),
  sourceType: z.string().default('PURCHASE_INVOICE'),
  sourceId: z.string().uuid().optional(),
  sourceDocumentNumber: z.string().max(100).optional(),
  batchNumber: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});
export type ReceiveStockRequest = z.infer<typeof ReceiveStockRequestSchema>;

export const IssueStockRequestSchema = z.object({
  legalEntityId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  itemId: z.string().uuid(),
  uomId: z.string().uuid(),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Quantity must be positive'),
  movementType: z.nativeEnum(MovementType).default(MovementType.INTERNAL_CONSUMPTION),
  sourceType: z.string().default('MANUAL_ISSUE'),
  sourceId: z.string().uuid().optional(),
  sourceDocumentNumber: z.string().max(100).optional(),
  batchNumber: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});
export type IssueStockRequest = z.infer<typeof IssueStockRequestSchema>;

export const ReverseInventoryMovementSchema = z.object({
  movementId: z.string().uuid(),
  reversalReason: z.string().min(3).max(255),
  newMovementNumber: z.string().min(2).max(50).optional(),
});
export type ReverseInventoryMovementRequest = z.infer<typeof ReverseInventoryMovementSchema>;

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
  nameAr: z.string().min(2).max(255).optional(),
  nameEn: z.string().max(255).optional(),
  description: z.string().optional(),
  accountType: z.nativeEnum(AccountType).default(AccountType.ASSET),
  normalBalance: z.nativeEnum(NormalBalance).default(NormalBalance.DEBIT),
  parentId: z.string().uuid().optional().nullable(),
  level: z.number().int().min(1).default(1),
  isPostable: z.boolean().default(true),
  currency: z.string().length(3).default('SAR'),
});
export type CreateChartOfAccount = z.infer<typeof CreateChartOfAccountSchema>;

export const UpdateChartOfAccountSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  nameAr: z.string().min(2).max(255).optional(),
  nameEn: z.string().max(255).optional(),
  description: z.string().optional(),
  parentId: z.string().uuid().optional().nullable(),
  isPostable: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateChartOfAccountRequest = z.infer<typeof UpdateChartOfAccountSchema>;

export const JournalLineCreateSchema = z.object({
  accountId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  costCenterId: z.string().uuid().optional().nullable(),
  debit: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
  credit: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.0000'),
  currency: z.string().length(3).default('SAR'),
  description: z.string().max(255).optional(),
});

export const CreateJournalEntrySchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  journalNumber: z.string().min(2).max(50),
  journalType: z.nativeEnum(JournalType).default(JournalType.GENERAL),
  sourceType: z.string().min(2).max(50),
  sourceId: z.string().uuid(),
  description: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  entryDate: z.string().datetime().optional(),
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

// ====================================================================
// 17. Cost Centers & Financial Dimensions
// ====================================================================

export const CreateCostCenterSchema = z.object({
  legalEntityId: z.string().uuid(),
  code: z.string().min(1).max(50),
  nameAr: z.string().min(2).max(255),
  nameEn: z.string().max(255).optional(),
  parentId: z.string().uuid().optional().nullable(),
});
export type CreateCostCenterRequest = z.infer<typeof CreateCostCenterSchema>;

export const UpdateCostCenterSchema = z.object({
  nameAr: z.string().min(2).max(255).optional(),
  nameEn: z.string().max(255).optional(),
  parentId: z.string().uuid().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateCostCenterRequest = z.infer<typeof UpdateCostCenterSchema>;

// ====================================================================
// 18. Default Account Mappings
// ====================================================================

export const SetAccountMappingSchema = z.object({
  legalEntityId: z.string().uuid(),
  mappingKey: z.string().min(1).max(50),
  accountId: z.string().uuid(),
  description: z.string().max(255).optional(),
});
export type SetAccountMappingRequest = z.infer<typeof SetAccountMappingSchema>;

// ====================================================================
// 19. Cash Vaults & Safes
// ====================================================================

export const CreateCashVaultSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  code: z.string().min(1).max(50),
  nameAr: z.string().min(2).max(255),
  nameEn: z.string().max(255).optional(),
  accountId: z.string().uuid(),
  custodianId: z.string().uuid().optional().nullable(),
});
export type CreateCashVaultRequest = z.infer<typeof CreateCashVaultSchema>;

export const UpdateCashVaultSchema = z.object({
  nameAr: z.string().min(2).max(255).optional(),
  nameEn: z.string().max(255).optional(),
  custodianId: z.string().uuid().optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateCashVaultRequest = z.infer<typeof UpdateCashVaultSchema>;

export const VaultTransferSchema = z.object({
  legalEntityId: z.string().uuid(),
  fromVaultId: z.string().uuid(),
  toVaultId: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  notes: z.string().max(500).optional(),
});
export type VaultTransferRequest = z.infer<typeof VaultTransferSchema>;

export const VaultPhysicalCountSchema = z.object({
  legalEntityId: z.string().uuid(),
  vaultId: z.string().uuid(),
  actualAmount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  notes: z.string().max(500).optional(),
});
export type VaultPhysicalCountRequest = z.infer<typeof VaultPhysicalCountSchema>;

// ====================================================================
// 20. Bank Accounts & Reconciliations
// ====================================================================

export const CreateBankAccountSchema = z.object({
  legalEntityId: z.string().uuid(),
  bankName: z.string().min(2).max(255),
  accountNumber: z.string().min(2).max(100),
  iban: z.string().max(50).optional(),
  swiftCode: z.string().max(50).optional(),
  currency: z.string().length(3).default('SAR'),
  accountId: z.string().uuid(),
});
export type CreateBankAccountRequest = z.infer<typeof CreateBankAccountSchema>;

export const UpdateBankAccountSchema = z.object({
  bankName: z.string().min(2).max(255).optional(),
  iban: z.string().max(50).optional(),
  swiftCode: z.string().max(50).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateBankAccountRequest = z.infer<typeof UpdateBankAccountSchema>;

export const BankReconciliationSchema = z.object({
  legalEntityId: z.string().uuid(),
  bankAccountId: z.string().uuid(),
  statementDate: z.string().datetime(),
  statementEndingBalance: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
  notes: z.string().max(500).optional(),
});
export type BankReconciliationRequest = z.infer<typeof BankReconciliationSchema>;

// ====================================================================
// 21. Payment Vouchers (سندات الصرف)
// ====================================================================

export const CreatePaymentVoucherSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  voucherNumber: z.string().min(1).max(50),
  voucherDate: z.string().datetime().optional(),
  voucherType: z.nativeEnum(PaymentVoucherType).default(PaymentVoucherType.VENDOR_PAYMENT),
  beneficiaryType: z.string().default('VENDOR'),
  beneficiaryId: z.string().uuid().optional().nullable(),
  beneficiaryName: z.string().min(2).max(255),
  sourceType: z.enum(['VAULT', 'BANK']).default('VAULT'),
  sourceId: z.string().uuid(),
  accountId: z.string().uuid(),
  costCenterId: z.string().uuid().optional().nullable(),
  paymentMethod: z.string().default('CASH'),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  currency: z.string().length(3).default('SAR'),
  exchangeRate: z.string().regex(/^\d+(\.\d{1,6})?$/).default('1.000000'),
  notes: z.string().max(500).optional(),
});
export type CreatePaymentVoucherRequest = z.infer<typeof CreatePaymentVoucherSchema>;

// ====================================================================
// 22. Receipt Vouchers (سندات القبض)
// ====================================================================

export const CreateReceiptVoucherSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  voucherNumber: z.string().min(1).max(50),
  voucherDate: z.string().datetime().optional(),
  voucherType: z.nativeEnum(ReceiptVoucherType).default(ReceiptVoucherType.CUSTOMER_PAYMENT),
  payerType: z.string().default('CUSTOMER'),
  payerId: z.string().uuid().optional().nullable(),
  payerName: z.string().min(2).max(255),
  destinationType: z.enum(['VAULT', 'BANK']).default('VAULT'),
  destinationId: z.string().uuid(),
  accountId: z.string().uuid(),
  paymentMethod: z.string().default('CASH'),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
  currency: z.string().length(3).default('SAR'),
  exchangeRate: z.string().regex(/^\d+(\.\d{1,6})?$/).default('1.000000'),
  notes: z.string().max(500).optional(),
});
export type CreateReceiptVoucherRequest = z.infer<typeof CreateReceiptVoucherSchema>;

// ====================================================================
// 23. Expenses (المصروفات التشغيلية)
// ====================================================================

export const CreateExpenseSchema = z.object({
  legalEntityId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
  costCenterId: z.string().uuid().optional().nullable(),
  expenseNumber: z.string().min(1).max(50),
  expenseDate: z.string().datetime().optional(),
  category: z.string().min(2).max(100),
  accountId: z.string().uuid(),
  vendorName: z.string().max(255).optional(),
  subtotal: z.string().regex(/^\d+(\.\d{1,4})?$/),
  taxRate: z.string().regex(/^\d+(\.\d{1,4})?$/).default('0.1500'),
  notes: z.string().max(500).optional(),
  paymentVoucherId: z.string().uuid().optional().nullable(),
});
export type CreateExpenseRequest = z.infer<typeof CreateExpenseSchema>;

// ====================================================================
// 24. Year-End Closing & Fiscal Operations
// ====================================================================

export const YearEndClosingSchema = z.object({
  legalEntityId: z.string().uuid(),
  closingFiscalYear: z.string().min(4).max(10),
  retainedEarningsAccountId: z.string().uuid(),
  closingJournalNumber: z.string().min(1).max(50),
  notes: z.string().max(500).optional(),
});
export type YearEndClosingRequest = z.infer<typeof YearEndClosingSchema>;

// ====================================================================
// 25. Financial Reports & Tax Queries
// ====================================================================

export const FinancialReportQuerySchema = z.object({
  legalEntityId: z.string().uuid(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  branchId: z.string().uuid().optional(),
  costCenterId: z.string().uuid().optional(),
});
export type FinancialReportQuery = z.infer<typeof FinancialReportQuerySchema>;

export const VatReturnReportQuerySchema = z.object({
  legalEntityId: z.string().uuid(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});
export type VatReturnReportQuery = z.infer<typeof VatReturnReportQuerySchema>;

export const AgingReportQuerySchema = z.object({
  legalEntityId: z.string().uuid(),
  asOfDate: z.string().datetime().optional(),
  entityType: z.enum(['CUSTOMER', 'SUPPLIER']).default('CUSTOMER'),
});
export type AgingReportQuery = z.infer<typeof AgingReportQuerySchema>;




