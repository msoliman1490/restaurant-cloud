import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
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
  Calculator,
  X,
  AlertCircle,
  Loader2,
  RefreshCw,
  Printer,
  History,
  RotateCcw,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PosShiftClosingView } from './PosShiftClosingView';
import { ReceiptPrintModal, ReceiptPrintData } from './ReceiptPrintModal';
import { OfflinePosDrawer } from './OfflinePosDrawer';
import {
  enqueueOfflineOrder,
  listQueuedOrders,
  subscribeNetworkStatus,
} from '../utils/offlinePosQueue';

export interface PosProduct {
  id: string;
  sku: string;
  nameAr: string;
  nameEn: string;
  category: string;
  uomId?: string;
  price: number; // Excl. VAT
  taxRate: number; // 0.15
  stockQty: number;
}

export interface CartItem extends PosProduct {
  quantity: number;
}

interface PosViewProps {
  onExitFullscreen?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const PosView: React.FC<PosViewProps> = ({
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  const { user, activeLegalEntity, activeBranch, hierarchy } = useAuth();
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [categories, setCategories] = useState<string[]>(['الكل']);
  const [activeShiftId, setActiveShiftId] = useState<string | undefined>(undefined);
  const [selectedCategory, setSelectedCategory] = useState('الكل');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [splitCashAmount, setSplitCashAmount] = useState('');
  const [showShiftClosingModal, setShowShiftClosingModal] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [lastOrderNumber, setLastOrderNumber] = useState('');
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY'>('TAKEAWAY');

  // Receipt printing & duplicate-print guard
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [activeReceiptData, setActiveReceiptData] = useState<ReceiptPrintData | null>(null);
  const [lastCompletedReceipt, setLastCompletedReceipt] = useState<{ data: ReceiptPrintData; key: string } | null>(null);
  const [printedOrderKeys, setPrintedOrderKeys] = useState<Set<string>>(() => new Set());
  const [isPrintingGuard, setIsPrintingGuard] = useState(false);
  const [isReprintPreview, setIsReprintPreview] = useState(false);

  // Recent Orders & Sales Refund state
  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [refundTargetOrder, setRefundTargetOrder] = useState<any | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [restockInventory, setRestockInventory] = useState(true);
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [refundIdempotencyKey, setRefundIdempotencyKey] = useState('');
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundSuccessMsg, setRefundSuccessMsg] = useState<string | null>(null);

  // Offline POS Queue & Network status
  const [showOfflineDrawer, setShowOfflineDrawer] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);

  const refreshOfflineCount = useCallback(async () => {
    try {
      const orders = await listQueuedOrders();
      setPendingOfflineCount(orders.filter((o) => o.status !== 'SYNCED').length);
    } catch {
      // Ignore storage read failure
    }
  }, []);

  useEffect(() => {
    void refreshOfflineCount();
    const unsub = subscribeNetworkStatus(
      () => {
        setIsOnline(true);
        void refreshOfflineCount();
      },
      () => {
        setIsOnline(false);
        void refreshOfflineCount();
      },
    );
    return unsub;
  }, [refreshOfflineCount]);

  const defaultDeviceId = hierarchy?.devices?.find((d) => d.branchId === activeBranch?.id)?.id || hierarchy?.devices?.[0]?.id || '';
  const defaultWarehouseId = hierarchy?.warehouses?.find((w) => w.branchId === activeBranch?.id)?.id || hierarchy?.warehouses?.[0]?.id || '';

  const loadPosCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const itemsRes = await apiClient.get<any>('/api/v1/catalog/items?limit=100');
      const rows = Array.isArray(itemsRes) ? itemsRes : itemsRes?.items || [];
      const mapped: PosProduct[] = rows
        .filter((i: any) => i.isSold !== false && i.isActive !== false)
        .map((i: any) => ({
          id: i.id,
          sku: i.sku || '',
          nameAr: i.nameAr || i.nameEn || i.sku,
          nameEn: i.nameEn || '',
          category: i.categoryName || 'عام',
          uomId: i.baseUomId,
          price: Number(i.defaultPrice ?? 0),
          taxRate: i.taxRate !== undefined && i.taxRate !== null ? Number(i.taxRate) : 0.15,
          stockQty: Number(i.onHandQty ?? 0),
        }));
      setProducts(mapped);
      const uniqueCats = Array.from(new Set(mapped.map((m) => m.category)));
      setCategories(['الكل', ...uniqueCats]);

      if (defaultDeviceId) {
        const shiftRes = await apiClient.get<any>(`/api/v1/sales/shifts/active/${defaultDeviceId}`).catch(() => null);
        setActiveShiftId(shiftRes?.id || undefined);
      } else {
        setActiveShiftId(undefined);
      }
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل قائمة الأصناف من الخادم');
      setProducts([]);
      setCategories(['الكل']);
    } finally {
      setLoading(false);
    }
  }, [defaultDeviceId]);

  useEffect(() => {
    void loadPosCatalog();
  }, [loadPosCatalog]);

  // Filter products
  const filteredProducts = products.filter((p) => {
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
  const taxTotal = cart.reduce((acc, item) => acc + item.price * item.quantity * item.taxRate, 0);
  const grandTotal = subtotal + taxTotal;

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setPaymentError(null);
    setShowSplitForm(false);
    setSplitCashAmount((Math.floor((grandTotal / 2) * 100) / 100).toFixed(2));
    setShowPaymentModal(true);
  };

  const openReceiptPreview = useCallback(
    (receipt: ReceiptPrintData, orderKey: string, forceReprint = false) => {
      if (isPrintingGuard) return;
      setIsPrintingGuard(true);
      setTimeout(() => setIsPrintingGuard(false), 450);

      const alreadyPrinted = forceReprint || printedOrderKeys.has(orderKey);
      setIsReprintPreview(alreadyPrinted);

      const baseOrderType = receipt.orderType || 'نقطة البيع';
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

  const loadRecentOrders = useCallback(async () => {
    setLoadingOrders(true);
    setOrdersError(null);
    try {
      const qs = activeBranch?.id ? `?branchId=${encodeURIComponent(activeBranch.id)}` : '';
      const res = await apiClient.get<any>(`/api/v1/sales/orders${qs}`);
      const list = Array.isArray(res) ? res : res?.items || res?.data || [];
      setRecentOrders(list);
    } catch (err: any) {
      setOrdersError(err?.message || 'تعذر تحميل سجل الطلبات الأخيرة');
      setRecentOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }, [activeBranch?.id]);

  const handleOpenOrdersModal = () => {
    setRefundTargetOrder(null);
    setRefundError(null);
    setRefundSuccessMsg(null);
    setShowOrdersModal(true);
    void loadRecentOrders();
  };

  const handlePrintHistoryOrder = (order: any) => {
    const orderSubtotal = Number(order.subtotal ?? 0);
    const orderDiscount = Number(order.discountTotal ?? order.discountAmount ?? 0);
    const orderVat = Number(order.taxTotal ?? order.taxAmount ?? order.vatAmount ?? 0);
    const orderGrandTotal = Number(order.grandTotal ?? 0);
    const orderKey = order.id || order.orderNumber;
    const isReprint = printedOrderKeys.has(orderKey);

    const lines = Array.isArray(order.lines) && order.lines.length > 0
      ? order.lines.map((l: any) => ({
          name: l.itemNameAr || l.itemName || l.name || `صنف #${String(l.itemId || '').slice(0, 6)}`,
          quantity: Number(l.quantity ?? 1),
          unitPrice: Number(l.unitPrice ?? 0),
          total: Number(l.lineTotal ?? Number(l.quantity ?? 1) * Number(l.unitPrice ?? 0)),
          vatAmount: Number(l.taxAmount ?? 0),
        }))
      : [
          {
            name: `طلب رقم #${order.orderNumber || String(order.id).slice(0, 8)}`,
            quantity: 1,
            unitPrice: orderSubtotal,
            total: orderSubtotal,
            vatAmount: orderVat,
          },
        ];

    const receipt: ReceiptPrintData = {
      invoiceNumber: order.orderNumber || String(order.id).slice(0, 8),
      issueDate: order.createdAt
        ? new Date(order.createdAt).toLocaleString('ar-SA')
        : new Date().toLocaleString('ar-SA'),
      tenantName: activeLegalEntity?.commercialName || activeLegalEntity?.legalName || 'المطعم',
      branchName: activeBranch?.name || 'الفرع الرئيسي',
      vatNumber: activeLegalEntity?.vatNumber || undefined,
      crNumber: activeLegalEntity?.crNumber || undefined,
      cashierName: user?.displayName || user?.email,
      orderType: order.orderType === 'DINE_IN' ? 'محلي (Dine-in)' : 'سفري (Takeaway)',
      tableNumber: order.tableNumber || undefined,
      invoiceType: 'SIMPLIFIED',
      items: lines,
      subtotal: orderSubtotal,
      discountAmount: orderDiscount,
      vatRate: 15,
      vatAmount: orderVat,
      grandTotal: orderGrandTotal,
      paymentMethod: order.paymentMethod || undefined,
      paidAmount: orderGrandTotal,
      zatcaQrBase64: order.zatcaQrCode || order.zatcaQrBase64 || order.qrCode || undefined,
      currency: 'ر.س',
    };

    openReceiptPreview(receipt, orderKey, isReprint || true);
  };

  const openRefundForm = (order: any) => {
    setRefundTargetOrder(order);
    setRefundReason('');
    setRestockInventory(true);
    setRefundMethod('CASH');
    setRefundError(null);
    setRefundSuccessMsg(null);
    setRefundIdempotencyKey(
      `refund-${order.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    );
  };

  const submitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundTargetOrder || isSubmittingRefund) return;
    if (!refundReason.trim()) {
      setRefundError('يرجى إدخال سبب الاسترجاع');
      return;
    }

    setIsSubmittingRefund(true);
    setRefundError(null);
    setRefundSuccessMsg(null);
    try {
      await apiClient.post(`/api/v1/sales/orders/${refundTargetOrder.id}/refund`, {
        reason: refundReason.trim(),
        restockInventory,
        refundMethod,
        idempotencyKey: refundIdempotencyKey,
      });
      setRefundSuccessMsg(
        `تم تنفيذ المرتجع بنجاح للطلب #${refundTargetOrder.orderNumber || refundTargetOrder.id.slice(0, 8)} (${refundMethod})`
      );
      setRefundTargetOrder(null);
      await Promise.all([loadRecentOrders(), loadPosCatalog()]);
    } catch (err: any) {
      setRefundError(err?.message || 'فشل تنفيذ عملية الاسترجاع');
    } finally {
      setIsSubmittingRefund(false);
    }
  };

  const confirmPayment = async (method: 'CASH' | 'CARD' | 'SPLIT') => {
    setPaymentError(null);
    if (!activeLegalEntity?.id || !activeBranch?.id || !defaultDeviceId || !defaultWarehouseId) {
      setPaymentError('بيانات الفرع أو الجهاز أو المستودع غير مكتملة. يرجى التحقق من إعدادات الجلسة.');
      return;
    }
    const missingUomItem = cart.find((c) => !c.uomId);
    if (missingUomItem) {
      setPaymentError(`الصنف "${missingUomItem.nameAr}" يفتقد وحدة القياس الأساسية (UOM) ولا يمكن إتمام الفاتورة.`);
      return;
    }

    let payments: { paymentMethod: string; amount: string }[];
    if (method === 'SPLIT') {
      const cashVal = Number(splitCashAmount);
      if (Number.isNaN(cashVal) || cashVal <= 0 || cashVal >= grandTotal) {
        setPaymentError(`يرجى إدخال مبلغ نقدي صحيح أكبر من 0 وأقل من الإجمالي (${grandTotal.toFixed(2)} ر.س)`);
        return;
      }
      const cardVal = Math.round((grandTotal - cashVal) * 100) / 100;
      payments = [
        { paymentMethod: 'CASH', amount: cashVal.toFixed(4) },
        { paymentMethod: 'CARD', amount: cardVal.toFixed(4) },
      ];
    } else {
      payments = [{ paymentMethod: method, amount: grandTotal.toFixed(4) }];
    }

    const ordNum = `ORD-${method}-${Date.now().toString(36).toUpperCase()}`;
    const orderLinesPayload = cart.map((c) => ({
      itemId: c.id,
      uomId: c.uomId!,
      quantity: c.quantity.toFixed(4),
      unitPrice: c.price.toFixed(4),
      discountAmount: '0.0000',
    }));
    const paymentLabel =
      method === 'SPLIT'
        ? `نقدي (${payments[0].amount}) + شبكة (${payments[1].amount})`
        : method === 'CASH'
        ? 'نقدي (CASH)'
        : 'شبكة / بطاقة (CARD)';

    const buildReceiptData = (
      invoiceNumber: string,
      resObj?: any,
    ): ReceiptPrintData => ({
      invoiceNumber,
      issueDate: new Date(resObj?.createdAt || Date.now()).toLocaleString('ar-SA'),
      tenantName: activeLegalEntity?.commercialName || activeLegalEntity?.legalName || 'المطعم',
      branchName: activeBranch?.name || 'الفرع الرئيسي',
      vatNumber: activeLegalEntity?.vatNumber || undefined,
      crNumber: activeLegalEntity?.crNumber || undefined,
      cashierName: user?.displayName || user?.email,
      orderType: orderType === 'DINE_IN' ? 'محلي (Dine-in)' : 'سفري (Takeaway)',
      invoiceType: 'SIMPLIFIED',
      items: cart.map((c) => ({
        name: c.nameAr,
        quantity: c.quantity,
        unitPrice: c.price,
        total: c.price * c.quantity,
        vatAmount: c.price * c.quantity * c.taxRate,
      })),
      subtotal: Number(resObj?.subtotal ?? subtotal),
      discountAmount: Number(resObj?.discountTotal ?? resObj?.discountAmount ?? 0),
      vatRate: 15,
      vatAmount: Number(resObj?.taxTotal ?? resObj?.taxAmount ?? taxTotal),
      grandTotal: Number(resObj?.grandTotal ?? grandTotal),
      paymentMethod: paymentLabel,
      paidAmount: Number(resObj?.grandTotal ?? grandTotal),
      changeAmount: 0,
      zatcaQrBase64: resObj?.zatcaQrCode || resObj?.zatcaQrBase64 || resObj?.qrCode || undefined,
      currency: 'ر.س',
    });

    const queueOrderOffline = async () => {
      const queued = await enqueueOfflineOrder({
        deviceId: defaultDeviceId,
        legalEntityId: activeLegalEntity.id,
        branchId: activeBranch.id,
        warehouseId: defaultWarehouseId,
        shiftId: activeShiftId,
        orderNumber: ordNum,
        orderType,
        channel: 'POS',
        invoiceType: 'SIMPLIFIED',
        lines: orderLinesPayload,
        payments,
        grandTotalEstimate: grandTotal.toFixed(4),
      });
      await refreshOfflineCount();
      const receiptData = buildReceiptData(`${ordNum} (محلي)`);
      const orderKey = queued.clientTransactionId;
      setLastCompletedReceipt({ data: receiptData, key: orderKey });
      setLastOrderNumber(`${ordNum} (محلي - بانتظار المزامنة)`);
      setShowPaymentModal(false);
      setShowSplitForm(false);
      setPaymentSuccess(true);
      setCart([]);
      openReceiptPreview(receiptData, orderKey, false);
      setTimeout(() => setPaymentSuccess(false), 6000);
    };

    setIsSubmittingPayment(true);
    try {
      if (!isOnline) {
        await queueOrderOffline();
        return;
      }

      const res = await apiClient.post<any>('/api/v1/sales/orders', {
        legalEntityId: activeLegalEntity.id,
        branchId: activeBranch.id,
        deviceId: defaultDeviceId,
        shiftId: activeShiftId,
        warehouseId: defaultWarehouseId,
        orderNumber: ordNum,
        orderType,
        channel: 'POS',
        idempotencyKey: `pos-${ordNum}`,
        lines: orderLinesPayload,
        payments,
      });
      const finalOrderNum = res?.orderNumber || ordNum;
      const receiptData = buildReceiptData(finalOrderNum, res);

      const orderKey = res?.id || finalOrderNum;
      setLastCompletedReceipt({ data: receiptData, key: orderKey });
      setLastOrderNumber(finalOrderNum);
      setShowPaymentModal(false);
      setShowSplitForm(false);
      setPaymentSuccess(true);
      setCart([]);
      openReceiptPreview(receiptData, orderKey, false);
      setTimeout(() => setPaymentSuccess(false), 6000);
    } catch (err: any) {
      const isNetworkFailure =
        !navigator.onLine ||
        err instanceof TypeError ||
        err?.name === 'AbortError' ||
        /failed to fetch|network|offline|timeout|load failed/i.test(err?.message || '');
      if (isNetworkFailure) {
        try {
          await queueOrderOffline();
          return;
        } catch (queueErr: any) {
          setPaymentError(queueErr?.message || 'فشل حفظ الفاتورة محلياً في وضع عدم الاتصال');
          return;
        }
      }
      setPaymentError(err?.message || 'فشل تسجيل الفاتورة في الخادم');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] -m-8 bg-slate-950 text-slate-100 select-none overflow-hidden">
      {/* Top POS Action Bar */}
      <header className="h-14 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${activeShiftId ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            <span className="font-bold text-sm tracking-wide text-white">نقطة البيع والكاشير (POS)</span>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full border ${
              activeShiftId
                ? 'bg-indigo-900/60 text-indigo-300 border-indigo-700/50'
                : 'bg-amber-900/40 text-amber-300 border-amber-700/50'
            }`}
          >
            {activeShiftId ? 'وردية مفتوحة' : 'لا توجد وردية مفتوحة'} • الكاشير: {user?.displayName || user?.email || 'غير محدد'}
          </span>
          <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded">
            {activeBranch?.name || 'الفرع غير محدد'}
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

          {/* Recent Orders & Returns Button */}
          <button
            type="button"
            onClick={handleOpenOrdersModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
          >
            <History size={14} />
            <span>الطلبات الأخيرة والمرتجعات</span>
          </button>

          {/* Offline POS Queue Button */}
          <button
            type="button"
            onClick={() => setShowOfflineDrawer(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              isOnline
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border-amber-500/50'
            }`}
            title="إدارة صف الفواتير المحلي (Offline POS)"
          >
            {isOnline ? <Wifi size={14} className="text-emerald-400" /> : <WifiOff size={14} className="text-amber-400" />}
            <span>{isOnline ? 'متصل' : 'غير متصل'}</span>
            {pendingOfflineCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold">
                {pendingOfflineCount}
              </span>
            )}
          </button>

          {/* Shift Closing Workstation Button */}
          <button
            type="button"
            onClick={() => setShowShiftClosingModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
          >
            <Calculator size={14} />
            <span>إقفال الوردية وسجل الورديات</span>
          </button>

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
          <div className="flex items-center gap-2">
            {lastCompletedReceipt && (
              <button
                type="button"
                disabled={isPrintingGuard}
                onClick={() => openReceiptPreview(lastCompletedReceipt.data, lastCompletedReceipt.key, true)}
                className="flex items-center gap-1.5 px-3 py-1 bg-white/15 hover:bg-white/25 disabled:opacity-50 rounded-lg text-xs font-bold transition-colors"
              >
                <Printer size={14} />
                <span>إعادة طباعة الفاتورة (نسخة مطبوعة)</span>
              </button>
            )}
            <span className="text-xs bg-emerald-700/60 px-2 py-1 rounded">فاتورة إلكترونية ZATCA جاهزة</span>
          </div>
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
              {categories.map((cat) => (
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
          <div className="flex-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
                <Loader2 size={32} className="animate-spin text-indigo-400" />
                <p className="text-sm">جاري تحميل قائمة الأصناف...</p>
              </div>
            ) : error ? (
              <div className="h-full flex flex-col items-center justify-center text-rose-400 gap-3 p-6 text-center">
                <AlertCircle size={36} />
                <p className="text-sm font-semibold">{error}</p>
                <button
                  onClick={() => void loadPosCatalog()}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 transition-colors"
                >
                  <RefreshCw size={14} />
                  <span>إعادة المحاولة</span>
                </button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2 p-6 text-center">
                <Search size={36} className="stroke-slate-700" />
                <p className="text-sm font-semibold text-slate-300">لا توجد أصناف متاحة للعرض</p>
                <p className="text-xs text-slate-500">
                  {products.length === 0
                    ? 'لم يتم العثور على أصناف مفعّلة في الكتالوج'
                    : 'جرّب تغيير كلمة البحث أو التصنيف المختار'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5">
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
            )}
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
                      {(item.price * (1 + item.taxRate)).toFixed(2)} ر.س / حبة
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
                    {(item.price * item.quantity * (1 + item.taxRate)).toFixed(2)}
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

            {paymentError && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-700/60 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle size={16} className="shrink-0" />
                <span>{paymentError}</span>
              </div>
            )}

            {!showSplitForm ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    disabled={isSubmittingPayment}
                    onClick={() => void confirmPayment('CASH')}
                    className="p-5 rounded-2xl bg-slate-950 border border-slate-800 hover:border-emerald-500 hover:bg-emerald-950/20 disabled:opacity-50 text-center space-y-2 transition-all group"
                  >
                    <Banknote size={32} className="mx-auto text-emerald-400 group-hover:scale-110 transition-transform" />
                    <div className="font-bold text-sm text-white">نقدي (Cash)</div>
                    <div className="text-[11px] text-slate-400">تحصيل في صندوق الكاشير</div>
                  </button>

                  <button
                    disabled={isSubmittingPayment}
                    onClick={() => void confirmPayment('CARD')}
                    className="p-5 rounded-2xl bg-slate-950 border border-slate-800 hover:border-indigo-500 hover:bg-indigo-950/20 disabled:opacity-50 text-center space-y-2 transition-all group"
                  >
                    <CreditCard size={32} className="mx-auto text-indigo-400 group-hover:scale-110 transition-transform" />
                    <div className="font-bold text-sm text-white">شبكة / مدى / بطاقة</div>
                    <div className="text-[11px] text-slate-400">جهاز نقاط البيع الإلكتروني</div>
                  </button>
                </div>

                <button
                  disabled={isSubmittingPayment}
                  onClick={() => {
                    setPaymentError(null);
                    setSplitCashAmount((Math.floor((grandTotal / 2) * 100) / 100).toFixed(2));
                    setShowSplitForm(true);
                  }}
                  className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-xs font-semibold text-slate-300 flex items-center justify-center gap-2"
                >
                  <span>دفع مجزأ (نقدي + شبكة بمبالغ مخصصة)</span>
                </button>
              </>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">المبلغ النقدي (ر.س)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={Math.max(0.01, grandTotal - 0.01).toFixed(2)}
                    value={splitCashAmount}
                    onChange={(e) => setSplitCashAmount(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-400">المتبقي على الشبكة / البطاقة:</span>
                  <span className="font-bold text-indigo-400">
                    {Math.max(0, grandTotal - (Number(splitCashAmount) || 0)).toFixed(2)} ر.س
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={isSubmittingPayment}
                    onClick={() => void confirmPayment('SPLIT')}
                    className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-bold text-white flex items-center justify-center gap-2"
                  >
                    {isSubmittingPayment && <Loader2 size={14} className="animate-spin" />}
                    <span>تأكيد الدفع المجزأ</span>
                  </button>
                  <button
                    disabled={isSubmittingPayment}
                    onClick={() => {
                      setPaymentError(null);
                      setShowSplitForm(false);
                    }}
                    className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
                  >
                    رجوع
                  </button>
                </div>
              </div>
            )}

            <button
              disabled={isSubmittingPayment}
              onClick={() => {
                setShowPaymentModal(false);
                setShowSplitForm(false);
                setPaymentError(null);
              }}
              className="w-full py-2 text-xs text-slate-400 hover:text-white transition-colors"
            >
              إلغاء والعودة للطلب
            </button>
          </div>
        </div>
      )}

      {/* Shift Closing Workstation Drawer / Modal */}
      {showShiftClosingModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-6xl max-h-[92vh] bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <span className="font-bold text-white flex items-center gap-2">
                <Calculator size={18} className="text-emerald-400" />
                إقفال وردية نقاط البيع ومطابقة الصندوق
              </span>
              <button
                type="button"
                onClick={() => setShowShiftClosingModal(false)}
                className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <PosShiftClosingView
                legalEntityId={activeLegalEntity?.id || '00000000-0000-0000-0000-000000000001'}
                theme="dark"
                defaultBranchId={activeBranch?.id || ''}
              />
            </div>
          </div>
        </div>
      )}

      {/* Recent Orders & Sales Refund Modal */}
      {showOrdersModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <span className="font-bold text-white flex items-center gap-2">
                <History size={18} className="text-indigo-400" />
                الطلبات الأخيرة وإدارة المرتجعات (Recent Orders & Refunds)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadRecentOrders()}
                  className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition"
                  title="تحديث"
                >
                  <RefreshCw size={16} className={loadingOrders ? 'animate-spin' : ''} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowOrdersModal(false)}
                  className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {refundSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span>{refundSuccessMsg}</span>
                </div>
              )}

              {refundTargetOrder && (
                <form
                  onSubmit={submitRefund}
                  className="p-4 rounded-2xl bg-slate-950 border border-amber-600/50 space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h4 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                        <RotateCcw size={15} />
                        استرجاع فاتورة #{refundTargetOrder.orderNumber || refundTargetOrder.id.slice(0, 8)}
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                        Idempotency Key: {refundIdempotencyKey}
                      </p>
                    </div>
                    <span className="text-sm font-black text-emerald-400">
                      {Number(refundTargetOrder.grandTotal ?? 0).toFixed(2)} ر.س
                    </span>
                  </div>

                  {refundError && (
                    <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-700/60 text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle size={15} className="shrink-0" />
                      <span>{refundError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        سبب الاسترجاع *
                      </label>
                      <input
                        type="text"
                        required
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                        placeholder="مثال: خطأ في الطلب أو طلب العميل"
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        طريقة رد المبلغ (Refund Method)
                      </label>
                      <select
                        value={refundMethod}
                        onChange={(e) => setRefundMethod(e.target.value as 'CASH' | 'CARD')}
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                      >
                        <option value="CASH">نقدي (CASH)</option>
                        <option value="CARD">شبكة / بطاقة (CARD)</option>
                      </select>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={restockInventory}
                      onChange={(e) => setRestockInventory(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-emerald-500"
                    />
                    <span>إعادة الأصناف إلى المخزون (Restock Inventory)</span>
                  </label>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={isSubmittingRefund || !refundReason.trim()}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2"
                    >
                      {isSubmittingRefund && <Loader2 size={14} className="animate-spin" />}
                      <span>تأكيد الاسترجاع والترحيل المالي</span>
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingRefund}
                      onClick={() => setRefundTargetOrder(null)}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                    >
                      إلغاء
                    </button>
                  </div>
                </form>
              )}

              {loadingOrders ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <Loader2 size={28} className="animate-spin text-indigo-400" />
                  <span className="text-xs">جاري تحميل الطلبات الأخيرة...</span>
                </div>
              ) : ordersError ? (
                <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle size={16} />
                  <span>{ordersError}</span>
                </div>
              ) : recentOrders.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  لا توجد طلبات مسجلة حالياً
                </div>
              ) : (
                <div className="space-y-2">
                  {recentOrders.map((ord) => {
                    const orderKey = ord.id || ord.orderNumber;
                    const isPrinted = printedOrderKeys.has(orderKey);
                    const isRefundable = ord.status !== 'REFUNDED' && ord.status !== 'VOIDED';
                    return (
                      <div
                        key={orderKey}
                        className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-white">
                              #{ord.orderNumber || String(ord.id).slice(0, 8)}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                ord.status === 'REFUNDED'
                                  ? 'bg-rose-900/60 text-rose-300'
                                  : ord.status === 'VOIDED'
                                  ? 'bg-slate-800 text-slate-400'
                                  : 'bg-emerald-900/60 text-emerald-300'
                              }`}
                            >
                              {ord.status}
                            </span>
                            {isPrinted && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/50 text-amber-300 border border-amber-700/40 font-semibold">
                                نسخة مطبوعة / Reprint
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {ord.createdAt ? new Date(ord.createdAt).toLocaleString('ar-SA') : ''} •{' '}
                            {ord.orderType || 'POS'}
                          </p>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-black text-emerald-400">
                            {Number(ord.grandTotal ?? 0).toFixed(2)} ر.س
                          </span>

                          <button
                            type="button"
                            disabled={isPrintingGuard}
                            onClick={() => handlePrintHistoryOrder(ord)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold border border-slate-700"
                          >
                            <Printer size={13} />
                            <span>{isPrinted ? 'إعادة طباعة (نسخة مطبوعة)' : 'طباعة'}</span>
                          </button>

                          {isRefundable && (
                            <button
                              type="button"
                              onClick={() => openRefundForm(ord)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-600/40 text-xs font-semibold"
                            >
                              <RotateCcw size={13} />
                              <span>استرجاع</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reprint Indicator Banner + Receipt Print Modal */}
      {receiptModalOpen && isReprintPreview && (
        <div className="no-print fixed top-3 left-1/2 -translate-x-1/2 z-[60] px-4 py-1.5 rounded-full bg-amber-500 text-slate-950 text-xs font-bold shadow-lg flex items-center gap-2">
          <Printer size={14} />
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

      <OfflinePosDrawer
        isOpen={showOfflineDrawer}
        onClose={() => {
          setShowOfflineDrawer(false);
          void refreshOfflineCount();
        }}
        deviceId={defaultDeviceId || undefined}
        warehouseId={defaultWarehouseId || undefined}
        branchId={activeBranch?.id}
        onOrderSynced={() => {
          void loadPosCatalog();
          void refreshOfflineCount();
        }}
      />
    </div>
  );
};
