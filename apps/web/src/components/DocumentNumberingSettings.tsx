import React, { useEffect, useState } from 'react';
import { Hash, Lock, Plus, RefreshCw, Unlock } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface SequenceRow {
  id: string;
  legalEntityId: string;
  branchId?: string | null;
  documentType: string;
  periodKey: string;
  prefix: string;
  startingNumber: number;
  currentValue: number;
  padding: number;
  fiscalYearFormat: 'YYYY' | 'YY' | 'NONE';
  annualResetPolicy: 'ANNUAL' | 'NEVER';
  isActive: boolean;
  isLockedByUsage: boolean;
}

const DOC_TYPES = [
  'SALES_INVOICE',
  'POS_TRANSACTION',
  'PURCHASE_INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'JOURNAL_ENTRY',
  'RECEIPT',
  'PAYMENT',
  'PURCHASE_ORDER',
  'PURCHASE_REQUEST',
  'GOODS_RECEIPT',
  'DELIVERY_NOTE',
  'STOCK_TRANSFER',
  'STOCK_ADJUSTMENT',
];

const DOC_TYPE_LABELS: Record<string, string> = {
  SALES_INVOICE: 'فاتورة مبيعات',
  POS_TRANSACTION: 'فاتورة نقطة بيع (POS)',
  PURCHASE_INVOICE: 'فاتورة مشتريات',
  CREDIT_NOTE: 'إشعار دائن (مرتجع مبيعات)',
  DEBIT_NOTE: 'إشعار مدين (مرتجع مشتريات)',
  JOURNAL_ENTRY: 'قيد يومية',
  RECEIPT: 'سند قبض',
  PAYMENT: 'سند صرف / دفعة مورد',
  PURCHASE_ORDER: 'أمر شراء',
  PURCHASE_REQUEST: 'طلب شراء',
  GOODS_RECEIPT: 'إذن استلام بضاعة (GRN)',
  DELIVERY_NOTE: 'إذن تسليم / صرف',
  STOCK_TRANSFER: 'تحويل مخزني',
  STOCK_ADJUSTMENT: 'تسوية مخزنية / جرد',
};

export const DocumentNumberingSettings: React.FC = () => {
  const { hierarchy } = useAuth();
  const entities = hierarchy?.legalEntities ?? [];
  const branches = hierarchy?.branches ?? [];

  const [sequences, setSequences] = useState<SequenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [form, setForm] = useState({
    legalEntityId: entities[0]?.id || '',
    branchId: '',
    documentType: 'SALES_INVOICE',
    prefix: 'INV',
    startingNumber: 1,
    padding: 6,
    fiscalYearFormat: 'YYYY' as 'YYYY' | 'YY' | 'NONE',
    annualResetPolicy: 'ANNUAL' as 'ANNUAL' | 'NEVER',
    reason: '',
  });

  useEffect(() => {
    if (!form.legalEntityId && entities[0]?.id) {
      setForm((f) => ({ ...f, legalEntityId: entities[0]!.id }));
    }
  }, [entities]);

  const loadSequences = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<SequenceRow[]>('/document-numbering/sequences');
      setSequences(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل تسلسلات الترقيم');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSequences();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await apiClient.request('/document-numbering/sequences', {
        method: 'PUT',
        body: JSON.stringify({
          legalEntityId: form.legalEntityId,
          branchId: form.branchId || null,
          documentType: form.documentType,
          prefix: form.prefix,
          startingNumber: Number(form.startingNumber),
          padding: Number(form.padding),
          fiscalYearFormat: form.fiscalYearFormat,
          annualResetPolicy: form.annualResetPolicy,
          reason: form.reason || undefined,
        }),
      });
      setSuccess('تم حفظ إعدادات الترقيم بنجاح.');
      await loadSequences();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ إعدادات الترقيم');
    } finally {
      setSaving(false);
    }
  };

  const entityBranches = branches.filter((b) => b.legalEntityId === form.legalEntityId);

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Hash className="w-5 h-5 text-[#0D6E4F]" />
              إعدادات ترقيم المستندات (Document Numbering)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ترقيم ذري مستقل لكل شركة قانونية ونوع مستند وفرع، منفصل تماماً عن تسلسل ZATCA ICV/PIH، ومقفل أثناء الفترة المفتوحة بعد الاستخدام.
            </p>
          </div>
          <button
            type="button"
            onClick={loadSequences}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>تحديث</span>
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#0D6E4F] text-xs font-semibold">
            {success}
          </div>
        )}

        <form onSubmit={handleSave} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">الشركة القانونية *</label>
            <select
              required
              value={form.legalEntityId}
              onChange={(e) => setForm({ ...form, legalEntityId: e.target.value, branchId: '' })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white"
            >
              {entities.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.legalName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">الفرع (اختياري)</label>
            <select
              value={form.branchId}
              onChange={(e) => setForm({ ...form, branchId: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white"
            >
              <option value="">على مستوى الشركة القانونية</option>
              {entityBranches.map((br) => (
                <option key={br.id} value={br.id}>
                  {br.name} ({br.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">نوع المستند *</label>
            <select
              value={form.documentType}
              onChange={(e) => setForm({ ...form, documentType: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono"
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t] || t} ({t})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">البادئة (Prefix) *</label>
            <input
              type="text"
              required
              value={form.prefix}
              onChange={(e) => setForm({ ...form, prefix: e.target.value })}
              dir="ltr"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">رقم البداية / العرض (Padding)</label>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={form.startingNumber}
                onChange={(e) => setForm({ ...form, startingNumber: Number(e.target.value) })}
                className="w-1/2 px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono"
              />
              <input
                type="number"
                min={1}
                max={12}
                value={form.padding}
                onChange={(e) => setForm({ ...form, padding: Number(e.target.value) })}
                className="w-1/2 px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">صيغة السنة / التصفير</label>
            <div className="flex gap-2">
              <select
                value={form.fiscalYearFormat}
                onChange={(e) => setForm({ ...form, fiscalYearFormat: e.target.value as any })}
                className="w-1/2 px-2 py-2 rounded-xl border border-slate-200 bg-white"
              >
                <option value="YYYY">YYYY</option>
                <option value="YY">YY</option>
                <option value="NONE">بدون</option>
              </select>
              <select
                value={form.annualResetPolicy}
                onChange={(e) => setForm({ ...form, annualResetPolicy: e.target.value as any })}
                className="w-1/2 px-2 py-2 rounded-xl border border-slate-200 bg-white"
              >
                <option value="ANNUAL">سنوي</option>
                <option value="NEVER">مستمر</option>
              </select>
            </div>
          </div>
          <div className="sm:col-span-2">
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="سبب التعديل (يسجل في سجل التدقيق)"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2 px-4 rounded-xl bg-[#0D6E4F] hover:bg-[#0A5A40] text-white font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>حفظ التسلسل</span>
            </button>
          </div>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <th className="py-2.5 px-3">نوع المستند</th>
                <th className="py-2.5 px-3">الفترة</th>
                <th className="py-2.5 px-3">البادئة</th>
                <th className="py-2.5 px-3">الرقم الحالي</th>
                <th className="py-2.5 px-3">العرض / السنة</th>
                <th className="py-2.5 px-3">حالة القفل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    جاري التحميل...
                  </td>
                </tr>
              ) : sequences.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    سيتم إنشاء التسلسلات تلقائياً عند أول استخدام أو عبر النموذج أعلاه.
                  </td>
                </tr>
              ) : (
                sequences.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2.5 px-3 font-bold">
                      <span>{DOC_TYPE_LABELS[s.documentType] || s.documentType}</span>
                      <span className="block text-[10px] font-mono text-slate-400">{s.documentType}</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono">{s.periodKey}</td>
                    <td className="py-2.5 px-3 font-mono">{s.prefix}</td>
                    <td className="py-2.5 px-3 font-mono font-bold text-[#0D6E4F]">{s.currentValue}</td>
                    <td className="py-2.5 px-3">
                      {s.padding} خانات · {s.fiscalYearFormat} ({s.annualResetPolicy})
                    </td>
                    <td className="py-2.5 px-3">
                      {s.isLockedByUsage ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                          <Lock className="w-3 h-3" /> مستخدم ومقفل
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-[#0D6E4F] border border-emerald-200 font-semibold">
                          <Unlock className="w-3 h-3" /> قابل للتعديل
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
