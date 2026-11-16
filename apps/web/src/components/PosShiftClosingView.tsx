import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calculator,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  RefreshCw,
  Clock,
  Lock,
  Unlock,
  FileText,
  Filter,
  Wallet,
  Building2,
  Monitor,
  User,
  Calendar,
  ArrowDownRight,
  ArrowUpRight,
  X,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';

export interface PosShiftRecord {
  id: string;
  tenantId: string;
  legalEntityId: string;
  branchId: string;
  branchName?: string | null;
  deviceId: string;
  deviceCode?: string | null;
  deviceName?: string | null;
  cashVaultId?: string | null;
  vaultName?: string | null;
  vaultCode?: string | null;
  cashierId: string;
  cashierName?: string | null;
  cashierEmail?: string | null;
  closedBy?: string | null;
  openedAt: string;
  closedAt?: string | null;
  openingCash: string;
  totalCashReceipts?: string | null;
  totalCashRefunds?: string | null;
  totalCashChange?: string | null;
  totalCashIn?: string | null;
  totalCashOut?: string | null;
  expectedCash?: string | null;
  countedCash?: string | null;
  variance?: string | null;
  status: 'OPEN' | 'CLOSED' | string;
  closeJournalEntryId?: string | null;
  journalNumber?: string | null;
  notes?: string | null;
}

export interface ShiftBreakdown {
  openingCash: number;
  totalCashReceipts: number;
  totalCashRefunds: number;
  totalCashChange: number;
  totalCashIn: number;
  totalCashOut: number;
  totalNonCashSales: number;
  netCashFromSales: number;
  expectedCash: number;
}

export interface ShiftSummaryDetail extends PosShiftRecord {
  vault?: { id: string; code: string; nameAr: string; balance: string } | null;
  journalEntry?: {
    id: string;
    journalNumber: string;
    status: string;
    debitTotal: string;
    creditTotal: string;
  } | null;
  breakdown: ShiftBreakdown;
}

interface PosShiftClosingViewProps {
  legalEntityId: string;
  theme?: 'light' | 'dark';
  defaultBranchId?: string;
}

const fmtCurrency = (val: string | number | null | undefined) => {
  const num = typeof val === 'string' ? parseFloat(val) : Number(val ?? 0);
  if (!Number.isFinite(num)) return '0.00';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ar-SA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const PosShiftClosingView: React.FC<PosShiftClosingViewProps> = ({
  legalEntityId,
  theme = 'light',
  defaultBranchId = '',
}) => {
  const toast = useToast();
  const { dir } = useLocale();
  const isDark = theme === 'dark';

  const [shifts, setShifts] = useState<PosShiftRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>(defaultBranchId);
  const [deviceFilter, setDeviceFilter] = useState<string>('');
  const [vaultFilter, setVaultFilter] = useState<string>('');
  const [cashierFilter, setCashierFilter] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // Reference lists for dropdowns
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [devices, setDevices] = useState<Array<{ id: string; deviceCode: string; name?: string }>>([]);
  const [vaults, setVaults] = useState<Array<{ id: string; code: string; nameAr: string }>>([]);

  // Close Shift Modal / Detail Drawer
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummaryDetail | null>(null);

  useEffect(() => {
    if (!selectedShiftId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedShiftId(null);
        setShiftSummary(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedShiftId]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [countedCashInput, setCountedCashInput] = useState<string>('');
  const [closeNotes, setCloseNotes] = useState<string>('');
  const [submittingClose, setSubmittingClose] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeIdempotencyKey, setCloseIdempotencyKey] = useState<string>('');

  // Load filter metadata
  useEffect(() => {
    async function loadMeta() {
      if (!legalEntityId) return;
      try {
        const [brRes, devRes, vltRes] = await Promise.all([
          apiClient.get<any[]>(`/branches?legalEntityId=${legalEntityId}`).catch(() => []),
          apiClient.get<any[]>(`/accounting/pos-devices?legalEntityId=${legalEntityId}`).catch(() => []),
          apiClient.get<any[]>(`/api/v1/accounting/vaults?legalEntityId=${legalEntityId}`).catch(() => []),
        ]);
        setBranches(brRes || []);
        setDevices(devRes || []);
        setVaults(vltRes || []);
      } catch {
        // Silently degrade dropdown metadata
      }
    }
    loadMeta();
  }, [legalEntityId]);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (legalEntityId) params.set('legalEntityId', legalEntityId);
      if (branchFilter) params.set('branchId', branchFilter);
      if (deviceFilter) params.set('deviceId', deviceFilter);
      if (vaultFilter) params.set('cashVaultId', vaultFilter);
      if (cashierFilter) params.set('cashierId', cashierFilter);
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter);
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const data = await apiClient.get<PosShiftRecord[]>(`/sales/shifts?${params.toString()}`);
      setShifts(data || []);
    } catch (err: any) {
      toast.error(err.message || 'تعذر تحميل سجل الورديات');
    } finally {
      setLoading(false);
    }
  }, [
    legalEntityId,
    branchFilter,
    deviceFilter,
    vaultFilter,
    cashierFilter,
    statusFilter,
    fromDate,
    toDate,
    searchQuery,
  ]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  // Extract unique cashiers from loaded shifts
  const cashierOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of shifts) {
      if (s.cashierId) {
        map.set(s.cashierId, s.cashierName || s.cashierEmail || s.cashierId.slice(0, 8));
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [shifts]);

  const openShiftDetail = async (shiftId: string) => {
    setSelectedShiftId(shiftId);
    setSummaryLoading(true);
    setCloseError(null);
    setCloseNotes('');
    setCloseIdempotencyKey(
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `close-${shiftId}-${Date.now()}`
    );

    try {
      const summary = await apiClient.get<ShiftSummaryDetail>(`/sales/shifts/${shiftId}/summary`);
      setShiftSummary(summary);
      if (summary.status === 'OPEN') {
        setCountedCashInput(summary.breakdown.expectedCash.toFixed(2));
      } else {
        setCountedCashInput(summary.countedCash || '0.00');
      }
    } catch (err: any) {
      toast.error(err.message || 'تعذر تحميل ملخص الوردية');
      setSelectedShiftId(null);
    } finally {
      setSummaryLoading(false);
    }
  };

  const liveVariance = useMemo(() => {
    if (!shiftSummary) return 0;
    const expected = shiftSummary.breakdown.expectedCash;
    const actual = parseFloat(countedCashInput || '0');
    if (!Number.isFinite(actual)) return 0;
    return Number((actual - expected).toFixed(4));
  }, [shiftSummary, countedCashInput]);

  const handleConfirmCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftSummary) return;

    const countedVal = parseFloat(countedCashInput);
    if (!Number.isFinite(countedVal) || countedVal < 0) {
      setCloseError('يرجى إدخال قيمة نقد فعلي صحيحة (رقم أكبر من أو يساوي صفر)');
      return;
    }

    setSubmittingClose(true);
    setCloseError(null);
    try {
      const res = await apiClient.post<any>('/sales/shifts/close', {
        shiftId: shiftSummary.id,
        countedCash: countedVal.toFixed(4),
        notes: closeNotes.trim() || undefined,
        idempotencyKey: closeIdempotencyKey,
      });

      toast.success(
        res.journalEntry
          ? `تم إقفال الوردية بنجاح وترحيل قيد تسوية الفرق (${res.journalEntry.journalNumber})`
          : 'تم إقفال الوردية بنجاح دون وجود فرق نقدي'
      );

      await openShiftDetail(shiftSummary.id);
      await loadShifts();
    } catch (err: any) {
      setCloseError(err.message || 'فشل إقفال الوردية');
      toast.error(err.message || 'فشل إقفال الوردية');
    } finally {
      setSubmittingClose(false);
    }
  };

  // KPI metrics
  const kpis = useMemo(() => {
    const openCount = shifts.filter((s) => s.status === 'OPEN').length;
    const closedCount = shifts.filter((s) => s.status === 'CLOSED').length;
    const totalVariance = shifts
      .filter((s) => s.status === 'CLOSED' && s.variance)
      .reduce((acc, s) => acc + parseFloat(s.variance || '0'), 0);
    return { openCount, closedCount, totalVariance };
  }, [shifts]);

  const cardBg = isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200';
  const inputCls = `w-full px-3 py-2 text-sm rounded-lg border outline-none transition ${
    isDark
      ? 'bg-slate-900 border-slate-700 text-slate-100 focus:border-emerald-500'
      : 'bg-white border-slate-300 text-slate-800 focus:border-emerald-500'
  }`;

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header & KPIs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Calculator className="w-6 h-6 text-emerald-500" />
            إقفال الورديات ومطابقة الصندوق (POS Shift Closing)
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            احتساب النقد المتوقع، تسوية فروقات العجز (CASH_OVER_SHORT) والفائض (CASH_OVERAGE)، والربط التلقائي بالأستاذ العام
          </p>
        </div>

        <button
          type="button"
          onClick={loadShifts}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث السجل
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`p-4 rounded-2xl border ${cardBg} shadow-sm flex items-center justify-between`}>
          <div>
            <div className="text-xs text-slate-500 font-medium">ورديات مفتوحة حالياً</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">{kpis.openCount}</div>
          </div>
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-600">
            <Unlock className="w-6 h-6" />
          </div>
        </div>

        <div className={`p-4 rounded-2xl border ${cardBg} shadow-sm flex items-center justify-between`}>
          <div>
            <div className="text-xs text-slate-500 font-medium">ورديات مقفلة ومعتمدة</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">{kpis.closedCount}</div>
          </div>
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-600">
            <Lock className="w-6 h-6" />
          </div>
        </div>

        <div className={`p-4 rounded-2xl border ${cardBg} shadow-sm flex items-center justify-between`}>
          <div>
            <div className="text-xs text-slate-500 font-medium">صافي الفروقات المسجلة</div>
            <div
              className={`text-2xl font-bold mt-1 ${
                Math.abs(kpis.totalVariance) < 0.01
                  ? 'text-emerald-600'
                  : kpis.totalVariance < 0
                    ? 'text-rose-600'
                    : 'text-blue-600'
              }`}
            >
              {kpis.totalVariance > 0 ? '+' : ''}
              {fmtCurrency(kpis.totalVariance)} ر.س
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-500/10 text-slate-600">
            <Wallet className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className={`p-4 rounded-2xl border ${cardBg} shadow-sm space-y-3`}>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
          <Filter className="w-4 h-4 text-emerald-500" />
          تصفية وبحث سجل إقفالات الورديات
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div className="relative md:col-span-2">
            <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="بحث برقم الوردية، القيد، الكاشير، الجهاز..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`${inputCls} pr-9`}
            />
          </div>

          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className={inputCls}
            aria-label="تصفية حسب الفرع"
          >
            <option value="">جميع الفروع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <select
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
            className={inputCls}
            aria-label="تصفية حسب جهاز POS"
          >
            <option value="">جميع الأجهزة</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.deviceCode} {d.name ? `- ${d.name}` : ''}
              </option>
            ))}
          </select>

          <select
            value={vaultFilter}
            onChange={(e) => setVaultFilter(e.target.value)}
            className={inputCls}
            aria-label="تصفية حسب الخزينة"
          >
            <option value="">جميع الخزائن</option>
            {vaults.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} - {v.nameAr}
              </option>
            ))}
          </select>

          <select
            value={cashierFilter}
            onChange={(e) => setCashierFilter(e.target.value)}
            className={inputCls}
            aria-label="تصفية حسب الكاشير"
          >
            <option value="">جميع الكاشيرين</option>
            {cashierOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={inputCls}
            aria-label="تصفية حسب الحالة"
          >
            <option value="ALL">كل الحالات</option>
            <option value="OPEN">مفتوحة (OPEN)</option>
            <option value="CLOSED">مقفلة (CLOSED)</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Calendar className="w-3.5 h-3.5" />
            من تاريخ:
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={`px-2 py-1 text-xs rounded border ${
                isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
              }`}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            إلى تاريخ:
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={`px-2 py-1 text-xs rounded border ${
                isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
              }`}
            />
          </div>
          {(branchFilter || deviceFilter || vaultFilter || cashierFilter || fromDate || toDate || searchQuery || statusFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setBranchFilter('');
                setDeviceFilter('');
                setVaultFilter('');
                setCashierFilter('');
                setFromDate('');
                setToDate('');
                setSearchQuery('');
                setStatusFilter('ALL');
              }}
              className="text-xs text-rose-600 hover:underline font-medium"
            >
              مسح التصفية
            </button>
          )}
        </div>
      </div>

      {/* Shifts Table */}
      <div className={`rounded-2xl border ${cardBg} shadow-sm overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className={isDark ? 'bg-slate-900/70 text-slate-300' : 'bg-slate-50 text-slate-600'}>
              <tr>
                <th className="py-3 px-4 font-semibold">الوردية / التوقيت</th>
                <th className="py-3 px-4 font-semibold">الفرع والجهاز والخزينة</th>
                <th className="py-3 px-4 font-semibold">الكاشير</th>
                <th className="py-3 px-4 font-semibold text-left">الافتتاح</th>
                <th className="py-3 px-4 font-semibold text-left">المتوقع</th>
                <th className="py-3 px-4 font-semibold text-left">الفعلي</th>
                <th className="py-3 px-4 font-semibold text-left">الفرق</th>
                <th className="py-3 px-4 font-semibold">الحالة / القيد</th>
                <th className="py-3 px-4 font-semibold text-center">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {loading && shifts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    جاري تحميل سجل الورديات...
                  </td>
                </tr>
              ) : shifts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    لا توجد ورديات مطابقة لمعايير البحث
                  </td>
                </tr>
              ) : (
                shifts.map((shift) => {
                  const varianceVal = shift.variance ? parseFloat(shift.variance) : 0;
                  const isOpen = shift.status === 'OPEN';

                  return (
                    <tr
                      key={shift.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition cursor-pointer"
                      onClick={() => openShiftDetail(shift.id)}
                    >
                      <td className="py-3 px-4">
                        <div className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200">
                          #{shift.id.slice(0, 8).toUpperCase()}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {fmtDateTime(shift.openedAt)}
                        </div>
                        {shift.closedAt && (
                          <div className="text-[11px] text-slate-400">
                            إقفال: {fmtDateTime(shift.closedAt)}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-medium flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          {shift.branchName || 'فرع'}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <Monitor className="w-3 h-3" />
                          {shift.deviceCode || shift.deviceName || 'جهاز POS'}
                        </div>
                        {shift.vaultName && (
                          <div className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
                            <Wallet className="w-3 h-3" />
                            {shift.vaultName}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span>{shift.cashierName || shift.cashierEmail || 'كاشير'}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-left font-mono">
                        {fmtCurrency(shift.openingCash)}
                      </td>

                      <td className="py-3 px-4 text-left font-mono font-medium">
                        {shift.expectedCash !== null && shift.expectedCash !== undefined
                          ? fmtCurrency(shift.expectedCash)
                          : '—'}
                      </td>

                      <td className="py-3 px-4 text-left font-mono font-semibold">
                        {shift.countedCash !== null && shift.countedCash !== undefined
                          ? fmtCurrency(shift.countedCash)
                          : '—'}
                      </td>

                      <td className="py-3 px-4 text-left font-mono">
                        {isOpen ? (
                          <span className="text-slate-400 text-xs">قيد التشغيل</span>
                        ) : Math.abs(varianceVal) < 0.005 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                            0.00 (مطابق)
                          </span>
                        ) : varianceVal < 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                            <ArrowDownRight className="w-3 h-3" />
                            {fmtCurrency(varianceVal)} (عجز)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                            <ArrowUpRight className="w-3 h-3" />+{fmtCurrency(varianceVal)} (فائض)
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            isOpen
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                          }`}
                        >
                          {isOpen ? 'مفتوحة' : 'مقفلة'}
                        </span>
                        {shift.journalNumber && (
                          <div className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {shift.journalNumber}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openShiftDetail(shift.id);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                            isOpen
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              : 'bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100'
                          }`}
                        >
                          {isOpen ? 'جرد وإقفال' : 'عرض التفاصيل'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Shift Closing / Details Modal */}
      {selectedShiftId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            className={`w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden max-h-[90vh] flex flex-col ${
              isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Calculator className="w-5 h-5 text-emerald-500" />
                  {shiftSummary?.status === 'OPEN'
                    ? 'إقفال الوردية ومطابقة النقدية'
                    : 'تقرير إقفال الوردية المعتمد'}
                </h3>
                {shiftSummary && (
                  <p className="text-xs text-slate-500 mt-0.5 font-mono">
                    Shift #{shiftSummary.id.slice(0, 8).toUpperCase()} • {shiftSummary.branchName} •{' '}
                    {shiftSummary.deviceCode}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedShiftId(null);
                  setShiftSummary(null);
                }}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5">
              {summaryLoading || !shiftSummary ? (
                <div className="py-12 text-center text-slate-400">جاري حساب ملخص الحركات النقدية...</div>
              ) : (
                <>
                  {/* Meta Banner */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                    <div>
                      <span className="text-slate-400 block">الكاشير</span>
                      <span className="font-semibold">{shiftSummary.cashierName || '—'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">الخزينة المرتبطة</span>
                      <span className="font-semibold">{shiftSummary.vault?.nameAr || 'افتراضي الفرع'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">توقيت الافتتاح</span>
                      <span className="font-semibold">{fmtDateTime(shiftSummary.openedAt)}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">حالة الوردية</span>
                      <span
                        className={`inline-block font-bold ${
                          shiftSummary.status === 'OPEN' ? 'text-amber-600' : 'text-emerald-600'
                        }`}
                      >
                        {shiftSummary.status === 'OPEN' ? 'مفتوحة (OPEN)' : 'مقفلة (CLOSED)'}
                      </span>
                    </div>
                  </div>

                  {/* Expected Cash Formula Breakdown */}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                      معادلة احتساب النقد المتوقع بالصندوق
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                      <div className="px-4 py-2.5 flex justify-between">
                        <span className="text-slate-600 dark:text-slate-300">رصيد افتتاح الوردية (+)</span>
                        <span className="font-mono font-semibold">{fmtCurrency(shiftSummary.breakdown.openingCash)} ر.س</span>
                      </div>
                      <div className="px-4 py-2.5 flex justify-between">
                        <span className="text-slate-600 dark:text-slate-300">إجمالي المقبوضات النقدية المستلمة (+)</span>
                        <span className="font-mono font-semibold text-emerald-600">
                          +{fmtCurrency(shiftSummary.breakdown.totalCashReceipts)} ر.س
                        </span>
                      </div>
                      <div className="px-4 py-2.5 flex justify-between">
                        <span className="text-slate-600 dark:text-slate-300">الباقي المصروف للعملاء (Change Given) (-)</span>
                        <span className="font-mono font-semibold text-amber-600">
                          -{fmtCurrency(shiftSummary.breakdown.totalCashChange)} ر.س
                        </span>
                      </div>
                      <div className="px-4 py-2.5 flex justify-between">
                        <span className="text-slate-600 dark:text-slate-300">المبالغ النقدية المستردة للعملاء (مرتجعات) (-)</span>
                        <span className="font-mono font-semibold text-rose-600">
                          -{fmtCurrency(shiftSummary.breakdown.totalCashRefunds)} ر.س
                        </span>
                      </div>
                      <div className="px-4 py-2.5 flex justify-between">
                        <span className="text-slate-600 dark:text-slate-300">التحويلات النقدية الواردة المعتمدة (+)</span>
                        <span className="font-mono font-semibold text-emerald-600">
                          +{fmtCurrency(shiftSummary.breakdown.totalCashIn)} ر.س
                        </span>
                      </div>
                      <div className="px-4 py-2.5 flex justify-between">
                        <span className="text-slate-600 dark:text-slate-300">المصروفات النقدية والتحويلات الصادرة (-)</span>
                        <span className="font-mono font-semibold text-rose-600">
                          -{fmtCurrency(shiftSummary.breakdown.totalCashOut)} ر.س
                        </span>
                      </div>
                      <div className="px-4 py-3 flex justify-between bg-emerald-50/70 dark:bg-emerald-950/30 font-bold text-base">
                        <span>النقد المتوقع عند الإقفال (=)</span>
                        <span className="font-mono text-emerald-700 dark:text-emerald-400">
                          {fmtCurrency(shiftSummary.breakdown.expectedCash)} ر.س
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Non-cash Note */}
                  {shiftSummary.breakdown.totalNonCashSales > 0 && (
                    <div className="px-4 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300 flex justify-between items-center">
                      <span>إجمالي مبيعات الشبكة والبطاقات والمحافظ (مدى / فيزا / Apple Pay) — مستبعدة من عهدة الصندوق النقدي:</span>
                      <span className="font-mono font-bold">{fmtCurrency(shiftSummary.breakdown.totalNonCashSales)} ر.س</span>
                    </div>
                  )}

                  {/* Open Shift Close Form vs Closed Summary */}
                  {shiftSummary.status === 'OPEN' ? (
                    <form onSubmit={handleConfirmCloseShift} className="space-y-4">
                      <div>
                        <label className="block text-sm font-semibold mb-1.5">
                          النقد الفعلي المعدود بواسطة الكاشير (ر.س) *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          value={countedCashInput}
                          onChange={(e) => setCountedCashInput(e.target.value)}
                          className={`${inputCls} font-mono text-lg font-bold`}
                        />
                      </div>

                      {/* Real-time Variance Preview */}
                      <div
                        className={`p-4 rounded-xl border flex items-center justify-between ${
                          Math.abs(liveVariance) < 0.005
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200'
                            : liveVariance < 0
                              ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
                              : 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-200'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          {Math.abs(liveVariance) < 0.005 ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                          ) : liveVariance < 0 ? (
                            <AlertTriangle className="w-5 h-5 text-rose-600" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-blue-600" />
                          )}
                          <div>
                            <div className="font-bold text-sm">
                              {Math.abs(liveVariance) < 0.005
                                ? 'مطابقة كاملة (فرق صفري)'
                                : liveVariance < 0
                                  ? 'عجز نقدي (سيتم إنشاء قيد تسوية على حساب CASH_OVER_SHORT)'
                                  : 'زيادة نقدية (سيتم إنشاء قيد تسوية على حساب CASH_OVERAGE)'}
                            </div>
                            <div className="text-xs opacity-80">
                              {Math.abs(liveVariance) < 0.005
                                ? 'لا يتطلب إنشاء قيد محاسبي إضافي'
                                : 'سيتم ترحيل القيد وتحديث رصيد الخزينة في معاملة ذرية واحدة'}
                            </div>
                          </div>
                        </div>
                        <div className="font-mono text-lg font-bold">
                          {liveVariance > 0 ? '+' : ''}
                          {fmtCurrency(liveVariance)} ر.س
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold mb-1 text-slate-500">
                          ملاحظات الإقفال (اختياري)
                        </label>
                        <textarea
                          rows={2}
                          value={closeNotes}
                          onChange={(e) => setCloseNotes(e.target.value)}
                          placeholder="أضف أي مبرر أو ملاحظات حول الجرد النقدي..."
                          className={inputCls}
                        />
                      </div>

                      {closeError && (
                        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                          <XCircle className="w-4 h-4 shrink-0" />
                          <span>{closeError}</span>
                        </div>
                      )}

                      <div className="flex justify-end gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedShiftId(null);
                            setShiftSummary(null);
                          }}
                          className="px-4 py-2 rounded-xl text-sm font-medium border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                        >
                          إلغاء
                        </button>
                        <button
                          type="submit"
                          disabled={submittingClose}
                          className="px-5 py-2 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition disabled:opacity-50"
                        >
                          {submittingClose ? 'جاري الإقفال والترحيل...' : 'اعتماد وإقفال الوردية نهائياً'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    /* Closed Shift Audit Summary */
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                          <span className="text-xs text-slate-400 block">النقد الفعلي المعدود</span>
                          <span className="text-lg font-mono font-bold">
                            {fmtCurrency(shiftSummary.countedCash)} ر.س
                          </span>
                        </div>
                        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                          <span className="text-xs text-slate-400 block">العجز / الزيادة المسجلة</span>
                          <span
                            className={`text-lg font-mono font-bold ${
                              Math.abs(parseFloat(shiftSummary.variance || '0')) < 0.005
                                ? 'text-emerald-600'
                                : parseFloat(shiftSummary.variance || '0') < 0
                                  ? 'text-rose-600'
                                  : 'text-blue-600'
                            }`}
                          >
                            {parseFloat(shiftSummary.variance || '0') > 0 ? '+' : ''}
                            {fmtCurrency(shiftSummary.variance)} ر.س
                          </span>
                        </div>
                        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
                          <span className="text-xs text-slate-400 block">رقم القيد المحاسبي المرتبط</span>
                          <span className="text-sm font-mono font-bold text-emerald-600">
                            {shiftSummary.journalEntry?.journalNumber || 'لا يوجد (فرق صفري)'}
                          </span>
                        </div>
                      </div>

                      {shiftSummary.notes && (
                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300">
                          <span className="font-bold">ملاحظات الإقفال:</span> {shiftSummary.notes}
                        </div>
                      )}

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedShiftId(null);
                            setShiftSummary(null);
                          }}
                          className="px-5 py-2 rounded-xl text-sm font-semibold bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-white transition"
                        >
                          إغلاق النافذة
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
