export interface Category {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  displayOrder: number;
  isActive: boolean;
}

export interface ProductItem {
  id: string;
  sku: string;
  barcode?: string;
  barcodes?: Array<{ barcode: string; barcodeType: string; isPrimary: boolean }>;
  nameAr: string;
  nameEn: string;
  description?: string;
  categoryId: string;
  categoryName?: string;
  productType?: string;
  baseUom: string;
  defaultCost: number;
  defaultPrice: number;
  taxRate: number;
  minStockLevel?: number;
  maxStockLevel?: number;
  isSold?: boolean;
  isPurchased?: boolean;
  isRecipeIngredient?: boolean;
  isActive: boolean;
  isArchived?: boolean;
  primaryImageUrl?: string;
  mediaFiles?: Array<{ id: string; publicUrl: string; fileName: string; isPrimary: boolean; mimeType: string }>;
  onHandQty?: number;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  branchName?: string;
  warehouseType?: string;
  status?: string;
  address?: string;
  allowReceiving?: boolean;
  allowIssuing?: boolean;
  allowTransfer?: boolean;
}

export interface StockBalance {
  id: string;
  warehouseId: string;
  warehouseName: string;
  warehouseCode?: string;
  warehouseType?: string;
  itemId: string;
  itemSku: string;
  itemName: string;
  onHandQty: number;
  reservedQty: number;
  inTransitQty?: number;
  damagedQty?: number;
  underInspectionQty?: number;
  availableQty?: number;
  unitCost: number;
  wacCost?: number;
  totalValue: number;
  minStock?: number;
  maxStock?: number;
  reorderPoint?: number;
  availabilityStatus?: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'OVER_STOCKED';
}

export interface StockTransfer {
  id: string;
  transferNumber: string;
  sourceWarehouseName: string;
  destinationWarehouseName: string;
  status: 'DRAFT' | 'APPROVED' | 'IN_TRANSIT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'REJECTED' | 'CANCELLED' | 'CLOSED';
  itemCount: number;
  totalShippedQty?: number;
  totalReceivedQty?: number;
  totalDamagedQty?: number;
  totalLostQty?: number;
  requestedAt: string;
  approvedAt?: string;
  notes?: string;
}

export interface StocktakeOrder {
  id: string;
  orderNumber: string;
  warehouseName: string;
  stocktakeType: 'FULL' | 'PARTIAL';
  countFrequency: 'PERIODIC' | 'SURPRISE';
  status: 'DRAFT' | 'IN_PROGRESS' | 'COUNTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  freezeMovements: boolean;
  itemCount: number;
  countedCount: number;
  totalVarianceQty: number;
  totalVarianceAmount: number;
  createdAt: string;
  countedAt?: string;
  approvedAt?: string;
  notes?: string;
}

export interface InventoryMovementRow {
  id: string;
  movementNumber: string;
  movementType: string;
  direction: 'IN' | 'OUT';
  warehouseName: string;
  itemName: string;
  itemSku: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  batchNumber?: string;
  notes?: string;
  occurredAt: string;
  isReversed: boolean;
  reversalOfId?: string;
}
