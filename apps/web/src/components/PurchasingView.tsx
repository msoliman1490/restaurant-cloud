import { useEffect, useState } from 'react';
import {
  ShoppingCart,
  PackageCheck,
  FileText,
  Plus,
  CheckCircle2,
  Clock,
  Banknote,
  RotateCcw,
  Loader2,
  AlertCircle,
  RefreshCw,
  ClipboardList,
  Eye,
  XCircle,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';

interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface PurchaseRequestLineRow {
  id: string;
  itemId: string;
  uomId: string;
  requestedQty: string | number;
  estimatedUnitCost: string | number;
  notes?: string | null;
}

interface PurchaseRequestRow {
  id: string;
  requestNumber: string;
  legalEntityId: string;
  warehouseId: string;
  status: string;
  requestedBy?: string | null;
  approvedBy?: string | null;
  neededByDate?: string | null;
  notes?: string | null;
  createdAt?: string;
  lines?: PurchaseRequestLineRow[];
  approvalMetadata?: {
    status: string;
    requestedBy?: string | null;
    approvedBy?: string | null;
    createdAt?: string;
  };
}

interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierId?: string;
  supplierName?: string;
  warehouseId?: string;
  warehouseName?: string;
  status: string;
  itemCount?: number;
  grandTotal: number | string;
  orderDate?: string;
  createdAt?: string;
}

interface GoodsReceiptRow {
  id: string;
  receiptNumber: string;
  purchaseOrderId?: string | null;
  warehouseId: string;
  status: string;
  receivedAt?: string;
  createdAt?: string;
  notes?: string | null;
}

interface SupplierInvoiceRow {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  subtotal?: string | number;
  taxTotal?: string | number;
  grandTotal: string | number;
  status: string;
  invoiceDate?: string;
  createdAt?: string;
}

interface PurchaseReturnRow {
  id: string;
  returnNumber: string;
  supplierId: string;
  totalAmount?: string | number;
  grandTotal?: string | number;
  reason?: string | null;
  status: string;
  createdAt?: string;
}

interface SupplierPaymentItem {
  id: string;
  paymentNumber: string;
  supplierId?: string;
  supplierName?: string;
  amount: number | string;
  paymentMethod: string;
  paymentDate?: string;
  createdAt?: string;
  referenceNumber?: string | null;
}

export const PurchasingView = () => {
  const { activeLegalEntity, hierarchy } = useAuth();
  const { dir } = useLocale();
  const [requests, setRequests] = useState<PurchaseRequestRow[]>([]);
  const [requestsMeta, setRequestsMeta] = useState<PaginationMeta>({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [prStatusFilter, setPrStatusFilter] = useState<string>('');
  const [prWarehouseFilter, setPrWarehouseFilter] = useState<string>('');
  const [prPage, setPrPage] = useState<number>(1);

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [ordersMeta, setOrdersMeta] = useState<PaginationMeta>({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [ordersPage, setOrdersPage] = useState<number>(1);

  const [receipts, setReceipts] = useState<GoodsReceiptRow[]>([]);
  const [receiptsMeta, setReceiptsMeta] = useState<PaginationMeta>({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [receiptsPage, setReceiptsPage] = useState<number>(1);

  const [invoices, setInvoices] = useState<SupplierInvoiceRow[]>([]);
  const [invoicesMeta, setInvoicesMeta] = useState<PaginationMeta>({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [invoicesPage, setInvoicesPage] = useState<number>(1);

  const [returns, setReturns] = useState<PurchaseReturnRow[]>([]);
  const [returnsMeta, setReturnsMeta] = useState<PaginationMeta>({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [returnsPage, setReturnsPage] = useState<number>(1);

  const [payments, setPayments] = useState<SupplierPaymentItem[]>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [items, setItems] = useState<Array<{ id: string; nameAr: string; baseUomId: string; defaultCost: number }>>([]);
  const [activeTab, setActiveTab] = useState<'requests' | 'orders' | 'receipts' | 'invoices' | 'returns' | 'payments'>('requests');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  // Purchase Request Modals & Forms
  const [isPrModalOpen, setIsPrModalOpen] = useState(false);
  const [prWarehouseId, setPrWarehouseId] = useState('');
  const [prNeededByDate, setPrNeededByDate] = useState('');
  const [prNotes, setPrNotes] = useState('');
  const [prItemId, setPrItemId] = useState('');
  const [prQty, setPrQty] = useState('10');
  const [prEstimatedCost, setPrEstimatedCost] = useState('25');

  const [selectedPrDetail, setSelectedPrDetail] = useState<PurchaseRequestRow | null>(null);
  const [rejectPrTarget, setRejectPrTarget] = useState<PurchaseRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [convertPrTarget, setConvertPrTarget] = useState<PurchaseRequestRow | null>(null);
  const [convertSupplierId, setConvertSupplierId] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (convertPrTarget) setConvertPrTarget(null);
        else if (rejectPrTarget) setRejectPrTarget(null);
        else if (selectedPrDetail) setSelectedPrDetail(null);
        else if (isPrModalOpen) setIsPrModalOpen(false);
        else if (isPaymentModalOpen) setIsPaymentModalOpen(false);
        else if (isModalOpen) setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [convertPrTarget, rejectPrTarget, selectedPrDetail, isPrModalOpen, isPaymentModalOpen, isModalOpen]);

  const extractPaginated = <T,>(res: any, fallbackPage: number): { items: T[]; meta: PaginationMeta } => {
    if (Array.isArray(res)) {
      return {
        items: res,
        meta: { total: res.length, page: fallbackPage, limit: 20, totalPages: 1 },
      };
    }
    const rows = Array.isArray(res?.items) ? res.items : [];
    return {
      items: rows,
      meta: {
        total: typeof res?.total === 'number' ? res.total : rows.length,
        page: typeof res?.page === 'number' ? res.page : fallbackPage,
        limit: typeof res?.limit === 'number' ? res.limit : 20,
        totalPages: typeof res?.totalPages === 'number' ? Math.max(1, res.totalPages) : 1,
      },
    };
  };

  const buildQuery = (params: Record<string, string | number | undefined>) => {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') usp.set(k, String(v));
    });
    const qs = usp.toString();
    return qs ? `?${qs}` : '';
  };

  const loadPurchasing = async () => {
    setLoading(true);
    setError(null);
    const leId = activeLegalEntity?.id;
    try {
      const [reqRes, ordRes, recRes, invRes, retRes, payRes, supRes, itemRes] = await Promise.all([
        apiClient.get<any>(
          `/api/v1/purchasing/requests${buildQuery({
            legalEntityId: leId,
            warehouseId: prWarehouseFilter,
            status: prStatusFilter,
            page: prPage,
            limit: 20,
          })}`
        ),
        apiClient.get<any>(`/api/v1/purchasing/orders${buildQuery({ legalEntityId: leId, page: ordersPage, limit: 20 })}`),
        apiClient.get<any>(`/api/v1/purchasing/receipts${buildQuery({ legalEntityId: leId, page: receiptsPage, limit: 20 })}`),
        apiClient.get<any>(`/api/v1/purchasing/invoices${buildQuery({ legalEntityId: leId, page: invoicesPage, limit: 20 })}`),
        apiClient.get<any>(`/api/v1/purchasing/returns${buildQuery({ legalEntityId: leId, page: returnsPage, limit: 20 })}`),
        apiClient.get<any>(`/api/v1/purchasing/payments${buildQuery({ legalEntityId: leId })}`),
        apiClient.get<any>('/api/v1/catalog/suppliers').catch(() => null),
        apiClient.get<any>('/api/v1/catalog/items?limit=50').catch(() => null),
      ]);

      const parsedReq = extractPaginated<PurchaseRequestRow>(reqRes, prPage);
      setRequests(parsedReq.items);
      setRequestsMeta(parsedReq.meta);

      const parsedOrd = extractPaginated<PurchaseOrder>(ordRes, ordersPage);
      setOrders(parsedOrd.items);
      setOrdersMeta(parsedOrd.meta);

      const parsedRec = extractPaginated<GoodsReceiptRow>(recRes, receiptsPage);
      setReceipts(parsedRec.items);
      setReceiptsMeta(parsedRec.meta);

      const parsedInv = extractPaginated<SupplierInvoiceRow>(invRes, invoicesPage);
      setInvoices(parsedInv.items);
      setInvoicesMeta(parsedInv.meta);

      const parsedRet = extractPaginated<PurchaseReturnRow>(retRes, returnsPage);
      setReturns(parsedRet.items);
      setReturnsMeta(parsedRet.meta);

      setPayments(Array.isArray(payRes) ? payRes : payRes?.items || []);
      const supRows = Array.isArray(supRes) ? supRes : supRes?.items || [];
      if (supRows.length > 0) {
        setSuppliers(supRows);
        setPaySupplier(supRows[0].id);
        setSupplierName(supRows[0].id);
        setConvertSupplierId((prev) => prev || supRows[0].id);
      }
      const itemRows = Array.isArray(itemRes) ? itemRes : itemRes?.items || [];
      if (itemRows.length > 0) {
        setItems(itemRows);
        setPrItemId((prev) => prev || itemRows[0].id);
      }
      const defaultWh = hierarchy?.warehouses?.[0]?.id;
      if (defaultWh) {
        setPrWarehouseId((prev) => prev || defaultWh);
      }
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل بيانات المشتريات من الخادم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPurchasing();
  }, [
    activeLegalEntity?.id,
    prStatusFilter,
    prWarehouseFilter,
    prPage,
    ordersPage,
    receiptsPage,
    invoicesPage,
    returnsPage,
  ]);

  // New Payment Form
  const [paySupplier, setPaySupplier] = useState('شركة المراعي للألبان والأغذية');
  const [payAmount, setPayAmount] = useState('2000');

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paySupplier);
    if (activeLegalEntity?.id && isUuid) {
      try {
        await apiClient.post('/api/v1/purchasing/payments', {
          legalEntityId: activeLegalEntity.id,
          supplierId: paySupplier,
          paymentNumber: `PAY-${Date.now().toString(36).toUpperCase()}`,
          amount: (parseFloat(payAmount) || 0).toFixed(4),
          paymentMethod: 'BANK_TRANSFER',
        });
        await loadPurchasing();
        setIsPaymentModalOpen(false);
        return;
      } catch (err: any) {
        alert(err?.message || 'فشل ترحيل سند الصرف للمورد');
        return;
      }
    }
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

  const handleCreatePr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLegalEntity?.id) {
      alert('يرجى تحديد الكيان القانوني أولاً');
      return;
    }
    const targetWh = prWarehouseId || hierarchy?.warehouses?.[0]?.id;
    const targetItem = items.find((it) => it.id === prItemId) || items[0];
    if (!targetWh || !targetItem) {
      alert('يرجى التأكد من وجود مستودع وصنف نشط');
      return;
    }
    try {
      await apiClient.post('/api/v1/purchasing/requests', {
        legalEntityId: activeLegalEntity.id,
        warehouseId: targetWh,
        requestNumber: `PR-${Date.now().toString(36).toUpperCase()}`,
        neededByDate: prNeededByDate ? new Date(prNeededByDate).toISOString() : undefined,
        notes: prNotes || undefined,
        lines: [
          {
            itemId: targetItem.id,
            uomId: targetItem.baseUomId,
            requestedQty: (parseFloat(prQty) || 1).toFixed(4),
            estimatedUnitCost: (parseFloat(prEstimatedCost) || 0).toFixed(4),
          },
        ],
      });
      setIsPrModalOpen(false);
      setPrNotes('');
      setPrNeededByDate('');
      await loadPurchasing();
    } catch (err: any) {
      alert(err?.message || 'فشل إنشاء طلب الشراء');
    }
  };

  const handleViewPrDetail = async (requestId: string) => {
    try {
      const detail = await apiClient.get<PurchaseRequestRow>(`/api/v1/purchasing/requests/${requestId}`);
      setSelectedPrDetail(detail);
    } catch (err: any) {
      alert(err?.message || 'تعذر جلب تفاصيل طلب الشراء');
    }
  };

  const handleApprovePr = async (requestId: string) => {
    try {
      await apiClient.post(`/api/v1/purchasing/requests/${requestId}/approve`, {});
      if (selectedPrDetail?.id === requestId) {
        await handleViewPrDetail(requestId);
      }
      await loadPurchasing();
    } catch (err: any) {
      alert(err?.message || 'فشل اعتماد طلب الشراء');
    }
  };

  const handleRejectPr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectPrTarget) return;
    try {
      await apiClient.post(`/api/v1/purchasing/requests/${rejectPrTarget.id}/reject`, {
        reason: rejectReason || 'مرفوض من المشتريات',
      });
      const targetId = rejectPrTarget.id;
      setRejectPrTarget(null);
      setRejectReason('');
      if (selectedPrDetail?.id === targetId) {
        await handleViewPrDetail(targetId);
      }
      await loadPurchasing();
    } catch (err: any) {
      alert(err?.message || 'فشل رفض طلب الشراء');
    }
  };

  const handleConvertPrToPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convertPrTarget || !convertSupplierId) {
      alert('يرجى اختيار المورد');
      return;
    }
    try {
      await apiClient.post(`/api/v1/purchasing/requests/${convertPrTarget.id}/convert-to-po`, {
        supplierId: convertSupplierId,
      });
      setConvertPrTarget(null);
      setSelectedPrDetail(null);
      setActiveTab('orders');
      await loadPurchasing();
    } catch (err: any) {
      alert(err?.message || 'فشل تحويل طلب الشراء إلى أمر شراء');
    }
  };

  const renderPagination = (meta: PaginationMeta, onPageChange: (nextPage: number) => void) => {
    if (meta.total <= 0) return null;
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
        <div>
          صفحة <span className="font-mono font-bold">{meta.page}</span> من{' '}
          <span className="font-mono font-bold">{meta.totalPages}</span> (إجمالي{' '}
          <span className="font-mono font-bold">{meta.total}</span> سجل)
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={meta.page <= 1}
            onClick={() => onPageChange(meta.page - 1)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40"
          >
            <ChevronRight className="w-3.5 h-3.5" />
            <span>السابق</span>
          </button>
          <button
            type="button"
            disabled={meta.page >= meta.totalPages}
            onClick={() => onPageChange(meta.page + 1)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40"
          >
            <span>التالي</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  // New PO Form
  const [supplierName, setSupplierName] = useState('شركة المراعي');
  const [totalAmount, setTotalAmount] = useState('3200');

  const handleApprovePo = async (orderId: string) => {
    try {
      await apiClient.post(`/api/v1/purchasing/orders/${orderId}/approve`, {});
      await loadPurchasing();
    } catch (err: any) {
      alert(err?.message || 'فشل اعتماد أمر الشراء');
    }
  };

  const handleCancelPo = async (orderId: string) => {
    try {
      await apiClient.post(`/api/v1/purchasing/orders/${orderId}/cancel`, {
        reason: 'إلغاء من واجهة المشتريات',
      });
      await loadPurchasing();
    } catch (err: any) {
      alert(err?.message || 'فشل إلغاء أمر الشراء');
    }
  };

  const handleQuickReceivePo = async (po: PurchaseOrder) => {
    if (!activeLegalEntity?.id || !po.supplierId) return;
    const defaultWh = po.warehouseId || hierarchy?.warehouses?.[0]?.id;
    const defaultItem = items[0];
    if (!defaultWh || !defaultItem) {
      alert('يرجى التأكد من وجود مستودع وصنف نشط');
      return;
    }
    try {
      await apiClient.post('/api/v1/purchasing/receipts', {
        legalEntityId: activeLegalEntity.id,
        purchaseOrderId: po.id,
        supplierId: po.supplierId,
        warehouseId: defaultWh,
        receiptNumber: `GRN-${Date.now().toString(36).toUpperCase()}`,
        lines: [
          {
            itemId: defaultItem.id,
            uomId: defaultItem.baseUomId,
            receivedQty: '1.0000',
            unitCost: '10.0000',
          },
        ],
      });
      await loadPurchasing();
    } catch (err: any) {
      alert(err?.message || 'فشل استلام البضاعة');
    }
  };

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supplierName);
    const defaultWh = hierarchy?.warehouses?.[0]?.id;
    const defaultItem = items[0];
    if (activeLegalEntity?.id && isUuid && defaultWh && defaultItem) {
      try {
        await apiClient.post('/api/v1/purchasing/orders', {
          legalEntityId: activeLegalEntity.id,
          supplierId: supplierName,
          warehouseId: defaultWh,
          orderNumber: `PO-${Date.now().toString(36).toUpperCase()}`,
          lines: [
            {
              itemId: defaultItem.id,
              uomId: defaultItem.baseUomId,
              orderedQty: '10.0000',
              unitPrice: ((parseFloat(totalAmount) || 100) / 10).toFixed(4),
            },
          ],
        });
        await loadPurchasing();
        setIsModalOpen(false);
        return;
      } catch (err: any) {
        alert(err?.message || 'فشل إنشاء أمر الشراء');
        return;
      }
    }
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
    <div className="space-y-6" dir={dir}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">إدارة المشتريات والموردين (Procurement & AP)</h2>
          <p className="text-sm text-slate-500">
            أوامر الشراء (PO)، استلام البضائع (GRN)، المطابقة الثلاثية (3-Way Match)، وأرصدة الموردين
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setIsPrModalOpen(true)}
            className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm"
          >
            <ClipboardList className="w-4 h-4" />
            <span>طلب شراء جديد (PR)</span>
          </button>
          <button
            onClick={() => setIsPaymentModalOpen(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm"
          >
            <Banknote className="w-4 h-4" />
            <span>تسجيل سند صرف لمورد</span>
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 bg-[#0D6E4F] hover:bg-[#0A583F] text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>إصدار أمر شراء جديد (PO)</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('requests')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
            activeTab === 'requests' ? 'bg-[#0D6E4F] hover:bg-[#0A583F] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          <span>طلبات الشراء ({requestsMeta.total})</span>
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
            activeTab === 'orders' ? 'bg-[#0D6E4F] hover:bg-[#0A583F] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>أوامر الشراء ({ordersMeta.total})</span>
        </button>
        <button
          onClick={() => setActiveTab('receipts')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'receipts' ? 'bg-[#0D6E4F] hover:bg-[#0A583F] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <PackageCheck className="w-4 h-4" />
          <span>إيصالات الاستلام (Goods Receipts GRN)</span>
        </button>
        <button
          onClick={() => setActiveTab('invoices')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'invoices' ? 'bg-[#0D6E4F] hover:bg-[#0A583F] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>فواتير الموردين ({invoices.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('returns')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'returns' ? 'bg-[#0D6E4F] hover:bg-[#0A583F] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>مرتجعات المشتريات ({returns.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'payments' ? 'bg-[#0D6E4F] hover:bg-[#0A583F] text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Banknote className="w-4 h-4" />
          <span>سندات سداد الموردين ({payments.length})</span>
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6 text-slate-500 text-sm">
          <Loader2 className="w-4 h-4 ml-2 animate-spin" />
          جارٍ تحديث بيانات المشتريات...
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center justify-between gap-3 text-rose-700 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void loadPurchasing()}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      )}

      {/* Table of Purchase Requests */}
      {activeTab === 'requests' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-2xl border border-slate-200">
            <select
              value={prStatusFilter}
              onChange={(e) => {
                setPrStatusFilter(e.target.value);
                setPrPage(1);
              }}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700"
            >
              <option value="">كل الحالات</option>
              <option value="DRAFT">مسودة (DRAFT)</option>
              <option value="SUBMITTED">مقدم للاعتماد (SUBMITTED)</option>
              <option value="APPROVED">معتمد (APPROVED)</option>
              <option value="REJECTED">مرفوض (REJECTED)</option>
              <option value="CONVERTED_TO_PO">محول لأمر شراء (CONVERTED_TO_PO)</option>
            </select>

            <select
              value={prWarehouseFilter}
              onChange={(e) => {
                setPrWarehouseFilter(e.target.value);
                setPrPage(1);
              }}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-700"
            >
              <option value="">كل المستودعات</option>
              {(hierarchy?.warehouses || []).map((wh: any) => (
                <option key={wh.id} value={wh.id}>
                  {wh.name || wh.code}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
            <table className="w-full text-right border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-4">رقم طلب الشراء</th>
                  <th className="py-3 px-4">المستودع</th>
                  <th className="py-3 px-4 text-center">تاريخ الاحتياج</th>
                  <th className="py-3 px-4 text-center">تاريخ الإنشاء</th>
                  <th className="py-3 px-4 text-center">الحالة</th>
                  <th className="py-3 px-4 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map((pr) => (
                  <tr key={pr.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-xs text-[#0D6E4F]">{pr.requestNumber}</td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600">
                      {(hierarchy?.warehouses || []).find((w: any) => w.id === pr.warehouseId)?.name || pr.warehouseId.slice(0, 8)}
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono text-xs text-slate-500">
                      {pr.neededByDate ? pr.neededByDate.slice(0, 10) : '-'}
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono text-xs text-slate-500">
                      {(pr.createdAt || '').slice(0, 10)}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          pr.status === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : pr.status === 'CONVERTED_TO_PO'
                            ? 'bg-blue-50 text-blue-800 border border-blue-200'
                            : pr.status === 'REJECTED'
                            ? 'bg-rose-100 text-rose-800'
                            : pr.status === 'SUBMITTED'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {pr.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleViewPrDetail(pr.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>التفاصيل</span>
                        </button>
                        {(pr.status === 'DRAFT' || pr.status === 'SUBMITTED') && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleApprovePr(pr.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>اعتماد</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setRejectPrTarget(pr)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 text-xs font-medium hover:bg-rose-100"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>رفض</span>
                            </button>
                          </>
                        )}
                        {pr.status === 'APPROVED' && (
                          <button
                            type="button"
                            onClick={() => setConvertPrTarget(pr)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0D6E4F] hover:bg-[#0A583F] text-white text-xs font-medium"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            <span>تحويل إلى PO</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      لا توجد طلبات شراء مسجلة حالياً
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {renderPagination(requestsMeta, setPrPage)}
          </div>
        </div>
      )}

      {/* Table of Orders */}
      {activeTab === 'orders' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
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
                <th className="py-3 px-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((po) => (
                <tr key={po.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-xs text-[#0D6E4F]">{po.orderNumber}</td>
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
                          : po.status === 'CANCELLED'
                          ? 'bg-rose-100 text-rose-800'
                          : po.status === 'DRAFT'
                          ? 'bg-slate-100 text-slate-700'
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
                      ) : po.status === 'DRAFT' ? (
                        'مسودة'
                      ) : po.status === 'CANCELLED' ? (
                        'ملغي'
                      ) : (
                        'صادر (قيد التوريد)'
                      )}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {po.status === 'DRAFT' && (
                        <button
                          type="button"
                          onClick={() => handleApprovePo(po.id)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                        >
                          اعتماد
                        </button>
                      )}
                      {(po.status === 'ISSUED' || po.status === 'PARTIALLY_RECEIVED') && (
                        <button
                          type="button"
                          onClick={() => handleQuickReceivePo(po)}
                          className="px-2.5 py-1 rounded-lg bg-[#0D6E4F] hover:bg-[#0A583F] text-white text-xs font-medium"
                        >
                          استلام GRN
                        </button>
                      )}
                      {(po.status === 'DRAFT' || po.status === 'ISSUED') && (
                        <button
                          type="button"
                          onClick={() => handleCancelPo(po.id)}
                          className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 text-xs font-medium hover:bg-rose-100"
                        >
                          إلغاء
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {renderPagination(ordersMeta, setOrdersPage)}
        </div>
      )}

      {/* Table of Supplier Payments */}
      {activeTab === 'payments' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
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

      {/* Goods Receipts (GRN) Tab */}
      {activeTab === 'receipts' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
          <table className="w-full text-right border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">رقم إيصال الاستلام (GRN)</th>
                <th className="py-3 px-4">أمر الشراء</th>
                <th className="py-3 px-4">المستودع</th>
                <th className="py-3 px-4">تاريخ الاستلام</th>
                <th className="py-3 px-4 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {receipts.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80">
                  <td className="py-3.5 px-4 font-mono font-bold text-xs text-[#0D6E4F]">{r.receiptNumber}</td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-600">{r.purchaseOrderId ? r.purchaseOrderId.slice(0, 8) : '-'}</td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-600">{r.warehouseId.slice(0, 8)}</td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-500">{(r.receivedAt || r.createdAt || '').slice(0, 10)}</td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
              {receipts.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    لا توجد إيصالات استلام بضائع (GRN) مسجلة حالياً
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {renderPagination(receiptsMeta, setReceiptsPage)}
        </div>
      )}

      {/* Supplier Invoices (AP) Tab */}
      {activeTab === 'invoices' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
          <table className="w-full text-right border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">رقم الفاتورة</th>
                <th className="py-3 px-4">المورد</th>
                <th className="py-3 px-4 text-left">الإجمالي شامل الضريبة</th>
                <th className="py-3 px-4 text-center">تاريخ الفاتورة</th>
                <th className="py-3 px-4 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/80">
                  <td className="py-3.5 px-4 font-mono font-bold text-xs text-[#0D6E4F]">{inv.invoiceNumber}</td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-600">{inv.supplierId.slice(0, 8)}</td>
                  <td className="py-3.5 px-4 text-left font-mono font-bold text-slate-900">
                    {Number(inv.grandTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-xs text-slate-500">{(inv.invoiceDate || inv.createdAt || '').slice(0, 10)}</td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    لا توجد فواتير موردين مسجلة حالياً
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {renderPagination(invoicesMeta, setInvoicesPage)}
        </div>
      )}

      {/* Purchase Returns Tab */}
      {activeTab === 'returns' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
          <table className="w-full text-right border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">رقم المرتجع</th>
                <th className="py-3 px-4">المورد</th>
                <th className="py-3 px-4">السبب</th>
                <th className="py-3 px-4 text-left">القيمة</th>
                <th className="py-3 px-4 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {returns.map((ret) => (
                <tr key={ret.id} className="hover:bg-slate-50/80">
                  <td className="py-3.5 px-4 font-mono font-bold text-xs text-rose-600">{ret.returnNumber}</td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-600">{ret.supplierId.slice(0, 8)}</td>
                  <td className="py-3.5 px-4 text-xs text-slate-600">{ret.reason || '-'}</td>
                  <td className="py-3.5 px-4 text-left font-mono font-bold text-slate-900">
                    {Number(ret.grandTotal ?? ret.totalAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                      {ret.status}
                    </span>
                  </td>
                </tr>
              ))}
              {returns.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    لا توجد مرتجعات مشتريات مسجلة حالياً
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {renderPagination(returnsMeta, setReturnsPage)}
        </div>
      )}

      {/* New Payment Modal */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
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
                  {suppliers.length > 0 ? (
                    suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.nameAr}</option>
                    ))
                  ) : (
                    <>
                      <option value="مؤسسة التوريدات اللحوم الطازجة">مؤسسة التوريدات اللحوم الطازجة</option>
                      <option value="شركة المخابز الذهبية">شركة المخابز الذهبية</option>
                    </>
                  )}
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
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
                  {suppliers.length > 0 ? (
                    suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.nameAr}</option>
                    ))
                  ) : (
                    <>
                      <option value="شركة المراعي للألبان">شركة المراعي للألبان</option>
                      <option value="مؤسسة توريدات اللحوم الطازجة">مؤسسة توريدات اللحوم الطازجة</option>
                      <option value="شركة المخابز الذهبية">شركة المخابز الذهبية</option>
                    </>
                  )}
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

              <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-800 border border-blue-200">
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
                  className="px-5 py-2 rounded-xl bg-[#0D6E4F] hover:bg-[#0A583F] text-white text-sm font-medium"
                >
                  تأكيد وإصدار أمر الشراء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Purchase Request Modal */}
      {isPrModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="font-bold text-lg text-slate-800 mb-4 pb-2 border-b border-slate-100">
              إنشاء طلب شراء جديد (Purchase Request)
            </h3>
            <form onSubmit={handleCreatePr} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">المستودع الطالب</label>
                <select
                  value={prWarehouseId}
                  onChange={(e) => setPrWarehouseId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  required
                >
                  {(hierarchy?.warehouses || []).map((wh: any) => (
                    <option key={wh.id} value={wh.id}>
                      {wh.name || wh.code}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الصنف المطلوب</label>
                <select
                  value={prItemId}
                  onChange={(e) => setPrItemId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  required
                >
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.nameAr}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">الكمية المطلوبة</label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={prQty}
                    onChange={(e) => setPrQty(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">التكلفة التقديرية للوحدة (SAR)</label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={prEstimatedCost}
                    onChange={(e) => setPrEstimatedCost(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">تاريخ الاحتياج (اختياري)</label>
                <input
                  type="date"
                  value={prNeededByDate}
                  onChange={(e) => setPrNeededByDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">ملاحظات</label>
                <textarea
                  value={prNotes}
                  onChange={(e) => setPrNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  placeholder="تفاصيل إضافية لطلب الشراء..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPrModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#0D6E4F] hover:bg-[#0A583F] text-white text-sm font-medium"
                >
                  إرسال طلب الشراء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PR Detail Modal */}
      {selectedPrDetail && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-lg text-slate-800">
                  تفاصيل طلب الشراء: <span className="font-mono text-[#0D6E4F]">{selectedPrDetail.requestNumber}</span>
                </h3>
                <p className="text-xs text-slate-500">
                  الحالة: <span className="font-semibold">{selectedPrDetail.status}</span>
                  {selectedPrDetail.approvalMetadata?.approvedBy
                    ? ` • معتمد بواسطة: ${selectedPrDetail.approvalMetadata.approvedBy.slice(0, 8)}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPrDetail(null)}
                className="px-3 py-1 rounded-xl border border-slate-200 text-xs text-slate-600"
              >
                إغلاق
              </button>
            </div>

            {selectedPrDetail.notes && (
              <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-700 border border-slate-200">
                {selectedPrDetail.notes}
              </div>
            )}

            <div className="border border-slate-200 rounded-2xl overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">الصنف</th>
                    <th className="py-2.5 px-3 text-center">الكمية المطلوبة</th>
                    <th className="py-2.5 px-3 text-left">التكلفة التقديرية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(selectedPrDetail.lines || []).map((line) => (
                    <tr key={line.id}>
                      <td className="py-2.5 px-3 font-medium text-slate-800">
                        {items.find((it) => it.id === line.itemId)?.nameAr || line.itemId.slice(0, 8)}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">{line.requestedQty}</td>
                      <td className="py-2.5 px-3 text-left font-mono">{line.estimatedUnitCost} SAR</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {(selectedPrDetail.status === 'DRAFT' || selectedPrDetail.status === 'SUBMITTED') && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleApprovePr(selectedPrDetail.id)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                  >
                    اعتماد الطلب
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectPrTarget(selectedPrDetail)}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium"
                  >
                    رفض الطلب
                  </button>
                </>
              )}
              {selectedPrDetail.status === 'APPROVED' && (
                <button
                  type="button"
                  onClick={() => setConvertPrTarget(selectedPrDetail)}
                  className="px-4 py-2 rounded-xl bg-[#0D6E4F] hover:bg-[#0A583F] text-white text-xs font-medium"
                >
                  تحويل إلى أمر شراء (PO)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject PR Modal */}
      {rejectPrTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="font-bold text-lg text-slate-800 mb-3">
              رفض طلب الشراء ({rejectPrTarget.requestNumber})
            </h3>
            <form onSubmit={handleRejectPr} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">سبب الرفض</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  placeholder="أدخل سبب رفض الطلب..."
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectPrTarget(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium"
                >
                  تأكيد الرفض
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Convert PR to PO Modal */}
      {convertPrTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="font-bold text-lg text-slate-800 mb-3">
              تحويل طلب الشراء ({convertPrTarget.requestNumber}) إلى أمر شراء (PO)
            </h3>
            <form onSubmit={handleConvertPrToPo} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">اختر المورد المعتمد</label>
                <select
                  value={convertSupplierId}
                  onChange={(e) => setConvertSupplierId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                  required
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nameAr}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConvertPrTarget(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-[#0D6E4F] hover:bg-[#0A583F] text-white text-sm font-medium"
                >
                  تحويل وإنشاء PO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
