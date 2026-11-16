import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeftRight,
  Plus,
  Search,
  RefreshCw,
  Truck,
  PackageCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Lock,
  Eye,
  RotateCcw,
  FileText,
  X,
  Send,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useLocale } from '../context/LocaleContext';
import { useToast } from '../context/ToastContext';

interface TransfersViewProps {
  legalEntityId?: string;
}

type SubTab = 'list' | 'reconciliation';

const TRANSFER_TYPE_LABELS: Record<string, { label: string; badge: string }> = {
  SAME_BRANCH: { label: 'داخل نفس الفرع', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
  SAME_LEGAL_ENTITY: { label: 'بين فروع المنشأة', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  CROSS_LEGAL_ENTITY: { label: 'بين منشآت قانونية', badge: 'bg-amber-50 text-amber-800 border-amber-200' },
};

const STATUS_LABELS: Record<string, { label: string; badge: string }> = {
  DRAFT: { label: 'مسودة', badge: 'bg-slate-100 text-slate-600' },
  SUBMITTED: { label: 'مقدمة للاعتماد', badge: 'bg-sky-100 text-sky-700' },
  APPROVED: { label: 'معتمدة (محجوز)', badge: 'bg-amber-100 text-amber-700' },
  DISPATCHED: { label: 'تم الشحن', badge: 'bg-blue-50 text-blue-800 border border-blue-200' },
  IN_TRANSIT: { label: 'في الطريق', badge: 'bg-blue-50 text-blue-800 border border-blue-200' },
  PARTIALLY_RECEIVED: { label: 'استلام جزئي', badge: 'bg-orange-100 text-orange-700' },
  RECEIVED: { label: 'مستلمة بالكامل', badge: 'bg-emerald-100 text-emerald-700' },
  DISCREPANCY: { label: 'فروقات استلام', badge: 'bg-rose-100 text-rose-700' },
  COMPLETED: { label: 'مكتملة', badge: 'bg-emerald-100 text-emerald-700' },
  CLOSED: { label: 'مغلقة', badge: 'bg-slate-200 text-slate-800' },
  CANCELLED: { label: 'ملغاة', badge: 'bg-red-100 text-red-700' },
  REJECTED: { label: 'مرفوضة', badge: 'bg-red-100 text-red-700' },
};

export const TransfersView: React.FC<TransfersViewProps> = ({ legalEntityId }) => {
  const { dir } = useLocale();
  const { showToast } = useToast();
  const [subTab, setSubTab] = useState<SubTab>('list');
  const [loading, setLoading] = useState(false);

  // List & Pagination
  const [transfers, setTransfers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [limit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Reference Data
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);

  // Detail & Action Modals
  const [selectedTransfer, setSelectedTransfer] = useState<any | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isReceiveOpen) setIsReceiveOpen(false);
        else if (isCreateOpen) setIsCreateOpen(false);
        else if (selectedTransfer) setSelectedTransfer(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isReceiveOpen, isCreateOpen, selectedTransfer]);

  // Create form state
  const [newTransferNumber, setNewTransferNumber] = useState(`TRF-${Date.now().toString(36).toUpperCase()}`);
  const [newSourceWh, setNewSourceWh] = useState('');
  const [newDestWh, setNewDestWh] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newLines, setNewLines] = useState<Array<{ itemId: string; uomId: string; quantity: string; transferPrice?: string }>>([
    { itemId: '', uomId: '', quantity: '1' },
  ]);

  // Receive form state
  const [receiveLines, setReceiveLines] = useState<
    Array<{ itemId: string; itemName: string; remaining: number; receivedQuantity: string; damagedQuantity: string; lostQuantity: string; overageQuantity: string }>
  >([]);
  const [receiveNotes, setReceiveNotes] = useState('');
  const [rejectAll, setRejectAll] = useState(false);

  // Reconciliation report
  const [reconReport, setReconReport] = useState<any | null>(null);

  const loadTransfers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (legalEntityId) params.set('legalEntityId', legalEntityId);
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('transferType', typeFilter);

      const payload = await apiClient.get<{ items: any[]; total: number }>(
        `/api/v1/inventory/transfers?${params.toString()}`
      );
      setTransfers(Array.isArray(payload?.items) ? payload.items : []);
      setTotal(payload?.total ?? 0);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل المناقلات المخزنية', 'error');
    } finally {
      setLoading(false);
    }
  }, [legalEntityId, limit, offset, search, statusFilter, typeFilter, showToast]);

  const loadReconciliation = useCallback(async () => {
    setLoading(true);
    try {
      const params = legalEntityId ? `?legalEntityId=${encodeURIComponent(legalEntityId)}` : '';
      const res = await apiClient.get<any>(
        `/api/v1/inventory/transfers/reports/reconciliation${params}`
      );
      setReconReport(res ?? null);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل تقرير المطابقة', 'error');
    } finally {
      setLoading(false);
    }
  }, [legalEntityId, showToast]);

  const loadRefData = useCallback(async () => {
    try {
      const [whRes, itemRes] = await Promise.all([
        apiClient.get<any>('/api/v1/inventory/warehouses'),
        apiClient.get<any>('/api/v1/catalog/items?limit=200'),
      ]);
      setWarehouses(Array.isArray(whRes) ? whRes : whRes?.items || []);
      setItems(Array.isArray(itemRes) ? itemRes : itemRes?.items || []);
    } catch {
      // Non-blocking reference fetch
    }
  }, []);

  useEffect(() => {
    loadRefData();
  }, [loadRefData]);

  useEffect(() => {
    if (subTab === 'list') loadTransfers();
    else loadReconciliation();
  }, [subTab, loadTransfers, loadReconciliation]);

  const openDetails = async (id: string) => {
    try {
      const res = await apiClient.get<any>(`/api/v1/inventory/transfers/${id}`);
      setSelectedTransfer(res ?? null);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل تفاصيل المناقلة', 'error');
    }
  };

  const runAction = async (url: string, body: any, successMsg: string) => {
    try {
      await apiClient.post(url, body);
      showToast(successMsg, 'success');
      await loadTransfers();
      if (selectedTransfer) {
        await openDetails(selectedTransfer.id);
      }
      if (subTab === 'reconciliation') {
        await loadReconciliation();
      }
    } catch (err: any) {
      showToast(err?.message || 'فشل تنفيذ العملية', 'error');
    }
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const srcWh = warehouses.find((w) => w.id === newSourceWh);
    const effectiveLeId = srcWh?.legalEntityId || legalEntityId;
    if (!effectiveLeId || !newSourceWh || !newDestWh) {
      showToast('يرجى تحديد المستودع المصدر والمستودع الوجهة', 'error');
      return;
    }
    const validLines = newLines.filter((l) => l.itemId && l.uomId && parseFloat(l.quantity) > 0);
    if (validLines.length === 0) {
      showToast('يرجى إضافة صنف واحد على الأقل بكمية صالحة', 'error');
      return;
    }
    try {
      await apiClient.post('/api/v1/inventory/transfers', {
        legalEntityId: effectiveLeId,
        transferNumber: newTransferNumber.trim(),
        sourceWarehouseId: newSourceWh,
        destinationWarehouseId: newDestWh,
        notes: newNotes.trim() || undefined,
        idempotencyKey: `ui-create-${newTransferNumber.trim()}-${Date.now()}`,
        lines: validLines.map((l) => ({
          itemId: l.itemId,
          uomId: l.uomId,
          quantity: l.quantity,
          transferPrice: l.transferPrice?.trim() || undefined,
        })),
      });
      showToast('تم إنشاء طلب المناقلة بنجاح', 'success');
      setIsCreateOpen(false);
      setNewTransferNumber(`TRF-${Date.now().toString(36).toUpperCase()}`);
      setNewNotes('');
      loadTransfers();
    } catch (err: any) {
      showToast(err?.message || 'فشل إنشاء المناقلة', 'error');
    }
  };

  const openReceiveModal = async (transferId: string) => {
    try {
      const tr = await apiClient.get<any>(`/api/v1/inventory/transfers/${transferId}`);
      if (!tr) return;
      setSelectedTransfer(tr);
      setReceiveLines(
        (tr.lines || []).map((l: any) => {
          const disp = parseFloat(l.dispatchedQuantity || l.quantity);
          const acc = parseFloat(l.receivedQuantity || '0') + parseFloat(l.damagedQuantity || '0') + parseFloat(l.lostQuantity || '0');
          const rem = Math.max(0, disp - acc);
          return {
            itemId: l.itemId,
            itemName: l.itemName || l.itemId,
            remaining: rem,
            receivedQuantity: rem.toFixed(4),
            damagedQuantity: '0',
            lostQuantity: '0',
            overageQuantity: '0',
          };
        })
      );
      setRejectAll(false);
      setReceiveNotes('');
      setIsReceiveOpen(true);
    } catch (err: any) {
      showToast(err?.message || 'تعذر فتح شاشة الاستلام', 'error');
    }
  };

  const handleReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTransfer) return;
    await runAction(
      `/api/v1/inventory/transfers/${selectedTransfer.id}/receive`,
      {
        rejectAll,
        receivedNotes: receiveNotes.trim() || undefined,
        idempotencyKey: `ui-rcv-${selectedTransfer.id}-${Date.now()}`,
        receivedLines: receiveLines.map((l) => ({
          itemId: l.itemId,
          receivedQuantity: l.receivedQuantity || '0',
          damagedQuantity: l.damagedQuantity || '0',
          lostQuantity: l.lostQuantity || '0',
          overageQuantity: l.overageQuantity || '0',
        })),
      },
      rejectAll ? 'تم تسجيل رفض كامل الشحنة' : 'تم استلام الشحنة وترحيل القيود بنجاح'
    );
    setIsReceiveOpen(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-4" dir={dir}>
      {/* Header & Sub-Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSubTab('list')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
              subTab === 'list' ? 'bg-[#0D6E4F] hover:bg-[#0A583F] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <ArrowLeftRight className="w-4 h-4" />
            <span>التحويلات المخزنية والمالية ({total})</span>
          </button>
          <button
            onClick={() => setSubTab('reconciliation')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
              subTab === 'reconciliation' ? 'bg-[#0D6E4F] hover:bg-[#0A583F] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            <span>مطابقة البضاعة في الطريق والفروقات</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => (subTab === 'list' ? loadTransfers() : loadReconciliation())}
            className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
            title="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#0D6E4F] hover:bg-[#0A583F] text-white text-xs font-bold"
          >
            <Plus className="w-4 h-4" />
            <span>تحويل مخزني جديد</span>
          </button>
        </div>
      </div>

      {subTab === 'list' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {/* Filters */}
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setOffset(0);
                  setSearch(e.target.value);
                }}
                placeholder="بحث برقم التحويل..."
                className="w-full pr-9 pl-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#0D6E4F]"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => {
                setOffset(0);
                setTypeFilter(e.target.value);
              }}
              className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
            >
              <option value="">جميع أنواع التحويل</option>
              <option value="SAME_BRANCH">داخل نفس الفرع</option>
              <option value="SAME_LEGAL_ENTITY">بين فروع المنشأة</option>
              <option value="CROSS_LEGAL_ENTITY">بين منشآت قانونية</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => {
                setOffset(0);
                setStatusFilter(e.target.value);
              }}
              className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
            >
              <option value="">جميع الحالات</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-4">رقم التحويل</th>
                  <th className="py-3 px-4">النوع</th>
                  <th className="py-3 px-4">المصدر / الوجهة</th>
                  <th className="py-3 px-4">المشحون / المستلم</th>
                  <th className="py-3 px-4">التكلفة</th>
                  <th className="py-3 px-4">الحالة</th>
                  <th className="py-3 px-4">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {transfers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">
                      لا توجد تحويلات مخزنية مطابقة للبحث
                    </td>
                  </tr>
                ) : (
                  transfers.map((t) => {
                    const typeMeta = TRANSFER_TYPE_LABELS[t.transferType] || { label: t.transferType, badge: 'bg-slate-100 text-slate-600' };
                    const stMeta = STATUS_LABELS[t.status] || { label: t.status, badge: 'bg-slate-100 text-slate-600' };
                    const srcName = warehouses.find((w) => w.id === t.sourceWarehouseId)?.nameAr || t.sourceWarehouseId?.slice(0, 8);
                    const dstName = warehouses.find((w) => w.id === t.destinationWarehouseId)?.nameAr || t.destinationWarehouseId?.slice(0, 8);

                    return (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-bold text-slate-800">{t.transferNumber}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-1 rounded-lg border text-[11px] font-semibold ${typeMeta.badge}`}>
                            {typeMeta.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {srcName} ← {dstName}
                        </td>
                        <td className="py-3 px-4 font-mono">
                          {parseFloat(t.totalShippedQty || '0').toFixed(2)} / {parseFloat(t.totalReceivedQty || '0').toFixed(2)}
                        </td>
                        <td className="py-3 px-4 font-mono font-semibold">
                          {parseFloat(t.totalTransferCost || '0').toFixed(2)}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-1 rounded-lg text-[11px] font-bold ${stMeta.badge}`}>
                            {stMeta.label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              onClick={() => openDetails(t.id)}
                              className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>تفاصيل</span>
                            </button>
                            {t.status === 'DRAFT' && (
                              <button
                                onClick={() => runAction(`/api/v1/inventory/transfers/${t.id}/submit`, {}, 'تم تقديم التحويل للاعتماد')}
                                className="px-2 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold flex items-center gap-1"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>تقديم</span>
                              </button>
                            )}
                            {(t.status === 'DRAFT' || t.status === 'SUBMITTED') && (
                              <button
                                onClick={() => runAction(`/api/v1/inventory/transfers/${t.id}/approve`, {}, 'تم اعتماد التحويل وحجز المخزون')}
                                className="px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold flex items-center gap-1"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>اعتماد</span>
                              </button>
                            )}
                            {t.status === 'APPROVED' && (
                              <button
                                onClick={() =>
                                  runAction(
                                    `/api/v1/inventory/transfers/${t.id}/dispatch`,
                                    { idempotencyKey: `ui-disp-${t.id}-${Date.now()}` },
                                    'تم شحن البضاعة وترحيل القيد'
                                  )
                                }
                                className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 font-semibold flex items-center gap-1"
                              >
                                <Truck className="w-3.5 h-3.5" />
                                <span>شحن</span>
                              </button>
                            )}
                            {(t.status === 'IN_TRANSIT' || t.status === 'PARTIALLY_RECEIVED' || t.status === 'DISCREPANCY') && (
                              <button
                                onClick={() => openReceiveModal(t.id)}
                                className="px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold flex items-center gap-1"
                              >
                                <PackageCheck className="w-3.5 h-3.5" />
                                <span>استلام</span>
                              </button>
                            )}
                            {(t.status === 'RECEIVED' || t.status === 'COMPLETED') && (
                              <button
                                onClick={() => runAction(`/api/v1/inventory/transfers/${t.id}/close`, {}, 'تم إغلاق التحويل بنجاح')}
                                className="px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold flex items-center gap-1"
                              >
                                <Lock className="w-3.5 h-3.5" />
                                <span>إغلاق</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="p-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <span>
              صفحة {currentPage} من {totalPages} (إجمالي {total} سجل)
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40"
              >
                السابق
              </button>
              <button
                disabled={offset + limit >= total}
                onClick={() => setOffset(offset + limit)}
                className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          </div>
        </div>
      )}

      {subTab === 'reconciliation' && reconReport && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="bg-white p-4 rounded-2xl border border-slate-200">
              <div className="text-xs text-slate-500">تحويلات في الطريق</div>
              <div className="text-xl font-bold text-[#0D6E4F] mt-1">{reconReport.summary.inTransitCount}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-200">
              <div className="text-xs text-slate-500">كمية في الطريق</div>
              <div className="text-xl font-bold text-slate-800 mt-1">{parseFloat(reconReport.summary.totalInTransitQty).toFixed(2)}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-200">
              <div className="text-xs text-slate-500">قيمة المخزون في الطريق</div>
              <div className="text-xl font-bold text-emerald-600 mt-1">{parseFloat(reconReport.summary.totalInTransitValue).toFixed(2)}</div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-slate-200">
              <div className="text-xs text-slate-500">فروقات مفتوحة ({reconReport.summary.openDiscrepanciesCount})</div>
              <div className="text-xl font-bold text-rose-600 mt-1">{parseFloat(reconReport.summary.openDiscrepanciesValue).toFixed(2)}</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <h4 className="font-bold text-sm text-slate-800 mb-3">الفروقات المفتوحة بانتظار التسوية المحاسبية</h4>
            {reconReport.openDiscrepancies.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">لا توجد فروقات مفتوحة حالياً</p>
            ) : (
              <div className="space-y-2">
                {reconReport.openDiscrepancies.map((d: any) => (
                  <div key={d.id} className="p-3 rounded-xl border border-rose-100 bg-rose-50/40 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-rose-700">{d.discrepancyType}</span> — كمية: {parseFloat(d.quantity).toFixed(2)} — قيمة:{' '}
                      {parseFloat(d.totalValue).toFixed(2)}
                      <div className="text-slate-500 mt-0.5">{d.notes}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {d.discrepancyType === 'OVERAGE' ? (
                        <button
                          onClick={() =>
                            runAction(
                              `/api/v1/inventory/transfers/${d.transferId}/discrepancies/${d.id}/resolve`,
                              { resolution: 'RESOLVED_GAIN', resolutionNotes: 'اعتماد الزيادة من شاشة المطابقة' },
                              'تم اعتماد الزيادة وترحيل القيد'
                            )
                          }
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                        >
                          اعتماد كفائض
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            runAction(
                              `/api/v1/inventory/transfers/${d.transferId}/discrepancies/${d.id}/resolve`,
                              { resolution: 'RESOLVED_LOSS', resolutionNotes: 'اعتماد الخسارة من شاشة المطابقة' },
                              'تم اعتماد العجز/التلف وترحيل القيد'
                            )
                          }
                          className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-semibold"
                        >
                          اعتماد كخسارة
                        </button>
                      )}
                      <button
                        onClick={() =>
                          runAction(
                            `/api/v1/inventory/transfers/${d.transferId}/discrepancies/${d.id}/resolve`,
                            { resolution: 'RESOLVED_RETURNED', resolutionNotes: 'إرجاع للمستودع المصدر' },
                            'تم إرجاع الكمية للمستودع المصدر'
                          )
                        }
                        className="px-2.5 py-1 rounded-lg bg-slate-700 text-white font-semibold"
                      >
                        إرجاع للمصدر
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detail Drawer Modal */}
      {selectedTransfer && !isReceiveOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-slate-800">تفاصيل التحويل: {selectedTransfer.transferNumber}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  النوع: {TRANSFER_TYPE_LABELS[selectedTransfer.transferType]?.label || selectedTransfer.transferType} | الحالة:{' '}
                  {STATUS_LABELS[selectedTransfer.status]?.label || selectedTransfer.status}
                </p>
              </div>
              <button onClick={() => setSelectedTransfer(null)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b text-slate-500">
                    <th className="py-2 px-3">الصنف</th>
                    <th className="py-2 px-3">المطلوب</th>
                    <th className="py-2 px-3">المشحون</th>
                    <th className="py-2 px-3">المستلم</th>
                    <th className="py-2 px-3">تالف / مفقود / زيادة</th>
                    <th className="py-2 px-3">تكلفة الوحدة</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(selectedTransfer.lines || []).map((l: any) => (
                    <tr key={l.id}>
                      <td className="py-2 px-3 font-semibold">{l.itemName || l.itemId}</td>
                      <td className="py-2 px-3 font-mono">{parseFloat(l.quantity).toFixed(2)}</td>
                      <td className="py-2 px-3 font-mono">{parseFloat(l.dispatchedQuantity || '0').toFixed(2)}</td>
                      <td className="py-2 px-3 font-mono">{parseFloat(l.receivedQuantity || '0').toFixed(2)}</td>
                      <td className="py-2 px-3 font-mono">
                        {parseFloat(l.damagedQuantity || '0').toFixed(2)} / {parseFloat(l.lostQuantity || '0').toFixed(2)} /{' '}
                        {parseFloat(l.overageQuantity || '0').toFixed(2)}
                      </td>
                      <td className="py-2 px-3 font-mono">{parseFloat(l.unitCost || '0').toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedTransfer.linkedJournals?.length > 0 && (
              <div className="bg-slate-50 rounded-xl p-3 space-y-1.5">
                <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  <span>القيود المحاسبية المرتبطة ({selectedTransfer.linkedJournals.length})</span>
                </div>
                {selectedTransfer.linkedJournals.map((j: any) => (
                  <div key={j.id} className="text-xs flex items-center justify-between bg-white p-2 rounded-lg border border-slate-200">
                    <span className="font-mono font-bold text-[#0D6E4F]">{j.journalNumber}</span>
                    <span className="text-slate-600">{j.description}</span>
                    <span className="font-mono font-semibold">{parseFloat(j.debitTotal || '0').toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
              {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(selectedTransfer.status) && (
                <button
                  onClick={() =>
                    runAction(
                      `/api/v1/inventory/transfers/${selectedTransfer.id}/cancel`,
                      { cancellationReason: 'إلغاء يدوي قبل الشحن' },
                      'تم إلغاء التحويل'
                    )
                  }
                  className="px-3 py-1.5 rounded-xl bg-red-50 text-red-700 text-xs font-bold flex items-center gap-1"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>إلغاء قبل الشحن</span>
                </button>
              )}
              {['IN_TRANSIT', 'DISCREPANCY'].includes(selectedTransfer.status) && (
                <button
                  onClick={() =>
                    runAction(
                      `/api/v1/inventory/transfers/${selectedTransfer.id}/reverse-after-dispatch`,
                      { reversalReason: 'عكس موثق للشحنة وإرجاعها للمصدر' },
                      'تم عكس التحويل وإرجاع المخزون للمصدر'
                    )
                  }
                  className="px-3 py-1.5 rounded-xl bg-amber-50 text-amber-800 text-xs font-bold flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>عكس موثق بعد الشحن</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Transfer Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={handleCreateTransfer} className="bg-white rounded-2xl max-w-xl w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-800">إنشاء تحويل مخزني جديد</h3>
              <button type="button" onClick={() => setIsCreateOpen(false)} className="p-1 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-600 mb-1">رقم التحويل</label>
                <input
                  required
                  value={newTransferNumber}
                  onChange={(e) => setNewTransferNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-600 mb-1">ملاحظات</label>
                <input
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-600 mb-1">المستودع المصدر</label>
                <select
                  required
                  value={newSourceWh}
                  onChange={(e) => setNewSourceWh(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  <option value="">اختر المستودع المصدر...</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.nameAr || w.name} ({w.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-600 mb-1">المستودع الوجهة</label>
                <select
                  required
                  value={newDestWh}
                  onChange={(e) => setNewDestWh(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white"
                >
                  <option value="">اختر المستودع الوجهة...</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.nameAr || w.name} ({w.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700">الأصناف</span>
                <button
                  type="button"
                  onClick={() => setNewLines([...newLines, { itemId: '', uomId: '', quantity: '1' }])}
                  className="text-[#0D6E4F] font-bold"
                >
                  + إضافة صنف
                </button>
              </div>
              {newLines.map((ln, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 text-xs">
                  <select
                    required
                    value={ln.itemId}
                    onChange={(e) => {
                      const it = items.find((x) => x.id === e.target.value);
                      const copy = [...newLines];
                      copy[idx] = { ...ln, itemId: e.target.value, uomId: it?.baseUomId || ln.uomId };
                      setNewLines(copy);
                    }}
                    className="col-span-6 px-2 py-2 border border-slate-200 rounded-xl bg-white"
                  >
                    <option value="">اختر الصنف...</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.nameAr || it.name} ({it.sku})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    required
                    value={ln.quantity}
                    onChange={(e) => {
                      const copy = [...newLines];
                      copy[idx] = { ...ln, quantity: e.target.value };
                      setNewLines(copy);
                    }}
                    placeholder="الكمية"
                    className="col-span-3 px-2 py-2 border border-slate-200 rounded-xl"
                  />
                  <input
                    type="number"
                    step="0.0001"
                    value={ln.transferPrice || ''}
                    onChange={(e) => {
                      const copy = [...newLines];
                      copy[idx] = { ...ln, transferPrice: e.target.value };
                      setNewLines(copy);
                    }}
                    placeholder="سعر تحويلي (اختياري)"
                    className="col-span-3 px-2 py-2 border border-slate-200 rounded-xl"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setIsCreateOpen(false)} className="px-4 py-2 rounded-xl border text-xs font-semibold">
                إلغاء
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-[#0D6E4F] hover:bg-[#0A583F] text-white text-xs font-bold">
                حفظ كمسودة
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Receive Modal */}
      {isReceiveOpen && selectedTransfer && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={handleReceiveSubmit} className="bg-white rounded-2xl max-w-2xl w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-sm text-slate-800">استلام التحويل: {selectedTransfer.transferNumber}</h3>
              <button type="button" onClick={() => setIsReceiveOpen(false)} className="p-1 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <label className="flex items-center gap-2 text-xs font-bold text-rose-700 bg-rose-50 p-2.5 rounded-xl">
              <input type="checkbox" checked={rejectAll} onChange={(e) => setRejectAll(e.target.checked)} />
              <span>رفض كامل الشحنة عند الاستلام (Full Rejection)</span>
            </label>

            {!rejectAll && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {receiveLines.map((rl, idx) => (
                  <div key={rl.itemId} className="grid grid-cols-12 gap-2 items-center text-xs border border-slate-100 p-2 rounded-xl">
                    <div className="col-span-4 font-semibold">
                      {rl.itemName} <span className="text-slate-400">(متبقي: {rl.remaining.toFixed(2)})</span>
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-slate-500 block">مستلم</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={rl.receivedQuantity}
                        onChange={(e) => {
                          const c = [...receiveLines];
                          c[idx] = { ...rl, receivedQuantity: e.target.value };
                          setReceiveLines(c);
                        }}
                        className="w-full px-2 py-1 border rounded-lg"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-slate-500 block">تالف</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={rl.damagedQuantity}
                        onChange={(e) => {
                          const c = [...receiveLines];
                          c[idx] = { ...rl, damagedQuantity: e.target.value };
                          setReceiveLines(c);
                        }}
                        className="w-full px-2 py-1 border rounded-lg"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-slate-500 block">مفقود</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={rl.lostQuantity}
                        onChange={(e) => {
                          const c = [...receiveLines];
                          c[idx] = { ...rl, lostQuantity: e.target.value };
                          setReceiveLines(c);
                        }}
                        className="w-full px-2 py-1 border rounded-lg"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] text-slate-500 block">زيادة</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={rl.overageQuantity}
                        onChange={(e) => {
                          const c = [...receiveLines];
                          c[idx] = { ...rl, overageQuantity: e.target.value };
                          setReceiveLines(c);
                        }}
                        className="w-full px-2 py-1 border rounded-lg"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">ملاحظات الاستلام</label>
              <input
                value={receiveNotes}
                onChange={(e) => setReceiveNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setIsReceiveOpen(false)} className="px-4 py-2 rounded-xl border text-xs font-semibold">
                إلغاء
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold">
                تأكيد الاستلام
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
