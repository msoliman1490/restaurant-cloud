import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Sun,
  Moon,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
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
  imageUrl?: string;
}

export interface CartItem extends PosProduct {
  quantity: number;
}

export interface HeldOrder {
  id: string;
  label: string;
  orderType: 'DINE_IN' | 'TAKEAWAY';
  items: CartItem[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  heldAt: string;
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
  const { locale, dir, t } = useLocale();
  const [posTheme, setPosTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('rc_pos_theme_v1') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const isLight = posTheme === 'light';
  const togglePosTheme = () => {
    setPosTheme((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem('rc_pos_theme_v1', next);
      } catch {
        // Ignore storage error
      }
      return next;
    });
  };
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
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Held / Suspended Orders (الطلبات المعلقة)
  const heldStorageKey = `rc_pos_held_orders_v1_${activeBranch?.id || 'default'}`;
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>(() => {
    try {
      const raw = localStorage.getItem(`rc_pos_held_orders_v1_${activeBranch?.id || 'default'}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [showHeldOrdersModal, setShowHeldOrdersModal] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(heldStorageKey);
      setHeldOrders(raw ? JSON.parse(raw) : []);
    } catch {
      setHeldOrders([]);
    }
  }, [heldStorageKey]);

  const persistHeldOrders = useCallback(
    (next: HeldOrder[]) => {
      setHeldOrders(next);
      try {
        localStorage.setItem(heldStorageKey, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
    },
    [heldStorageKey],
  );

  const handleHoldCurrentOrder = useCallback(() => {
    if (cart.length === 0) return;
    const nextNum = heldOrders.length + 1;
    const subtotalNow = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    const taxNow = cart.reduce((s, i) => s + i.price * i.quantity * i.taxRate, 0);
    const newHeld: HeldOrder = {
      id: `HELD-${Date.now().toString(36).toUpperCase()}`,
      label: t(`طلب معلق #${nextNum}`, `Held Order #${nextNum}`),
      orderType,
      items: cart,
      subtotal: subtotalNow,
      taxTotal: taxNow,
      grandTotal: subtotalNow + taxNow,
      heldAt: new Date().toISOString(),
    };
    persistHeldOrders([newHeld, ...heldOrders]);
    setCart([]);
  }, [cart, heldOrders, orderType, persistHeldOrders, t]);

  const handleResumeHeldOrder = useCallback(
    (held: HeldOrder) => {
      let nextHeld = heldOrders.filter((h) => h.id !== held.id);
      // If cart already has items, auto-park current cart so nothing is lost
      if (cart.length > 0) {
        const subtotalNow = cart.reduce((s, i) => s + i.price * i.quantity, 0);
        const taxNow = cart.reduce((s, i) => s + i.price * i.quantity * i.taxRate, 0);
        nextHeld = [
          {
            id: `HELD-${Date.now().toString(36).toUpperCase()}`,
            label: t(`طلب معلق #${nextHeld.length + 1}`, `Held Order #${nextHeld.length + 1}`),
            orderType,
            items: cart,
            subtotal: subtotalNow,
            taxTotal: taxNow,
            grandTotal: subtotalNow + taxNow,
            heldAt: new Date().toISOString(),
          },
          ...nextHeld,
        ];
      }
      persistHeldOrders(nextHeld);
      setOrderType(held.orderType);
      setCart(held.items);
      setShowHeldOrdersModal(false);
    },
    [cart, heldOrders, orderType, persistHeldOrders, t],
  );

  const handleDeleteHeldOrder = useCallback(
    (id: string) => {
      persistHeldOrders(heldOrders.filter((h) => h.id !== id));
    },
    [heldOrders, persistHeldOrders],
  );

  useEffect(() => {
    const onPosKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') {
        if (showPaymentModal) {
          setShowPaymentModal(false);
          setShowSplitForm(false);
        } else if (showOrdersModal) {
          setShowOrdersModal(false);
        } else if (showShiftClosingModal) {
          setShowShiftClosingModal(false);
        } else if (showOfflineDrawer) {
          setShowOfflineDrawer(false);
        } else if (showHeldOrdersModal) {
          setShowHeldOrdersModal(false);
        } else if (receiptModalOpen) {
          setReceiptModalOpen(false);
          setIsReprintPreview(false);
        }
        return;
      }

      if (e.key === 'F6' && cart.length > 0 && !showPaymentModal && !showOrdersModal && !showShiftClosingModal) {
        e.preventDefault();
        handleHoldCurrentOrder();
        return;
      }

      if (e.key === 'F7' && !showPaymentModal && !showOrdersModal && !showShiftClosingModal) {
        e.preventDefault();
        setShowHeldOrdersModal((prev) => !prev);
        return;
      }

      if (e.key === 'F2' || (!isTyping && e.key === '/')) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (e.key === 'F4' && cart.length > 0 && !showPaymentModal && !showOrdersModal && !showShiftClosingModal) {
        e.preventDefault();
        setPaymentError(null);
        setShowPaymentModal(true);
        return;
      }

      if (showPaymentModal && !isSubmittingPayment) {
        if (e.key === 'F8') {
          e.preventDefault();
          void confirmPayment('CASH');
          return;
        }
        if (e.key === 'F9') {
          e.preventDefault();
          void confirmPayment('CARD');
          return;
        }
        if (e.key === 'F10') {
          e.preventDefault();
          setShowSplitForm((prev) => !prev);
          return;
        }
      }

      if (!isTyping && !showPaymentModal && cart.length > 0) {
        const lastItem = cart[cart.length - 1];
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setCart((prev) =>
            prev.map((c) => (c.id === lastItem.id ? { ...c, quantity: c.quantity + 1 } : c)),
          );
        } else if (e.key === '-') {
          e.preventDefault();
          setCart((prev) =>
            lastItem.quantity <= 1
              ? prev.filter((c) => c.id !== lastItem.id)
              : prev.map((c) => (c.id === lastItem.id ? { ...c, quantity: c.quantity - 1 } : c)),
          );
        } else if (e.key === 'Delete') {
          e.preventDefault();
          setCart((prev) => prev.filter((c) => c.id !== lastItem.id));
        }
      }
    };

    window.addEventListener('keydown', onPosKeyDown);
    return () => window.removeEventListener('keydown', onPosKeyDown);
  });

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
          imageUrl: i.imageUrl || undefined,
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
      branchAddress: [
        (activeLegalEntity as any)?.shortAddress,
        (activeLegalEntity as any)?.buildingNumber,
        (activeLegalEntity as any)?.streetName,
        (activeLegalEntity as any)?.district,
        (activeLegalEntity as any)?.city,
        (activeLegalEntity as any)?.postalCode,
        (activeLegalEntity as any)?.country,
      ]
        .filter(Boolean)
        .join(' — ') || undefined,
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
      branchAddress: [
        (activeLegalEntity as any)?.shortAddress,
        (activeLegalEntity as any)?.buildingNumber,
        (activeLegalEntity as any)?.streetName,
        (activeLegalEntity as any)?.district,
        (activeLegalEntity as any)?.city,
        (activeLegalEntity as any)?.postalCode,
        (activeLegalEntity as any)?.country,
      ]
        .filter(Boolean)
        .join(' — ') || undefined,
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

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const exactMatch = products.find((p) => p.sku.toLowerCase() === q);
      const target = exactMatch || (filteredProducts.length === 1 ? filteredProducts[0] : null);
      if (target) {
        e.preventDefault();
        addToCart(target);
        setSearchQuery('');
      }
    }
  };

  return (
    <div
      dir={dir}
      className={`flex flex-col min-h-[calc(100vh-6rem)] lg:h-[calc(100vh-6rem)] -m-4 md:-m-6 lg:-m-8 select-none overflow-hidden transition-colors ${
        isLight ? 'bg-[#F4F5F7] text-slate-900' : 'bg-slate-900 text-slate-100'
      }`}
    >
      {/* Top POS Action Bar */}
      <header
        className={`min-h-14 border-b px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0 ${
          isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
        }`}
      >
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${activeShiftId ? 'bg-[#0D6E4F]' : 'bg-amber-500'}`} />
            <span className={`font-bold text-sm tracking-wide ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {t('نقطة البيع (POS)', 'Point of Sale (POS)')}
            </span>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
              activeShiftId
                ? isLight
                  ? 'bg-emerald-50 text-[#0D6E4F] border-emerald-200'
                  : 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
                : isLight
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-amber-900/40 text-amber-300 border-amber-700/50'
            }`}
          >
            {activeShiftId ? t('وردية مفتوحة', 'Shift Open') : t('لا توجد وردية مفتوحة', 'No Open Shift')} • {user?.displayName || user?.email || t('كاشير', 'Cashier')}
          </span>
          <span
            className={`text-xs px-2.5 py-1 rounded-full border ${
              isLight ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-slate-800 text-slate-300 border-slate-700'
            }`}
          >
            {activeBranch?.name || t('الفرع الرئيسي', 'Main Branch')}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Order Type Toggle */}
          <div
            className={`p-0.5 rounded-xl flex text-xs border ${
              isLight ? 'bg-slate-100 border-slate-200' : 'bg-slate-800 border-slate-700'
            }`}
          >
            <button
              type="button"
              onClick={() => setOrderType('TAKEAWAY')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                orderType === 'TAKEAWAY'
                  ? 'bg-[#0D6E4F] text-white shadow-sm'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('سفري', 'Takeaway')}
            </button>
            <button
              type="button"
              onClick={() => setOrderType('DINE_IN')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${
                orderType === 'DINE_IN'
                  ? 'bg-[#0D6E4F] text-white shadow-sm'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('محلي / طاولة', 'Dine-in')}
            </button>
          </div>

          {/* Held Orders Button */}
          <button
            type="button"
            onClick={() => setShowHeldOrdersModal(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              heldOrders.length > 0
                ? isLight
                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
                  : 'bg-amber-950/60 hover:bg-amber-900/60 text-amber-200 border-amber-700'
                : isLight
                ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
            title={t('الطلبات المعلقة (F7)', 'Held Orders (F7)')}
          >
            <PauseCircle size={14} />
            <span>{t('الطلبات المعلقة', 'Held Orders')}</span>
            {heldOrders.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-bold font-mono">
                {heldOrders.length}
              </span>
            )}
          </button>

          {/* Recent Orders & Returns Button */}
          <button
            type="button"
            onClick={handleOpenOrdersModal}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              isLight
                ? 'bg-blue-50 hover:bg-blue-100 text-blue-800 border-blue-200'
                : 'bg-blue-950/60 hover:bg-blue-900/60 text-blue-200 border-blue-800'
            }`}
          >
            <History size={14} />
            <span>{t('الطلبات والمرتجعات', 'Orders & Refunds')}</span>
          </button>

          {/* Offline POS Queue Button */}
          <button
            type="button"
            onClick={() => setShowOfflineDrawer(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              isOnline
                ? isLight
                  ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : isLight
                ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
                : 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border-amber-500/50'
            }`}
            title={t('إدارة صف الفواتير المحلي', 'Offline Sales Queue')}
          >
            {isOnline ? <Wifi size={14} className="text-[#0D6E4F]" /> : <WifiOff size={14} className="text-amber-600" />}
            <span>{isOnline ? t('متصل', 'Online') : t('غير متصل', 'Offline')}</span>
            {pendingOfflineCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                {pendingOfflineCount}
              </span>
            )}
          </button>

          {/* Shift Closing Workstation Button */}
          <button
            type="button"
            onClick={() => setShowShiftClosingModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0D6E4F] hover:bg-[#0A583F] text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
          >
            <Calculator size={14} />
            <span>{t('إقفال الوردية', 'Shift Closing')}</span>
          </button>

          {/* Light / Dark Theme Toggle */}
          <button
            type="button"
            onClick={togglePosTheme}
            aria-label={isLight ? t('الوضع الداكن', 'Dark Mode') : t('الوضع الفاتح', 'Light Mode')}
            title={isLight ? t('تبديل إلى الوضع الداكن', 'Switch to Dark Mode') : t('تبديل إلى الوضع الفاتح المريح', 'Switch to Eye-Comfort Light Mode')}
            className={`p-2 rounded-xl border transition-all ${
              isLight
                ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            {isLight ? <Moon size={15} /> : <Sun size={15} />}
          </button>

          {/* Fullscreen Toggle */}
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                isLight
                  ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
              title={isFullscreen ? t('تصغير الشاشة', 'Exit Fullscreen') : t('ملء الشاشة', 'Fullscreen')}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              <span className="hidden xl:inline">{isFullscreen ? t('خروج', 'Exit') : t('ملء الشاشة', 'Fullscreen')}</span>
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
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Catalog & Product Grid */}
        <div className="flex-1 flex flex-col p-4 sm:p-5 overflow-hidden">
          {/* Search & Categories Bar */}
          <div className="space-y-3 mb-4">
            <div className="relative">
              <Search className="absolute right-4 top-3 text-slate-400" size={18} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder={t('ابحث بالاسم، الكود، أو امسح الباركود... (F2)', 'Search by name, SKU, or scan barcode... (F2)')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className={`w-full border rounded-2xl pr-11 pl-16 py-2.5 text-sm transition-colors focus:outline-none focus:border-[#0D6E4F] ${
                  isLight
                    ? 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 shadow-sm'
                    : 'bg-slate-800 border-slate-700 text-slate-100 placeholder-slate-400'
                }`}
              />
              <kbd
                className={`hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded absolute left-3 top-2.5 border ${
                  isLight
                    ? 'text-slate-600 bg-slate-100 border-slate-300'
                    : 'text-slate-300 bg-slate-700 border-slate-600'
                }`}
              >
                F2
              </kbd>
            </div>

            {/* Category Pills */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                    selectedCategory === cat
                      ? 'bg-[#0D6E4F] text-white border-[#0D6E4F] shadow-sm'
                      : isLight
                      ? 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product Tiles Grid */}
          <div className="flex-1 overflow-y-auto pe-1">
            {loading ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3">
                <Loader2 size={32} className="animate-spin text-[#0D6E4F]" />
                <p className="text-sm">{t('جاري تحميل قائمة الأصناف...', 'Loading menu items...')}</p>
              </div>
            ) : error ? (
              <div className="h-full flex flex-col items-center justify-center text-rose-600 gap-3 p-6 text-center">
                <AlertCircle size={36} />
                <p className="text-sm font-semibold">{error}</p>
                <button
                  type="button"
                  onClick={() => void loadPosCatalog()}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-colors ${
                    isLight
                      ? 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  }`}
                >
                  <RefreshCw size={14} />
                  <span>{t('إعادة المحاولة', 'Retry')}</span>
                </button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2 p-6 text-center">
                <Search size={36} className="opacity-40" />
                <p className={`text-sm font-semibold ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                  {t('لا توجد أصناف متاحة للعرض', 'No items found')}
                </p>
                <p className="text-xs text-slate-500">
                  {products.length === 0
                    ? t('لم يتم العثور على أصناف مفعّلة في الكتالوج', 'No active items in catalog')
                    : t('جرّب تغيير كلمة البحث أو التصنيف المختار', 'Try a different search or category')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredProducts.map((p) => {
                  const inCart = cart.find((i) => i.id === p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addToCart(p)}
                      className={`relative p-3.5 rounded-2xl border text-start transition-all flex flex-col justify-between active:scale-[0.99] ${
                        inCart
                          ? isLight
                            ? 'bg-emerald-50/40 border-[#0D6E4F] ring-1 ring-[#0D6E4F]/25 shadow-sm'
                            : 'bg-emerald-950/30 border-emerald-500 shadow-sm'
                          : isLight
                          ? 'bg-white border-slate-200 hover:border-[#0D6E4F]/50 hover:shadow-md'
                          : 'bg-slate-800/80 border-slate-700 hover:border-slate-600'
                      }`}
                    >
                      {inCart && (
                        <span className="absolute top-2.5 left-2.5 w-6 h-6 rounded-full bg-[#0D6E4F] text-white text-xs font-bold flex items-center justify-center shadow-sm">
                          {inCart.quantity}
                        </span>
                      )}
                      {p.imageUrl && (
                        <img
                          src={p.imageUrl}
                          alt={p.nameAr}
                          className="w-full h-24 object-cover rounded-xl mb-2.5 border border-slate-100"
                        />
                      )}
                      <div>
                        <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">{p.sku}</span>
                        <h3 className={`font-bold text-sm mt-0.5 line-clamp-2 ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                          {p.nameAr}
                        </h3>
                        {p.nameEn && <p className="text-xs text-slate-500 mt-0.5 truncate">{p.nameEn}</p>}
                      </div>
                      <div
                        className={`mt-3 pt-2.5 border-t flex items-center justify-between ${
                          isLight ? 'border-slate-100' : 'border-slate-700/80'
                        }`}
                      >
                        <div className="font-mono" data-numeric="true">
                          <span className={`font-bold text-base ${isLight ? 'text-[#0D6E4F]' : 'text-emerald-400'}`}>
                            {(p.price * (1 + p.taxRate)).toFixed(2)}
                          </span>
                          <span className="text-[10px] font-sans text-slate-500 ms-1">ر.س</span>
                        </div>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                            p.stockQty <= 0
                              ? 'bg-amber-50 text-amber-800 border border-amber-200'
                              : isLight
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {p.stockQty}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Cart Panel */}
        <div
          className={`w-full lg:w-96 xl:w-[410px] border-t lg:border-t-0 lg:border-s flex flex-col shrink-0 max-h-[45vh] lg:max-h-none ${
            isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-800'
          }`}
        >
          {/* Cart Header */}
          <div
            className={`px-4 py-3.5 border-b flex items-center justify-between ${
              isLight ? 'border-slate-200' : 'border-slate-800'
            }`}
          >
            <div className="flex items-center gap-2">
              <ShoppingCart size={18} className="text-[#0D6E4F]" />
              <span className="font-bold text-sm">
                {t('سلة الطلب', 'Order Cart')} ({cart.reduce((s, i) => s + i.quantity, 0)})
              </span>
            </div>
            {cart.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleHoldCurrentOrder}
                  title={t('تعليق الطلب (F6)', 'Hold Order (F6)')}
                  className={`text-xs font-semibold flex items-center gap-1 px-2.5 py-1 rounded-lg border transition-colors ${
                    isLight
                      ? 'bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200'
                      : 'bg-amber-950/60 hover:bg-amber-900/60 text-amber-200 border-amber-700'
                  }`}
                >
                  <PauseCircle size={13} />
                  <span>{t('تعليق', 'Hold')}</span>
                </button>
                <button
                  type="button"
                  onClick={clearCart}
                  className="text-xs text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1"
                >
                  <Trash2 size={13} />
                  <span>{t('إفراغ', 'Clear')}</span>
                </button>
              </div>
            )}
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-2">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center p-6">
                <ShoppingCart size={36} className="opacity-40 mb-2" />
                <p className="text-sm font-medium text-slate-500">{t('السلة فارغة', 'Cart is empty')}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {t('اختر الأصناف من القائمة أو امسح الباركود للبدء', 'Select items or scan barcode to start')}
                </p>
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item.id}
                  className={`border p-3 rounded-xl flex items-center justify-between gap-2.5 ${
                    isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-slate-800/60 border-slate-700'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <h4 className={`font-bold text-xs truncate ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                      {item.nameAr}
                    </h4>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                      {(item.price * (1 + item.taxRate)).toFixed(2)} ر.س
                    </p>
                  </div>

                  <div
                    className={`flex items-center gap-1 rounded-lg p-0.5 border ${
                      isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.id, -1)}
                      aria-label={t('إنقاص الكمية', 'Decrease quantity')}
                      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                        isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <Minus size={13} />
                    </button>
                    <span className="text-xs font-bold px-1.5 min-w-[1.5rem] text-center font-mono">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.id, 1)}
                      aria-label={t('زيادة الكمية', 'Increase quantity')}
                      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                        isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <Plus size={13} />
                    </button>
                  </div>

                  <div
                    className={`text-end font-bold text-xs font-mono min-w-[4rem] ${
                      isLight ? 'text-[#0D6E4F]' : 'text-emerald-400'
                    }`}
                  >
                    {(item.price * item.quantity * (1 + item.taxRate)).toFixed(2)}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Totals & Checkout Button */}
          <div
            className={`p-4 border-t space-y-2 ${
              isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
            }`}
          >
            <div className="flex justify-between text-xs text-slate-500">
              <span>{t('المجموع قبل الضريبة', 'Subtotal (Excl. VAT)')}</span>
              <span className="font-mono">{subtotal.toFixed(2)} ر.س</span>
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>{t('ضريبة القيمة المضافة (15%)', 'VAT (15%)')}</span>
              <span className="font-mono">{taxTotal.toFixed(2)} ر.س</span>
            </div>
            <div
              className={`flex justify-between text-base font-extrabold pt-2 border-t ${
                isLight ? 'text-slate-900 border-slate-200' : 'text-white border-slate-800'
              }`}
            >
              <span>{t('الإجمالي المستحق', 'Grand Total')}</span>
              <span className={`font-mono ${isLight ? 'text-[#0D6E4F]' : 'text-emerald-400'}`}>
                {grandTotal.toFixed(2)} ر.س
              </span>
            </div>

            <button
              type="button"
              onClick={handleCheckout}
              disabled={cart.length === 0}
              className="w-full mt-2 py-3 rounded-xl bg-[#0D6E4F] hover:bg-[#0A583F] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed font-bold text-sm text-white shadow-sm transition-all flex items-center justify-center gap-2"
            >
              <CreditCard size={18} />
              <span>{t('دفع وتحصيل الطلب', 'Checkout')} ({grandTotal.toFixed(2)} ر.س)</span>
              <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-mono bg-white/15 rounded">F4</kbd>
            </button>
          </div>
        </div>
      </div>

      {/* Payment Tender Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <div
            className={`border rounded-3xl max-w-md w-full p-6 space-y-6 shadow-2xl ${
              isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-800 text-slate-100'
            }`}
          >
            <div className={`flex justify-between items-center border-b pb-4 ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
              <div>
                <h3 className="text-lg font-bold">{t('تحصيل وسيلة الدفع', 'Payment Method')}</h3>
                <p className="text-xs text-slate-500">{t('اختر طريقة السداد لتحصيل المبلغ', 'Select payment tender')}</p>
              </div>
              <span className={`text-2xl font-black font-mono ${isLight ? 'text-[#0D6E4F]' : 'text-emerald-400'}`}>
                {grandTotal.toFixed(2)} ر.س
              </span>
            </div>

            {paymentError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle size={16} className="shrink-0" />
                <span>{paymentError}</span>
              </div>
            )}

            {!showSplitForm ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={isSubmittingPayment}
                    onClick={() => void confirmPayment('CASH')}
                    className={`p-5 rounded-2xl border disabled:opacity-50 text-center space-y-2 transition-all group ${
                      isLight
                        ? 'bg-slate-50 border-slate-200 hover:border-[#0D6E4F] hover:bg-emerald-50/50'
                        : 'bg-slate-800 border-slate-700 hover:border-emerald-500 hover:bg-emerald-950/30'
                    }`}
                  >
                    <Banknote size={30} className="mx-auto text-[#0D6E4F] group-hover:scale-105 transition-transform" />
                    <div className="font-bold text-sm">نقدي (Cash)</div>
                    <div className="text-[11px] text-slate-500">
                      {t('تحصيل في صندوق الكاشير', 'Cash drawer')} • <kbd className="font-mono">F8</kbd>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={isSubmittingPayment}
                    onClick={() => void confirmPayment('CARD')}
                    className={`p-5 rounded-2xl border disabled:opacity-50 text-center space-y-2 transition-all group ${
                      isLight
                        ? 'bg-slate-50 border-slate-200 hover:border-blue-600 hover:bg-blue-50/50'
                        : 'bg-slate-800 border-slate-700 hover:border-blue-500 hover:bg-blue-950/30'
                    }`}
                  >
                    <CreditCard size={30} className="mx-auto text-blue-600 group-hover:scale-105 transition-transform" />
                    <div className="font-bold text-sm">شبكة / مدى / بطاقة</div>
                    <div className="text-[11px] text-slate-500">
                      {t('جهاز نقاط البيع', 'Card terminal')} • <kbd className="font-mono">F9</kbd>
                    </div>
                  </button>
                </div>

                <button
                  type="button"
                  disabled={isSubmittingPayment}
                  onClick={() => {
                    setPaymentError(null);
                    setSplitCashAmount((Math.floor((grandTotal / 2) * 100) / 100).toFixed(2));
                    setShowSplitForm(true);
                  }}
                  className={`w-full py-3 rounded-xl disabled:opacity-50 border text-xs font-semibold flex items-center justify-center gap-2 ${
                    isLight
                      ? 'bg-slate-100 hover:bg-slate-200/70 border-slate-200 text-slate-700'
                      : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                  }`}
                >
                  <span>{t('دفع مجزأ (نقدي + شبكة بمبالغ مخصصة)', 'Split Payment (Cash + Card)')}</span>
                  <kbd className="font-mono text-[10px] opacity-70">F10</kbd>
                </button>
              </>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">المبلغ النقدي (ر.س)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={Math.max(0.01, grandTotal - 0.01).toFixed(2)}
                    value={splitCashAmount}
                    onChange={(e) => setSplitCashAmount(e.target.value)}
                    className={`w-full border rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-[#0D6E4F] ${
                      isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-800 border-slate-700 text-white'
                    }`}
                  />
                </div>
                <div
                  className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                    isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-800 border-slate-700'
                  }`}
                >
                  <span className="text-slate-500">المتبقي على الشبكة / البطاقة:</span>
                  <span className="font-bold font-mono text-blue-600">
                    {Math.max(0, grandTotal - (Number(splitCashAmount) || 0)).toFixed(2)} ر.س
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isSubmittingPayment}
                    onClick={() => void confirmPayment('SPLIT')}
                    className="flex-1 py-3 rounded-xl bg-[#0D6E4F] hover:bg-[#0A583F] disabled:opacity-50 text-xs font-bold text-white flex items-center justify-center gap-2"
                  >
                    {isSubmittingPayment && <Loader2 size={14} className="animate-spin" />}
                    <span>تأكيد الدفع المجزأ</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmittingPayment}
                    onClick={() => {
                      setPaymentError(null);
                      setShowSplitForm(false);
                    }}
                    className={`px-4 py-3 rounded-xl text-xs font-semibold ${
                      isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    }`}
                  >
                    رجوع
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={isSubmittingPayment}
              onClick={() => {
                setShowPaymentModal(false);
                setShowSplitForm(false);
                setPaymentError(null);
              }}
              className="w-full py-2 text-xs text-slate-500 hover:text-slate-800 transition-colors"
            >
              إلغاء والعودة للطلب (Esc)
            </button>
          </div>
        </div>
      )}

      {/* Shift Closing Workstation Drawer / Modal */}
      {showShiftClosingModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div
            className={`w-full max-w-6xl max-h-[92vh] border rounded-3xl shadow-2xl flex flex-col overflow-hidden ${
              isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
            }`}
          >
            <div
              className={`px-6 py-4 border-b flex items-center justify-between ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
              }`}
            >
              <span className="font-bold flex items-center gap-2">
                <Calculator size={18} className="text-[#0D6E4F]" />
                إقفال وردية نقاط البيع ومطابقة الصندوق
              </span>
              <button
                type="button"
                onClick={() => setShowShiftClosingModal(false)}
                className="p-2 rounded-xl hover:bg-slate-200/70 text-slate-500 transition"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <PosShiftClosingView
                legalEntityId={activeLegalEntity?.id || '00000000-0000-0000-0000-000000000001'}
                theme={posTheme}
                defaultBranchId={activeBranch?.id || ''}
              />
            </div>
          </div>
        </div>
      )}

      {/* Recent Orders & Sales Refund Modal */}
      {showOrdersModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div
            className={`w-full max-w-4xl max-h-[90vh] border rounded-3xl shadow-2xl flex flex-col overflow-hidden ${
              isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
            }`}
          >
            <div
              className={`px-6 py-4 border-b flex items-center justify-between ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
              }`}
            >
              <span className="font-bold flex items-center gap-2">
                <History size={18} className="text-blue-600" />
                {t('الطلبات الأخيرة وإدارة المرتجعات', 'Recent Orders & Refunds')}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadRecentOrders()}
                  className="p-2 rounded-xl hover:bg-slate-200/70 text-slate-500 transition"
                  title="تحديث"
                >
                  <RefreshCw size={16} className={loadingOrders ? 'animate-spin' : ''} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowOrdersModal(false)}
                  className="p-2 rounded-xl hover:bg-slate-200/70 text-slate-500 transition"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              {refundSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span>{refundSuccessMsg}</span>
                </div>
              )}

              {refundTargetOrder && (
                <form
                  onSubmit={submitRefund}
                  className={`p-4 rounded-2xl border space-y-4 ${
                    isLight ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-800 border-amber-600/50'
                  }`}
                >
                  <div className={`flex items-center justify-between border-b pb-3 ${isLight ? 'border-amber-200' : 'border-slate-700'}`}>
                    <div>
                      <h4 className={`text-sm font-bold flex items-center gap-2 ${isLight ? 'text-amber-900' : 'text-amber-300'}`}>
                        <RotateCcw size={15} />
                        استرجاع فاتورة #{refundTargetOrder.orderNumber || refundTargetOrder.id.slice(0, 8)}
                      </h4>
                    </div>
                    <span className={`text-sm font-black font-mono ${isLight ? 'text-[#0D6E4F]' : 'text-emerald-400'}`}>
                      {Number(refundTargetOrder.grandTotal ?? 0).toFixed(2)} ر.س
                    </span>
                  </div>

                  {refundError && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                      <AlertCircle size={15} className="shrink-0" />
                      <span>{refundError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                        سبب الاسترجاع *
                      </label>
                      <input
                        type="text"
                        required
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                        placeholder="مثال: خطأ في الطلب أو طلب العميل"
                        className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 ${
                          isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-900 border-slate-700 text-white'
                        }`}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                        طريقة رد المبلغ
                      </label>
                      <select
                        value={refundMethod}
                        onChange={(e) => setRefundMethod(e.target.value as 'CASH' | 'CARD')}
                        className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500 ${
                          isLight ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-900 border-slate-700 text-white'
                        }`}
                      >
                        <option value="CASH">نقدي (Cash)</option>
                        <option value="CARD">شبكة / بطاقة (Card)</option>
                      </select>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={restockInventory}
                      onChange={(e) => setRestockInventory(e.target.checked)}
                      className="rounded border-slate-300 text-[#0D6E4F]"
                    />
                    <span>إعادة الأصناف إلى المخزون</span>
                  </label>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={isSubmittingRefund || !refundReason.trim()}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2"
                    >
                      {isSubmittingRefund && <Loader2 size={14} className="animate-spin" />}
                      <span>تأكيد الاسترجاع والترحيل المالي</span>
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingRefund}
                      onClick={() => setRefundTargetOrder(null)}
                      className={`px-4 py-2 rounded-xl text-xs font-semibold ${
                        isLight ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      إلغاء
                    </button>
                  </div>
                </form>
              )}

              {loadingOrders ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-500 gap-2">
                  <Loader2 size={28} className="animate-spin text-[#0D6E4F]" />
                  <span className="text-xs">جاري تحميل الطلبات الأخيرة...</span>
                </div>
              ) : ordersError ? (
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
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
                        className={`p-3.5 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
                          isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-slate-800/60 border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`font-mono text-xs font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                              #{ord.orderNumber || String(ord.id).slice(0, 8)}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                ord.status === 'REFUNDED'
                                  ? 'bg-rose-100 text-rose-800'
                                  : ord.status === 'VOIDED'
                                  ? 'bg-slate-200 text-slate-600'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {ord.status}
                            </span>
                            {isPrinted && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 font-semibold">
                                نسخة مطبوعة
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1">
                            {ord.createdAt ? new Date(ord.createdAt).toLocaleString('ar-SA') : ''} •{' '}
                            {ord.orderType || 'POS'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <span className={`font-mono text-sm font-black ${isLight ? 'text-[#0D6E4F]' : 'text-emerald-400'}`}>
                            {Number(ord.grandTotal ?? 0).toFixed(2)} ر.س
                          </span>

                          <button
                            type="button"
                            disabled={isPrintingGuard}
                            onClick={() => handlePrintHistoryOrder(ord)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl disabled:opacity-50 text-xs font-semibold border ${
                              isLight
                                ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                            }`}
                          >
                            <Printer size={13} />
                            <span>{isPrinted ? 'إعادة طباعة' : 'طباعة'}</span>
                          </button>

                          {isRefundable && (
                            <button
                              type="button"
                              onClick={() => openRefundForm(ord)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-semibold"
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
        <div className="no-print fixed top-3 left-1/2 -translate-x-1/2 z-[60] px-4 py-1.5 rounded-full bg-amber-500 text-white text-xs font-bold shadow-lg flex items-center gap-2">
          <Printer size={14} />
          <span>نسخة مطبوعة — تم طباعة هذه الفاتورة مسبقاً</span>
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
        locale={locale}
      />

      {/* Held Orders Modal (الطلبات المعلقة) */}
      {showHeldOrdersModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div
            className={`w-full max-w-2xl max-h-[85vh] border rounded-3xl shadow-2xl flex flex-col overflow-hidden ${
              isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-slate-900 border-slate-700 text-slate-100'
            }`}
          >
            <div
              className={`px-6 py-4 border-b flex items-center justify-between ${
                isLight ? 'bg-slate-50 border-slate-200' : 'bg-slate-950/60 border-slate-800'
              }`}
            >
              <span className="font-bold flex items-center gap-2">
                <PauseCircle size={18} className="text-amber-600" />
                {t('الطلبات المعلقة', 'Held Orders')} ({heldOrders.length})
              </span>
              <button
                type="button"
                onClick={() => setShowHeldOrdersModal(false)}
                className="p-2 rounded-xl hover:bg-slate-200/70 text-slate-500 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-3">
              {heldOrders.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-sm">
                  {t('لا توجد طلبات معلقة حالياً.', 'No held orders at the moment.')}
                </div>
              ) : (
                heldOrders.map((held) => (
                  <div
                    key={held.id}
                    className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-3 ${
                      isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-slate-800/60 border-slate-700'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">{held.label}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700 font-medium">
                          {held.orderType === 'DINE_IN' ? t('محلي', 'Dine-in') : t('سفري', 'Takeaway')}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          {new Date(held.heldAt).toLocaleTimeString(locale === 'en' ? 'en-US' : 'ar-SA', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1 truncate">
                        {held.items.map((i) => `${i.nameAr} ×${i.quantity}`).join('، ')}
                      </p>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className={`font-mono text-sm font-black ${isLight ? 'text-[#0D6E4F]' : 'text-emerald-400'}`}>
                        {held.grandTotal.toFixed(2)} ر.س
                      </span>
                      <button
                        type="button"
                        onClick={() => handleResumeHeldOrder(held)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0D6E4F] hover:bg-[#0A583F] text-white text-xs font-semibold shadow-sm"
                      >
                        <PlayCircle size={14} />
                        <span>{t('استئناف', 'Resume')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteHeldOrder(held.id)}
                        aria-label={t('حذف الطلب المعلق', 'Delete held order')}
                        className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

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

      {/* Calm Keyboard Shortcuts Bar */}
      <footer
        className={`h-8 border-t px-4 flex items-center justify-between text-[11px] shrink-0 overflow-x-auto ${
          isLight ? 'bg-white border-slate-200 text-slate-600' : 'bg-slate-900 border-slate-800 text-slate-400'
        }`}
      >
        <div className="flex items-center gap-4 whitespace-nowrap">
          <span><kbd className="rc-kbd">F2</kbd> {t('بحث / باركود', 'Search / Barcode')}</span>
          <span><kbd className="rc-kbd">F4</kbd> {t('الدفع', 'Checkout')}</span>
          <span><kbd className="rc-kbd">F6</kbd> {t('تعليق', 'Hold')}</span>
          <span><kbd className="rc-kbd">F7</kbd> {t('المعلقة', 'Held')}</span>
          <span><kbd className="rc-kbd">F8</kbd> {t('نقدي', 'Cash')}</span>
          <span><kbd className="rc-kbd">F9</kbd> {t('شبكة', 'Card')}</span>
          <span><kbd className="rc-kbd">F10</kbd> {t('مجزأ', 'Split')}</span>
          <span><kbd className="rc-kbd">+/-</kbd> {t('الكمية', 'Qty')}</span>
          <span><kbd className="rc-kbd">Esc</kbd> {t('إغلاق', 'Close')}</span>
        </div>
        <span className={`font-medium hidden sm:inline ${isLight ? 'text-[#0D6E4F]' : 'text-emerald-400'}`}>
          {t('وضع الكيبورد السريع مفعّل', 'Keyboard-First POS')}
        </span>
      </footer>
    </div>
  );
};
