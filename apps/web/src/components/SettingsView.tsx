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
  MessageSquare,
  Webhook,
  Send,
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
  const [activeTab, setActiveTab] = useState<'general' | 'integrations'>('general');
  const [waEnabled, setWaEnabled] = useState(false);
  const [waPhoneId, setWaPhoneId] = useState('');
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [testRecipient, setTestRecipient] = useState('+966500000000');
  const [notifLogs, setNotifLogs] = useState<
    Array<{ id: string; channel: string; recipient: string; eventType: string; status: string; createdAt: string }>
  >([]);

  const fetchIntegrations = async () => {
    try {
      const [intRes, logRes] = await Promise.all([
        apiClient.request<Array<{ channel: string; isEnabled: boolean; configJson: Record<string, any> }>>('/tenants/integrations'),
        apiClient.request<Array<{ id: string; channel: string; recipient: string; eventType: string; status: string; createdAt: string }>>('/tenants/notifications?limit=15'),
      ]);
      if (Array.isArray(intRes)) {
        const wa = intRes.find((i) => i.channel === 'WHATSAPP');
        if (wa) {
          setWaEnabled(wa.isEnabled);
          setWaPhoneId(wa.configJson?.phoneNumberId || '');
        }
        const wh = intRes.find((i) => i.channel === 'WEBHOOK');
        if (wh) {
          setWebhookEnabled(wh.isEnabled);
          setWebhookUrl(wh.configJson?.webhookUrl || '');
        }
      }
      if (Array.isArray(logRes)) {
        setNotifLogs(logRes);
      }
    } catch {
      // Keep UI functional even if integrations table is empty
    }
  };

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
      await fetchIntegrations();
    } catch (err: any) {
      setError(err?.message || 'فشل في تحميل إعدادات المنشأة');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveIntegration = async (channel: 'WHATSAPP' | 'WEBHOOK') => {
    setIsSubmitting(true);
    setError(null);
    try {
      await apiClient.request(`/tenants/integrations/${channel}`, {
        method: 'PATCH',
        body: JSON.stringify(
          channel === 'WHATSAPP'
            ? { provider: 'META_CLOUD_API', isEnabled: waEnabled, configJson: { phoneNumberId: waPhoneId } }
            : { provider: 'CUSTOM_WEBHOOK', isEnabled: webhookEnabled, configJson: { webhookUrl } }
        ),
      });
      setSuccessMsg(`تم حفظ إعدادات قناة ${channel} بنجاح`);
      await fetchIntegrations();
    } catch (err: any) {
      setError(err?.message || 'فشل حفظ إعدادات التكامل');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendTestNotification = async (channel: 'WHATSAPP' | 'WEBHOOK') => {
    setIsSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/tenants/notifications/dispatch', {
        channel,
        recipient: channel === 'WHATSAPP' ? testRecipient : webhookUrl || 'https://webhook.local/test',
        eventType: 'TEST_MESSAGE',
        payload: { message: 'رسالة اختبار من Restaurant Cloud' },
        idempotencyKey: `TEST-${channel}-${Date.now()}`,
      });
      setSuccessMsg(`تم إرسال إشعار اختبار عبر ${channel}`);
      await fetchIntegrations();
    } catch (err: any) {
      setError(err?.message || 'فشل إرسال الإشعار');
    } finally {
      setIsSubmitting(false);
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
              activeTab === 'general' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            الإعدادات العامة
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('integrations')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === 'integrations' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>التكاملات والإشعارات (WhatsApp)</span>
          </button>
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

      {activeTab === 'integrations' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* WhatsApp Business Integration */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-emerald-600" />
                  تكامل WhatsApp Business API
                </h2>
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={waEnabled}
                    onChange={(e) => setWaEnabled(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>تفعيل القناة</span>
                </label>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number ID</label>
                <input
                  type="text"
                  value={waPhoneId}
                  onChange={(e) => setWaPhoneId(e.target.value)}
                  placeholder="مثال: 1092837465001"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">رقم مستلم للاختبار</label>
                <input
                  type="text"
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                />
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleSaveIntegration('WHATSAPP')}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                >
                  حفظ إعدادات WhatsApp
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleSendTestNotification('WHATSAPP')}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 flex items-center gap-1"
                >
                  <Send className="w-3.5 h-3.5" />
                  إرسال رسالة اختبار
                </button>
              </div>
            </div>

            {/* Webhook Integration */}
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Webhook className="w-5 h-5 text-indigo-600" />
                  تكامل Webhooks الأحداث
                </h2>
                <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={webhookEnabled}
                    onChange={(e) => setWebhookEnabled(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>تفعيل القناة</span>
                </label>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Webhook Endpoint URL</label>
                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://example.com/webhooks/restaurant-cloud"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
                />
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleSaveIntegration('WEBHOOK')}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                >
                  حفظ إعدادات Webhook
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleSendTestNotification('WEBHOOK')}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 flex items-center gap-1"
                >
                  <Send className="w-3.5 h-3.5" />
                  اختبار الإرسال
                </button>
              </div>
            </div>
          </div>

          {/* Notification Dispatch Logs */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">سجل الإشعارات والتكاملات (Notification Dispatch Log)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-3">القناة</th>
                    <th className="py-2.5 px-3">المستلم</th>
                    <th className="py-2.5 px-3">الحدث</th>
                    <th className="py-2.5 px-3">الحالة</th>
                    <th className="py-2.5 px-3">التاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {notifLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        لا توجد إشعارات مرسلة بعد
                      </td>
                    </tr>
                  ) : (
                    notifLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 px-3 font-mono font-bold">{log.channel}</td>
                        <td className="py-2.5 px-3 font-mono">{log.recipient}</td>
                        <td className="py-2.5 px-3">{log.eventType}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                              log.status === 'SENT'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-500">{log.createdAt?.slice(0, 19).replace('T', ' ')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
};
