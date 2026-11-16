import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  QrCode,
  Send,
  AlertTriangle,
  RefreshCw,
  KeyRound,
  Activity,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useToast } from '../context/ToastContext';

type ZatcaTab = 'config' | 'egs' | 'documents' | 'outbox' | 'reports';

export const ZatcaV2View: React.FC = () => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<ZatcaTab>('config');
  const [entities, setEntities] = useState<any[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [config, setConfig] = useState<any | null>(null);
  const [egsUnits, setEgsUnits] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [outbox, setOutbox] = useState<any[]>([]);
  const [errorReport, setErrorReport] = useState<any[]>([]);
  const [reconReport, setReconReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  // Config form
  const [sellerVat, setSellerVat] = useState('310000000000003');
  const [sellerNameAr, setSellerNameAr] = useState('');
  const [environment, setEnvironment] = useState<'SANDBOX' | 'SIMULATION'>('SANDBOX');
  const [v2Enabled, setV2Enabled] = useState(false);

  const loadEntities = useCallback(async () => {
    try {
      const res = await apiClient.get<any>('/legal-entities');
      const list = res.data || res || [];
      setEntities(list);
      if (list.length > 0 && !selectedEntityId) {
        setSelectedEntityId(list[0].id);
        setSellerNameAr(list[0].legalName || '');
        if (list[0].vatNumber) setSellerVat(list[0].vatNumber);
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل المنشآت القانونية', 'error');
    }
  }, [selectedEntityId, showToast]);

  const loadZatcaData = useCallback(async () => {
    if (!selectedEntityId) return;
    setLoading(true);
    try {
      const [cfgRes, egsRes, docsRes, outRes, errRes, recRes] = await Promise.all([
        apiClient.get<any>(`/api/v1/zatca/config?legalEntityId=${selectedEntityId}`).catch(() => null),
        apiClient.get<any>(`/api/v1/zatca/egs-units?legalEntityId=${selectedEntityId}`).catch(() => []),
        apiClient.get<any>(`/api/v1/zatca/documents?legalEntityId=${selectedEntityId}&limit=20`).catch(() => ({ data: [] })),
        apiClient.get<any>(`/api/v1/zatca/outbox?legalEntityId=${selectedEntityId}&limit=20`).catch(() => ({ data: [] })),
        apiClient.get<any>(`/api/v1/zatca/reports/errors?legalEntityId=${selectedEntityId}&limit=20`).catch(() => ({ data: [] })),
        apiClient.get<any>(`/api/v1/zatca/reports/reconciliation?legalEntityId=${selectedEntityId}`).catch(() => null),
      ]);
      if (cfgRes) {
        setConfig(cfgRes);
        setSellerVat(cfgRes.sellerVatNumber || sellerVat);
        setSellerNameAr(cfgRes.sellerNameAr || sellerNameAr);
        setEnvironment(cfgRes.environment === 'SIMULATION' ? 'SIMULATION' : 'SANDBOX');
        setV2Enabled(Boolean(cfgRes.v2Enabled));
      } else {
        setConfig(null);
      }
      setEgsUnits(Array.isArray(egsRes) ? egsRes : egsRes?.data || []);
      setDocuments(docsRes?.data || []);
      setOutbox(outRes?.data || []);
      setErrorReport(errRes?.data || []);
      setReconReport(recRes);
    } finally {
      setLoading(false);
    }
  }, [selectedEntityId]);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  useEffect(() => {
    loadZatcaData();
  }, [loadZatcaData]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/v1/zatca/config', {
        legalEntityId: selectedEntityId,
        sellerVatNumber: sellerVat,
        sellerNameAr,
        environment,
        v2Enabled,
      });
      showToast('تم حفظ إعدادات ZATCA V2 (مع إبقاء V1 نشطاً)', 'success');
      await loadZatcaData();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ الإعدادات', 'error');
    }
  };

  const handleProcessOutbox = async () => {
    try {
      const res = await apiClient.post<any>('/api/v1/zatca/outbox/process-batch', {
        legalEntityId: selectedEntityId,
      });
      showToast(`تمت معالجة ${res.processedCount || 0} عملية من Outbox`, 'success');
      await loadZatcaData();
    } catch (err: any) {
      showToast(err?.message || 'تعذر معالجة Outbox', 'error');
    }
  };

  const handleWatchdog = async () => {
    try {
      const res = await apiClient.post<any>('/api/v1/zatca/outbox/watchdog', {
        legalEntityId: selectedEntityId,
      });
      showToast(`استرداد Watchdog: ${res.recoveredCount || 0} عملية متعثرة`, 'success');
      await loadZatcaData();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تشغيل Watchdog', 'error');
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <QrCode className="w-5 h-5 text-indigo-600" />
            جاهزية الفوترة الإلكترونية ZATCA Phase 2 (Staging)
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            ZATCA V1 نشط دون تغيير — وحدات POS EGS مستقلة، توقيع ECDSA، تسلسل ICV/PIH، وOutbox مع Watchdog.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedEntityId}
            onChange={(e) => setSelectedEntityId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
          >
            {entities.map((ent) => (
              <option key={ent.id} value={ent.id}>
                {ent.commercialName || ent.legalName}
              </option>
            ))}
          </select>
          <button
            onClick={loadZatcaData}
            className="p-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {[
          { id: 'config', label: 'إعدادات المنشأة وV1/V2', icon: ShieldCheck },
          { id: 'egs', label: 'وحدات POS EGS والشهادات', icon: KeyRound },
          { id: 'documents', label: 'سجل الفواتير والإشعارات', icon: QrCode },
          { id: 'outbox', label: 'صف الإرسال وWatchdog', icon: Send },
          { id: 'reports', label: 'تقارير الأخطاء والمصالحة', icon: Activity },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as ZatcaTab)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
                activeTab === t.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'config' && (
        <form onSubmit={handleSaveConfig} className="bg-white p-6 rounded-xl border border-slate-200 space-y-4 max-w-2xl">
          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
            <span>حالة ZATCA V1: <strong>نشط دائماً (Active)</strong></span>
            <span>حالة V2 في الإنتاج: <strong>معطل حتى القبول النهائي</strong></span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">الرقم الضريبي (15 رقم)</label>
              <input value={sellerVat} onChange={(e) => setSellerVat(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">الاسم القانوني للمنشأة</label>
              <input value={sellerNameAr} onChange={(e) => setSellerNameAr(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">بيئة الربط (Staging فقط)</label>
              <select value={environment} onChange={(e) => setEnvironment(e.target.value as any)} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="SANDBOX">SANDBOX</option>
                <option value="SIMULATION">SIMULATION</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" checked={v2Enabled} onChange={(e) => setV2Enabled(e.target.checked)} id="v2Toggle" />
              <label htmlFor="v2Toggle" className="text-sm text-slate-700">تفعيل V2 على Staging للاختبار</label>
            </div>
          </div>
          <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">حفظ إعدادات المنشأة</button>
          {config && <div className="text-xs text-slate-500">آخر تحديث: {String(config.updatedAt).slice(0, 19).replace('T', ' ')}</div>}
        </form>
      )}

      {activeTab === 'egs' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3">معرف الوحدة (EGS)</th>
                <th className="px-4 py-3">الجهاز (POS)</th>
                <th className="px-4 py-3">ICV الحالي</th>
                <th className="px-4 py-3">مرجع الشهادة (CSID)</th>
                <th className="px-4 py-3">الشهادات</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {egsUnits.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-mono">{u.unitIdentifier}</td>
                  <td className="px-4 py-3">{u.deviceAssetCode || '—'}</td>
                  <td className="px-4 py-3 font-mono">{u.icvCurrent}</td>
                  <td className="px-4 py-3 font-mono text-xs">{u.csidReference || '—'}</td>
                  <td className="px-4 py-3 text-xs">{(u.certificates || []).map((c: any) => `${c.certificateType}:${c.status}`).join(' | ') || 'لا توجد'}</td>
                </tr>
              ))}
              {egsUnits.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">لا توجد وحدات POS EGS مسجلة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3">رقم المستند</th>
                <th className="px-4 py-3">ICV</th>
                <th className="px-4 py-3">النوع</th>
                <th className="px-4 py-3">الإجمالي</th>
                <th className="px-4 py-3">حالة ZATCA</th>
                <th className="px-4 py-3">ربط القيد</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 font-medium">{d.documentNumber}</td>
                  <td className="px-4 py-3 font-mono">{d.icv}</td>
                  <td className="px-4 py-3 font-mono text-xs">{d.invoiceTypeCode}/{d.invoiceSubtype}</td>
                  <td className="px-4 py-3 font-mono">{Number(d.grandTotal).toFixed(2)}</td>
                  <td className="px-4 py-3">{d.complianceStatus}</td>
                  <td className="px-4 py-3 font-mono text-xs">{d.journalEntryId ? d.journalEntryId.slice(0, 8) : 'غير مربوط'}</td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">لا توجد مستندات ZATCA</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'outbox' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <button onClick={handleProcessOutbox} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">تشغيل دفعة الإرسال (Outbox)</button>
            <button onClick={handleWatchdog} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium">استرداد العمليات المتعثرة (Watchdog)</button>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-3">المستند</th>
                  <th className="px-4 py-3">النوع</th>
                  <th className="px-4 py-3">الحالة</th>
                  <th className="px-4 py-3">المحاولات</th>
                  <th className="px-4 py-3">آخر خطأ</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {outbox.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-3 font-mono text-xs">{o.zatcaDocumentId.slice(0, 8)}</td>
                    <td className="px-4 py-3">{o.submissionType}</td>
                    <td className="px-4 py-3 font-semibold">{o.status}</td>
                    <td className="px-4 py-3">{o.attemptCount} / {o.maxAttempts}</td>
                    <td className="px-4 py-3 text-xs text-rose-600">{o.lastErrorMessage || '—'}</td>
                  </tr>
                ))}
                {outbox.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">صف Outbox فارغ</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="space-y-4">
          {reconReport && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white p-4 rounded-xl border border-slate-200">
                <div className="text-xs text-slate-500">مستندات غير مربوطة بقيد محاسبي</div>
                <div className="text-2xl font-bold mt-1">{reconReport.unlinkedJournalDocumentsCount}</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200">
                <div className="text-xs text-slate-500">عمليات Dead Letter</div>
                <div className="text-2xl font-bold mt-1 text-rose-600">{reconReport.deadLetterQueueCount}</div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200">
                <div className="text-xs text-slate-500">حالات المستندات</div>
                <div className="text-xs mt-1 space-y-1">
                  {(reconReport.byStatus || []).map((s: any) => (
                    <div key={s.status} className="flex justify-between"><span>{s.status}</span><strong>{s.cnt}</strong></div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <div className="px-4 py-3 bg-rose-50 border-b text-rose-800 font-semibold text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> تقرير الأخطاء والمستندات المرفوضة / المحتاجة للمصالحة
            </div>
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-4 py-2">رقم المستند</th>
                  <th className="px-4 py-2">الحالة</th>
                  <th className="px-4 py-2">تفاصيل الخطأ</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {errorReport.map((er) => (
                  <tr key={er.id}>
                    <td className="px-4 py-2 font-medium">{er.documentNumber}</td>
                    <td className="px-4 py-2 text-rose-700">{er.complianceStatus}</td>
                    <td className="px-4 py-2 text-xs font-mono">{JSON.stringify(er.zatcaErrorsJson || [])}</td>
                  </tr>
                ))}
                {errorReport.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-400">لا توجد أخطاء ZATCA</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
