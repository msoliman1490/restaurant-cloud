import React, { useState } from 'react';
import {
  Search,
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  CreditCard,
  Banknote,
  Maximize2,
  Minimize2,
  CheckCircle2,
} from 'lucide-react';

export interface PosProduct {
  id: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  category: string;
  price: number; // Excl. VAT
  taxRate: number; // 0.15
  stockQty: number;
}

export interface CartItem extends PosProduct {
  quantity: number;
}

const SAMPLE_PRODUCTS: PosProduct[] = [
  { id: '1', sku: 'BRG-01', nameAr: 'برجر أنجوس كلاسيك لحم', nameEn: 'Classic Angus Burger', category: 'برجر', price: 30.43, taxRate: 0.15, stockQty: 85 },
  { id: '2', sku: 'BRG-02', nameAr: 'برجر دجاج كرسبي مقرمش', nameEn: 'Crispy Chicken Burger', category: 'برجر', price: 24.35, taxRate: 0.15, stockQty: 42 },
  { id: '3', sku: 'BRG-03', nameAr: 'دبل برجر مع جبنة تشيدر ذائبة', nameEn: 'Double Cheddar Burger', category: 'برجر', price: 36.52, taxRate: 0.15, stockQty: 30 },
  { id: '4', sku: 'PIZ-01', nameAr: 'بيتزا مارجريتا نابولي كبيرة', nameEn: 'Neapolitan Margherita Large', category: 'بيتزا', price: 39.13, taxRate: 0.15, stockQty: 25 },
  { id: '5', sku: 'PIZ-02', nameAr: 'بيتزا بيبروني لحم بقري مدخن', nameEn: 'Smoked Pepperoni Pizza', category: 'بيتزا', price: 43.48, taxRate: 0.15, stockQty: 20 },
  { id: '6', sku: 'SID-01', nameAr: 'بطاطس مقلية متبلة ومقرمشة', nameEn: 'Seasoned French Fries', category: 'مقبلات', price: 10.43, taxRate: 0.15, stockQty: 150 },
  { id: '7', sku: 'SID-02', nameAr: 'أصابع جبنة موتزاريلا (5 حبات)', nameEn: 'Mozzarella Sticks (5pcs)', category: 'مقبلات', price: 15.65, taxRate: 0.15, stockQty: 60 },
  { id: '8', sku: 'BEV-01', nameAr: 'كوكاكولا بارد 330 مل', nameEn: 'Coca Cola 330ml', category: 'مشروبات', price: 5.22, taxRate: 0.15, stockQty: 240 },
  { id: '9', sku: 'BEV-02', nameAr: 'عصير برتقال طبيعي طازج', nameEn: 'Fresh Orange Juice', category: 'مشروبات', price: 13.04, taxRate: 0.15, stockQty: 50 },
  { id: '10', sku: 'DES-01', nameAr: 'كيكة الشوكولاتة الذائبة (لافا)', nameEn: 'Chocolate Lava Cake', category: 'حلويات', price: 19.13, taxRate: 0.15, stockQty: 18 },
];

const CATEGORIES = ['الكل', 'برجر', 'بيتزا', 'مقبلات', 'مشروبات', 'حلويات'];

interface PosViewProps {
  onExitFullscreen?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const PosView: React.FC<PosViewProps> = ({
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  const [selectedCategory, setSelectedCategory] = useState('الكل');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [lastOrderNumber, setLastOrderNumber] = useState('');
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY'>('TAKEAWAY');

  // Filter products
  const filteredProducts = SAMPLE_PRODUCTS.filter((p) => {
    const matchesCat = selectedCategory === 'الكل' || p.category === selectedCategory;
    const matchesSearch =
      p.nameAr.includes(searchQuery) ||
      p.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  // Cart operations
  const addToCart = (product: PosProduct) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const clearCart = () => setCart([]);

  // Financial calculations
  const subtotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const taxTotal = subtotal * 0.15; // 15% VAT
  const grandTotal = subtotal + taxTotal;

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setShowPaymentModal(true);
  };

  const confirmPayment = (method: 'CASH' | 'CARD' | 'SPLIT') => {
    const ordNum = `ORD-${method}-${Math.floor(100000 + Math.random() * 900000)}`;
    setLastOrderNumber(ordNum);
    setShowPaymentModal(false);
    setPaymentSuccess(true);
    setCart([]);
    setTimeout(() => setPaymentSuccess(false), 4000);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] -m-8 bg-slate-950 text-slate-100 select-none overflow-hidden">
      {/* Top POS Action Bar */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-bold text-sm tracking-wide text-white">نقطة البيع والكاشير (POS)</span>
          </div>
          <span className="text-xs bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 px-2.5 py-1 rounded-full">
            وردية مفتوحة • الكاشير: أحمد السعيد
          </span>
          <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
            فرع العليا - الرياض
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Order Type Toggle */}
          <div className="bg-slate-800 p-0.5 rounded-xl flex text-xs">
            <button
              onClick={() => setOrderType('TAKEAWAY')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                orderType === 'TAKEAWAY' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              سفري (Takeaway)
            </button>
            <button
              onClick={() => setOrderType('DINE_IN')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                orderType === 'DINE_IN' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              محلي / طاولة (Dine-in)
            </button>
          </div>

          {/* Fullscreen Toggle */}
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium border border-slate-700 transition-all"
              title={isFullscreen ? 'تصغير الشاشة' : 'ملء الشاشة المخصص للكاشير'}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              <span>{isFullscreen ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'}</span>
            </button>
          )}
        </div>
      </header>

      {/* POS Success Toast */}
      {paymentSuccess && (
        <div className="bg-emerald-600 text-white px-6 py-3 flex items-center justify-between text-sm font-semibold shadow-lg animate-in slide-in-from-top duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} />
            <span>تم استلام الدفعة بنجاح للطلب {lastOrderNumber} وتم ترحيل القيد وخصم المخزون!</span>
          </div>
          <span className="text-xs bg-emerald-700/60 px-2 py-1 rounded">فاتورة إلكترونية ZATCA جاهزة</span>
        </div>
      )}

      {/* Main POS Interface (Product Grid + Cart Drawer) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left/Middle: Catalog & Product Grid */}
        <div className="flex-1 flex flex-col p-6 overflow-hidden">
          {/* Search & Categories Bar */}
          <div className="space-y-4 mb-4">
            <div className="relative">
              <Search className="absolute right-4 top-3 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="ابحث بالاسم، الكود، أو امسح الباركود..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl pr-11 pl-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Category Pills */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                    selectedCategory === cat
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-slate-800/80'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product Tiles Grid */}
          <div className="flex-1 overflow-y-auto grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5 pr-1">
            {filteredProducts.map((p) => {
              const inCart = cart.find((i) => i.id === p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className={`relative p-4 rounded-2xl border text-right transition-all flex flex-col justify-between hover:scale-[1.01] active:scale-[0.99] ${
                    inCart
                      ? 'bg-slate-900/90 border-indigo-500 shadow-md shadow-indigo-500/10'
                      : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-900 hover:border-slate-700'
                  }`}
                >
                  {inCart && (
                    <span className="absolute top-2.5 left-2.5 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
                      {inCart.quantity}
                    </span>
                  )}
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">{p.sku}</span>
                    <h3 className="font-bold text-sm text-slate-200 mt-0.5 line-clamp-2">{p.nameAr}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{p.nameEn}</p>
                  </div>
                  <div className="mt-4 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-base text-emerald-400">
                        {(p.price * (1 + p.taxRate)).toFixed(2)}
                      </span>
                      <span className="text-[10px] text-slate-400 mr-1">ر.س شاملاً</span>
                    </div>
                    <span className="text-[10px] text-slate-500">مخزون: {p.stockQty}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Cart Drawer */}
        <div className="w-96 bg-slate-900 border-r border-slate-800 flex flex-col">
          {/* Cart Header */}
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart size={18} className="text-indigo-400" />
              <span className="font-bold text-sm">سلة الطلب ({cart.reduce((s, i) => s + i.quantity, 0)})</span>
            </div>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
              >
                <Trash2 size={13} />
                <span>إلغاء</span>
              </button>
            )}
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center p-6">
                <ShoppingCart size={40} className="stroke-slate-700 mb-2" />
                <p className="text-sm">السلة فارغة</p>
                <p className="text-xs text-slate-600 mt-1">اختر الأصناف من القائمة للبدء بالطلب</p>
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-950/70 border border-slate-800 p-3 rounded-xl flex items-center justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-xs text-slate-200 truncate">{item.nameAr}</h4>
                    <p className="text-[11px] text-slate-400">
                      {(item.price * 1.15).toFixed(2)} ر.س / حبة
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 bg-slate-900 rounded-lg p-1 border border-slate-800">
                    <button
                      onClick={() => updateQuantity(item.id, -1)}
                      className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      <Minus size={11} />
                    </button>
                    <span className="text-xs font-bold px-1.5 min-w-[1.2rem] text-center text-white">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.id, 1)}
                      className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      <Plus size={11} />
                    </button>
                  </div>

                  <div className="text-left font-bold text-xs text-emerald-400 min-w-[3.5rem]">
                    {(item.price * item.quantity * 1.15).toFixed(2)}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Totals & Checkout Button */}
          <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-2">
            <div className="flex justify-between text-xs text-slate-400">
              <span>المجموع قبل الضريبة</span>
              <span>{subtotal.toFixed(2)} ر.س</span>
            </div>
            <div className="flex justify-between text-xs text-slate-400">
              <span>ضريبة القيمة المضافة (15%)</span>
              <span>{taxTotal.toFixed(2)} ر.س</span>
            </div>
            <div className="flex justify-between text-base font-extrabold text-white pt-2 border-t border-slate-800/80">
              <span>الإجمالي المستحق</span>
              <span className="text-emerald-400">{grandTotal.toFixed(2)} ر.س</span>
            </div>

            <button
              onClick={handleCheckout}
              disabled={cart.length === 0}
              className="w-full mt-3 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed font-bold text-sm text-white shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2"
            >
              <CreditCard size={18} />
              <span>دفع وتحصيل الطلب ({grandTotal.toFixed(2)} ر.س)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Payment Tender Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-6 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white">تحصيل وسيلة الدفع</h3>
                <p className="text-xs text-slate-400">اختر طريقة السداد لتحصيل المبلغ</p>
              </div>
              <span className="text-2xl font-black text-emerald-400">{grandTotal.toFixed(2)} ر.س</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => confirmPayment('CASH')}
                className="p-5 rounded-2xl bg-slate-950 border border-slate-800 hover:border-emerald-500 hover:bg-emerald-950/20 text-center space-y-2 transition-all group"
              >
                <Banknote size={32} className="mx-auto text-emerald-400 group-hover:scale-110 transition-transform" />
                <div className="font-bold text-sm text-white">نقدي (Cash)</div>
                <div className="text-[11px] text-slate-400">تحصيل في صندوق الكاشير</div>
              </button>

              <button
                onClick={() => confirmPayment('CARD')}
                className="p-5 rounded-2xl bg-slate-950 border border-slate-800 hover:border-indigo-500 hover:bg-indigo-950/20 text-center space-y-2 transition-all group"
              >
                <CreditCard size={32} className="mx-auto text-indigo-400 group-hover:scale-110 transition-transform" />
                <div className="font-bold text-sm text-white">شبكة / مدى / بطاقة</div>
                <div className="text-[11px] text-slate-400">جهاز نقاط البيع الإلكتروني</div>
              </button>
            </div>

            <button
              onClick={() => confirmPayment('SPLIT')}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 flex items-center justify-center gap-2"
            >
              <span>دفع مجزأ (نصف كاش + نصف شبكة)</span>
            </button>

            <button
              onClick={() => setShowPaymentModal(false)}
              className="w-full py-2 text-xs text-slate-400 hover:text-white transition-colors"
            >
              إلغاء والعودة للطلب
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
