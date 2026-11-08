import { useState } from 'react';
import { ShoppingCart, PackageCheck, FileText, Plus, CheckCircle2, Clock, Banknote } from 'lucide-react';

interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierName: string;
  warehouseName: string;
  status: 'ISSUED' | 'PARTIALLY_RECEIVED' | 'COMPLETED';
  itemCount: number;
  grandTotal: number;
  orderDate: string;
}

interface SupplierPaymentItem {
  id: string;
  paymentNumber: string;
  supplierName: string;
  amount: number;
  paymentMethod: string;
  paymentDate: string;
  referenceNumber: string;
}

const INITIAL_POS: PurchaseOrder[] = [
  {
    id: 'po-1',
    orderNumber: 'PO-2026-0081',
    supplierName: 'شركة المراعي للألبان والأغذية',
    warehouseName: 'المستودع اللوجستي المشترك (الملز)',
    status: 'PARTIALLY_RECEIVED',
    itemCount: 4,
    grandTotal: 4830.0,
    orderDate: '2026-11-08',
  },
  {
    id: 'po-2',
    orderNumber: 'PO-2026-0080',
    supplierName: 'مؤسسة التوريدات اللحوم الطازجة',
    warehouseName: 'المستودع اللوجستي المشترك (الملز)',
    status: 'COMPLETED',
    itemCount: 2,
    grandTotal: 12500.0,
    orderDate: '2026-11-07',
  },
  {
    id: 'po-3',
    orderNumber: 'PO-2026-0079',
    supplierName: 'شركة المخابز الذهبية',
    warehouseName: 'مستودع فرع العليا',
    status: 'ISSUED',
    itemCount: 3,
    grandTotal: 1850.0,
    orderDate: '2026-11-08',
  },
];

const INITIAL_PAYMENTS: SupplierPaymentItem[] = [
  {
    id: 'pay-1',
    paymentNumber: 'PAY-2026-0031',
    supplierName: 'شركة المراعي للألبان والأغذية',
    amount: 3500.0,
    paymentMethod: 'تحويل بنكي (IBAN)',
    paymentDate: '2026-11-08',
    referenceNumber: 'REF-BNK-98124',
  },
  {
    id: 'pay-2',
    paymentNumber: 'PAY-2026-0030',
    supplierName: 'مؤسسة التوريدات اللحوم الطازجة',
    amount: 10000.0,
    paymentMethod: 'تحويل بنكي (IBAN)',
    paymentDate: '2026-11-07',
    referenceNumber: 'REF-BNK-97541',
  },
];

export const PurchasingView = () => {
  const [orders, setOrders] = useState<PurchaseOrder[]>(INITIAL_POS);
  const [payments, setPayments] = useState<SupplierPaymentItem[]>(INITIAL_PAYMENTS);
  const [activeTab, setActiveTab] = useState<'orders' | 'receipts' | 'invoices' | 'payments'>('orders');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  // New Payment Form
  const [paySupplier, setPaySupplier] = useState('شركة المراعي للألبان والأغذية');
  const [payAmount, setPayAmount] = useState('2000');

  const handleCreatePayment = (e: React.FormEvent) => {
    e.preventDefault();
    const newPmt: SupplierPaymentItem = {
      id: `pay-${Date.now()}`,
      paymentNumber: `PAY-2026-00${payments.length + 32}`,
      supplierName: paySupplier,
      amount: parseFloat(payAmount) || 0,
      paymentMethod: 'تحويل بنكي (IBAN)',
      paymentDate: new Date().toISOString().slice(0, 10),
      referenceNumber: `REF-BNK-${Math.floor(10000 + Math.random() * 90000)}`,
    };
    setPayments([newPmt, ...payments]);
    setIsPaymentModalOpen(false);
  };

  // New PO Form
  const [supplierName, setSupplierName] = useState('شركة المراعي');
  const [totalAmount, setTotalAmount] = useState('3200');

  const handleCreatePo = (e: React.FormEvent) => {
    e.preventDefault();
    const newOrder: PurchaseOrder = {
      id: `po-${Date.now()}`,
      orderNumber: `PO-2026-00${orders.length + 82}`,
      supplierName,
      warehouseName: 'المستودع اللوجستي المشترك',
      status: 'ISSUED',
      itemCount: 3,
      grandTotal: parseFloat(totalAmount) || 0,
      orderDate: new Date().toISOString().slice(0, 10),
    };
    setOrders([newOrder, ...orders]);
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">إدارة المشتريات والموردين (Procurement & AP)</h2>
          <p className="text-sm text-slate-500">
            أوامر الشراء (PO)، استلام البضائع (GRN)، المطابقة الثلاثية (3-Way Match)، وأرصدة الموردين
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPaymentModalOpen(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm"
          >
            <Banknote className="w-4 h-4" />
            <span>تسجيل سند صرف لمورد</span>
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm shadow-indigo-600/20"
          >
            <Plus className="w-4 h-4" />
            <span>إصدار أمر شراء جديد (PO)</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('orders')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'orders' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>أوامر الشراء (Purchase Orders)</span>
        </button>
        <button
          onClick={() => setActiveTab('receipts')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'receipts' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <PackageCheck className="w-4 h-4" />
          <span>إيصالات الاستلام (Goods Receipts GRN)</span>
        </button>
        <button
          onClick={() => setActiveTab('invoices')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'invoices' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>فواتير الموردين (AP Invoices)</span>
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'payments' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Banknote className="w-4 h-4" />
          <span>سندات سداد الموردين ({payments.length})</span>
        </button>
      </div>

      {/* Table of Orders */}
      {activeTab === 'orders' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <table className="w-full text-right border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">رقم أمر الشراء</th>
                <th className="py-3 px-4">المورد</th>
                <th className="py-3 px-4">مستودع الاستلام</th>
                <th className="py-3 px-4 text-center">عدد الأصناف</th>
                <th className="py-3 px-4 text-left">إجمالي القيمة شامل الضريبة</th>
                <th className="py-3 px-4 text-center">تاريخ الطلب</th>
                <th className="py-3 px-4 text-center">حالة الاستلام</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((po) => (
                <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600">{po.orderNumber}</td>
                  <td className="py-3.5 px-4 font-medium text-slate-800">{po.supplierName}</td>
                  <td className="py-3.5 px-4 text-slate-600 text-xs">{po.warehouseName}</td>
                  <td className="py-3.5 px-4 text-center font-mono">{po.itemCount}</td>
                  <td className="py-3.5 px-4 text-left font-mono font-bold text-slate-900">
                    {po.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-xs text-slate-500">{po.orderDate}</td>
                  <td className="py-3.5 px-4 text-center">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        po.status === 'COMPLETED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : po.status === 'PARTIALLY_RECEIVED'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {po.status === 'COMPLETED' ? (
                        <>
                          <CheckCircle2 className="w-3 h-3" />
                          مكتمل الاستلام
                        </>
                      ) : po.status === 'PARTIALLY_RECEIVED' ? (
                        <>
                          <Clock className="w-3 h-3" />
                          استلام جزئي
                        </>
                      ) : (
                        'صادر (قيد التوريد)'
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Table of Supplier Payments */}
      {activeTab === 'payments' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
          <table className="w-full text-right border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">رقم سند الصرف</th>
                <th className="py-3 px-4">المورد المستفيد</th>
                <th className="py-3 px-4">طريقة السداد</th>
                <th className="py-3 px-4">المرجع البنكي</th>
                <th className="py-3 px-4 text-left">المبلغ المسدد</th>
                <th className="py-3 px-4 text-center">تاريخ الصرف</th>
                <th className="py-3 px-4 text-center">الأثر المحاسبي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-xs text-emerald-600">{p.paymentNumber}</td>
                  <td className="py-3.5 px-4 font-medium text-slate-800">{p.supplierName}</td>
                  <td className="py-3.5 px-4 text-slate-600 text-xs">{p.paymentMethod}</td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-500">{p.referenceNumber}</td>
                  <td className="py-3.5 px-4 text-left font-mono font-bold text-slate-900">
                    {p.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-xs text-slate-500">{p.paymentDate}</td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                      <CheckCircle2 className="w-3 h-3" />
                      تخفيض AP ومرحل للدفتر
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Placeholder for receipts and invoices tabs */}
      {(activeTab === 'receipts' || activeTab === 'invoices') && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
          <p className="font-semibold text-slate-700 mb-1">
            {activeTab === 'receipts' ? 'سجلات استلام البضائع (GRN) والمطابقة' : 'فواتير الموردين المسجلة'}
          </p>
          <p className="text-xs text-slate-400">
            تتم معالجة المستندات وربطها تلقائياً بأرصدة الموردين وتوليد طبقات تكلفة FIFO في قاعدة البيانات.
          </p>
        </div>
      )}

      {/* New Payment Modal */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="font-bold text-lg text-slate-800 mb-4 pb-2 border-b border-slate-100">
              تسجيل سند صرف وسداد لمورد (AP Payment)
            </h3>
            <form onSubmit={handleCreatePayment} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">المورد المستفيد</label>
                <select
                  value={paySupplier}
                  onChange={(e) => setPaySupplier(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  <option value="شركة المراعي للألبان والأغذية">شركة المراعي للألبان والأغذية</option>
                  <option value="مؤسسة التوريدات اللحوم الطازجة">مؤسسة التوريدات اللحوم الطازجة</option>
                  <option value="شركة المخابز الذهبية">شركة المخابز الذهبية</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">مبلغ السداد الصافي (SAR)</label>
                <input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                  required
                />
              </div>

              <div className="p-3 bg-emerald-50/50 rounded-xl text-xs text-emerald-800 border border-emerald-100">
                يتم تخفيض رصيد المورد الدائن في دفتر الحسابات تلقائياً وترحيل قيد اليومية (مدين: الموردون، دائن: البنك).
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
                >
                  تأكيد وترحيل سند الصرف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New PO Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="font-bold text-lg text-slate-800 mb-4 pb-2 border-b border-slate-100">
              إنشاء أمر شراء جديد للمورد
            </h3>
            <form onSubmit={handleCreatePo} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">اسم المورد المعتمد</label>
                <select
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  <option value="شركة المراعي للألبان">شركة المراعي للألبان</option>
                  <option value="مؤسسة توريدات اللحوم الطازجة">مؤسسة توريدات اللحوم الطازجة</option>
                  <option value="شركة المخابز الذهبية">شركة المخابز الذهبية</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">إجمالي التقديري للطلب (SAR)</label>
                <input
                  type="number"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                />
              </div>

              <div className="p-3 bg-indigo-50/50 rounded-xl text-xs text-indigo-700 border border-indigo-100">
                يتم تحديث المخزون بطبقات التكلفة (FIFO Cost Layers) آلياً بمجرد تأكيد سند الاستلام (GRN).
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
                >
                  تأكيد وإصدار أمر الشراء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
