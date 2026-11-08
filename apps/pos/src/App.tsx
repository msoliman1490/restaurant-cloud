import { useState, useEffect } from 'react';
import { PosHeader } from './components/PosHeader';
import { ProductGrid } from './components/ProductGrid';
import { CartDrawer } from './components/CartDrawer';
import { PaymentModal } from './components/PaymentModal';
import { PosCategory, PosProduct, CartItem, OrderType, ItemModifier } from './types';
import { posApi } from './api/posApi';

const INITIAL_CATEGORIES: PosCategory[] = [
  { id: 'BURGERS', nameAr: 'برجر وساندوتشات', nameEn: 'Burgers', iconName: 'utensils' },
  { id: 'PIZZA', nameAr: 'بيتزا ومعجنات', nameEn: 'Pizza', iconName: 'pizza' },
  { id: 'SIDES', nameAr: 'بطاطس ومقبلات', nameEn: 'Sides & Fries', iconName: 'french-fries' },
  { id: 'BEVERAGES', nameAr: 'مشروبات وعصائر', nameEn: 'Drinks', iconName: 'coffee' },
  { id: 'DESSERTS', nameAr: 'حلويات وآيس كريم', nameEn: 'Desserts', iconName: 'ice-cream' },
];

const INITIAL_PRODUCTS: PosProduct[] = [
  {
    id: 'p-1',
    sku: 'BRG-001',
    nameAr: 'برجر أنجوس كلاسيك لحم',
    nameEn: 'Classic Angus Beef',
    categoryId: 'BURGERS',
    price: 30.43, // 35.00 SAR including 15% VAT
    taxRate: 0.15,
    isAvailable: true,
    stockQty: 85,
  },
  {
    id: 'p-2',
    sku: 'BRG-002',
    nameAr: 'برجر دجاج كرسبي مقرمش',
    nameEn: 'Crispy Chicken Burger',
    categoryId: 'BURGERS',
    price: 24.35, // 28.00 SAR with tax
    taxRate: 0.15,
    isAvailable: true,
    stockQty: 42,
  },
  {
    id: 'p-3',
    sku: 'BRG-003',
    nameAr: 'دبل برجر مع جبنة تشيدر ذائبة',
    nameEn: 'Double Cheddar Burger',
    categoryId: 'BURGERS',
    price: 36.52, // 42.00 SAR with tax
    taxRate: 0.15,
    isAvailable: true,
    stockQty: 30,
  },
  {
    id: 'p-4',
    sku: 'PIZ-001',
    nameAr: 'بيتزا مارجريتا نابولي كبيرة',
    nameEn: 'Neapolitan Margherita Large',
    categoryId: 'PIZZA',
    price: 39.13, // 45.00 SAR with tax
    taxRate: 0.15,
    isAvailable: true,
    stockQty: 25,
  },
  {
    id: 'p-5',
    sku: 'PIZ-002',
    nameAr: 'بيتزا بيبروني لحم بقري مدخن',
    nameEn: 'Smoked Pepperoni Pizza',
    categoryId: 'PIZZA',
    price: 43.48, // 50.00 SAR with tax
    taxRate: 0.15,
    isAvailable: true,
    stockQty: 20,
  },
  {
    id: 'p-6',
    sku: 'SID-001',
    nameAr: 'بطاطس مقلية متبلة ومقرمشة',
    nameEn: 'Seasoned French Fries',
    categoryId: 'SIDES',
    price: 10.43, // 12.00 SAR with tax
    taxRate: 0.15,
    isAvailable: true,
    stockQty: 150,
  },
  {
    id: 'p-7',
    sku: 'SID-002',
    nameAr: 'أصابع جبنة موتزاريلا (5 حبات)',
    nameEn: 'Mozzarella Sticks (5pcs)',
    categoryId: 'SIDES',
    price: 15.65, // 18.00 SAR with tax
    taxRate: 0.15,
    isAvailable: true,
    stockQty: 60,
  },
  {
    id: 'p-8',
    sku: 'BEV-001',
    nameAr: 'كوكاكولا بارد 330 مل',
    nameEn: 'Coca Cola Can 330ml',
    categoryId: 'BEVERAGES',
    price: 5.22, // 6.00 SAR with tax
    taxRate: 0.15,
    isAvailable: true,
    stockQty: 240,
  },
  {
    id: 'p-9',
    sku: 'BEV-002',
    nameAr: 'عصير برتقال طبيعي طازج',
    nameEn: 'Fresh Orange Juice',
    categoryId: 'BEVERAGES',
    price: 13.04, // 15.00 SAR with tax
    taxRate: 0.15,
    isAvailable: true,
    stockQty: 50,
  },
  {
    id: 'p-10',
    sku: 'DES-001',
    nameAr: 'كيكة الشوكولاتة الذائبة (لافا)',
    nameEn: 'Chocolate Lava Cake',
    categoryId: 'DESSERTS',
    price: 21.74, // 25.00 SAR with tax
    taxRate: 0.15,
    isAvailable: true,
    stockQty: 35,
  },
];

export default function App() {
  const [categories, setCategories] = useState<PosCategory[]>(INITIAL_CATEGORIES);
  const [products, setProducts] = useState<PosProduct[]>(INITIAL_PRODUCTS);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('DINE_IN');
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    const loadLiveCatalog = async () => {
      try {
        const [liveCats, liveProds] = await Promise.all([
          posApi.getCategories(),
          posApi.getProducts(),
        ]);
        if (mounted) {
          if (liveCats.length > 0) setCategories(liveCats);
          if (liveProds.length > 0) setProducts(liveProds);
        }
      } catch {
        // Keeps initial fallback on failure
      }
    };
    loadLiveCatalog();
    return () => {
      mounted = false;
    };
  }, []);

  // Add product to cart or increment quantity
  const handleAddToCart = (product: PosProduct) => {
    setCartItems((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  // Update quantity (+1 or -1)
  const handleUpdateQuantity = (productId: string, delta: number) => {
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.product.id === productId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  // Remove single line
  const handleRemoveItem = (productId: string) => {
    setCartItems((prev) => prev.filter((item) => item.product.id !== productId));
  };

  // Clear all items
  const handleClearCart = () => {
    if (cartItems.length > 0 && window.confirm('هل أنت متأكد من إلغاء محتويات الطلب الحالية؟')) {
      setCartItems([]);
    }
  };

  // Toggle modifier on cart item
  const handleToggleModifier = (productId: string, modifier: ItemModifier) => {
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.product.id !== productId) return item;
        const currentMods = item.modifiers || [];
        const exists = currentMods.some((m) => m.id === modifier.id);
        const updatedMods = exists
          ? currentMods.filter((m) => m.id !== modifier.id)
          : [...currentMods, modifier];
        return { ...item, modifiers: updatedMods };
      })
    );
  };

  const handleOrderComplete = () => {
    setCartItems([]);
  };

  const subtotal = cartItems.reduce((sum, item) => {
    const modTotal = item.modifiers?.reduce((mSum, m) => mSum + m.priceDelta, 0) || 0;
    return sum + (item.product.price + modTotal) * item.quantity;
  }, 0);
  const vatAmount = subtotal * 0.15;
  const grandTotal = subtotal + vatAmount;

  return (
    <div className="h-screen w-screen bg-slate-900 flex flex-col overflow-hidden font-sans select-none" dir="rtl">
      {/* Top Header */}
      <PosHeader
        branchName="فرع الرياض العليا — مطاعم النخبة"
        terminalCode="POS-01"
        cashierName="أحمد المحمد"
        shiftNumber={104}
      />

      {/* Main Cashier Workspace (Split View) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left/Center: Touch Product Grid */}
        <ProductGrid
          categories={categories}
          products={products}
          onAddToCart={handleAddToCart}
        />

        {/* Right: Order Cart Panel */}
        <CartDrawer
          items={cartItems}
          orderType={orderType}
          onChangeOrderType={setOrderType}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={handleRemoveItem}
          onToggleModifier={handleToggleModifier}
          onClearCart={handleClearCart}
          onOpenPayment={() => setIsPaymentOpen(true)}
        />
      </div>

      {/* Payment and ZATCA E-Invoice Modal */}
      {isPaymentOpen && (
        <PaymentModal
          items={cartItems}
          subtotal={subtotal}
          vatAmount={vatAmount}
          grandTotal={grandTotal}
          onClose={() => setIsPaymentOpen(false)}
          onCompleteOrder={handleOrderComplete}
        />
      )}
    </div>
  );
}
