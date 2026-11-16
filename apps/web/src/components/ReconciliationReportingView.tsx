import React, { useState, useEffect, useCallback } from 'react';
import {
  Scale,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  Search,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Play,
  Eye,
  X,
  Building2,
  Download,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useToast } from '../context/ToastContext';
import { exportToCsv } from '../utils/export';

type ReportTab =
  | 'dashboard'
  | 'trial-balance'
  | 'general-ledger'
  | 'account-statement'
  | 'inventory-recon'
  | 'vault-bank-recon'
  | 'ar-ap-recon'
  | 'gateway-aggregator-recon'
  | 'interbranch-intercompany-recon'
  | 'discrepancies';

interface LegalEntityOption {
  id: string;
  legalName: string;
  commercialName?: string;
}

interface BranchOption {
  id: string;
  legalEntityId: string;
  code: string;
  name: string;
}

interface TrialBalanceNode {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: string;
  normalBalance: string;
  level: number;
  isPostable: boolean;
  openingDebit: string;
  openingCredit: string;
  openingNormalBalance: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
  closingNormalBalance: string;
  children: TrialBalanceNode[];
}

const fmt = (val: string | number | undefined | null) =>
  parseFloat(String(val ?? 0)).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });

export const ReconciliationReportingView: React.FC = () => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<ReportTab>('dashboard');
  const [entities, setEntities] = useState<LegalEntityOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [legalEntityId, setLegalEntityId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Dashboard & Reconciliation items
  const [liveRecon, setLiveRecon] = useState<any>(null);
  const [reconRuns, setReconRuns] = useState<any[]>([]);

  // Hierarchical Trial Balance
  const [tbData, setTbData] = useState<any>(null);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  // General Ledger
  const [glRows, setGlRows] = useState<any[]>([]);
  const [glTotal, setGlTotal] = useState<number>(0);
  const [glPage, setGlPage] = useState<number>(1);
  const [glTotals, setGlTotals] = useState<{ debit: string; credit: string }>({ debit: '0', credit: '0' });

  // Account Statement
  const [coaList, setCoaList] = useState<any[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [statementData, setStatementData] = useState<any>(null);
  const [stmtPage, setStmtPage] = useState<number>(1);

  // Discrepancies
  const [discRows, setDiscRows] = useState<any[]>([]);
  const [discTotal, setDiscTotal] = useState<number>(0);
  const [discPage, setDiscPage] = useState<number>(1);

  // Drill-down modal
  const [drillDownData, setDrillDownData] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<any>('/legal-entities');
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setEntities(list);
        if (list.length > 0 && !legalEntityId) {
          setLegalEntityId(list[0].id);
        }
        const brRes = await apiClient.get<any>('/branches');
        setBranches(Array.isArray(brRes) ? brRes : (brRes?.data ?? []));
      } catch {
        // Fallback if tenant endpoints differ
      }
    })();
  }, []);

  useEffect(() => {
    if (!legalEntityId) return;
    (async () => {
      try {
        const res = await apiClient.get<any>(`/api/v1/accounting/accounts?legalEntityId=${legalEntityId}`);
        const list = Array.isArray(res) ? res : (res?.data ?? []);
        setCoaList(list);
        if (list.length > 0 && !selectedAccountId) {
          setSelectedAccountId(list[0].id);
        }
      } catch {
        setCoaList([]);
      }
    })();
  }, [legalEntityId]);

  const fetchTabData = useCallback(async () => {
    if (!legalEntityId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ legalEntityId });
      if (branchId) qs.set('branchId', branchId);
      if (startDate) qs.set('startDate', startDate);
      if (endDate) qs.set('endDate', endDate);
      if (search.trim()) qs.set('search', search.trim());

      if (
        activeTab === 'dashboard' ||
        activeTab === 'inventory-recon' ||
        activeTab === 'vault-bank-recon' ||
        activeTab === 'ar-ap-recon' ||
        activeTab === 'gateway-aggregator-recon' ||
        activeTab === 'interbranch-intercompany-recon'
      ) {
        const [liveRes, runsRes] = await Promise.all([
          apiClient.get<any>(`/api/v1/accounting/reconciliation/live?${qs.toString()}`),
          apiClient.get<any>(`/api/v1/accounting/reconciliation/runs?legalEntityId=${legalEntityId}&limit=10`),
        ]);
        setLiveRecon(liveRes);
        setReconRuns(runsRes?.data ?? (Array.isArray(runsRes) ? runsRes : []));
      } else if (activeTab === 'trial-balance') {
        const data = await apiClient.get<any>(`/api/v1/accounting/reports/trial-balance-hierarchy?${qs.toString()}`);
        setTbData(data);
        const autoExpand: Record<string, boolean> = {};
        (data?.tree ?? []).forEach((n: TrialBalanceNode) => {
          autoExpand[n.accountId] = true;
        });
        setExpandedNodes((prev) => ({ ...autoExpand, ...prev }));
      } else if (activeTab === 'general-ledger') {
        qs.set('page', String(glPage));
        qs.set('limit', '25');
        const d = await apiClient.get<any>(`/api/v1/accounting/reports/general-ledger?${qs.toString()}`);
        setGlRows(d?.data ?? []);
        setGlTotal(d?.total ?? 0);
        setGlTotals(d?.totals ?? { debit: '0', credit: '0' });
      } else if (activeTab === 'account-statement' && selectedAccountId) {
        qs.set('accountId', selectedAccountId);
        qs.set('page', String(stmtPage));
        qs.set('limit', '50');
        const d = await apiClient.get<any>(`/api/v1/accounting/reports/account-statement?${qs.toString()}`);
        setStatementData(d);
      } else if (activeTab === 'discrepancies') {
        qs.set('page', String(discPage));
        qs.set('limit', '25');
        const d = await apiClient.get<any>(`/api/v1/accounting/reconciliation/discrepancies?${qs.toString()}`);
        setDiscRows(d?.data ?? []);
        setDiscTotal(d?.total ?? 0);
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل بيانات التقرير', 'error');
    } finally {
      setLoading(false);
    }
  }, [legalEntityId, branchId, startDate, endDate, search, activeTab, glPage, stmtPage, discPage, selectedAccountId, showToast]);

  useEffect(() => {
    fetchTabData();
  }, [fetchTabData]);

  const handleRunSnapshot = async () => {
    if (!legalEntityId) return;
    setLoading(true);
    try {
      await apiClient.post('/api/v1/accounting/reconciliation/runs', {
        legalEntityId,
        branchId: branchId || undefined,
        idempotencyKey: `recon-ui-${legalEntityId}-${Date.now()}`,
      });
      showToast('تم حفظ لقطة المصالحة المالية بنجاح', 'success');
      fetchTabData();
    } catch (err: any) {
      showToast(err?.message || 'فشل تشغيل المصالحة', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openDrillDown = async (journalEntryId: string) => {
    try {
      const data = await apiClient.get<any>(`/api/v1/accounting/reports/drill-down/${journalEntryId}`);
      setDrillDownData(data);
    } catch (err: any) {
      showToast(err?.message || 'تعذر فتح تفاصيل القيد', 'error');
    }
  };

  const filterReconItems = (categories?: string[]) => {
    const items = liveRecon?.items ?? [];
    return items.filter((item: any) => {
      if (categories && !categories.includes(item.category)) return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        return (
          (item.entityName ?? '').toLowerCase().includes(s) ||
          (item.accountCode ?? '').toLowerCase().includes(s) ||
          (item.varianceSource ?? '').toLowerCase().includes(s)
        );
      }
      return true;
    });
  };

  const renderTbRows = (nodes: TrialBalanceNode[], depth = 0): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    for (const node of nodes) {
      const hasChildren = node.children && node.children.length > 0;
      const isExpanded = !!expandedNodes[node.accountId];
      out.push(
        <tr
          key={node.accountId}
          className={`border-b border-slate-100 hover:bg-slate-50 ${!node.isPostable ? 'bg-slate-50/70 font-semibold' : ''}`}
        >
          <td className="py-2.5 px-3 text-right">
            <div className="flex items-center gap-1.5" style={{ paddingRight: `${depth * 18}px` }}>
              {hasChildren ? (
                <button
                  onClick={() => setExpandedNodes((p) => ({ ...p, [node.accountId]: !isExpanded }))}
                  className="p-0.5 rounded hover:bg-slate-200 text-slate-600"
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>
              ) : (
                <span className="w-5 inline-block" />
              )}
              <span className="font-mono text-xs text-indigo-700">{node.accountCode}</span>
              <span className="text-slate-800">{node.name}</span>
            </div>
          </td>
          <td className="py-2.5 px-3 text-xs text-slate-500">{node.normalBalance}</td>
          <td className="py-2.5 px-3 font-mono text-xs text-left">{fmt(node.openingNormalBalance)}</td>
          <td className="py-2.5 px-3 font-mono text-xs text-left text-emerald-700">{fmt(node.periodDebit)}</td>
          <td className="py-2.5 px-3 font-mono text-xs text-left text-rose-700">{fmt(node.periodCredit)}</td>
          <td className="py-2.5 px-3 font-mono text-xs text-left">{fmt(node.closingDebit)}</td>
          <td className="py-2.5 px-3 font-mono text-xs text-left">{fmt(node.closingCredit)}</td>
          <td className="py-2.5 px-3 font-mono text-xs font-semibold text-left">{fmt(node.closingNormalBalance)}</td>
          <td className="py-2.5 px-3 text-center">
            {node.isPostable && (
              <button
                onClick={() => {
                  setSelectedAccountId(node.accountId);
                  setActiveTab('account-statement');
                }}
                className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"
              >
                <Eye className="w-3.5 h-3.5" /> كشف
              </button>
            )}
          </td>
        </tr>
      );
      if (hasChildren && isExpanded) {
        out.push(...renderTbRows(node.children, depth + 1));
      }
    }
    return out;
  };

  const renderReconTable = (items: any[]) => (
    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table className="w-full text-sm text-right">
        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-xs">
          <tr>
            <th className="py-3 px-4">البند / الحساب</th>
            <th className="py-3 px-4">الحساب المحاسبي</th>
            <th className="py-3 px-4 text-left">الرصيد التشغيلي</th>
            <th className="py-3 px-4 text-left">رصيد GL</th>
            <th className="py-3 px-4 text-left">الفرق</th>
            <th className="py-3 px-4">الحالة</th>
            <th className="py-3 px-4">مصدر الفرق والمرجع</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-8 text-center text-slate-400">
                لا توجد بنود مطابقة للتصفية الحالية
              </td>
            </tr>
          ) : (
            items.map((item, idx) => (
              <tr key={`${item.category}-${item.entityId}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-3 px-4 font-medium text-slate-800">{item.entityName}</td>
                <td className="py-3 px-4 font-mono text-xs text-slate-600">
                  {item.accountCode ? `${item.accountCode} - ${item.accountName}` : 'غير مربوط'}
                </td>
                <td className="py-3 px-4 font-mono text-left">{fmt(item.operationalBalance)}</td>
                <td className="py-3 px-4 font-mono text-left">{fmt(item.glBalance)}</td>
                <td
                  className={`py-3 px-4 font-mono font-semibold text-left ${
                    Math.abs(parseFloat(item.variance)) > 0.005 ? 'text-rose-600' : 'text-emerald-600'
                  }`}
                >
                  {fmt(item.variance)}
                </td>
                <td className="py-3 px-4">
                  {item.status === 'MATCHED' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" /> متطابق
                    </span>
                  ) : item.status === 'DISCREPANCY' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-rose-50 text-rose-700">
                      <AlertTriangle className="w-3.5 h-3.5" /> فرق
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-700">
                      غير مهيأ
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-xs text-slate-600 max-w-md">{item.varianceSource || '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const tabs: Array<{ id: ReportTab; label: string }> = [
    { id: 'dashboard', label: 'لوحة المصالحات' },
    { id: 'trial-balance', label: 'ميزان المراجعة الهرمي' },
    { id: 'general-ledger', label: 'الأستاذ العام (GL)' },
    { id: 'account-statement', label: 'كشف حساب' },
    { id: 'inventory-recon', label: 'مصالحة المخزون' },
    { id: 'vault-bank-recon', label: 'الخزائن والبنوك' },
    { id: 'ar-ap-recon', label: 'العملاء والموردين' },
    { id: 'gateway-aggregator-recon', label: 'البوابات والتوصيل' },
    { id: 'interbranch-intercompany-recon', label: 'الفروع والشركات' },
    { id: 'discrepancies', label: 'الفروقات المفتوحة' },
  ];

  const filteredBranches = branches.filter((b) => !legalEntityId || b.legalEntityId === legalEntityId);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Scale className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">المصالحات والتقارير المالية</h1>
            <p className="text-xs text-slate-500">محرك المطابقة الموحد، ميزان المراجعة الهرمي، وكشوفات الأستاذ العام</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchTabData}
            disabled={loading}
            className="px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> تحديث
          </button>
          <button
            onClick={handleRunSnapshot}
            disabled={loading || !legalEntityId}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-medium inline-flex items-center gap-1.5"
          >
            <Play className="w-4 h-4" /> حفظ لقطة مصالحة
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-white p-4 rounded-xl border border-slate-200">
        <div>
          <label className="block text-xs text-slate-500 mb-1">الشركة القانونية</label>
          <select
            value={legalEntityId}
            onChange={(e) => {
              setLegalEntityId(e.target.value);
              setBranchId('');
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
          >
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.commercialName || e.legalName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">الفرع</label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
          >
            <option value="">كل الفروع</option>
            {filteredBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} - {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">من تاريخ</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">إلى تاريخ</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">بحث</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="رقم قيد، حساب، بيان..."
              className="w-full rounded-lg border border-slate-200 pr-9 pl-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-1.5 bg-white p-2 rounded-xl border border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === t.id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Dashboard */}
      {activeTab === 'dashboard' && liveRecon && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <div className="text-xs text-slate-500">إجمالي الفحوصات</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{liveRecon.summary?.totalChecks ?? 0}</div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-emerald-200">
              <div className="text-xs text-emerald-600">بنود متطابقة</div>
              <div className="text-2xl font-bold text-emerald-700 mt-1">{liveRecon.summary?.matchedCount ?? 0}</div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-rose-200">
              <div className="text-xs text-rose-600">فروقات مكتشفة</div>
              <div className="text-2xl font-bold text-rose-700 mt-1">{liveRecon.summary?.discrepancyCount ?? 0}</div>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <div className="text-xs text-slate-500">إجمالي قيمة الفروقات</div>
              <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{fmt(liveRecon.summary?.totalVariance)}</div>
            </div>
          </div>
          {renderReconTable(filterReconItems())}
          {reconRuns.length > 0 && (
            <div className="bg-white p-4 rounded-xl border border-slate-200">
              <h3 className="text-sm font-bold text-slate-800 mb-3">آخر لقطات المصالحة المحفوظة</h3>
              <div className="space-y-2 text-xs">
                {reconRuns.map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="font-mono font-semibold text-indigo-700">{r.runNumber}</span>
                    <span>الفحوصات: {r.totalChecks} | المتطابق: {r.matchedCount} | الفروقات: {r.discrepancyCount}</span>
                    <span className="font-mono">{fmt(r.totalVariance)}</span>
                    <span className="text-slate-400">{new Date(r.createdAt).toLocaleString('ar-SA')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'inventory-recon' && renderReconTable(filterReconItems(['INVENTORY', 'INVENTORY_IN_TRANSIT']))}
      {activeTab === 'vault-bank-recon' && renderReconTable(filterReconItems(['CASH_VAULTS', 'BANK_ACCOUNTS']))}
      {activeTab === 'ar-ap-recon' && renderReconTable(filterReconItems(['AR_CUSTOMERS', 'AP_SUPPLIERS']))}
      {activeTab === 'gateway-aggregator-recon' &&
        renderReconTable(filterReconItems(['PAYMENT_GATEWAYS', 'DELIVERY_AGGREGATORS', 'CLEARING_ACCOUNTS']))}
      {activeTab === 'interbranch-intercompany-recon' &&
        renderReconTable(filterReconItems(['INTER_BRANCH_TRANSFERS', 'INTERCOMPANY_AFFILIATES']))}

      {/* Hierarchical Trial Balance */}
      {activeTab === 'trial-balance' && tbData && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-xs">
                <tr>
                  <th className="py-3 px-3">الحساب</th>
                  <th className="py-3 px-3">الطبيعة</th>
                  <th className="py-3 px-3 text-left">أول المدة</th>
                  <th className="py-3 px-3 text-left">مدين الفترة</th>
                  <th className="py-3 px-3 text-left">دائن الفترة</th>
                  <th className="py-3 px-3 text-left">ختامي مدين</th>
                  <th className="py-3 px-3 text-left">ختامي دائن</th>
                  <th className="py-3 px-3 text-left">الرصيد الطبيعي</th>
                  <th className="py-3 px-3 text-center">إجراء</th>
                </tr>
              </thead>
              <tbody>{renderTbRows(tbData.tree ?? [])}</tbody>
              <tfoot className="bg-slate-100 font-bold text-xs border-t-2 border-slate-300">
                <tr>
                  <td colSpan={3} className="py-3 px-3">
                    الإجمالي العام {tbData.grandTotals?.isBalanced ? '✓ متوازن' : '✗ غير متوازن'}
                  </td>
                  <td className="py-3 px-3 font-mono text-left">{fmt(tbData.grandTotals?.periodDebit)}</td>
                  <td className="py-3 px-3 font-mono text-left">{fmt(tbData.grandTotals?.periodCredit)}</td>
                  <td className="py-3 px-3 font-mono text-left">{fmt(tbData.grandTotals?.closingDebit)}</td>
                  <td className="py-3 px-3 font-mono text-left">{fmt(tbData.grandTotals?.closingCredit)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* General Ledger */}
      {activeTab === 'general-ledger' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <div className="p-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">دفتر الأستاذ العام (General Ledger)</span>
            <button
              type="button"
              disabled={glRows.length === 0}
              onClick={() =>
                exportToCsv(
                  `general-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
                  glRows.map((r) => ({
                    journalNumber: r.journalNumber,
                    entryDate: new Date(r.entryDate).toLocaleDateString('en-CA'),
                    account: `${r.accountCode} - ${r.accountName}`,
                    description: r.description,
                    debit: Number(r.debit ?? 0).toFixed(2),
                    credit: Number(r.credit ?? 0).toFixed(2),
                  })),
                  [
                    { key: 'journalNumber', header: 'رقم القيد' },
                    { key: 'entryDate', header: 'التاريخ' },
                    { key: 'account', header: 'الحساب' },
                    { key: 'description', header: 'البيان' },
                    { key: 'debit', header: 'مدين' },
                    { key: 'credit', header: 'دائن' },
                  ]
                )
              }
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير CSV</span>
            </button>
          </div>
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-xs">
              <tr>
                <th className="py-3 px-3">رقم القيد</th>
                <th className="py-3 px-3">التاريخ</th>
                <th className="py-3 px-3">الحساب</th>
                <th className="py-3 px-3">البيان</th>
                <th className="py-3 px-3 text-left">مدين</th>
                <th className="py-3 px-3 text-left">دائن</th>
                <th className="py-3 px-3 text-center">المصدر</th>
              </tr>
            </thead>
            <tbody>
              {glRows.map((r) => (
                <tr key={r.lineId} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2.5 px-3 font-mono text-xs text-indigo-700">{r.journalNumber}</td>
                  <td className="py-2.5 px-3 text-xs text-slate-500">{new Date(r.entryDate).toLocaleDateString('en-CA')}</td>
                  <td className="py-2.5 px-3 text-xs">{r.accountCode} - {r.accountName}</td>
                  <td className="py-2.5 px-3 text-xs text-slate-700">{r.description}</td>
                  <td className="py-2.5 px-3 font-mono text-xs text-left text-emerald-700">{fmt(r.debit)}</td>
                  <td className="py-2.5 px-3 font-mono text-xs text-left text-rose-700">{fmt(r.credit)}</td>
                  <td className="py-2.5 px-3 text-center">
                    <button onClick={() => openDrillDown(r.journalEntryId)} className="text-xs text-indigo-600 hover:underline">
                      تتبع القيد
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-3 flex items-center justify-between text-xs text-slate-600 border-t border-slate-200">
            <span>إجمالي الحركات: {glTotal} | مدين: {fmt(glTotals.debit)} | دائن: {fmt(glTotals.credit)}</span>
            <div className="flex gap-2">
              <button disabled={glPage <= 1} onClick={() => setGlPage((p) => p - 1)} className="px-2.5 py-1 border rounded disabled:opacity-40">
                السابق
              </button>
              <span>صفحة {glPage}</span>
              <button disabled={glPage * 25 >= glTotal} onClick={() => setGlPage((p) => p + 1)} className="px-2.5 py-1 border rounded disabled:opacity-40">
                التالي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account Statement */}
      {activeTab === 'account-statement' && (
        <div className="space-y-3">
          <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-wrap items-center gap-4">
            <div className="min-w-[260px]">
              <label className="block text-xs text-slate-500 mb-1">اختر الحساب</label>
              <select
                value={selectedAccountId}
                onChange={(e) => {
                  setSelectedAccountId(e.target.value);
                  setStmtPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white"
              >
                {coaList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.accountCode} - {c.nameAr || c.name}
                  </option>
                ))}
              </select>
            </div>
            {statementData && (
              <div className="flex flex-wrap items-center gap-6 text-xs">
                <div>أول المدة: <span className="font-mono font-bold">{fmt(statementData.openingBalance)}</span></div>
                <div>مدين الفترة: <span className="font-mono font-bold text-emerald-700">{fmt(statementData.periodDebit)}</span></div>
                <div>دائن الفترة: <span className="font-mono font-bold text-rose-700">{fmt(statementData.periodCredit)}</span></div>
                <div>الرصيد الختامي: <span className="font-mono font-bold text-indigo-700">{fmt(statementData.closingBalance)}</span></div>
                <button
                  type="button"
                  disabled={!statementData.data?.length}
                  onClick={() =>
                    exportToCsv(
                      `account-statement-${new Date().toISOString().slice(0, 10)}.csv`,
                      (statementData.data ?? []).map((r: any) => ({
                        journalNumber: r.journalNumber,
                        entryDate: new Date(r.entryDate).toLocaleDateString('en-CA'),
                        description: r.description,
                        debit: Number(r.debit ?? 0).toFixed(2),
                        credit: Number(r.credit ?? 0).toFixed(2),
                        runningBalance: Number(r.runningBalance ?? 0).toFixed(2),
                      })),
                      [
                        { key: 'journalNumber', header: 'رقم القيد' },
                        { key: 'entryDate', header: 'التاريخ' },
                        { key: 'description', header: 'البيان' },
                        { key: 'debit', header: 'مدين' },
                        { key: 'credit', header: 'دائن' },
                        { key: 'runningBalance', header: 'الرصيد المتحرك' },
                      ]
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تصدير CSV</span>
                </button>
              </div>
            )}
          </div>
          {statementData && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-xs">
                  <tr>
                    <th className="py-3 px-3">رقم القيد</th>
                    <th className="py-3 px-3">التاريخ</th>
                    <th className="py-3 px-3">البيان</th>
                    <th className="py-3 px-3 text-left">مدين</th>
                    <th className="py-3 px-3 text-left">دائن</th>
                    <th className="py-3 px-3 text-left">الرصيد المتحرك</th>
                    <th className="py-3 px-3 text-center">تتبع</th>
                  </tr>
                </thead>
                <tbody>
                  {(statementData.data ?? []).map((r: any) => (
                    <tr key={r.lineId} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono text-xs text-indigo-700">{r.journalNumber}</td>
                      <td className="py-2.5 px-3 text-xs text-slate-500">{new Date(r.entryDate).toLocaleDateString('en-CA')}</td>
                      <td className="py-2.5 px-3 text-xs">{r.description}</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-left text-emerald-700">{fmt(r.debit)}</td>
                      <td className="py-2.5 px-3 font-mono text-xs text-left text-rose-700">{fmt(r.credit)}</td>
                      <td className="py-2.5 px-3 font-mono text-xs font-semibold text-left">{fmt(r.runningBalance)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <button onClick={() => openDrillDown(r.journalEntryId)} className="text-xs text-indigo-600 hover:underline">
                          تفاصيل
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Unresolved Discrepancies */}
      {activeTab === 'discrepancies' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <div className="p-3 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">الفروقات غير المحسومة (Discrepancies)</span>
            <button
              type="button"
              disabled={discRows.length === 0}
              onClick={() =>
                exportToCsv(
                  `reconciliation-discrepancies-${new Date().toISOString().slice(0, 10)}.csv`,
                  discRows.map((d) => ({
                    sourceDomain: d.source_domain,
                    discrepancyType: d.discrepancy_type,
                    referenceNumber: d.reference_number,
                    amount: Number(d.amount ?? 0).toFixed(2),
                    status: d.status,
                    description: d.description,
                  })),
                  [
                    { key: 'sourceDomain', header: 'المجال' },
                    { key: 'discrepancyType', header: 'نوع الفرق' },
                    { key: 'referenceNumber', header: 'المرجع' },
                    { key: 'amount', header: 'القيمة' },
                    { key: 'status', header: 'الحالة' },
                    { key: 'description', header: 'الوصف' },
                  ]
                )
              }
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير CSV</span>
            </button>
          </div>
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-xs">
              <tr>
                <th className="py-3 px-4">المجال</th>
                <th className="py-3 px-4">نوع الفرق</th>
                <th className="py-3 px-4">المرجع</th>
                <th className="py-3 px-4 text-left">القيمة</th>
                <th className="py-3 px-4">الحالة</th>
                <th className="py-3 px-4">الوصف</th>
              </tr>
            </thead>
            <tbody>
              {discRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    لا توجد فروقات غير محسومة
                  </td>
                </tr>
              ) : (
                discRows.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100">
                    <td className="py-2.5 px-4 text-xs font-medium">{d.source_domain}</td>
                    <td className="py-2.5 px-4 text-xs">{d.discrepancy_type}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-indigo-700">{d.reference_number}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-left text-rose-700">{fmt(d.amount)}</td>
                    <td className="py-2.5 px-4 text-xs">{d.status}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">{d.description}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="p-3 flex items-center justify-between text-xs text-slate-600 border-t border-slate-200">
            <span>إجمالي الفروقات المفتوحة: {discTotal}</span>
            <div className="flex gap-2">
              <button disabled={discPage <= 1} onClick={() => setDiscPage((p) => p - 1)} className="px-2.5 py-1 border rounded disabled:opacity-40">
                السابق
              </button>
              <span>صفحة {discPage}</span>
              <button disabled={discPage * 25 >= discTotal} onClick={() => setDiscPage((p) => p + 1)} className="px-2.5 py-1 border rounded disabled:opacity-40">
                التالي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drill-Down Modal */}
      {drillDownData && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900">
                  تفاصيل القيد: {drillDownData.journalEntry?.journalNumber}
                </h3>
              </div>
              <button onClick={() => setDrillDownData(null)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-xs text-slate-600 grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg">
              <div>نوع المصدر: <span className="font-mono">{drillDownData.journalEntry?.sourceType}</span></div>
              <div>الحالة: <span className="font-semibold">{drillDownData.journalEntry?.status}</span></div>
              <div className="col-span-2">البيان: {drillDownData.journalEntry?.description}</div>
            </div>
            <table className="w-full text-xs text-right border rounded-lg overflow-hidden">
              <thead className="bg-slate-100">
                <tr>
                  <th className="py-2 px-3">الحساب</th>
                  <th className="py-2 px-3">البيان</th>
                  <th className="py-2 px-3 text-left">مدين</th>
                  <th className="py-2 px-3 text-left">دائن</th>
                </tr>
              </thead>
              <tbody>
                {(drillDownData.lines ?? []).map((l: any) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-2 px-3 font-mono">{l.accountCode} - {l.accountName}</td>
                    <td className="py-2 px-3">{l.description}</td>
                    <td className="py-2 px-3 font-mono text-left text-emerald-700">{fmt(l.debit)}</td>
                    <td className="py-2 px-3 font-mono text-left text-rose-700">{fmt(l.credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {drillDownData.sourceDocument && (
              <div className="bg-indigo-50/60 border border-indigo-100 p-3 rounded-lg text-xs space-y-1">
                <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4" /> المستند التشغيلي الأصلي ({drillDownData.sourceDocument.type})
                </div>
                <pre className="text-[11px] overflow-x-auto text-slate-700" dir="ltr">
                  {JSON.stringify(drillDownData.sourceDocument, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
