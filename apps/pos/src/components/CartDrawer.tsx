import { useState } from 'react';
import { Trash2, Plus, Minus, CreditCard, ShoppingBag, Utensils, Bike, Sparkles } from 'lucide-react';
import { CartItem, OrderType, ItemModifier } from '../types';

interface CartDrawerProps {
  items: CartItem[];
  orderType: OrderType;
  onChangeOrderType: (type: OrderType) => void;
  onUpdateQuantity: (productId: string, delta: number) => void;
  onRemoveItem: (productId: string) => void;
  onToggleModifier?: (productId: string, modifier: ItemModifier) => void;
  onClearCart: () => void;
  onOpenPayment: () => void;
}

export const CartDrawer = ({
  items,
  orderType,
  onChangeOrderType,
  onUpdateQuantity,
  onRemoveItem,
  onToggleModifier,
  onClearCart,
  onOpenPayment,
}: CartDrawerProps) => {
  const [tableNumber, setTableNumber] = useState('12');

  // Compute ZATCA compliant subtotal and tax with modifiers
  const subtotal = items.reduce((sum, item) => {
    const modTotal = item.modifiers?.reduce((mSum, m) => mSum + m.priceDelta, 0) || 0;
    return sum + (item.product.price + modTotal) * item.quantity;
  }, 0);
  const vatAmount = subtotal * 0.15;
  const grandTotal = subtotal + vatAmount;

  return (
    <div className="w-96 bg-slate-950 border-r border-slate-800 flex flex-col h-full text-white select-none">
      {/* Order Type Tabs */}
      <div className="p-3 border-b border-slate-800 grid grid-cols-3 gap-1.5 bg-slate-900/60">
        <button
          onClick={() => onChangeOrderType('DINE_IN')}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
            orderType === 'DINE_IN'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Utensils className="w-3.5 h-3.5" />
          <span>محلي</span>
        </button>
        <button
          onClick={() => onChangeOrderType('TAKEAWAY')}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
            orderType === 'TAKEAWAY'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          <span>سفري</span>
        </button>
        <button
          onClick={() => onChangeOrderType('DELIVERY')}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-all ${
            orderType === 'DELIVERY'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Bike className="w-3.5 h-3.5" />
          <span>توصيل</span>
        </button>
      </div>

      {/* Dine In Table Selector */}
      {orderType === 'DINE_IN' && (
        <div className="px-4 py-2 bg-slate-900/40 border-b border-slate-800/80 flex items-center justify-between text-xs">
          <span className="text-slate-400">رقم الطاولة:</span>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 text-[10px]">طاولة</span>
            <input
              type="text"
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              className="w-12 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-center font-bold text-emerald-400 font-mono text-xs focus:outline-hidden"
            />
          </div>
        </div>
      )}

      {/* Cart Items List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5 divide-y divide-slate-800/50">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
            <ShoppingBag className="w-10 h-10 mb-2 stroke-[1.5] text-slate-700" />
            <p className="font-semibold text-slate-400">سلة الطلب فارغة</p>
            <p className="text-xs text-slate-600 mt-1">اضغط على أي صنف لإضافته للطلب</p>
          </div>
        ) : (
          items.map((item) => {
            const modTotal = item.modifiers?.reduce((mSum, m) => mSum + m.priceDelta, 0) || 0;
            const singleItemPriceWithTax = (item.product.price + modTotal) * 1.15;
            const itemTotal = (singleItemPriceWithTax * item.quantity).toFixed(2);
            return (
              <div key={item.product.id} className="pt-2.5 first:pt-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-bold text-xs text-white block truncate leading-tight">
                      {item.product.nameAr}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {singleItemPriceWithTax.toFixed(2)} ر.س / حبة
                    </span>
                    {/* Active Modifiers */}
                    {item.modifiers && item.modifiers.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.modifiers.map((m) => (
                          <span
                            key={m.id}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] bg-slate-800 text-emerald-400 font-medium"
                          >
                            <span>+ {m.nameAr}</span>
                            {m.priceDelta > 0 && <span>({(m.priceDelta * 1.15).toFixed(1)} ر.س)</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="font-mono font-bold text-xs text-emerald-400 shrink-0">
                    {itemTotal} ر.س
                  </span>
                </div>

                {/* Modifiers Quick-Toggle row */}
                {onToggleModifier && (
                  <div className="flex items-center gap-1.5 mt-1.5 overflow-x-auto no-scrollbar">
                    <button
                      onClick={() =>
                        onToggleModifier(item.product.id, {
                          id: 'extra-cheese',
                          nameAr: 'جبنة إضافية',
                          priceDelta: 3.48, // 4.00 SAR with VAT
                        })
                      }
                      className="px-1.5 py-0.5 rounded text-[10px] bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 flex items-center gap-1"
                    >
                      <Sparkles className="w-2.5 h-2.5 text-amber-400" />
                      <span>+ جبن</span>
                    </button>
                    <button
                      onClick={() =>
                        onToggleModifier(item.product.id, {
                          id: 'no-onion',
                          nameAr: 'بدون بصل',
                          priceDelta: 0.0,
                        })
                      }
                      className="px-1.5 py-0.5 rounded text-[10px] bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800"
                    >
                      بدون بصل
                    </button>
                    <button
                      onClick={() =>
                        onToggleModifier(item.product.id, {
                          id: 'extra-sauce',
                          nameAr: 'صوص خاص',
                          priceDelta: 1.74, // 2.00 SAR with VAT
                        })
                      }
                      className="px-1.5 py-0.5 rounded text-[10px] bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
                    >
                      + صوص
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between mt-2">
                  <button
                    onClick={() => onRemoveItem(item.product.id)}
                    className="p-1 text-slate-500 hover:text-red-400 rounded-md transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl p-0.5">
                    <button
                      onClick={() => onUpdateQuantity(item.product.id, -1)}
                      className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 font-bold"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-6 text-center font-mono font-bold text-xs text-white">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => onUpdateQuantity(item.product.id, 1)}
                      className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 font-bold"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Financial Summary & Actions */}
      <div className="p-4 bg-slate-900/90 border-t border-slate-800 space-y-3 shrink-0">
        <div className="space-y-1.5 text-xs text-slate-400">
          <div className="flex items-center justify-between">
            <span>المجموع قبل الضريبة</span>
            <span className="font-mono text-slate-200">{subtotal.toFixed(2)} ر.س</span>
          </div>
          <div className="flex items-center justify-between">
            <span>ضريبة القيمة المضافة (15%)</span>
            <span className="font-mono text-slate-200">{vatAmount.toFixed(2)} ر.س</span>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-sm font-bold text-white">
            <span className="text-emerald-400">الإجمالي النهائي المستحق</span>
            <span className="font-mono text-lg text-emerald-400">{grandTotal.toFixed(2)} ر.س</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1">
          <button
            onClick={onClearCart}
            disabled={items.length === 0}
            className="py-2.5 px-3 rounded-xl border border-slate-800 text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            إلغاء الطلب
          </button>
          <button
            disabled={items.length === 0}
            className="py-2.5 px-3 rounded-xl border border-slate-800 text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            تعليق الطلب
          </button>
          <button
            onClick={onOpenPayment}
            disabled={items.length === 0}
            className="py-2.5 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 disabled:opacity-40 transition-colors"
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>الدفع</span>
          </button>
        </div>
      </div>
    </div>
  );
};
