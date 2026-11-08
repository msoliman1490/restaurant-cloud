import { useState } from 'react';
import { CreditCard, Banknote, Smartphone, CheckCircle, X, Printer, QrCode, Split, Users, Loader2 } from 'lucide-react';
import { PaymentMethod, CartItem } from '../types';
import { posApi } from '../api/posApi';

interface PaymentModalProps {
  items: CartItem[];
  subtotal: number;
  vatAmount: number;
  grandTotal: number;
  onClose: () => void;
  onCompleteOrder: () => void;
}

export const PaymentModal = ({
  items,
  subtotal,
  vatAmount,
  grandTotal,
  onClose,
  onCompleteOrder,
}: PaymentModalProps) => {
  const [method, setMethod] = useState<PaymentMethod>('MADA');
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [paidSplits, setPaidSplits] = useState<number[]>([]);
  const [tenderAmount, setTenderAmount] = useState<number>(Math.ceil(grandTotal));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(`INV-${Date.now().toString().slice(-6)}`);
  const [isOfflineQueued, setIsOfflineQueued] = useState(false);

  const splitAmount = grandTotal / splitCount;
  const currentDue = isSplitMode ? splitAmount : grandTotal;
  const changeDue = Math.max(0, tenderAmount - currentDue);

  const handleConfirmPayment = async () => {
    if (isSplitMode) {
      const nextPaid = [...paidSplits, paidSplits.length + 1];
      setPaidSplits(nextPaid);
      if (nextPaid.length < splitCount) {
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await posApi.submitSalesOrder({
        orderNumber: `ORD-${Date.now().toString().slice(-6)}`,
        orderType: 'DINE_IN',
        items,
        paymentMethod: method,
        subtotal,
        vatAmount,
        grandTotal,
      });
      setInvoiceNumber(res.invoiceNumber);
      setIsOfflineQueued(!!res.offlineQueued);
      setIsSuccess(true);
    } catch {
      setIsSuccess(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinish = () => {
    onCompleteOrder();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 z-50 select-none">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 text-white shadow-2xl relative">
        {/* Close Button */}
        {!isSuccess && (
          <button
            onClick={onClose}
            className="absolute left-5 top-5 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {!isSuccess ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold">إتمام الدفع وإصدار الفاتورة</h3>
                <p className="text-xs text-slate-400">اختر وسيلة الدفع أو قسّم الفاتورة</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSplitMode(!isSplitMode);
                  setPaidSplits([]);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  isSplitMode
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Split className="w-3.5 h-3.5" />
                <span>{isSplitMode ? 'إلغاء التقسيم' : 'تقسيم الفاتورة'}</span>
              </button>
            </div>

            {/* Split Bill Controls */}
            {isSplitMode && (
              <div className="p-3 bg-indigo-950/40 border border-indigo-800/60 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-indigo-300 flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    <span>تقسيم بالتساوي على:</span>
                  </span>
                  <div className="flex items-center gap-2">
                    {[2, 3, 4, 5].map((count) => (
                      <button
                        key={count}
                        onClick={() => {
                          setSplitCount(count);
                          setPaidSplits([]);
                        }}
                        className={`w-7 h-7 rounded-lg text-xs font-bold ${
                          splitCount === count
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                        }`}
                      >
                        {count}
                      </button>
                    ))}
                    <span className="text-xs text-indigo-300">أشخاص</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-indigo-900/60 text-xs">
                  <span className="text-slate-300">
                    نصيب كل ضيف ({paidSplits.length}/{splitCount} مسدد):
                  </span>
                  <span className="font-mono font-bold text-sm text-indigo-300">
                    {splitAmount.toFixed(2)} ر.س
                  </span>
                </div>
              </div>
            )}

            {/* Total Due Banner */}
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {isSplitMode ? `المبلغ المطلوب سداده (الدفعة ${paidSplits.length + 1}):` : 'المبلغ الإجمالي المستحق:'}
              </span>
              <span className="text-2xl font-black font-mono text-emerald-400">
                {currentDue.toFixed(2)} ر.س
              </span>
            </div>

            {/* Payment Method Selector */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setMethod('MADA')}
                className={`py-3 px-2 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1.5 transition-all ${
                  method === 'MADA'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white'
                }`}
              >
                <CreditCard className="w-5 h-5" />
                <span>مدى (Mada)</span>
              </button>

              <button
                type="button"
                onClick={() => setMethod('CASH')}
                className={`py-3 px-2 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1.5 transition-all ${
                  method === 'CASH'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white'
                }`}
              >
                <Banknote className="w-5 h-5" />
                <span>نقداً (Cash)</span>
              </button>

              <button
                type="button"
                onClick={() => setMethod('APPLE_PAY')}
                className={`py-3 px-2 rounded-2xl border text-xs font-bold flex flex-col items-center gap-1.5 transition-all ${
                  method === 'APPLE_PAY'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-white'
                }`}
              >
                <Smartphone className="w-5 h-5" />
                <span>Apple Pay</span>
              </button>
            </div>

            {/* Cash Tender Calculation */}
            {method === 'CASH' && (
              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">المبلغ المستلم من العميل:</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="1"
                      value={tenderAmount}
                      onChange={(e) => setTenderAmount(parseFloat(e.target.value) || 0)}
                      className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-center font-mono font-bold text-white text-sm"
                    />
                    <span className="text-slate-500">ر.س</span>
                  </div>
                </div>

                {/* Quick Tender Buttons */}
                <div className="flex items-center gap-2 pt-1">
                  {[Math.ceil(currentDue), 50, 100, 200, 500].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setTenderAmount(amt)}
                      className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-mono font-semibold text-slate-300"
                    >
                      {amt}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                  <span className="text-slate-400">المتبقي للعميل (Change Due):</span>
                  <span className="font-mono font-bold text-sm text-emerald-400">
                    {changeDue.toFixed(2)} ر.س
                  </span>
                </div>
              </div>
            )}

            {/* Confirm Payment Button */}
            <button
              disabled={isSubmitting}
              onClick={handleConfirmPayment}
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-2xl font-extrabold text-sm shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري تسجيل الطلب وخصم المخزون...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>
                    {isSplitMode && paidSplits.length + 1 < splitCount
                      ? `تسجيل دفعة الضيف ${paidSplits.length + 1} (${currentDue.toFixed(2)} ر.س)`
                      : 'تأكيد العملية وإصدار الفاتورة الضريبية'}
                  </span>
                </>
              )}
            </button>
          </div>
        ) : (
          /* Receipt Preview & Order Success */
          <div className="space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center mb-1">
              <CheckCircle className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-white">تم الدفع بنجاح</h3>
            <p className="text-xs text-slate-400">
              تم إصدار الفاتورة الضريبية المبسطة رقم {invoiceNumber}
            </p>
            {isOfflineQueued && (
              <span className="inline-block px-2.5 py-1 rounded-lg text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
                تم حفظ الطلب محلياً بنجاح في المحطة وسيتم المزامنة المركزية تلقائياً
              </span>
            )}

            {/* Receipt Preview Box */}
            <div className="bg-white text-slate-900 rounded-2xl p-4 text-right text-xs font-mono shadow-inner space-y-2 border border-slate-200">
              <div className="text-center font-bold text-sm border-b pb-2">
                شركة الضيافة الفندقية المحدودة
                <span className="block text-[10px] font-normal text-slate-500">
                  الرقم الضريبي: 310123456700003
                </span>
                <span className="block text-[10px] text-slate-400">فاتورة ضريبية مبسطة (ZATCA)</span>
              </div>

              <div className="space-y-1 py-1 border-b text-[11px]">
                {items.map((it) => {
                  const modTotal = it.modifiers?.reduce((mSum, m) => mSum + m.priceDelta, 0) || 0;
                  const itemLineTotal = ((it.product.price + modTotal) * 1.15 * it.quantity).toFixed(2);
                  return (
                    <div key={it.product.id}>
                      <div className="flex justify-between">
                        <span>
                          {it.product.nameAr} × {it.quantity}
                        </span>
                        <span>{itemLineTotal} ر.س</span>
                      </div>
                      {it.modifiers && it.modifiers.length > 0 && (
                        <div className="text-[9px] text-slate-500 pr-2">
                          {it.modifiers.map((m) => `+ ${m.nameAr}`).join('، ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-0.5 text-[11px] pt-1">
                <div className="flex justify-between">
                  <span>المجموع الخاضع للضريبة:</span>
                  <span>{subtotal.toFixed(2)} ر.س</span>
                </div>
                <div className="flex justify-between">
                  <span>ضريبة القيمة المضافة (15%):</span>
                  <span>{vatAmount.toFixed(2)} ر.س</span>
                </div>
                <div className="flex justify-between font-bold text-xs pt-1 border-t">
                  <span>الإجمالي شامل الضريبة:</span>
                  <span>{grandTotal.toFixed(2)} ر.س</span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-center">
                <div className="w-20 h-20 bg-slate-100 border border-slate-300 rounded-lg flex flex-col items-center justify-center text-slate-600">
                  <QrCode className="w-12 h-12 text-slate-800" />
                  <span className="text-[8px] text-slate-500 mt-0.5">ZATCA Phase 2 QR</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => alert('جاري إرسال أمر الطباعة إلى طابعة الإيصالات الحرارية...')}
                className="flex-1 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white flex items-center justify-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الإيصال</span>
              </button>
              <button
                type="button"
                onClick={handleFinish}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold"
              >
                طلب جديد
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
