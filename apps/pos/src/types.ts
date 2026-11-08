export interface PosCategory {
  id: string;
  nameAr: string;
  nameEn: string;
  iconName: string;
}

export interface ItemModifier {
  id: string;
  nameAr: string;
  nameEn?: string;
  priceDelta: number; // e.g. 4.00 SAR
}

export interface PosProduct {
  id: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  categoryId: string;
  price: number; // Base price before tax
  taxRate: number; // 0.15
  isAvailable: boolean;
  stockQty: number;
  availableModifiers?: ItemModifier[];
}

export interface CartItem {
  product: PosProduct;
  quantity: number;
  notes?: string;
  modifiers?: ItemModifier[];
}

export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type PaymentMethod = 'MADA' | 'CASH' | 'APPLE_PAY' | 'VISA_MC';
