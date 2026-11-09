import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Settings,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  CreditCard,
  Layers,
  X,
} from 'lucide-react';

interface TenantSettingsData {
  tenant: {
    id: string;
    code: string;
    displayName: string;
    deploymentMode: string;
    primaryLocale: string;
    timezone: string;
    status: string;
  };
  industryPacks: Array<{
    id: string;
    industry: string;
    status: string;
    isPrimary: boolean;
  }>;
  subscription: {
    id: string;
    planCode: string;
    status: string;
    maxBranches: number;
    maxDevices: number;
    maxUsers: number;
    trialEndsAt?: string | null;
  } | null;
}

export const SettingsView: React.FC = () => {
  const { activeTenant } = useAuth();
  const [data, setData] = useState<TenantSettingsData | null>(null);
  const [form, setForm] = useState({
    displayName: '',
    primaryLocale: 'ar-SA',
    timezone: 'Asia/Riyadh',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchSettings = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.request<TenantSettingsData>('/tenants/settings');
      if (res && res.tenant) {
        setData(res);
        setForm({
          displayName: res.tenant.displayName,
          primaryLocale: res.tenant.primaryLocale,
          timezone: res.tenant.timezone,
        });
      }
    } catch (err: any) {
      setError(err?.message || 'فشل في تحميل إعدادات المنشأة');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await apiClient.request('/tenants/settings', {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      setSuccessMsg('تم حفظ وتحديث إعدادات المنشأة بنجاح');
      await fetchSettings();
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء حفظ الإعدادات');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-24 flex justify-center items-center text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8" dir="rtl">
      {/* Header */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Settings className="w-7 h-7 text-indigo-600" />
            إعدادات المنشأة والنظام
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            تكوين البيانات العامة، الباقة التشغيلية، ومحددات النظام لـ ({data?.tenant.displayName || activeTenant?.name}).
          </p>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-3 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="mr-auto text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center gap-3 text-sm">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="mr-auto text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* General Settings Form */}
        <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
          <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">
            المعلومات الأساسية
          </h2>

          <form onSubmit={handleSave} className="space-y-5 text-sm">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">رمز المنشأة (Tenant Code)</label>
              <input
                type="text"
                disabled
                value={data?.tenant.code || ''}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-100 font-mono text-slate-500 cursor-not-allowed"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">رمز ثابت لا يمكن تعديله بعد الإنشاء.</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">اسم المنشأة التجاري *</label>
              <input
                type="text"
                required
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">اللغة الأساسية</label>
                <select
                  value={form.primaryLocale}
                  onChange={(e) => setForm({ ...form, primaryLocale: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="ar-SA">العربية (المملكة العربية السعودية)</option>
                  <option value="en-US">English (United States)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">المنطقة الزمنية</label>
                <select
                  value={form.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="Asia/Riyadh">Asia/Riyadh (GMT+3)</option>
                  <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
                  <option value="Africa/Cairo">Africa/Cairo (GMT+2)</option>
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 shadow-sm disabled:opacity-50 transition-all"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ التغييرات
              </button>
            </div>
          </form>
        </div>

        {/* Subscription & Multi-Industry Info */}
        <div className="space-y-6">
          {/* Subscription Card */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-indigo-600" />
              باقة الاشتراك والحدود
            </h3>

            {data?.subscription ? (
              <div className="space-y-3 text-xs text-slate-600">
                <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl">
                  <div className="font-bold text-indigo-900 text-sm mb-1">{data.subscription.planCode}</div>
                  <span className="text-[11px] text-indigo-600 font-semibold bg-white px-2 py-0.5 rounded-full border border-indigo-200">
                    الحالة: {data.subscription.status}
                  </span>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex justify-between">
                    <span className="text-slate-500">الحد الأقصى للفروع:</span>
                    <strong className="font-mono text-slate-900">{data.subscription.maxBranches}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">الحد الأقصى للأجهزة:</span>
                    <strong className="font-mono text-slate-900">{data.subscription.maxDevices}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">الحد الأقصى للمستخدمين:</span>
                    <strong className="font-mono text-slate-900">{data.subscription.maxUsers}</strong>
                  </div>
                  {data.subscription.trialEndsAt && (
                    <div className="flex justify-between text-amber-700">
                      <span>انتهاء التجربة:</span>
                      <strong className="font-mono">
                        {new Date(data.subscription.trialEndsAt).toLocaleDateString('ar-SA')}
                      </strong>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">لا توجد بيانات اشتراك مسجلة.</p>
            )}
          </div>

          {/* Industry Packs Card */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-600" />
              القطاعات المفعلة
            </h3>

            <div className="space-y-2">
              {data?.industryPacks.map((pack) => (
                <div
                  key={pack.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50 text-xs"
                >
                  <span className="font-bold text-slate-800">{pack.industry}</span>
                  {pack.isPrimary && (
                    <span className="text-[10px] bg-slate-900 text-white px-2 py-0.5 rounded-md font-semibold">
                      القطاع الأساسي
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
