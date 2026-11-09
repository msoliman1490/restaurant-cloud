import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import {
  FileText,
  ShieldCheck,
  Search,
  Filter,
  RefreshCw,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Eye,
  X,
  AlertCircle,
} from 'lucide-react';

interface AuditLogEntry {
  id: string;
  tenantId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: string | null;
  afterState?: string | null;
  correlationId?: string | null;
  occurredAt: string;
}

interface AuditQueryResponse {
  items: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
}

export const AuditLogsView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Snapshot Detail Modal
  const [inspectEntry, setInspectEntry] = useState<AuditLogEntry | null>(null);

  const fetchLogs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (entityFilter) params.append('entityType', entityFilter);
      if (actionFilter) params.append('action', actionFilter);

      const res = await apiClient.request<AuditQueryResponse>(`/audit-logs?${params.toString()}`);
      setLogs(res.items || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      setError(err?.message || 'فشل في تحميل سجل العمليات والرقابة');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, entityFilter, actionFilter]);

  const totalPages = Math.ceil(total / limit) || 1;

  const renderJsonPretty = (jsonStr?: string | null) => {
    if (!jsonStr) return <span className="text-slate-400 italic">لا توجد بيانات</span>;
    try {
      const parsed = JSON.parse(jsonStr);
      return (
        <pre className="text-xs font-mono bg-slate-900 text-slate-200 p-4 rounded-xl overflow-x-auto text-left" dir="ltr">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    } catch {
      return <span className="font-mono text-xs">{jsonStr}</span>;
    }
  };

  return (
    <div className="space-y-8" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-indigo-600" />
            سجل العمليات والرقابة (Audit Log)
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            سجل تدقيق رقمي غير قابل للتعديل أو الحذف، محمي بمحفزات قاعدة البيانات المباشرة (Append-Only).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            محمي بزناد Postgres التلقائي
          </span>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-3 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center gap-3">
        <div className="flex-1 w-full flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/80">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            placeholder="تصفية حسب نوع الإجراء (مثال: TENANT_ONBOARDED)..."
            className="w-full bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
          />
        </div>

        <div className="w-full md:w-64 flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200/80">
          <Filter className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={entityFilter}
            onChange={(e) => {
              setEntityFilter(e.target.value);
              setPage(1);
            }}
            placeholder="الكيان (tenant, branch, legal_entity)..."
            className="w-full bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
          />
        </div>

        <button
          onClick={fetchLogs}
          className="p-2.5 rounded-xl border border-slate-200 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 transition-all flex items-center gap-1.5 text-xs font-semibold"
          title="تحديث"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          تحديث
        </button>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">سجل الأحداث ({total})</h2>
          <div className="text-xs text-slate-400 font-mono">
            الصفحة {page} من {totalPages}
          </div>
        </div>

        {isLoading ? (
          <div className="py-20 flex justify-center items-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">
            لا توجد سجلات تطابق معايير البحث.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs font-semibold border-b border-slate-200/60">
                <tr>
                  <th className="px-6 py-4">التوقيت</th>
                  <th className="px-6 py-4">الإجراء (Action)</th>
                  <th className="px-6 py-4">نوع الكيان</th>
                  <th className="px-6 py-4">معرف الكيان (Entity ID)</th>
                  <th className="px-6 py-4 text-center">التفاصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-4 text-xs font-mono text-slate-500 whitespace-nowrap">
                      {new Date(log.occurredAt).toLocaleString('ar-SA')}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs font-semibold text-slate-800">
                      {log.entityType}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">
                      {log.entityId.slice(0, 8)}...
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => setInspectEntry(log)}
                        className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 transition-all inline-flex items-center gap-1 text-xs font-semibold"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        فحص
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
            <div>إجمالي السجلات: {total}</div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="font-bold font-mono">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Snapshot Inspect Modal */}
      {inspectEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 max-w-2xl w-full shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  تفاصيل لقطة السجل ({inspectEntry.action})
                </h3>
                <span className="text-xs font-mono text-slate-400">
                  معرف السجل: {inspectEntry.id}
                </span>
              </div>
              <button
                onClick={() => setInspectEntry(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl">
                <div>
                  <span className="text-slate-400 block">الكيان المستهدف:</span>
                  <strong className="text-slate-800">{inspectEntry.entityType} ({inspectEntry.entityId})</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">توقيت الحدث:</span>
                  <strong className="font-mono text-slate-800">
                    {new Date(inspectEntry.occurredAt).toLocaleString('ar-SA')}
                  </strong>
                </div>
              </div>

              {inspectEntry.beforeState && (
                <div>
                  <h4 className="font-bold text-slate-800 mb-1">الحالة السابقة (Before State):</h4>
                  {renderJsonPretty(inspectEntry.beforeState)}
                </div>
              )}

              <div>
                <h4 className="font-bold text-slate-800 mb-1">الحالة الناتجة (After State):</h4>
                {renderJsonPretty(inspectEntry.afterState)}
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                onClick={() => setInspectEntry(null)}
                className="px-5 py-2 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
