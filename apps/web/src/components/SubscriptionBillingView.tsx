import React, { useEffect, useState } from 'react';
import {
  CreditCard,
  Loader2,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { apiClient } from '../api/client';

interface Plan {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  monthlyPriceSar: string;
  annualPriceSar: string;
  maxBranches: number;
  maxDevices: number;
  maxUsers: number;
}

interface SubscriptionOverview {
  subscription: {
    id: string;
    planCode: string;
    status: string;
    billingCycle: 'MONTHLY' | 'ANNUAL';
    autoRenew: boolean;
    maxBranches: number;
    maxDevices: number;
    maxUsers: number;
    trialEndsAt?: string | null;
    currentPeriodEnd?: string | null;
    lastPaymentStatus?: string | null;
  } | null;
  plan: Plan | null;
  usage: {
    branches: number;
    devices: number;
    users: number;
    legalEntities: number;
  };
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    planCode: string;
    billingCycle: string;
    subtotalSar: string;
    vatSar: string;
    totalSar: string;
    status: string;
    createdAt: string;
  }>;
}

export const SubscriptionBillingView: React.FC<{ locale: 'ar' | 'en' }> = ({ locale }) => {
  const isEn = locale === 'en';
  const [overview, setOverview] = useState<SubscriptionOverview | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [checkoutInfo, setCheckoutInfo] = useState<{
    hostedCheckoutUrl: string;
    invoiceNumber: string;
    note: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [subData, plansData] = await Promise.all([
        apiClient.get<SubscriptionOverview>('/saas/subscription'),
        apiClient.get<Plan[]>('/saas/public/plans'),
      ]);
      setOverview(subData);
      setPlans(plansData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleStartCheckout = async (planCode: string) => {
    setBusy(true);
    setFeedback(null);
    setCheckoutInfo(null);
    try {
      const res = await apiClient.post<{
        hostedCheckoutUrl: string;
        invoice: { invoiceNumber: string };
        note: string;
      }>('/saas/billing/checkout', {
        planCode,
        billingCycle,
      });
      setCheckoutInfo({
        hostedCheckoutUrl: res.hostedCheckoutUrl,
        invoiceNumber: res.invoice.invoiceNumber,
        note: res.note,
      });
      await loadData();
    } catch (err: unknown) {
      setFeedback((err as Error)?.message || 'Checkout initiation failed');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleAutoRenew = async () => {
    if (!overview?.subscription) return;
    setBusy(true);
    try {
      await apiClient.patch('/saas/subscription/auto-renew', {
        autoRenew: !overview.subscription.autoRenew,
      });
      await loadData();
    } finally {
      setBusy(false);
    }
  };

  const handleCancelSubscription = async () => {
    setBusy(true);
    try {
      await apiClient.post('/saas/subscription/cancel', {
        reason: 'Requested from Tenant Subscription Portal',
      });
      setFeedback(
        isEn ? 'Subscription marked as CANCELLED.' : 'تم إلغاء الاشتراك بنجاح.'
      );
      await loadData();
    } finally {
      setBusy(false);
    }
  };

  const handlePdplRequest = async (requestType: 'EXPORT' | 'CORRECTION') => {
    setBusy(true);
    try {
      const res = await apiClient.post<{ requestId: string; status: string }>(
        '/saas/pdpl/data-request',
        { requestType }
      );
      setFeedback(
        isEn
          ? `PDPL ${requestType} request submitted (${res.status}).`
          : `تم تسجيل طلب حماية البيانات (${requestType}) بنجاح.`
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-slate-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-[#0D6E4F]" />
        <span className="text-sm">{isEn ? 'Loading subscription...' : 'جاري تحميل بيانات الاشتراك...'}</span>
      </div>
    );
  }

  const sub = overview?.subscription;
  const usage = overview?.usage;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Status Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#0D6E4F]" />
            <h2 className="text-lg font-extrabold text-slate-900">
              {isEn ? 'Subscription & Billing' : 'الاشتراك والفوترة السحابية'}
            </h2>
            {sub && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-[#0D6E4F] border border-emerald-200">
                {sub.status} · {sub.planCode}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {isEn
              ? 'Hosted payment checkout with server-verified webhook activation (15% Saudi VAT included).'
              : 'دفع إلكتروني مستضاف وتفعيل آلي موثق عبر Webhook (شامل ضريبة القيمة المضافة 15%).'}
          </p>
        </div>

        {sub && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleToggleAutoRenew}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>
                {sub.autoRenew
                  ? isEn
                    ? 'Auto-Renew: ON'
                    : 'التجديد التلقائي: مفعل'
                  : isEn
                    ? 'Auto-Renew: OFF'
                    : 'التجديد التلقائي: متوقف'}
              </span>
            </button>
            {sub.status !== 'CANCELLED' && (
              <button
                type="button"
                disabled={busy}
                onClick={handleCancelSubscription}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{isEn ? 'Cancel Plan' : 'إلغاء الاشتراك'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[#0D6E4F] text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{feedback}</span>
        </div>
      )}

      {checkoutInfo && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1.5">
          <div className="font-bold flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>
              {isEn
                ? `Hosted Checkout Session Created (${checkoutInfo.invoiceNumber})`
                : `تم إنشاء جلسة دفع مستضافة (${checkoutInfo.invoiceNumber})`}
            </span>
          </div>
          <p>{checkoutInfo.note}</p>
          <div className="font-mono text-[11px] break-all bg-white/80 p-2 rounded-lg border border-amber-200">
            {checkoutInfo.hostedCheckoutUrl}
          </div>
        </div>
      )}

      {/* Usage Meters */}
      {sub && usage && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: isEn ? 'Branches' : 'الفروع', val: usage.branches, max: sub.maxBranches },
            { label: isEn ? 'POS Devices' : 'أجهزة الكاشير', val: usage.devices, max: sub.maxDevices },
            { label: isEn ? 'Users' : 'المستخدمون', val: usage.users, max: sub.maxUsers },
            { label: isEn ? 'Legal Entities' : 'الكيانات القانونية', val: usage.legalEntities, max: null },
          ].map((m) => (
            <div key={m.label} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
              <div className="text-xs text-slate-500">{m.label}</div>
              <div className="text-xl font-extrabold text-slate-900 mt-1">
                {m.val} {m.max !== null && <span className="text-xs font-normal text-slate-400">/ {m.max}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Plan Upgrade / Checkout */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-bold text-slate-900">
            {isEn ? 'Available Plans & Upgrades' : 'الباقات المتاحة والترقية'}
          </h3>
          <div className="inline-flex rounded-xl border border-slate-200 p-1 bg-slate-50">
            <button
              type="button"
              onClick={() => setBillingCycle('MONTHLY')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                billingCycle === 'MONTHLY' ? 'bg-[#0D6E4F] text-white' : 'text-slate-600'
              }`}
            >
              {isEn ? 'Monthly' : 'شهري'}
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('ANNUAL')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                billingCycle === 'ANNUAL' ? 'bg-[#0D6E4F] text-white' : 'text-slate-600'
              }`}
            >
              {isEn ? 'Annual' : 'سنوي'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((p) => {
            const price = billingCycle === 'ANNUAL' ? p.annualPriceSar : p.monthlyPriceSar;
            const isCurrent = sub?.planCode === p.code;
            return (
              <div
                key={p.id}
                className={`p-4 rounded-2xl border flex flex-col justify-between gap-4 ${
                  isCurrent ? 'border-[#0D6E4F] bg-emerald-50/30' : 'border-slate-200 bg-white'
                }`}
              >
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    {isEn ? p.nameEn : p.nameAr}
                  </div>
                  <div className="text-2xl font-extrabold text-[#0D6E4F] mt-1">
                    {price} <span className="text-xs font-medium text-slate-500">SAR</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {p.maxBranches} {isEn ? 'branches' : 'فروع'} · {p.maxDevices}{' '}
                    {isEn ? 'devices' : 'أجهزة'} · {p.maxUsers} {isEn ? 'users' : 'مستخدم'}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleStartCheckout(p.code)}
                  className="w-full py-2 rounded-xl bg-[#0D6E4F] hover:bg-[#0A5A40] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {isCurrent
                    ? isEn
                      ? 'Renew / Pay Now'
                      : 'تجديد / دفع الآن'
                    : isEn
                      ? 'Upgrade via Hosted Checkout'
                      : 'ترقية والدفع'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invoices Table & PDPL Rights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Receipt className="w-4 h-4 text-[#0D6E4F]" />
            <span>{isEn ? 'SaaS Invoices' : 'فواتير الاشتراك'}</span>
          </div>
          {!overview?.invoices?.length ? (
            <p className="text-xs text-slate-500">
              {isEn ? 'No subscription invoices issued yet.' : 'لا توجد فواتير اشتراك صادرة بعد.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-start">
                <thead className="text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="py-2 text-start">{isEn ? 'Invoice' : 'رقم الفاتورة'}</th>
                    <th className="py-2 text-start">{isEn ? 'Plan' : 'الباقة'}</th>
                    <th className="py-2 text-start">{isEn ? 'Total (SAR)' : 'الإجمالي'}</th>
                    <th className="py-2 text-start">{isEn ? 'Status' : 'الحالة'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {overview.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-2 font-mono">{inv.invoiceNumber}</td>
                      <td className="py-2">
                        {inv.planCode} ({inv.billingCycle})
                      </td>
                      <td className="py-2 font-bold">{inv.totalSar} SAR</td>
                      <td className="py-2">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 font-semibold">
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <ShieldCheck className="w-4 h-4 text-[#0D6E4F]" />
            <span>{isEn ? 'Saudi PDPL Data Rights' : 'حقوق البيانات (PDPL)'}</span>
          </div>
          <p className="text-xs text-slate-500">
            {isEn
              ? 'Submit an auditable Personal Data Protection request.'
              : 'تقديم طلب رسمي موثق بخصوص بيانات المنشأة وفق نظام حماية البيانات الشخصية.'}
          </p>
          <div className="space-y-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => handlePdplRequest('EXPORT')}
              className="w-full py-2 px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {isEn ? 'Request Data Export' : 'طلب تصدير البيانات'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handlePdplRequest('CORRECTION')}
              className="w-full py-2 px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {isEn ? 'Request Data Correction' : 'طلب تصحيح البيانات'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
