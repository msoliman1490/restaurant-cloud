import { useState } from 'react';
import { Boxes, ArrowLeftRight, AlertTriangle, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { StockBalance, Warehouse, StockTransfer } from '../types';

const INITIAL_WAREHOUSES: Warehouse[] = [
  { id: 'wh-all', code: 'ALL', name: 'جميع المستودعات', branchName: 'الكل' },
  { id: 'wh-1', code: 'WH-CENTRAL', name: 'المستودع المركزي (الملز)', branchName: 'المركز الرئيسي' },
  { id: 'wh-2', code: 'WH-OLAYA', name: 'مستودع فرع العليا', branchName: 'فرع الرياض العليا' },
  { id: 'wh-3', code: 'WH-MALQA', name: 'مستودع فرع الملقا', branchName: 'فرع الرياض الملقا' },
];

const INITIAL_BALANCES: StockBalance[] = [
  {
    id: 'bal-1',
    warehouseId: 'wh-1',
    warehouseName: 'المستودع المركزي (الملز)',
    itemId: 'prod-1',
    itemSku: 'BRG-001',
    itemName: 'برجر أنجوس كلاسيك',
    onHandQty: 450,
    reservedQty: 30,
    unitCost: 14.5,
    totalValue: 6525.0,
  },
  {
    id: 'bal-2',
    warehouseId: 'wh-2',
    warehouseName: 'مستودع فرع العليا',
    itemId: 'prod-1',
    itemSku: 'BRG-001',
    itemName: 'برجر أنجوس كلاسيك',
    onHandQty: 85,
    reservedQty: 5,
    unitCost: 14.5,
    totalValue: 1232.5,
  },
  {
    id: 'bal-3',
    warehouseId: 'wh-2',
    warehouseName: 'مستودع فرع العليا',
    itemId: 'prod-2',
    itemSku: 'BRG-002',
    itemName: 'برجر دجاج كرسبي مقرمش',
    onHandQty: 18,
    reservedQty: 2,
    unitCost: 11.0,
    totalValue: 198.0,
  },
  {
    id: 'bal-4',
    warehouseId: 'wh-1',
    warehouseName: 'المستودع المركزي (الملز)',
    itemId: 'prod-5',
    itemSku: 'BEV-001',
    itemName: 'كوكاكولا بارد 330 مل',
    onHandQty: 1200,
    reservedQty: 100,
    unitCost: 2.2,
    totalValue: 2640.0,
  },
  {
    id: 'bal-5',
    warehouseId: 'wh-3',
    warehouseName: 'مستودع فرع الملقا',
    itemId: 'prod-5',
    itemSku: 'BEV-001',
    itemName: 'كوكاكولا بارد 330 مل',
    onHandQty: 350,
    reservedQty: 15,
    unitCost: 2.2,
    totalValue: 770.0,
  },
];

const INITIAL_TRANSFERS: StockTransfer[] = [
  {
    id: 'trf-1',
    transferNumber: 'TRF-2026-0042',
    sourceWarehouseName: 'المستودع المركزي (الملز)',
    destinationWarehouseName: 'مستودع فرع العليا',
    status: 'IN_TRANSIT',
    itemCount: 4,
    requestedAt: '2026-11-08 09:30',
  },
  {
    id: 'trf-2',
    transferNumber: 'TRF-2026-0041',
    sourceWarehouseName: 'المستودع المركزي (الملز)',
    destinationWarehouseName: 'مستودع فرع الملقا',
    status: 'RECEIVED',
    itemCount: 6,
    requestedAt: '2026-11-07 14:15',
  },
];

export const InventoryView: React.FC = () => {
  const [balances] = useState<StockBalance[]>(INITIAL_BALANCES);
  const [transfers, setTransfers] = useState<StockTransfer[]>(INITIAL_TRANSFERS);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('wh-all');
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);

  // New transfer form state
  const [srcWh, setSrcWh] = useState('wh-1');
  const [dstWh, setDstWh] = useState('wh-2');
  const [transferQty, setTransferQty] = useState('20');

  const filteredBalances = balances.filter(
    (b) => selectedWarehouse === 'wh-all' || b.warehouseId === selectedWarehouse
  );

  const totalValuation = filteredBalances.reduce((sum, b) => sum + b.totalValue, 0);
  const lowStockCount = filteredBalances.filter((b) => b.onHandQty < 25).length;

  const handleCreateTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (srcWh === dstWh) {
      alert('لا يمكن التحويل إلى نفس المستودع');
      return;
    }

    const src = INITIAL_WAREHOUSES.find((w) => w.id === srcWh);
    const dst = INITIAL_WAREHOUSES.find((w) => w.id === dstWh);

    const newTrf: StockTransfer = {
      id: `trf-${Date.now()}`,
      transferNumber: `TRF-2026-00${transfers.length + 43}`,
      sourceWarehouseName: src?.name ?? 'مستودع المصدر',
      destinationWarehouseName: dst?.name ?? 'مستودع الوجهة',
      status: 'IN_TRANSIT',
      itemCount: 1,
      requestedAt: 'الآن',
    };

    setTransfers([newTrf, ...transfers]);
    setIsTransferModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">أرصدة المخزون والمناقلات</h2>
          <p className="text-sm text-slate-500">
            متابعة أرصدة المستودعات لحظياً، تكلفة المخزون المرجحة (WAC)، والتحويلات البينية
          </p>
        </div>
        <button
          onClick={() => setIsTransferModalOpen(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm shadow-indigo-600/20"
        >
          <ArrowLeftRight className="w-4 h-4" />
          <span>طلب مناقلة مخزنية جديدة</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>القيمة الإجمالية للمخزون</span>
            <Boxes className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
            {totalValuation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س
          </p>
          <span className="text-xs text-slate-400 mt-1 block">محسوبة بمتوسط التكلفة المرجح (WAC)</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>الأصناف تحت حد الطلب</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-600 mt-2">{lowStockCount} أصناف</p>
          <span className="text-xs text-slate-400 mt-1 block">أقل من 25 وحدة في المستودع</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>مناقلات قيد الشحن</span>
            <ArrowUpRight className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-blue-600 mt-2">
            {transfers.filter((t) => t.status === 'IN_TRANSIT').length} شحنة
          </p>
          <span className="text-xs text-slate-400 mt-1 block">محجوزة وفي طريقها للفرع</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold">
            <span>سلامة الحركة المخزنية</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-600 mt-2">100% متطابقة</p>
          <span className="text-xs text-slate-400 mt-1 block">حفظ كتلة المخزون (Conservation)</span>
        </div>
      </div>

      {/* Warehouse Selector */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 flex items-center gap-2 overflow-x-auto shadow-xs">
        {INITIAL_WAREHOUSES.map((w) => (
          <button
            key={w.id}
            onClick={() => setSelectedWarehouse(w.id)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
              selectedWarehouse === w.id
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            {w.name}
          </button>
        ))}
      </div>

      {/* Stock Balances Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-800">تفاصيل الأرصدة المتوفرة بالمستودعات</h3>
          <span className="text-xs text-slate-400">{filteredBalances.length} سجل مخزني</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">المستودع</th>
                <th className="py-3 px-4">رمز الصنف (SKU)</th>
                <th className="py-3 px-4">اسم الصنف</th>
                <th className="py-3 px-4 text-center">الكمية المتوفرة (On-Hand)</th>
                <th className="py-3 px-4 text-center">الكمية المحجوزة</th>
                <th className="py-3 px-4 text-left">متوسط التكلفة للوحدة</th>
                <th className="py-3 px-4 text-left">إجمالي القيمة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredBalances.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4 font-medium text-slate-700">{b.warehouseName}</td>
                  <td className="py-3 px-4 font-mono text-xs text-indigo-600">{b.itemSku}</td>
                  <td className="py-3 px-4 font-medium text-slate-800">{b.itemName}</td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold font-mono ${
                        b.onHandQty < 25
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      {b.onHandQty}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-xs text-slate-500">
                    {b.reservedQty}
                  </td>
                  <td className="py-3 px-4 text-left font-mono text-slate-600">
                    {b.unitCost.toFixed(2)} ر.س
                  </td>
                  <td className="py-3 px-4 text-left font-mono font-semibold text-slate-900">
                    {b.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stock Transfers Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-800">حركات المناقلات بين المستودعات والفروع</h3>
          <span className="text-xs text-slate-400">آخر العمليات</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">رقم المناقلة</th>
                <th className="py-3 px-4">من مستودع</th>
                <th className="py-3 px-4">إلى مستودع</th>
                <th className="py-3 px-4 text-center">عدد الأصناف</th>
                <th className="py-3 px-4 text-center">تاريخ الطلب</th>
                <th className="py-3 px-4 text-center">حالة المناقلة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {transfers.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-4 font-mono font-medium text-xs text-indigo-600">
                    {t.transferNumber}
                  </td>
                  <td className="py-3 px-4 text-slate-700">{t.sourceWarehouseName}</td>
                  <td className="py-3 px-4 text-slate-700">{t.destinationWarehouseName}</td>
                  <td className="py-3 px-4 text-center font-mono">{t.itemCount}</td>
                  <td className="py-3 px-4 text-center text-xs text-slate-500 font-mono">
                    {t.requestedAt}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        t.status === 'IN_TRANSIT'
                          ? 'bg-blue-100 text-blue-800 border border-blue-200'
                          : t.status === 'RECEIVED'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {t.status === 'IN_TRANSIT' ? 'في الطريق (In Transit)' : 'تم الاستلام (Received)'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transfer Modal */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="font-bold text-lg text-slate-800 mb-4 pb-2 border-b border-slate-100">
              إنشاء طلب مناقلة مخزنية بين الفروع
            </h3>
            <form onSubmit={handleCreateTransfer} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">المستودع المصدر (خصم الكمية)</label>
                <select
                  value={srcWh}
                  onChange={(e) => setSrcWh(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  {INITIAL_WAREHOUSES.filter((w) => w.id !== 'wh-all').map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">المستودع المستلم (إضافة الكمية)</label>
                <select
                  value={dstWh}
                  onChange={(e) => setDstWh(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  {INITIAL_WAREHOUSES.filter((w) => w.id !== 'wh-all').map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الكمية المحولة</label>
                <input
                  type="number"
                  min="1"
                  value={transferQty}
                  onChange={(e) => setTransferQty(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                />
              </div>

              <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-600 border border-slate-200">
                يتم قفل المخزون وحفظ حركة المناقلة مع التحقق الصارم من توفر الرصيد في مستودع المصدر.
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium shadow-sm hover:bg-indigo-700"
                >
                  تأكيد وإرسال المناقلة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
