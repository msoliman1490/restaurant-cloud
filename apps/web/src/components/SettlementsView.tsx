import React, { useState, useEffect, useCallback } from 'react';
import {
  CreditCard,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Search,
  RefreshCw,
  FileSpreadsheet,
  ArrowLeftRight,
  Plus,
  Eye,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useToast } from '../context/ToastContext';

interface SettlementsViewProps {
  legalEntityId: string;
  theme?: 'dark' | 'light';
  defaultBranchId?: string;
}

type SubTab = 'batches' | 'discrepancies' | 'providers' | 'import';

export const SettlementsView: React.FC<SettlementsViewProps> = ({
  legalEntityId,
  defaultBranchId,
}) => {
  const { showToast } = useToast();
  const [subTab, setSubTab] = useState<SubTab>('batches');
  const [loading, setLoading] = useState(false);

  // Summary KPIs
  const [summary, setSummary] = useState<any>(null);

  // Providers & Bank Accounts & Branches
  const [providers, setProviders] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);

  // Batches state (Server-side paginated)
  const [batches, setBatches] = useState<any[]>([]);
  const [batchPage, setBatchPage] = useState(1);
  const [batchTotalPages, setBatchTotalPages] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterProvider, setFilterProvider] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Selected Batch Detail Modal
  const [selectedBatchDetail, setSelectedBatchDetail] = useState<any>(null);
  const [postBankAccountId, setPostBankAccountId] = useState('');
  const [postBankRef, setPostBankRef] = useState('');
  const [postBankReceived, setPostBankReceived] = useState('');
  const [postHasTaxInv, setPostHasTaxInv] = useState(false);
  const [postTaxInvNum, setPostTaxInvNum] = useState('');
  const [postVatRecoverable, setPostVatRecoverable] = useState(false);
  const [postAllowSuspense, setPostAllowSuspense] = useState(false);
  const [postingBatch, setPostingBatch] = useState(false);

  // Discrepancies state
  const [discrepancies, setDiscrepancies] = useState<any[]>([]);
  const [discStatusFilter, setDiscStatusFilter] = useState('OPEN');
  const [resolvingDisc, setResolvingDisc] = useState<any>(null);
  const [resolveStatus, setResolveStatus] = useState('RESOLVED_APPROVED');
  const [resolveNotes, setResolveNotes] = useState('');

  // Import state
  const [importProviderId, setImportProviderId] = useState('');
  const [importBranchId, setImportBranchId] = useState(defaultBranchId || '');
  const [importDate, setImportDate] = useState(new Date().toISOString().slice(0, 10));
  const [importFormat, setImportFormat] = useState<'CSV' | 'EXCEL'>('CSV');
  const [importFileName, setImportFileName] = useState('settlement.csv');
  const [importCsvText, setImportCsvText] = useState('');
  const [importBase64, setImportBase64] = useState('');
  const [importing, setImporting] = useState(false);

  // Add Custom Provider Modal
  const [showNewProvider, setShowNewProvider] = useState(false);
  const [newProvCode, setNewProvCode] = useState('');
  const [newProvNameAr, setNewProvNameAr] = useState('');
  const [newProvNameEn, setNewProvNameEn] = useState('');
  const [newProvCategory, setNewProvCategory] = useState<'PAYMENT_GATEWAY' | 'DELIVERY_AGGREGATOR'>('PAYMENT_GATEWAY');
  const [newProvFeeRate, setNewProvFeeRate] = useState('1.5000');

  const loadReferenceData = useCallback(async () => {
    if (!legalEntityId) return;
    try {
      const [sumRes, provRes, bankRes, brRes] = await Promise.all([
        apiClient.get<any>(`/api/v1/settlements/summary?legalEntityId=${legalEntityId}`),
        apiClient.get<any>(`/api/v1/settlements/providers?legalEntityId=${legalEntityId}`),
        apiClient.get<any>(`/api/v1/accounting/bank-accounts?legalEntityId=${legalEntityId}`),
        apiClient.get<any>(`/branches?legalEntityId=${legalEntityId}`).catch(() => []),
      ]);
      setSummary(sumRes);
      setProviders(Array.isArray(provRes) ? provRes : []);
      setBankAccounts(Array.isArray(bankRes) ? bankRes : []);
      setBranches(Array.isArray(brRes) ? brRes : []);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل بيانات التسويات', 'error');
    }
  }, [legalEntityId, showToast]);

  const loadBatches = useCallback(async () => {
    if (!legalEntityId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        legalEntityId,
        page: String(batchPage),
        limit: '15',
      });
      if (filterStatus) params.set('status', filterStatus);
      if (filterProvider) params.set('providerId', filterProvider);
      if (filterCategory) params.set('settlementType', filterCategory);
      if (filterSearch) params.set('search', filterSearch);
      if (filterDateFrom) params.set('dateFrom', filterDateFrom);
      if (filterDateTo) params.set('dateTo', filterDateTo);

      const res = await apiClient.get<any>(`/api/v1/settlements/batches?${params.toString()}`);
      setBatches(res?.items || []);
      setBatchTotalPages(res?.pagination?.totalPages || 1);
    } catch (err: any) {
      showToast(err?.message || 'فشل تحميل دفعات التسوية', 'error');
    } finally {
      setLoading(false);
    }
  }, [
    legalEntityId,
    batchPage,
    filterStatus,
    filterProvider,
    filterCategory,
    filterSearch,
    filterDateFrom,
    filterDateTo,
    showToast,
  ]);

  const loadDiscrepancies = useCallback(async () => {
    if (!legalEntityId) return;
    try {
      const params = new URLSearchParams({ legalEntityId, limit: '50' });
      if (discStatusFilter) params.set('status', discStatusFilter);
      const res = await apiClient.get<any>(`/api/v1/settlements/discrepancies?${params.toString()}`);
      setDiscrepancies(res?.items || []);
    } catch {
      // handled cleanly
    }
  }, [legalEntityId, discStatusFilter]);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    if (subTab === 'batches') loadBatches();
    if (subTab === 'discrepancies') loadDiscrepancies();
  }, [subTab, loadBatches, loadDiscrepancies]);

  const handleSeedProviders = async () => {
    try {
      await apiClient.post('/api/v1/settlements/providers/seed-defaults', { legalEntityId });
      showToast('تم تفعيل مزودي الدفع ومنصات التوصيل الافتراضيين بنجاح', 'success');
      loadReferenceData();
    } catch (err: any) {
      showToast(err?.message || 'فشل تفعيل المزودين', 'error');
    }
  };

  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/v1/settlements/providers', {
        legalEntityId,
        code: newProvCode,
        nameAr: newProvNameAr,
        nameEn: newProvNameEn || newProvCode,
        category: newProvCategory,
        clearingMappingKey: newProvCategory === 'PAYMENT_GATEWAY' ? 'CARD_CLEARING' : 'AGGREGATOR_RECEIVABLE',
        feeMappingKey: newProvCategory === 'PAYMENT_GATEWAY' ? 'GATEWAY_FEES' : 'AGGREGATOR_COMMISSION',
        defaultFeeRate: newProvFeeRate,
      });
      showToast('تمت إضافة المزود بنجاح', 'success');
      setShowNewProvider(false);
      setNewProvCode('');
      setNewProvNameAr('');
      setNewProvNameEn('');
      loadReferenceData();
    } catch (err: any) {
      showToast(err?.message || 'تعذر إضافة المزود', 'error');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    if (file.name.toLowerCase().endsWith('.xlsx')) {
      setImportFormat('EXCEL');
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result as string;
        const b64 = res.split(',')[1] || '';
        setImportBase64(b64);
      };
      reader.readAsDataURL(file);
    } else {
      setImportFormat('CSV');
      const reader = new FileReader();
      reader.onload = () => setImportCsvText((reader.result as string) || '');
      reader.readAsText(file);
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importProviderId) {
      showToast('يرجى اختيار مزود التسوية', 'error');
      return;
    }
    setImporting(true);
    try {
      const payload: any = {
        legalEntityId,
        branchId: importBranchId || undefined,
        providerId: importProviderId,
        settlementDate: new Date(importDate).toISOString(),
        format: importFormat,
        fileName: importFileName,
      };
      if (importFormat === 'CSV') payload.csvContent = importCsvText;
      else payload.fileContentBase64 = importBase64;

      const res = await apiClient.post<any>('/api/v1/settlements/import', payload);
      showToast(
        res?.idempotent
          ? 'تم العثور على الدفعة مسبقاً (حماية التكرار)'
          : `تم استيراد ومطابقة الدفعة #${res?.batchNumber}`,
        'success'
      );
      setSubTab('batches');
      loadReferenceData();
      loadBatches();
    } catch (err: any) {
      showToast(err?.message || 'فشل استيراد كشف التسوية', 'error');
    } finally {
      setImporting(false);
    }
  };

  const openBatchDetails = async (batchId: string) => {
    try {
      const res = await apiClient.get<any>(`/api/v1/settlements/batches/${batchId}`);
      setSelectedBatchDetail(res);
      const b = res?.batch;
      setPostBankAccountId(b?.bankAccountId || bankAccounts[0]?.id || '');
      setPostBankReceived(b?.netExpectedAmount || '0.0000');
      setPostBankRef(b?.bankReference || `BNK-${Date.now().toString().slice(-6)}`);
      setPostHasTaxInv(Boolean(b?.hasValidTaxInvoice));
      setPostTaxInvNum(b?.taxInvoiceNumber || '');
      setPostVatRecoverable(Boolean(b?.isVatRecoverable));
    } catch (err: any) {
      showToast(err?.message || 'تعذر جلب تفاصيل الدفعة', 'error');
    }
  };

  const handlePostBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatchDetail?.batch?.id) return;
    setPostingBatch(true);
    try {
      await apiClient.post(`/api/v1/settlements/batches/${selectedBatchDetail.batch.id}/post`, {
        bankAccountId: postBankAccountId,
        bankReceivedAmount: postBankReceived,
        bankReference: postBankRef,
        hasValidTaxInvoice: postHasTaxInv,
        taxInvoiceNumber: postTaxInvNum || undefined,
        isVatRecoverable: postVatRecoverable,
        allowSuspensePosting: postAllowSuspense,
        idempotencyKey: `POST-UI-${selectedBatchDetail.batch.id}`,
      });
      showToast('تم اعتماد وترحيل دفعة التسوية وإنشاء القيد المحاسبي بنجاح', 'success');
      setSelectedBatchDetail(null);
      loadReferenceData();
      loadBatches();
    } catch (err: any) {
      showToast(err?.message || 'فشل ترحيل التسوية', 'error');
    } finally {
      setPostingBatch(false);
    }
  };

  const handleResolveDiscrepancy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingDisc) return;
    try {
      await apiClient.patch(`/api/v1/settlements/discrepancies/${resolvingDisc.id}/resolve`, {
        status: resolveStatus,
        resolutionNotes: resolveNotes,
      });
      showToast('تم تحديث حالة الفرق بنجاح', 'success');
      setResolvingDisc(null);
      setResolveNotes('');
      loadDiscrepancies();
      loadReferenceData();
    } catch (err: any) {
      showToast(err?.message || 'تعذر معالجة الفرق', 'error');
    }
  };

  const statusBadge = (st: string) => {
    const map: Record<string, string> = {
      POSTED: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
      RECONCILING: 'bg-sky-500/15 text-sky-500 border-sky-500/30',
      DISCREPANCY_PENDING: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
      OPEN: 'bg-rose-500/15 text-rose-500 border-rose-500/30',
      RESOLVED_APPROVED: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
      RESOLVED_SUSPENSE: 'bg-indigo-500/15 text-indigo-500 border-indigo-500/30',
    };
    return map[st] || 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* KPI Summary Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs text-slate-500 mb-1">عمليات بانتظار التسوية (Clearing)</div>
          <div className="text-2xl font-bold text-amber-500">
            {Number(summary?.unsettledAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س
          </div>
          <div className="text-xs text-slate-400 mt-1">{summary?.unsettledCount || 0} عملية غير مسوّاة</div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs text-slate-500 mb-1">صافي التسويات المودعة بالبنك</div>
          <div className="text-2xl font-bold text-emerald-500">
            {Number(summary?.totalPostedNetBank || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س
          </div>
          <div className="text-xs text-slate-400 mt-1">{summary?.postedBatches || 0} دفعة مرحّلة</div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs text-slate-500 mb-1">إجمالي العمولات والمحتجز</div>
          <div className="text-2xl font-bold text-sky-500">
            {Number(summary?.totalFees || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س
          </div>
          <div className="text-xs text-slate-400 mt-1">
            محتجز: {Number(summary?.totalWithheld || 0).toFixed(2)} ر.س
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs text-slate-500 mb-1">فروقات معلقة للمراجعة</div>
          <div className="text-2xl font-bold text-rose-500">{summary?.openDiscrepancies || 0}</div>
          <div className="text-xs text-slate-400 mt-1">
            بقيمة {Number(summary?.openDiscrepancyAmount || 0).toFixed(2)} ر.س
          </div>
        </div>
      </div>

      {/* Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'batches', label: 'دفعات التسوية والمطابقة', icon: ArrowLeftRight },
            { id: 'import', label: 'استيراد كشف تسوية (CSV / Excel)', icon: Upload },
            { id: 'discrepancies', label: 'الفروقات والمبالغ المعلقة', icon: AlertTriangle },
            { id: 'providers', label: 'مزودو الدفع ومنصات التوصيل', icon: CreditCard },
          ].map((t) => {
            const Icon = t.icon;
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id as SubTab)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition ${
                  active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            loadReferenceData();
            if (subTab === 'batches') loadBatches();
            if (subTab === 'discrepancies') loadDiscrepancies();
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          تحديث
        </button>
      </div>

      {/* TAB 1: Batches List & Filters */}
      {subTab === 'batches' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="relative md:col-span-2">
              <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="بحث برقم الدفعة أو المرجع البنكي..."
                value={filterSearch}
                onChange={(e) => {
                  setBatchPage(1);
                  setFilterSearch(e.target.value);
                }}
                className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm"
              />
            </div>

            <select
              value={filterCategory}
              onChange={(e) => {
                setBatchPage(1);
                setFilterCategory(e.target.value);
              }}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="">كل الأنواع</option>
              <option value="PAYMENT_GATEWAY">بوابات الدفع</option>
              <option value="DELIVERY_AGGREGATOR">منصات التوصيل</option>
            </select>

            <select
              value={filterProvider}
              onChange={(e) => {
                setBatchPage(1);
                setFilterProvider(e.target.value);
              }}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="">كل المزودين</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameAr}
                </option>
              ))}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => {
                setBatchPage(1);
                setFilterStatus(e.target.value);
              }}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="">كل الحالات</option>
              <option value="RECONCILING">جاهز للاعتماد</option>
              <option value="DISCREPANCY_PENDING">فروقات معلقة</option>
              <option value="POSTED">مرحّل</option>
            </select>

            <div className="flex gap-2">
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-xs"
              />
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-xs"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 text-xs">
                <tr>
                  <th className="p-3">رقم الدفعة</th>
                  <th className="p-3">المزود / المنصة</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">الإجمالي</th>
                  <th className="p-3">العمولة + الضريبة</th>
                  <th className="p-3">المحتجز</th>
                  <th className="p-3">صافي البنك</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-400">
                      جارٍ تحميل دفعات التسوية...
                    </td>
                  </tr>
                ) : batches.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-400">
                      لا توجد دفعات تسوية مطابقة للبحث
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-mono text-xs font-semibold">{b.batchNumber}</td>
                      <td className="p-3">{b.providerNameAr}</td>
                      <td className="p-3 text-xs">{String(b.settlementDate).slice(0, 10)}</td>
                      <td className="p-3 font-medium">{Number(b.grossAmount).toFixed(2)}</td>
                      <td className="p-3 text-xs text-slate-500">
                        {Number(b.feeAmount).toFixed(2)} + {Number(b.feeTaxAmount).toFixed(2)}
                      </td>
                      <td className="p-3 text-xs text-amber-500">{Number(b.withheldAmount).toFixed(2)}</td>
                      <td className="p-3 font-semibold text-emerald-500">
                        {Number(b.bankReceivedAmount).toFixed(2)}
                      </td>
                      <td className="p-3">
                        <span className={`px-2.5 py-1 rounded-full text-xs border ${statusBadge(b.status)}`}>
                          {b.status}
                        </span>
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => openBatchDetails(b.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          تفاصيل / ترحيل
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {batchTotalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={batchPage <= 1}
                onClick={() => setBatchPage((p) => p - 1)}
                className="px-3 py-1.5 rounded-lg border text-xs disabled:opacity-40"
              >
                السابق
              </button>
              <span className="text-xs text-slate-500">
                صفحة {batchPage} من {batchTotalPages}
              </span>
              <button
                type="button"
                disabled={batchPage >= batchTotalPages}
                onClick={() => setBatchPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg border text-xs disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Import Statement */}
      {subTab === 'import' && (
        <form
          onSubmit={handleImportSubmit}
          className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4 max-w-3xl"
        >
          <h3 className="text-base font-bold flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-indigo-500" />
            استيراد كشف تسوية مزود دفع أو منصة توصيل
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">مزود الدفع / المنصة</label>
              <select
                required
                value={importProviderId}
                onChange={(e) => setImportProviderId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                <option value="">اختر المزود...</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameAr} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">الفرع (اختياري)</label>
              <select
                value={importBranchId}
                onChange={(e) => setImportBranchId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                <option value="">على مستوى المنشأة</option>
                {branches.map((br) => (
                  <option key={br.id} value={br.id}>
                    {br.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">تاريخ التسوية</label>
              <input
                type="date"
                required
                value={importDate}
                onChange={(e) => setImportDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">رفع ملف CSV أو Excel (.xlsx)</label>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFileUpload}
              className="block w-full text-sm file:ml-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-indigo-600 file:text-white"
            />
          </div>

          {importFormat === 'CSV' && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">أو لصق بيانات CSV مباشرة</label>
              <textarea
                rows={5}
                value={importCsvText}
                onChange={(e) => setImportCsvText(e.target.value)}
                placeholder="externalRef,orderNumber,grossAmount,feeAmount,feeTaxAmount,withheldAmount,netAmount"
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent font-mono text-xs"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={importing}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            {importing ? 'جارٍ الاستيراد والمطابقة...' : 'استيراد ومطابقة الكشف'}
          </button>
        </form>
      )}

      {/* TAB 3: Discrepancies */}
      {subTab === 'discrepancies' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <select
              value={discStatusFilter}
              onChange={(e) => setDiscStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="">كل الحالات</option>
              <option value="OPEN">مفتوح (OPEN)</option>
              <option value="RESOLVED_APPROVED">تمت الموافقة</option>
              <option value="RESOLVED_SUSPENSE">محوّل للمعلق (Suspense)</option>
              <option value="DISMISSED">مستبعد</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 text-xs">
                <tr>
                  <th className="p-3">رقم الدفعة</th>
                  <th className="p-3">التصنيف</th>
                  <th className="p-3">المصدر</th>
                  <th className="p-3">القيمة</th>
                  <th className="p-3">الوصف</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {discrepancies.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      لا توجد فروقات ضمن التصنيف المحدد
                    </td>
                  </tr>
                ) : (
                  discrepancies.map((d) => (
                    <tr key={d.id}>
                      <td className="p-3 font-mono text-xs">{d.batchNumber}</td>
                      <td className="p-3 text-xs font-medium">{d.discrepancyType}</td>
                      <td className="p-3 text-xs">{d.sourceSystem}</td>
                      <td className="p-3 font-semibold text-rose-500">{Number(d.amount).toFixed(2)}</td>
                      <td className="p-3 text-xs max-w-md">{d.description}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs border ${statusBadge(d.status)}`}>
                          {d.status}
                        </span>
                      </td>
                      <td className="p-3">
                        {d.status === 'OPEN' && (
                          <button
                            type="button"
                            onClick={() => setResolvingDisc(d)}
                            className="px-3 py-1 rounded-lg bg-amber-500/15 text-amber-500 text-xs font-medium"
                          >
                            معالجة
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: Providers */}
      {subTab === 'providers' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-500">
              إعدادات مزودي الدفع ومنصات التوصيل مستقلة لهذه المنشأة القانونية.
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSeedProviders}
                className="px-4 py-2 rounded-xl border border-indigo-500 text-indigo-500 text-xs font-semibold hover:bg-indigo-500/10"
              >
                تفعيل المزودين القياسيين (Mada, HyperPay, HungerStation...)
              </button>
              <button
                type="button"
                onClick={() => setShowNewProvider(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold"
              >
                <Plus className="w-4 h-4" />
                إضافة مزود مخصص
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {providers.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm">{p.nameAr}</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                    {p.code}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  التصنيف: {p.category === 'PAYMENT_GATEWAY' ? 'بوابة دفع' : 'منصة توصيل'}
                </div>
                <div className="text-xs text-slate-500">
                  الربط: {p.clearingMappingKey} / {p.feeMappingKey}
                </div>
                <div className="text-xs text-slate-500">
                  العمولة الافتراضية: {Number(p.defaultFeeRate).toFixed(2)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Batch Detail & Posting Modal */}
      {selectedBatchDetail && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold">
                  دفعة التسوية #{selectedBatchDetail.batch.batchNumber}
                </h3>
                <p className="text-xs text-slate-500">{selectedBatchDetail.provider?.nameAr}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBatchDetail(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <div className="text-slate-500">إجمالي العمليات</div>
                <div className="font-bold text-sm mt-1">
                  {Number(selectedBatchDetail.batch.grossAmount).toFixed(2)} ر.س
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <div className="text-slate-500">العمولة + ضريبتها</div>
                <div className="font-bold text-sm mt-1">
                  {Number(selectedBatchDetail.batch.feeAmount).toFixed(2)} +{' '}
                  {Number(selectedBatchDetail.batch.feeTaxAmount).toFixed(2)} ر.س
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <div className="text-slate-500">المحتجز / خصم المطعم</div>
                <div className="font-bold text-sm mt-1">
                  {Number(selectedBatchDetail.batch.withheldAmount).toFixed(2)} /{' '}
                  {Number(selectedBatchDetail.batch.restaurantDiscountAmount).toFixed(2)} ر.س
                </div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/10">
                <div className="text-emerald-600 dark:text-emerald-400">الصافي المتوقع للبنك</div>
                <div className="font-bold text-sm text-emerald-600 dark:text-emerald-400 mt-1">
                  {Number(selectedBatchDetail.batch.netExpectedAmount).toFixed(2)} ر.س
                </div>
              </div>
            </div>

            {/* Lines preview */}
            <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full text-xs text-right">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500">
                  <tr>
                    <th className="p-2">#</th>
                    <th className="p-2">المرجع / الطلب</th>
                    <th className="p-2">الكشف</th>
                    <th className="p-2">النظام</th>
                    <th className="p-2">العمولة</th>
                    <th className="p-2">المطابقة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(selectedBatchDetail.lines || []).map((l: any) => (
                    <tr key={l.id}>
                      <td className="p-2">{l.lineNumber}</td>
                      <td className="p-2 font-mono">{l.externalRef || l.orderNumber}</td>
                      <td className="p-2">{Number(l.grossAmount).toFixed(2)}</td>
                      <td className="p-2">{Number(l.systemAmount).toFixed(2)}</td>
                      <td className="p-2">{Number(l.feeAmount).toFixed(2)}</td>
                      <td className="p-2">{l.matchStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedBatchDetail.journalEntry && (
              <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                <div className="text-xs font-bold text-emerald-500 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  تم الترحيل المحاسبي — قيد رقم {selectedBatchDetail.journalEntry.journalNumber}
                </div>
              </div>
            )}

            {selectedBatchDetail.batch.status !== 'POSTED' && (
              <form onSubmit={handlePostBatch} className="space-y-4 border-t pt-4">
                <h4 className="font-bold text-sm flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-500" />
                  اعتماد وترحيل التسوية إلى الأستاذ العام والبنك
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">الحساب البنكي المستلم</label>
                    <select
                      required
                      value={postBankAccountId}
                      onChange={(e) => setPostBankAccountId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    >
                      <option value="">اختر الحساب البنكي...</option>
                      {bankAccounts.map((ba) => (
                        <option key={ba.id} value={ba.id}>
                          {ba.bankName} ({ba.accountNumber})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">المبلغ الفعلي المستلم بالبنك</label>
                    <input
                      type="text"
                      required
                      value={postBankReceived}
                      onChange={(e) => setPostBankReceived(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">مرجع الحوالة البنكية</label>
                    <input
                      type="text"
                      required
                      value={postBankRef}
                      onChange={(e) => setPostBankRef(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-5 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={postHasTaxInv}
                      onChange={(e) => setPostHasTaxInv(e.target.checked)}
                    />
                    توفر فاتورة ضريبية صالحة للعمولة
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={postVatRecoverable}
                      onChange={(e) => setPostVatRecoverable(e.target.checked)}
                    />
                    ضريبة مدخلات قابلة للاسترداد (VAT Input)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={postAllowSuspense}
                      onChange={(e) => setPostAllowSuspense(e.target.checked)}
                    />
                    ترحيل المبالغ المحتجزة إلى المعلق (AGGREGATOR_SUSPENSE)
                  </label>
                </div>

                {postHasTaxInv && (
                  <input
                    type="text"
                    placeholder="رقم الفاتورة الضريبية للمزود..."
                    value={postTaxInvNum}
                    onChange={(e) => setPostTaxInvNum(e.target.value)}
                    className="w-full md:w-1/2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm"
                  />
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedBatchDetail(null)}
                    className="px-4 py-2 rounded-xl border text-sm"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={postingBatch}
                    className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {postingBatch ? 'جارٍ الترحيل...' : 'اعتماد وترحيل القيد'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Resolve Discrepancy Modal */}
      {resolvingDisc && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleResolveDiscrepancy}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-4"
          >
            <h4 className="font-bold">معالجة فرق تسوية ({resolvingDisc.discrepancyType})</h4>
            <p className="text-xs text-slate-500">{resolvingDisc.description}</p>
            <select
              value={resolveStatus}
              onChange={(e) => setResolveStatus(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="RESOLVED_APPROVED">اعتماد التسوية (RESOLVED_APPROVED)</option>
              <option value="RESOLVED_SUSPENSE">ترحيل لحساب المعلق (AGGREGATOR_SUSPENSE)</option>
              <option value="DISMISSED">استبعاد (DISMISSED)</option>
            </select>
            <textarea
              required
              rows={3}
              placeholder="ملاحظات المعالجة المحاسبية..."
              value={resolveNotes}
              onChange={(e) => setResolveNotes(e.target.value)}
              className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResolvingDisc(null)}
                className="px-4 py-2 rounded-xl border text-xs"
              >
                إلغاء
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold">
                حفظ المعالجة
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Custom Provider Modal */}
      {showNewProvider && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateProvider}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 space-y-3"
          >
            <h4 className="font-bold flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-500" />
              إضافة مزود تسوية جديد
            </h4>
            <input
              required
              placeholder="الكود (مثل: TABBY)"
              value={newProvCode}
              onChange={(e) => setNewProvCode(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm bg-transparent"
            />
            <input
              required
              placeholder="الاسم بالعربية"
              value={newProvNameAr}
              onChange={(e) => setNewProvNameAr(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm bg-transparent"
            />
            <input
              placeholder="الاسم بالإنجليزية"
              value={newProvNameEn}
              onChange={(e) => setNewProvNameEn(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm bg-transparent"
            />
            <select
              value={newProvCategory}
              onChange={(e) => setNewProvCategory(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl border text-sm bg-white dark:bg-slate-900"
            >
              <option value="PAYMENT_GATEWAY">بوابة دفع</option>
              <option value="DELIVERY_AGGREGATOR">منصة توصيل</option>
            </select>
            <input
              required
              placeholder="نسبة العمولة الافتراضية (%)"
              value={newProvFeeRate}
              onChange={(e) => setNewProvFeeRate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-sm bg-transparent"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewProvider(false)}
                className="px-4 py-2 rounded-xl border text-xs"
              >
                إلغاء
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold">
                حفظ المزود
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
