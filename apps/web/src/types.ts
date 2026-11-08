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
  nameAr: string;
  nameEn: string;
  categoryId: string;
  categoryName?: string;
  baseUom: string;
  defaultCost: number;
  defaultPrice: number;
  taxRate: number;
  isActive: boolean;
  onHandQty?: number;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  branchName: string;
}

export interface StockBalance {
  id: string;
  warehouseId: string;
  warehouseName: string;
  itemId: string;
  itemSku: string;
  itemName: string;
  onHandQty: number;
  reservedQty: number;
  unitCost: number;
  totalValue: number;
}

export interface StockTransfer {
  id: string;
  transferNumber: string;
  sourceWarehouseName: string;
  destinationWarehouseName: string;
  status: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';
  itemCount: number;
  requestedAt: string;
}
