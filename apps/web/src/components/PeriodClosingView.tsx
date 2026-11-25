import React, { useState, useEffect, useCallback } from 'react';
import {
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Plus,
  FileText,
  Scale,
  History,
  Clock,
  ChevronRight,
  ChevronLeft,
  X,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';

type ClosingTab = 'periods' | 'precheck' | 'pending' | 'trial-balance' | 'logs';

interface LegalEntityOption {
  id: string;
  legalName: string;
  commercialName?: string;
}

interface FiscalYearRow {
  id: string;
  yearCode: string;
  yearName: string;
  startDate: string;
  endDate: string;
  status: string;
}

interface FiscalPeriodRow {
  id: string;
  fiscalYearId?: string;
  periodNumber?: number;
  periodName: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSING' | 'CLOSED' | 'LOCKED';
  lastPrecheckAt?: string;
  lastPrecheckStatus?: string;
  closedAt?: string;
  reopenedAt?: string;
  reopenReason?: string;
}

interface PreCheckItem {
  code: string;
  title: string;
  severity: 'BLOCKER' | 'WARNING' | 'INFO';
  status: 'PASS' | 'FAIL' | 'WARN';
  count: number;
  message: string;
}

interface PreCheckResult {
  period: FiscalPeriodRow;
  precheckStatus: string;
  canClose: boolean;
  blockersCount: number;
  warningsCount: number;
  checks: PreCheckItem[];
}

export const PeriodClosingView: React.FC = () => {
  const { showToast } = useToast();
  const { dir } = useLocale();
  const [activeTab, setActiveTab] = useState<ClosingTab>('periods');
  const [entities, setEntities] = useState<LegalEntityOption[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string>('');
  const [fiscalYears, setFiscalYears] = useState<FiscalYearRow[]>([]);
  const [periods, setPeriods] = useState<FiscalPeriodRow[]>([]);
  const [periodsPage, setPeriodsPage] = useState(1);
  const [periodsTotalPages, setPeriodsTotalPages] = useState(1);
  const [selectedPeriod, setSelectedPeriod] = useState<FiscalPeriodRow | null>(null);
  const [loading, setLoading] = useState(false);

  // Precheck
  const [precheck, setPrecheck] = useState<PreCheckResult | null>(null);

  // Pending items
  const [pendingItems, setPendingItems] = useState<any[]>([]);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingTotalPages, setPendingTotalPages] = useState(1);
  const [pendingType, setPendingType] = useState('');

  // Final Trial Balance
  const [trialBalanceData, setTrialBalanceData] = useState<any | null>(null);

  // Closing Logs
  const [closingLogs, setClosingLogs] = useState<any[]>([]);
  const [logsPage, setLogsPage] = useState(1);
  const [logsTotalPages, setLogsTotalPages] = useState(1);

  // Modals
  const [showYearModal, setShowYearModal] = useState(false);
  const [yearCode, setYearCode] = useState('FY2026');
  const [yearName, setYearName] = useState('السنة المالية 2026');
  const [yearStart, setYearStart] = useState('2026-01-01');
  const [yearEnd, setYearEnd] = useState('2026-12-31');
  const [generateMonthly, setGenerateMonthly] = useState(true);

  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [periodName, setPeriodName] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [periodFyId, setPeriodFyId] = useState('');

  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenTarget, setReopenTarget] = useState<FiscalPeriodRow | null>(null);
  const [reopenReason, setReopenReason] = useState('');

  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeTarget, setCloseTarget] = useState<FiscalPeriodRow | null>(null);
  const [closeNotes, setCloseNotes] = useState('');

  // Priority 3: Fiscal Year Closing, Opening Balances & Reopening Modals
  const [fyCloseTarget, setFyCloseTarget] = useState<FiscalYearRow | null>(null);
  const [fyAutoOpenNext, setFyAutoOpenNext] = useState(true);
  const [fyCloseNotes, setFyCloseNotes] = useState('');
  const [fyPrecheckResult, setFyPrecheckResult] = useState<any | null>(null);
  const [fyReopenTarget, setFyReopenTarget] = useState<FiscalYearRow | null>(null);
  const [fyReopenReason, setFyReopenReason] = useState('');
  const [fyOpeningView, setFyOpeningView] = useState<any | null>(null);

  useEffect(() => {
    if (!showYearModal && !showPeriodModal && !showCloseModal && !showReopenModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowYearModal(false);
        setShowPeriodModal(false);
        setShowCloseModal(false);
        setShowReopenModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showYearModal, showPeriodModal, showCloseModal, showReopenModal]);

  const loadEntities = useCallback(async () => {
    try {
      const res = await apiClient.get<any>('/legal-entities');
      const list: LegalEntityOption[] = res.data || res || [];
      setEntities(list);
      if (list.length > 0 && !selectedEntityId) {
        setSelectedEntityId(list[0].id);
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل المنشآت القانونية', 'error');
    }
  }, [selectedEntityId, showToast]);

  const loadYearsAndPeriods = useCallback(async () => {
    if (!selectedEntityId) return;
    setLoading(true);
    try {
      const [fyRes, pRes] = await Promise.all([
        apiClient.get<any>(`/api/v1/accounting/fiscal-years?legalEntityId=${selectedEntityId}&limit=50`),
        apiClient.get<any>(
          `/api/v1/accounting/fiscal-periods?legalEntityId=${selectedEntityId}&page=${periodsPage}&limit=12`,
        ),
      ]);
      setFiscalYears(fyRes.data || []);
      const pRows: FiscalPeriodRow[] = pRes.data || [];
      setPeriods(pRows);
      setPeriodsTotalPages(pRes.totalPages || 1);
      if (pRows.length > 0 && !selectedPeriod) {
        setSelectedPeriod(pRows[0]);
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل الفترات المالية', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedEntityId, periodsPage, selectedPeriod, showToast]);

  const loadClosingLogs = useCallback(async () => {
    if (!selectedEntityId) return;
    try {
      const q = selectedPeriod ? `&periodId=${selectedPeriod.id}` : '';
      const res = await apiClient.get<any>(
        `/api/v1/accounting/fiscal-periods/closing-logs?legalEntityId=${selectedEntityId}${q}&page=${logsPage}&limit=15`,
      );
      setClosingLogs(res.data || []);
      setLogsTotalPages(res.totalPages || 1);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل سجل الإقفال', 'error');
    }
  }, [selectedEntityId, selectedPeriod, logsPage, showToast]);

  const loadPendingItems = useCallback(async () => {
    if (!selectedPeriod) return;
    try {
      const typeQ = pendingType ? `&type=${pendingType}` : '';
      const res = await apiClient.get<any>(
        `/api/v1/accounting/fiscal-periods/${selectedPeriod.id}/pending-items?page=${pendingPage}&limit=15${typeQ}`,
      );
      setPendingItems(res.data || []);
      setPendingTotalPages(res.totalPages || 1);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل المستندات المعلقة', 'error');
    }
  }, [selectedPeriod, pendingPage, pendingType, showToast]);

  const loadFinalTrialBalance = useCallback(async () => {
    if (!selectedPeriod) return;
    try {
      const res = await apiClient.get<any>(
        `/api/v1/accounting/fiscal-periods/${selectedPeriod.id}/final-trial-balance`,
      );
      setTrialBalanceData(res);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل ميزان المراجعة النهائي', 'error');
    }
  }, [selectedPeriod, showToast]);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  useEffect(() => {
    loadYearsAndPeriods();
  }, [loadYearsAndPeriods]);

  useEffect(() => {
    if (activeTab === 'logs') loadClosingLogs();
    if (activeTab === 'pending') loadPendingItems();
    if (activeTab === 'trial-balance') loadFinalTrialBalance();
  }, [activeTab, loadClosingLogs, loadPendingItems, loadFinalTrialBalance]);

  const handleRunPrecheck = async (period: FiscalPeriodRow) => {
    setSelectedPeriod(period);
    setLoading(true);
    try {
      const res = await apiClient.post<PreCheckResult>(
        `/api/v1/accounting/fiscal-periods/${period.id}/pre-check`,
        {},
      );
      setPrecheck(res);
      setActiveTab('precheck');
      await loadYearsAndPeriods();
      showToast(res.canClose ? 'الفترة جاهزة للإقفال' : 'توجد معوقات تمنع الإقفال', res.canClose ? 'success' : 'error');
    } catch (err: any) {
      showToast(err?.message || 'فشل فحص ما قبل الإقفال', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFiscalYear = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/v1/accounting/fiscal-years', {
        legalEntityId: selectedEntityId,
        yearCode,
        yearName,
        startDate: yearStart,
        endDate: yearEnd,
        generateMonthlyPeriods: generateMonthly,
      });
      setShowYearModal(false);
      showToast('تم إنشاء السنة المالية بنجاح', 'success');
      await loadYearsAndPeriods();
    } catch (err: any) {
      showToast(err?.message || 'تعذر إنشاء السنة المالية', 'error');
    }
  };

  const handleCreatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/v1/accounting/fiscal-periods', {
        legalEntityId: selectedEntityId,
        fiscalYearId: periodFyId || undefined,
        periodName,
        startDate: periodStart,
        endDate: periodEnd,
      });
      setShowPeriodModal(false);
      showToast('تم إنشاء الفترة المالية بنجاح', 'success');
      await loadYearsAndPeriods();
    } catch (err: any) {
      showToast(err?.message || 'تعذر إنشاء الفترة المالية', 'error');
    }
  };

  const handleClosePeriod = async () => {
    if (!closeTarget) return;
    try {
      await apiClient.post(`/api/v1/accounting/fiscal-periods/${closeTarget.id}/close`, {
        notes: closeNotes || undefined,
        idempotencyKey: `close-${closeTarget.id}-${Date.now()}`,
      });
      setShowCloseModal(false);
      setCloseNotes('');
      showToast('تم إقفال الفترة المالية بنجاح', 'success');
      await loadYearsAndPeriods();
    } catch (err: any) {
      showToast(err?.message || 'فشل إقفال الفترة المالية', 'error');
    }
  };

  const handleReopenPeriod = async () => {
    if (!reopenTarget) return;
    if (reopenReason.trim().length < 5) {
      showToast('يجب إدخال سبب إعادة الفتح (5 أحرف على الأقل)', 'error');
      return;
    }
    try {
      await apiClient.post(`/api/v1/accounting/fiscal-periods/${reopenTarget.id}/reopen`, {
        reason: reopenReason.trim(),
        idempotencyKey: `reopen-${reopenTarget.id}-${Date.now()}`,
      });
      setShowReopenModal(false);
      setReopenReason('');
      showToast('تمت إعادة فتح الفترة المالية وتسجيل السبب في سجل الرقابة', 'success');
      await loadYearsAndPeriods();
    } catch (err: any) {
      showToast(err?.message || 'تعذر إعادة فتح الفترة المالية', 'error');
    }
  };

  const handleFyPrecheck = async (fy: FiscalYearRow) => {
    try {
      const res = await apiClient.post<any>(`/api/v1/accounting/fiscal-years/${fy.id}/pre-check`, {});
      const data = res.data || res;
      setFyPrecheckResult({ fy, ...data });
      showToast(
        data.canClose ? 'السنة المالية جاهزة للإقفال' : `توجد ${data.blockersCount} عوائق تمنع إقفال السنة`,
        data.canClose ? 'success' : 'error',
      );
    } catch (err: any) {
      showToast(err?.message || 'تعذر تنفيذ فحص إقفال السنة المالية', 'error');
    }
  };

  const handleCloseFiscalYear = async () => {
    if (!fyCloseTarget) return;
    try {
      await apiClient.post(`/api/v1/accounting/fiscal-years/${fyCloseTarget.id}/close`, {
        autoOpenNextYear: fyAutoOpenNext,
        notes: fyCloseNotes || undefined,
        idempotencyKey: `fy-close-${fyCloseTarget.id}-${Date.now()}`,
      });
      setFyCloseTarget(null);
      setFyCloseNotes('');
      showToast('تم إقفال السنة المالية بنجاح وترحيل صافي النتيجة للأرباح المبقاة', 'success');
      await loadYearsAndPeriods();
    } catch (err: any) {
      showToast(err?.message || 'تعذر إقفال السنة المالية', 'error');
    }
  };

  const handleOpenNextFiscalYear = async (fy: FiscalYearRow) => {
    try {
      await apiClient.post(`/api/v1/accounting/fiscal-years/${fy.id}/open-next`, {
        generateMonthlyPeriods: true,
        idempotencyKey: `fy-open-next-${fy.id}-${Date.now()}`,
      });
      showToast('تم فتح السنة المالية التالية وترحيل الأرصدة الافتتاحية بنجاح', 'success');
      await loadYearsAndPeriods();
    } catch (err: any) {
      showToast(err?.message || 'تعذر فتح السنة المالية التالية', 'error');
    }
  };

  const handleReopenFiscalYear = async () => {
    if (!fyReopenTarget) return;
    if (fyReopenReason.trim().length < 10) {
      showToast('سبب إعادة فتح السنة المالية يجب أن لا يقل عن 10 أحرف', 'error');
      return;
    }
    try {
      await apiClient.post(`/api/v1/accounting/fiscal-years/${fyReopenTarget.id}/reopen`, {
        reason: fyReopenReason.trim(),
        idempotencyKey: `fy-reopen-${fyReopenTarget.id}-${Date.now()}`,
      });
      setFyReopenTarget(null);
      setFyReopenReason('');
      showToast('تمت إعادة فتح السنة المالية وعكس قيد الإقفال بقيد عكسي معتمد', 'success');
      await loadYearsAndPeriods();
    } catch (err: any) {
      showToast(err?.message || 'تعذر إعادة فتح السنة المالية', 'error');
    }
  };

  const handleViewOpeningBalances = async (fy: FiscalYearRow) => {
    try {
      const res = await apiClient.get<any>(`/api/v1/accounting/fiscal-years/${fy.id}/opening-balances`);
      setFyOpeningView(res.data || res);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل الأرصدة الافتتاحية', 'error');
    }
  };

  const statusBadge = (status: string) => {
    if (status === 'OPEN') {
      return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">مفتوحة (OPEN)</span>;
    }
    if (status === 'CLOSING') {
      return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">قيد الإقفال (CLOSING)</span>;
    }
    return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-800">مقفلة ({status})</span>;
  };

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Lock className="w-5 h-5 text-[#0D6E4F]" />
            إقفال الفترات المالية
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            إدارة السنوات والفترات المالية، فحوصات ما قبل الإقفال، ميزان المراجعة النهائي، وإعادة الفتح المقيدة بالصلاحيات.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedEntityId}
            onChange={(e) => {
              setSelectedEntityId(e.target.value);
              setSelectedPeriod(null);
              setPeriodsPage(1);
            }}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          >
            {entities.map((ent) => (
              <option key={ent.id} value={ent.id}>
                {ent.commercialName || ent.legalName}
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowYearModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#0D6E4F] text-white rounded-lg text-sm font-medium hover:bg-[#0A583F]"
          >
            <Plus className="w-4 h-4" />
            سنة مالية
          </button>

          <button
            onClick={() => setShowPeriodModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            فترة مالية
          </button>

          <button
            onClick={loadYearsAndPeriods}
            className="p-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
            title="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {[
          { id: 'periods', label: 'السنوات والفترات المالية', icon: Clock },
          { id: 'precheck', label: 'فحوصات ما قبل الإقفال', icon: CheckCircle2 },
          { id: 'pending', label: 'المستندات المعلقة', icon: FileText },
          { id: 'trial-balance', label: 'ميزان المراجعة النهائي', icon: Scale },
          { id: 'logs', label: 'سجل الإقفال وإعادة الفتح', icon: History },
        ].map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as ClosingTab)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#0D6E4F] text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Selected Period Banner */}
      {selectedPeriod && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-blue-800">
            <span className="font-semibold">الفترة المحددة:</span> {selectedPeriod.periodName} (
            {String(selectedPeriod.startDate).slice(0, 10)} → {String(selectedPeriod.endDate).slice(0, 10)})
          </div>
          <div className="flex items-center gap-2">{statusBadge(selectedPeriod.status)}</div>
        </div>
      )}

      {/* Tab: Periods */}
      {activeTab === 'periods' && (
        <div className="space-y-4">
          {fiscalYears.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {fiscalYears.map((fy) => (
                <div key={fy.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{fy.yearCode}</span>
                    {statusBadge(fy.status)}
                  </div>
                  <p className="text-sm text-slate-600">{fy.yearName}</p>
                  <p className="text-xs text-slate-400">
                    {String(fy.startDate).slice(0, 10)} — {String(fy.endDate).slice(0, 10)}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                    {fy.status !== 'CLOSED' ? (
                      <>
                        <button
                          onClick={() => handleFyPrecheck(fy)}
                          className="px-2 py-1 text-xs rounded bg-blue-50 text-blue-700 hover:bg-blue-100"
                        >
                          فحص السنة
                        </button>
                        <button
                          onClick={() => setFyCloseTarget(fy)}
                          className="px-2 py-1 text-xs rounded bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center gap-1"
                        >
                          <Lock className="w-3 h-3" /> إقفال السنة
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleOpenNextFiscalYear(fy)}
                          className="px-2 py-1 text-xs rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        >
                          فتح السنة التالية
                        </button>
                        <button
                          onClick={() => setFyReopenTarget(fy)}
                          className="px-2 py-1 text-xs rounded bg-amber-50 text-amber-700 hover:bg-amber-100 inline-flex items-center gap-1"
                        >
                          <Unlock className="w-3 h-3" /> إعادة فتح السنة
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleViewOpeningBalances(fy)}
                      className="px-2 py-1 text-xs rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
                    >
                      الأرصدة الافتتاحية
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">الفترة</th>
                  <th className="px-4 py-3">من</th>
                  <th className="px-4 py-3">إلى</th>
                  <th className="px-4 py-3">الحالة</th>
                  <th className="px-4 py-3">آخر فحص</th>
                  <th className="px-4 py-3">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {periods.map((p) => (
                  <tr
                    key={p.id}
                    className={`hover:bg-slate-50 cursor-pointer ${selectedPeriod?.id === p.id ? 'bg-blue-50/40' : ''}`}
                    onClick={() => setSelectedPeriod(p)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">{p.periodName}</td>
                    <td className="px-4 py-3 text-slate-600">{String(p.startDate).slice(0, 10)}</td>
                    <td className="px-4 py-3 text-slate-600">{String(p.endDate).slice(0, 10)}</td>
                    <td className="px-4 py-3">{statusBadge(p.status)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{p.lastPrecheckStatus || '—'}</td>
                    <td className="px-4 py-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleRunPrecheck(p)}
                        className="px-2.5 py-1 bg-blue-50 text-blue-800 border border-blue-200 rounded hover:bg-blue-100 text-xs font-medium"
                      >
                        فحص الإقفال
                      </button>
                      {p.status === 'OPEN' || p.status === 'CLOSING' ? (
                        <button
                          onClick={() => {
                            setCloseTarget(p);
                            setShowCloseModal(true);
                          }}
                          className="px-2.5 py-1 bg-rose-50 text-rose-700 rounded hover:bg-rose-100 text-xs font-medium inline-flex items-center gap-1"
                        >
                          <Lock className="w-3 h-3" /> إقفال
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setReopenTarget(p);
                            setShowReopenModal(true);
                          }}
                          className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded hover:bg-amber-100 text-xs font-medium inline-flex items-center gap-1"
                        >
                          <Unlock className="w-3 h-3" /> إعادة فتح
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {periods.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                      لا توجد فترات مالية لهذه المنشأة
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50 text-xs">
              <span>صفحة {periodsPage} من {periodsTotalPages}</span>
              <div className="flex gap-2">
                <button
                  disabled={periodsPage <= 1}
                  onClick={() => setPeriodsPage((p) => Math.max(1, p - 1))}
                  className="p-1.5 border rounded disabled:opacity-40 bg-white"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  disabled={periodsPage >= periodsTotalPages}
                  onClick={() => setPeriodsPage((p) => p + 1)}
                  className="p-1.5 border rounded disabled:opacity-40 bg-white"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Precheck */}
      {activeTab === 'precheck' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          {!precheck ? (
            <div className="text-center py-8 text-slate-500">
              اختر فترة مالية واضغط "فحص الإقفال" لعرض نتائج التحقق.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div className="flex items-center gap-4">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      precheck.canClose ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}
                  >
                    {precheck.canClose ? 'جاهز للإقفال (PASS)' : 'ممنوع الإقفال (BLOCKED)'}
                  </span>
                  <span className="text-sm text-slate-600">معوقات (Blockers): {precheck.blockersCount}</span>
                  <span className="text-sm text-slate-600">تحذيرات (Warnings): {precheck.warningsCount}</span>
                </div>
                {precheck.canClose && precheck.period.status !== 'CLOSED' && (
                  <button
                    onClick={() => {
                      setCloseTarget(precheck.period);
                      setShowCloseModal(true);
                    }}
                    className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium hover:bg-rose-700 inline-flex items-center gap-1.5"
                  >
                    <Lock className="w-4 h-4" /> تنفيذ الإقفال الآن
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {precheck.checks.map((c) => (
                  <div
                    key={c.code}
                    className={`p-4 rounded-lg border flex items-start justify-between gap-4 ${
                      c.status === 'FAIL'
                        ? 'bg-rose-50 border-rose-200'
                        : c.status === 'WARN'
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-emerald-50 border-emerald-200'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {c.status === 'FAIL' ? (
                        <XCircle className="w-5 h-5 text-rose-600 mt-0.5" />
                      ) : c.status === 'WARN' ? (
                        <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                      )}
                      <div>
                        <div className="font-semibold text-slate-900">{c.title}</div>
                        <div className="text-sm text-slate-700 mt-0.5">{c.message}</div>
                      </div>
                    </div>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-white/80 border border-slate-200">
                      {c.severity} ({c.count})
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab: Pending Items */}
      {activeTab === 'pending' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900">تقرير المستندات المعلقة</h3>
            <select
              value={pendingType}
              onChange={(e) => {
                setPendingType(e.target.value);
                setPendingPage(1);
              }}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
            >
              <option value="">الكل</option>
              <option value="UNPOSTED_JOURNAL">قيود غير مرحلة</option>
              <option value="OPEN_POS_SHIFT">ورديات مفتوحة</option>
              <option value="PENDING_SETTLEMENT_BATCH">دفعات تسوية معلقة</option>
              <option value="OPEN_STOCK_TRANSFER">تحويلات مخزنية مفتوحة</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-2">النوع</th>
                  <th className="px-3 py-2">المرجع</th>
                  <th className="px-3 py-2">التاريخ</th>
                  <th className="px-3 py-2">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pendingItems.map((it) => (
                  <tr key={`${it.item_type}-${it.id}`}>
                    <td className="px-3 py-2 font-medium">{it.item_type}</td>
                    <td className="px-3 py-2">{it.reference_number}</td>
                    <td className="px-3 py-2 text-slate-500">{String(it.item_date || '').slice(0, 10)}</td>
                    <td className="px-3 py-2">{it.status}</td>
                  </tr>
                ))}
                {pendingItems.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                      لا توجد مستندات معلقة
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs pt-2">
            <span>صفحة {pendingPage} من {pendingTotalPages}</span>
            <div className="flex gap-2">
              <button disabled={pendingPage <= 1} onClick={() => setPendingPage((p) => p - 1)} className="px-2 py-1 border rounded disabled:opacity-40">السابق</button>
              <button disabled={pendingPage >= pendingTotalPages} onClick={() => setPendingPage((p) => p + 1)} className="px-2 py-1 border rounded disabled:opacity-40">التالي</button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Final Trial Balance */}
      {activeTab === 'trial-balance' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          {!trialBalanceData ? (
            <div className="text-center py-8 text-slate-400">اختر فترة مالية لعرض ميزان المراجعة النهائي</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                <div className="text-sm">
                  <span className="font-semibold">المصدر:</span>{' '}
                  {trialBalanceData.source === 'CLOSING_SNAPSHOT' ? 'لقطة إقفال محفوظة (Snapshot)' : 'بيانات حية (Live)'}
                </div>
                <div className="text-sm font-medium text-slate-700">
                  حالة التوازن: {trialBalanceData.trialBalance?.grandTotals?.isBalanced ? 'متوازن ✓' : 'غير متوازن ✗'}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-3 py-2">الرمز</th>
                      <th className="px-3 py-2">الحساب</th>
                      <th className="px-3 py-2">مدين ختامي</th>
                      <th className="px-3 py-2">دائن ختامي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(trialBalanceData.trialBalance?.nodes || trialBalanceData.trialBalance?.accounts || []).map((acc: any) => (
                      <tr key={acc.accountId}>
                        <td className="px-3 py-2 font-mono">{acc.accountCode}</td>
                        <td className="px-3 py-2">{acc.name}</td>
                        <td className="px-3 py-2 font-mono">{Number(acc.closingDebit || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 font-mono">{Number(acc.closingCredit || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab: Logs */}
      {activeTab === 'logs' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-2">الإجراء</th>
                  <th className="px-3 py-2">الحالة السابقة → الجديدة</th>
                  <th className="px-3 py-2">السبب / الملاحظات</th>
                  <th className="px-3 py-2">التاريخ</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {closingLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-3 py-2 font-semibold">{log.action}</td>
                    <td className="px-3 py-2">{log.previousStatus} → {log.newStatus}</td>
                    <td className="px-3 py-2">{log.reason || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{String(log.createdAt).slice(0, 19).replace('T', ' ')}</td>
                  </tr>
                ))}
                {closingLogs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">لا توجد سجلات إقفال بعد</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs pt-2">
            <span>صفحة {logsPage} من {logsTotalPages}</span>
            <div className="flex gap-2">
              <button disabled={logsPage <= 1} onClick={() => setLogsPage((p) => p - 1)} className="px-2 py-1 border rounded disabled:opacity-40">السابق</button>
              <button disabled={logsPage >= logsTotalPages} onClick={() => setLogsPage((p) => p + 1)} className="px-2 py-1 border rounded disabled:opacity-40">التالي</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Fiscal Year */}
      {showYearModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleCreateFiscalYear} className="bg-white rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">إنشاء سنة مالية</h3>
              <button type="button" onClick={() => setShowYearModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <input value={yearCode} onChange={(e) => setYearCode(e.target.value)} placeholder="الرمز (FY2026)" className="w-full border rounded-lg px-3 py-2 text-sm" required />
            <input value={yearName} onChange={(e) => setYearName(e.target.value)} placeholder="الاسم" className="w-full border rounded-lg px-3 py-2 text-sm" required />
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={yearStart} onChange={(e) => setYearStart(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" required />
              <input type="date" value={yearEnd} onChange={(e) => setYearEnd(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" required />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={generateMonthly} onChange={(e) => setGenerateMonthly(e.target.checked)} />
              توليد 12 فترة شهرية تلقائياً
            </label>
            <button type="submit" className="w-full py-2 bg-[#0D6E4F] hover:bg-[#0A583F] text-white rounded-lg text-sm font-medium">حفظ السنة المالية</button>
          </form>
        </div>
      )}

      {/* Modal: Create Fiscal Period */}
      {showPeriodModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleCreatePeriod} className="bg-white rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">إنشاء فترة مالية</h3>
              <button type="button" onClick={() => setShowPeriodModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <select value={periodFyId} onChange={(e) => setPeriodFyId(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">بدون ربط بسنة مالية</option>
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.id}>{fy.yearCode} — {fy.yearName}</option>
              ))}
            </select>
            <input value={periodName} onChange={(e) => setPeriodName(e.target.value)} placeholder="اسم الفترة (2026-P01)" className="w-full border rounded-lg px-3 py-2 text-sm" required />
            <div className="grid grid-cols-2 gap-3">
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" required />
              <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" required />
            </div>
            <button type="submit" className="w-full py-2 bg-[#0D6E4F] hover:bg-[#0A583F] text-white rounded-lg text-sm font-medium">إنشاء الفترة</button>
          </form>
        </div>
      )}

      {/* Modal: Close Period */}
      {showCloseModal && closeTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-lg text-rose-700">تأكيد إقفال الفترة: {closeTarget.periodName}</h3>
            <p className="text-sm text-slate-600">سيتم منع أي قيود أو تعديلات مالية داخل هذه الفترة بعد الإقفال.</p>
            <textarea
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
              placeholder="ملاحظات الإقفال (اختياري)"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCloseModal(false)} className="px-4 py-2 border rounded-lg text-sm">إلغاء</button>
              <button onClick={handleClosePeriod} className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium">إقفال نهائي</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reopen Period */}
      {showReopenModal && reopenTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-lg text-amber-700">إعادة فتح الفترة: {reopenTarget.periodName}</h3>
            <p className="text-sm text-slate-600">يتطلب صلاحية مستقلة (accounting.period.reopen) وإدخال سبب إلزامي.</p>
            <textarea
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="سبب إعادة الفتح (إلزامي، 5 أحرف على الأقل)"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              rows={3}
              required
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowReopenModal(false)} className="px-4 py-2 border rounded-lg text-sm">إلغاء</button>
              <button onClick={handleReopenPeriod} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium">تأكيد إعادة الفتح</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Fiscal Year Pre-Check */}
      {fyPrecheckResult && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">فحص جاهزية إقفال السنة: {fyPrecheckResult.fy.yearCode}</h3>
              <button onClick={() => setFyPrecheckResult(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-2">
              {(fyPrecheckResult.checks || []).map((c: any) => (
                <div key={c.code} className="p-3 rounded-lg border border-slate-200 flex items-start justify-between gap-2 text-sm">
                  <div>
                    <div className="font-semibold text-slate-800">{c.title}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{c.message}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${c.severity === 'PASS' ? 'bg-emerald-100 text-emerald-700' : c.severity === 'WARNING' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                    {c.severity}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Close Fiscal Year */}
      {fyCloseTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-lg text-rose-700">تأكيد إقفال السنة المالية: {fyCloseTarget.yearCode}</h3>
            <p className="text-sm text-slate-600">
              سيتم تصفير حسابات الإيرادات والمصروفات وترحيل صافي الربح/الخسارة إلى الأرباح المبقاة (Retained Earnings)، وقفل جميع الفترات الـ 12 نهائياً.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fyAutoOpenNext} onChange={(e) => setFyAutoOpenNext(e.target.checked)} />
              فتح السنة المالية التالية وتوثيق الأرصدة الافتتاحية تلقائياً
            </label>
            <textarea
              value={fyCloseNotes}
              onChange={(e) => setFyCloseNotes(e.target.value)}
              placeholder="ملاحظات الإقفال السنوي (اختياري)"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setFyCloseTarget(null)} className="px-4 py-2 border rounded-lg text-sm">إلغاء</button>
              <button onClick={handleCloseFiscalYear} className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium">إقفال السنة نهائياً</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reopen Fiscal Year */}
      {fyReopenTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-lg text-amber-700">إعادة فتح السنة المالية: {fyReopenTarget.yearCode}</h3>
            <p className="text-sm text-slate-600">
              يتطلب صلاحية مستقلة (accounting.fiscal_year.reopen)؛ سيتم إنشاء قيد عكسي (REVERSAL) لقيد الإقفال دون تعديل القيود التاريخية.
            </p>
            <textarea
              value={fyReopenReason}
              onChange={(e) => setFyReopenReason(e.target.value)}
              placeholder="سبب إعادة الفتح (إلزامي، 10 أحرف على الأقل)"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              rows={3}
              required
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setFyReopenTarget(null)} className="px-4 py-2 border rounded-lg text-sm">إلغاء</button>
              <button onClick={handleReopenFiscalYear} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium">تأكيد إعادة الفتح</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Fiscal Year Opening Balances */}
      {fyOpeningView && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">الأرصدة الافتتاحية — {fyOpeningView.fiscalYear?.yearCode}</h3>
              <button onClick={() => setFyOpeningView(null)}><X className="w-5 h-5" /></button>
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="px-2.5 py-1 rounded bg-slate-100">إجمالي المدين: <b>{fyOpeningView.totals?.totalDebit}</b></span>
              <span className="px-2.5 py-1 rounded bg-slate-100">إجمالي الدائن: <b>{fyOpeningView.totals?.totalCredit}</b></span>
              <span className={`px-2.5 py-1 rounded font-bold ${fyOpeningView.totals?.isBalanced ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                {fyOpeningView.totals?.isBalanced ? 'متوازن 100%' : 'غير متوازن'}
              </span>
            </div>
            <table className="w-full text-xs text-right border-t border-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2">رمز الحساب</th>
                  <th className="p-2">اسم الحساب</th>
                  <th className="p-2">النوع</th>
                  <th className="p-2">مدين افتتاحي</th>
                  <th className="p-2">دائن افتتاحي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(fyOpeningView.balances || []).map((b: any) => (
                  <tr key={b.id}>
                    <td className="p-2 font-mono">{b.accountCode}</td>
                    <td className="p-2">{b.accountName}</td>
                    <td className="p-2">{b.accountType}</td>
                    <td className="p-2 font-mono">{b.openingDebit}</td>
                    <td className="p-2 font-mono">{b.openingCredit}</td>
                  </tr>
                ))}
                {(fyOpeningView.balances || []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">لا توجد أرصدة افتتاحية مرحّلة لهذه السنة بعد</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
