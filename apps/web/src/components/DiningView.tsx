import { useState, useEffect, useCallback } from 'react';
import {
  Armchair,
  Users,
  Ban,
  Plus,
  ChefHat,
  ArrowLeftRight,
  GitMerge,
  CreditCard,
  CheckCircle2,
  Clock,
  UtensilsCrossed,
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
  Printer,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ReceiptPrintModal, ReceiptPrintData } from './ReceiptPrintModal';

interface TableCard {
  id: string;
  tableNumber: string;
  section: string;
  capacity: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';
  activeSessionId?: string | null;
  guestCount?: number | null;
  activeOrderTotal?: number;
  activeOrderNumber?: string | null;
  currentOrderId?: string | null;
}

interface KitchenTicket {
  id: string;
  ticketNumber: string;
  orderId: string;
  tableId?: string | null;
  station: string;
  status: 'PENDING' | 'IN_PREPARATION' | 'READY' | 'SERVED' | 'CANCELLED';
  itemsSnapshot: Array<{ itemId: string; itemName: string; quantity: number; modifiers?: string[]; notes?: string }>;
  notes?: string | null;
  sentAt: string;
}

export const DiningView = () => {
  const { user, activeBranch, activeLegalEntity, hierarchy } = useAuth();
  const [tables, setTables] = useState<TableCard[]>([]);
  const [kitchenTickets, setKitchenTickets] = useState<KitchenTicket[]>([]);
  const [voids, setVoids] = useState<any[]>([]);
  const [catalogItems, setCatalogItems] = useState<Array<{ id: string; nameAr: string; baseUomId: string; defaultPrice: number }>>([]);
  const [activeTab, setActiveTab] = useState<'floor' | 'kitchen' | 'voids'>('floor');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected Table Order Modal
  const [selectedTable, setSelectedTable] = useState<TableCard | null>(null);
  const [tableOrderDetails, setTableOrderDetails] = useState<any | null>(null);
  const [orderItemId, setOrderItemId] = useState('');
  const [orderQty, setOrderQty] = useState('1');
  const [modifierText, setModifierText] = useState('');
  const [modifierPrice, setModifierPrice] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD'>('CASH');

  // Transfer / Merge Modal
  const [transferMode, setTransferMode] = useState<'transfer' | 'merge' | null>(null);
  const [targetTableId, setTargetTableId] = useState('');

  // Receipt printing & duplicate-print guard
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [activeReceiptData, setActiveReceiptData] = useState<ReceiptPrintData | null>(null);
  const [lastCheckedOutReceipt, setLastCheckedOutReceipt] = useState<{ data: ReceiptPrintData; key: string } | null>(null);
  const [printedOrderKeys, setPrintedOrderKeys] = useState<Set<string>>(() => new Set());
  const [isPrintingGuard, setIsPrintingGuard] = useState(false);
  const [isReprintPreview, setIsReprintPreview] = useState(false);

  const openReceiptPreview = useCallback(
    (receipt: ReceiptPrintData, orderKey: string, forceReprint = false) => {
      if (isPrintingGuard) return;
      setIsPrintingGuard(true);
      setTimeout(() => setIsPrintingGuard(false), 450);

      const alreadyPrinted = forceReprint || printedOrderKeys.has(orderKey);
      setIsReprintPreview(alreadyPrinted);

      const baseOrderType = receipt.orderType || 'محلي / طاولة (Dine-in)';
      const formattedReceipt: ReceiptPrintData = {
        ...receipt,
        orderType: alreadyPrinted
          ? `${baseOrderType} • نسخة مطبوعة (Reprint)`
          : baseOrderType,
      };

      setActiveReceiptData(formattedReceipt);
      setReceiptModalOpen(true);
      setPrintedOrderKeys((prev) => {
        const next = new Set(prev);
        next.add(orderKey);
        return next;
      });
    },
    [isPrintingGuard, printedOrderKeys]
  );

  const defaultDeviceId = hierarchy?.devices?.find((d) => d.branchId === activeBranch?.id)?.id || hierarchy?.devices?.[0]?.id || '';
  const defaultWarehouseId = hierarchy?.warehouses?.find((w) => w.branchId === activeBranch?.id)?.id || hierarchy?.warehouses?.[0]?.id || '';

  const loadDiningData = useCallback(async () => {
    if (!activeBranch?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [tablesRes, kdsRes, voidsRes, itemsRes] = await Promise.allSettled([
        apiClient.get<any>(`/api/v1/dining/branches/${activeBranch.id}/tables`),
        apiClient.get<any>(`/api/v1/dining/branches/${activeBranch.id}/kitchen-tickets`),
        apiClient.get<any>('/api/v1/dining/voids'),
        apiClient.get<any>('/api/v1/catalog/items?limit=100'),
      ]);

      if (tablesRes.status === 'fulfilled') {
        setTables(Array.isArray(tablesRes.value) ? tablesRes.value : tablesRes.value?.items || []);
      } else {
        setError(tablesRes.reason?.message || 'تعذر تحميل بيانات الطاولات');
      }
      if (kdsRes.status === 'fulfilled') {
        setKitchenTickets(Array.isArray(kdsRes.value) ? kdsRes.value : kdsRes.value?.items || []);
      }
      if (voidsRes.status === 'fulfilled') {
        setVoids(Array.isArray(voidsRes.value) ? voidsRes.value : voidsRes.value?.items || []);
      }
      if (itemsRes.status === 'fulfilled') {
        const rows = Array.isArray(itemsRes.value) ? itemsRes.value : itemsRes.value?.items || [];
        const mapped = rows.map((i: any) => ({
          id: i.id,
          nameAr: i.nameAr || i.nameEn || i.sku,
          baseUomId: i.baseUomId,
          defaultPrice: Number(i.defaultPrice ?? 0),
        }));
        setCatalogItems(mapped);
        if (mapped.length > 0 && !orderItemId) {
          setOrderItemId(mapped[0].id);
        }
      }
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل بيانات الصالة والمطبخ');
    } finally {
      setLoading(false);
    }
  }, [activeBranch?.id, orderItemId]);

  useEffect(() => {
    void loadDiningData();
  }, [loadDiningData]);

  const openTableModal = async (t: TableCard) => {
    setSelectedTable(t);
    try {
      const res = await apiClient.get<any>(`/api/v1/dining/tables/${t.id}/order`);
      setTableOrderDetails(res || null);
    } catch (err: any) {
      setTableOrderDetails(null);
      setError(err?.message || 'تعذر تحميل تفاصيل طلب الطاولة');
    }
  };

  const handleAddTable = async () => {
    if (!activeBranch?.id) {
      alert('يرجى تحديد الفرع النشط لإضافة طاولة');
      return;
    }
    const nextNum = tables.length + 1;
    try {
      await apiClient.post('/api/v1/dining/tables', {
        branchId: activeBranch.id,
        tableNumber: `T-${String(nextNum).padStart(2, '0')}`,
        section: 'الصالة الرئيسية',
        capacity: 4,
      });
      await loadDiningData();
    } catch (err: any) {
      alert(err?.message || 'فشل إضافة الطاولة');
    }
  };

  const handleOpenSession = async (t: TableCard) => {
    if (!activeBranch?.id) return;
    try {
      await apiClient.post('/api/v1/dining/sessions/open', {
        branchId: activeBranch.id,
        tableId: t.id,
        guestCount: 2,
      });
      await loadDiningData();
    } catch (err: any) {
      alert(err?.message || 'فشل فتح جلسة الطاولة');
    }
  };

  const handleCloseSession = async (sessionId: string) => {
    try {
      await apiClient.post(`/api/v1/dining/sessions/${sessionId}/close`, {});
      setSelectedTable(null);
      await loadDiningData();
    } catch (err: any) {
      alert(err?.message || 'لا يمكن إغلاق الطاولة');
    }
  };

  const handleAddOrderLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTable || !activeBranch?.id || !activeLegalEntity?.id || !defaultDeviceId || !orderItemId) {
      alert('يرجى التأكد من وجود فرع وشركة قانونية وجهاز POS وصنف محدد');
      return;
    }
    const item = catalogItems.find((i) => i.id === orderItemId);
    try {
      await apiClient.post(`/api/v1/dining/tables/${selectedTable.id}/order`, {
        legalEntityId: activeLegalEntity.id,
        branchId: activeBranch.id,
        deviceId: defaultDeviceId,
        lines: [
          {
            itemId: orderItemId,
            uomId: item?.baseUomId,
            quantity: parseFloat(orderQty) || 1,
            modifiers: modifierText.trim()
              ? [{ modifierNameAr: modifierText.trim(), modifierNameEn: modifierText.trim(), priceDelta: modifierPrice || '0', quantity: 1 }]
              : [],
          },
        ],
      });
      setModifierText('');
      setModifierPrice('0');
      await openTableModal(selectedTable);
      await loadDiningData();
    } catch (err: any) {
      alert(err?.message || 'فشل إضافة الصنف للطلب وإرساله للمطبخ');
    }
  };

  const handleCheckoutTable = async () => {
    if (!selectedTable || !activeBranch?.id || !activeLegalEntity?.id || !defaultDeviceId || !defaultWarehouseId) {
      alert('يرجى التأكد من توفر الجهاز والمستودع لإتمام السداد');
      return;
    }
    const total = Number(tableOrderDetails?.order?.grandTotal ?? selectedTable.activeOrderTotal ?? 0);
    if (total <= 0) return;

    const currentTable = selectedTable;
    const currentDetails = tableOrderDetails;
    const chosenMethod = paymentMethod;

    try {
      const res = await apiClient.post<any>(`/api/v1/dining/tables/${currentTable.id}/checkout`, {
        legalEntityId: activeLegalEntity.id,
        branchId: activeBranch.id,
        deviceId: defaultDeviceId,
        warehouseId: defaultWarehouseId,
        payments: [{ paymentMethod: chosenMethod, amount: total.toFixed(4) }],
      });

      const orderObj = res?.order || res || {};
      const orderLines = Array.isArray(currentDetails?.lines) ? currentDetails.lines : [];
      const subtotalVal = Number(
        orderObj.subtotal ?? currentDetails?.order?.subtotal ?? total / 1.15
      );
      const vatVal = Number(
        orderObj.taxTotal ?? orderObj.taxAmount ?? currentDetails?.order?.taxTotal ?? currentDetails?.order?.taxAmount ?? total - subtotalVal
      );
      const discountVal = Number(
        orderObj.discountTotal ?? orderObj.discountAmount ?? currentDetails?.order?.discountTotal ?? currentDetails?.order?.discountAmount ?? 0
      );
      const grandTotalVal = Number(orderObj.grandTotal ?? total);
      const invoiceNum =
        orderObj.orderNumber ||
        currentDetails?.order?.orderNumber ||
        currentTable.activeOrderNumber ||
        `TBL-${currentTable.tableNumber}`;

      const receiptData: ReceiptPrintData = {
        invoiceNumber: invoiceNum,
        issueDate: new Date(orderObj.createdAt || Date.now()).toLocaleString('ar-SA'),
        tenantName: activeLegalEntity.commercialName || activeLegalEntity.legalName || 'المطعم',
        branchName: activeBranch.name || 'الفرع الرئيسي',
        vatNumber: activeLegalEntity.vatNumber || undefined,
        crNumber: activeLegalEntity.crNumber || undefined,
        cashierName: user?.displayName || user?.email,
        orderType: 'محلي / طاولة (Dine-in)',
        tableNumber: currentTable.tableNumber,
        invoiceType: 'SIMPLIFIED',
        items:
          orderLines.length > 0
            ? orderLines.map((l: any) => ({
                name: l.itemNameAr || l.itemName || `صنف #${String(l.itemId || '').slice(0, 6)}`,
                quantity: Number(l.quantity ?? 1),
                unitPrice: Number(l.unitPrice ?? 0),
                total: Number(l.lineTotal ?? Number(l.quantity ?? 1) * Number(l.unitPrice ?? 0)),
                vatAmount: Number(l.taxAmount ?? 0),
              }))
            : [
                {
                  name: `فاتورة طاولة ${currentTable.tableNumber}`,
                  quantity: 1,
                  unitPrice: subtotalVal,
                  total: subtotalVal,
                  vatAmount: vatVal,
                },
              ],
        subtotal: subtotalVal,
        discountAmount: discountVal,
        vatRate: 15,
        vatAmount: vatVal,
        grandTotal: grandTotalVal,
        paymentMethod: chosenMethod === 'CASH' ? 'نقدي (CASH)' : 'شبكة / بطاقة (CARD)',
        paidAmount: grandTotalVal,
        changeAmount: 0,
        zatcaQrBase64: orderObj.zatcaQrCode || orderObj.zatcaQrBase64 || res?.zatcaQrCode || undefined,
        currency: 'ر.س',
      };

      const orderKey = orderObj.id || invoiceNum;
      setLastCheckedOutReceipt({ data: receiptData, key: orderKey });
      setSelectedTable(null);
      setTableOrderDetails(null);
      await loadDiningData();
      openReceiptPreview(receiptData, orderKey, false);
    } catch (err: any) {
      alert(err?.message || 'فشل إتمام السداد والترحيل');
    }
  };

  const handleTransferOrMerge = async () => {
    if (!selectedTable || !targetTableId || !transferMode) return;
    try {
      await apiClient.post(`/api/v1/dining/tables/${transferMode}`, {
        sourceTableId: selectedTable.id,
        targetTableId,
      });
      setTransferMode(null);
      setTargetTableId('');
      setSelectedTable(null);
      await loadDiningData();
    } catch (err: any) {
      alert(err?.message || 'فشل تنفيذ العملية على الطاولة');
    }
  };

  const handleAdvanceTicket = async (ticketId: string, status: 'IN_PREPARATION' | 'READY' | 'SERVED') => {
    try {
      await apiClient.patch(`/api/v1/dining/kitchen-tickets/${ticketId}/status`, { status });
      await loadDiningData();
    } catch (err: any) {
      alert(err?.message || 'فشل تحديث حالة تذكرة المطبخ');
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">إدارة صالات الطعام والطاولات والمطبخ (Dining & KDS)</h2>
          <p className="text-sm text-slate-500">
            فتح وإغلاق الجلسات، طلبات الطاولات والتعديلات، نقل ودمج الطاولات، شاشة المطبخ (KDS)، والسداد المتكامل
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastCheckedOutReceipt && (
            <button
              type="button"
              disabled={isPrintingGuard}
              onClick={() => openReceiptPreview(lastCheckedOutReceipt.data, lastCheckedOutReceipt.key, true)}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl font-medium text-xs transition-colors shadow-sm"
            >
              <Printer className="w-4 h-4" />
              <span>إعادة طباعة آخر فاتورة (نسخة مطبوعة)</span>
            </button>
          )}
          <button
            onClick={handleAddTable}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة طاولة جديدة</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('floor')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'floor' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Armchair className="w-4 h-4" />
          <span>مخطط الطاولات ({tables.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('kitchen')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'kitchen' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ChefHat className="w-4 h-4" />
          <span>شاشة المطبخ KDS ({kitchenTickets.filter((k) => k.status !== 'SERVED').length})</span>
        </button>
        <button
          onClick={() => setActiveTab('voids')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'voids' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Ban className="w-4 h-4" />
          <span>سجل الإلغاءات ({voids.length})</span>
        </button>
      </div>

      {/* Loading / Error State */}
      {loading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 flex items-center justify-center gap-3 text-slate-600 text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
          <span>جاري تحميل بيانات الطاولات والمطبخ...</span>
        </div>
      )}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center justify-between gap-3 text-rose-700 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void loadDiningData()}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      )}

      {/* Floor Plan */}
      {activeTab === 'floor' && !loading && (
        tables.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center justify-center text-center gap-2 text-slate-500">
            <Armchair className="w-10 h-10 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">لا توجد طاولات مسجلة لهذا الفرع</p>
            <p className="text-xs text-slate-400">اضغط على "إضافة طاولة جديدة" للبدء بتجهيز الصالة</p>
          </div>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tables.map((t) => (
            <div
              key={t.id}
              className={`p-5 rounded-2xl border-2 transition-all ${
                t.status === 'OCCUPIED'
                  ? 'border-indigo-500 bg-indigo-50/40'
                  : t.status === 'RESERVED'
                  ? 'border-amber-400 bg-amber-50/40'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-lg font-black text-slate-900">{t.tableNumber}</span>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                    t.status === 'OCCUPIED'
                      ? 'bg-indigo-600 text-white'
                      : t.status === 'RESERVED'
                      ? 'bg-amber-500 text-white'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {t.status === 'OCCUPIED' ? 'مشغولة' : t.status === 'RESERVED' ? 'محجوزة' : 'متاحة'}
                </span>
              </div>

              <div className="space-y-1 text-xs text-slate-600 mb-4">
                <p>القسم: <span className="font-semibold text-slate-800">{t.section}</span></p>
                <p className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  <span>السعة: {t.capacity} مقاعد</span>
                </p>
                {t.status === 'OCCUPIED' && (
                  <p className="text-indigo-700 font-bold mt-2">
                    الطلب الحالي: {Number(t.activeOrderTotal || 0).toFixed(2)} ر.س
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                {t.status === 'AVAILABLE' ? (
                  <button
                    onClick={() => handleOpenSession(t)}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2 rounded-xl"
                  >
                    فتح جلسة طاولة
                  </button>
                ) : (
                  <button
                    onClick={() => openTableModal(t)}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-2 rounded-xl"
                  >
                    إدارة الطلب والسداد
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        )
      )}

      {/* Kitchen Display Tab */}
      {activeTab === 'kitchen' && (
        kitchenTickets.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center justify-center text-center gap-2 text-slate-500">
            <ChefHat className="w-10 h-10 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">لا توجد تذاكر مطبخ حالياً</p>
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {kitchenTickets.map((kt) => (
            <div key={kt.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-slate-800">{kt.ticketNumber}</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
                  {kt.status}
                </span>
              </div>
              <div className="space-y-1 text-xs">
                {(kt.itemsSnapshot || []).map((item, idx) => (
                  <div key={idx} className="flex justify-between border-b border-slate-100 pb-1">
                    <span className="font-semibold text-slate-800">{item.itemName}</span>
                    <span className="font-mono font-bold">×{item.quantity}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                {kt.status === 'PENDING' && (
                  <button
                    onClick={() => handleAdvanceTicket(kt.id, 'IN_PREPARATION')}
                    className="flex-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold py-1.5 rounded-lg flex items-center justify-center gap-1"
                  >
                    <Clock className="w-3.5 h-3.5" /> بدء التحضير
                  </button>
                )}
                {kt.status === 'IN_PREPARATION' && (
                  <button
                    onClick={() => handleAdvanceTicket(kt.id, 'READY')}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-1.5 rounded-lg flex items-center justify-center gap-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> جاهز للتقديم
                  </button>
                )}
                {kt.status === 'READY' && (
                  <button
                    onClick={() => handleAdvanceTicket(kt.id, 'SERVED')}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold py-1.5 rounded-lg flex items-center justify-center gap-1"
                  >
                    <UtensilsCrossed className="w-3.5 h-3.5" /> تم التسليم
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        )
      )}

      {/* Voids Tab */}
      {activeTab === 'voids' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3">
          {voids.length === 0 ? (
            <div className="text-center text-slate-500 text-sm py-8">لا توجد إلغاءات مسجلة</div>
          ) : (
            voids.map((v) => (
              <div key={v.id} className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs">
                <div>
                  <span className="font-bold text-slate-800">{v.reason}</span>
                  <span className="text-slate-500 mr-2">{v.notes}</span>
                </div>
                <span className="font-mono font-bold text-rose-600">{Number(v.voidAmount).toFixed(2)} ر.س</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Table Order & Settlement Modal */}
      {selectedTable && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-lg text-slate-900">
                طاولة {selectedTable.tableNumber} — إدارة الطلب والمطبخ والسداد
              </h3>
              <button onClick={() => setSelectedTable(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Add Line Form */}
            <form onSubmit={handleAddOrderLine} className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-xl">
              <select
                value={orderItemId}
                onChange={(e) => setOrderItemId(e.target.value)}
                className="sm:col-span-2 px-3 py-2 rounded-lg border border-slate-200 text-xs"
              >
                {catalogItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nameAr} ({i.defaultPrice.toFixed(2)} ر.س)
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={orderQty}
                onChange={(e) => setOrderQty(e.target.value)}
                placeholder="الكمية"
                className="px-3 py-2 rounded-lg border border-slate-200 text-xs"
              />
              <button type="submit" className="bg-indigo-600 text-white rounded-lg text-xs font-bold px-3 py-2">
                إضافة وإرسال للمطبخ
              </button>
              <input
                type="text"
                value={modifierText}
                onChange={(e) => setModifierText(e.target.value)}
                placeholder="تعديل / إضافة (مثال: بدون بصل)"
                className="sm:col-span-3 px-3 py-1.5 rounded-lg border border-slate-200 text-xs"
              />
              <input
                type="number"
                step="0.5"
                value={modifierPrice}
                onChange={(e) => setModifierPrice(e.target.value)}
                placeholder="سعر الإضافة"
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs"
              />
            </form>

            {/* Current Order Lines */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700">بنود الطلب الحالي:</h4>
              {(tableOrderDetails?.lines || []).map((l: any) => (
                <div key={l.id} className="flex justify-between text-xs border-b border-slate-100 pb-1.5">
                  <div>
                    <span className="font-semibold text-slate-800">{l.itemNameAr || l.itemId}</span>
                    <span className="text-slate-500 mr-2">×{Number(l.quantity)}</span>
                    {l.modifiers?.length > 0 && (
                      <span className="text-indigo-600 mr-2">
                        ({l.modifiers.map((m: any) => m.modifierNameAr).join('، ')})
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-bold">{Number(l.lineTotal).toFixed(2)} ر.س</span>
                </div>
              ))}
              {tableOrderDetails?.order && (
                <div className="flex justify-between text-sm font-black text-slate-900 pt-2">
                  <span>الإجمالي شامل الضريبة</span>
                  <span>{Number(tableOrderDetails.order.grandTotal).toFixed(2)} ر.س</span>
                </div>
              )}
            </div>

            {/* Transfer / Merge Controls */}
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setTransferMode('transfer')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" /> نقل الطاولة
              </button>
              <button
                type="button"
                onClick={() => setTransferMode('merge')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold"
              >
                <GitMerge className="w-3.5 h-3.5" /> دمج مع طاولة
              </button>
              {selectedTable.activeSessionId && !tableOrderDetails?.order && (
                <button
                  type="button"
                  onClick={() => handleCloseSession(selectedTable.activeSessionId!)}
                  className="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-bold"
                >
                  إغلاق الجلسة
                </button>
              )}
            </div>

            {transferMode && (
              <div className="flex gap-2 bg-amber-50 p-3 rounded-xl">
                <select
                  value={targetTableId}
                  onChange={(e) => setTargetTableId(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-amber-200 text-xs"
                >
                  <option value="">اختر الطاولة المستهدفة</option>
                  {tables
                    .filter((t) => t.id !== selectedTable.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.tableNumber} ({t.status})
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={handleTransferOrMerge}
                  className="bg-amber-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold"
                >
                  تأكيد {transferMode === 'transfer' ? 'النقل' : 'الدمج'}
                </button>
              </div>
            )}

            {/* Checkout */}
            {tableOrderDetails?.order && (
              <div className="flex items-center gap-2 pt-3 border-t">
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'CARD')}
                  className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
                >
                  <option value="CASH">نقداً (CASH)</option>
                  <option value="CARD">شبكة / بطاقة (CARD)</option>
                </select>
                <button
                  type="button"
                  onClick={handleCheckoutTable}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2"
                >
                  <CreditCard className="w-4 h-4" /> إتمام السداد وإصدار الفاتورة وإغلاق الطاولة
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {receiptModalOpen && isReprintPreview && (
        <div className="no-print fixed top-3 left-1/2 -translate-x-1/2 z-[60] px-4 py-1.5 rounded-full bg-amber-500 text-slate-950 text-xs font-bold shadow-lg flex items-center gap-2">
          <Printer className="w-3.5 h-3.5" />
          <span>نسخة مطبوعة / Reprint — تم طباعة هذه الفاتورة مسبقاً</span>
        </div>
      )}
      <ReceiptPrintModal
        isOpen={receiptModalOpen}
        onClose={() => {
          setReceiptModalOpen(false);
          setIsReprintPreview(false);
        }}
        receipt={activeReceiptData}
        defaultFormat="80mm"
        locale="ar"
      />
    </div>
  );
};
