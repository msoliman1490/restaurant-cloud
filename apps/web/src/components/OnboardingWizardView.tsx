import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  Circle,
  Loader2,
  MonitorSmartphone,
  Percent,
  Sparkles,
  Users,
  Warehouse,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
} from 'lucide-react';
import { apiClient } from '../api/client';
import type { NavTab } from '../config/navigation';

interface OnboardingData {
  id: string;
  tenantId: string;
  completedSteps: string[];
  currentStep: string;
  isCompleted: boolean;
}

interface OnboardingWizardViewProps {
  locale: 'ar' | 'en';
  onNavigate: (tab: NavTab) => void;
}

const CHECKLIST_ITEMS: Array<{
  key: string;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  targetTab: NavTab;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    key: 'legal_entity',
    titleAr: 'الكيان القانوني والعنوان الوطني',
    titleEn: 'Legal Entity & National Address',
    descAr: 'مراجعة السجل التجاري والرقم الضريبي والعنوان الوطني السعودي.',
    descEn: 'Verify CR, 15-digit VAT number, and Saudi National Address.',
    targetTab: 'entities',
    icon: Building2,
  },
  {
    key: 'branch',
    titleAr: 'الفروع التشغيلية',
    titleEn: 'Operational Branches',
    descAr: 'إدارة الفرع الرئيسي وإضافة أي فروع إضافية.',
    descEn: 'Review your primary branch and add additional locations.',
    targetTab: 'entities',
    icon: Building2,
  },
  {
    key: 'warehouse',
    titleAr: 'المستودعات والمخزون',
    titleEn: 'Warehouses & Inventory',
    descAr: 'تأكيد ربط المستودع الرئيسي وتهيئة وحدات القياس.',
    descEn: 'Confirm default warehouse setup and inventory tracking.',
    targetTab: 'inventory',
    icon: Warehouse,
  },
  {
    key: 'tax',
    titleAr: 'إعدادات الضريبة والفوترة (اختياري لاحقاً لـ ZATCA OTP)',
    titleEn: 'Tax & Invoicing Settings (ZATCA OTP Optional)',
    descAr: 'ضبط ضريبة القيمة المضافة 15% وتنسيق الفواتير دون إجبار ربط ZATCA الآن.',
    descEn: 'Configure 15% VAT & receipt layout; ZATCA OTP can be linked when ready.',
    targetTab: 'settings',
    icon: Percent,
  },
  {
    key: 'users',
    titleAr: 'المستخدمون والأدوار',
    titleEn: 'Users & RBAC Roles',
    descAr: 'دعوة الكاشير ومدير الفرع والمحاسب وتعيين الصلاحيات.',
    descEn: 'Invite cashiers, branch managers, and accountants with scoped roles.',
    targetTab: 'users',
    icon: Users,
  },
  {
    key: 'devices',
    titleAr: 'أجهزة نقاط البيع',
    titleEn: 'POS Terminals & Devices',
    descAr: 'تسجيل أجهزة الكاشير والطابعات الحرارية 80mm.',
    descEn: 'Register POS terminals and 80mm thermal receipt printers.',
    targetTab: 'entities',
    icon: MonitorSmartphone,
  },
  {
    key: 'industry',
    titleAr: 'حزمة النشاط التجاري',
    titleEn: 'Industry Sector Pack',
    descAr: 'تفعيل خصائص المطاعم أو المقاهي أو التجزئة.',
    descEn: 'Customize active capabilities for Restaurant, Cafe, or Retail.',
    targetTab: 'industries',
    icon: Sparkles,
  },
];

export const OnboardingWizardView: React.FC<OnboardingWizardViewProps> = ({
  locale,
  onNavigate,
}) => {
  const isEn = locale === 'en';
  const [data, setData] = useState<OnboardingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadProgress = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<OnboardingData>('/saas/onboarding');
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProgress();
  }, []);

  const toggleStep = async (stepKey: string) => {
    if (!data) return;
    setSaving(true);
    try {
      const next = data.completedSteps.includes(stepKey)
        ? data.completedSteps
        : [...data.completedSteps, stepKey];
      const allDone = CHECKLIST_ITEMS.every((i) => next.includes(i.key));
      const updated = await apiClient.patch<OnboardingData>('/saas/onboarding', {
        currentStep: stepKey,
        completedSteps: next,
        isCompleted: allDone,
      });
      setData(updated);
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteOrSkip = async (skip: boolean) => {
    setSaving(true);
    try {
      await apiClient.patch<OnboardingData>('/saas/onboarding', {
        isCompleted: !skip,
        skipped: skip,
      });
      onNavigate('dashboard');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-slate-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-[#0D6E4F]" />
        <span className="text-sm">{isEn ? 'Loading setup checklist...' : 'جاري تحميل قائمة التهيئة...'}</span>
      </div>
    );
  }

  const completed = data?.completedSteps ?? [];
  const pct = Math.round((completed.length / CHECKLIST_ITEMS.length) * 100);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0D6E4F]">
              <ShieldCheck className="w-4 h-4" />
              <span>{isEn ? 'Guided Workspace Onboarding' : 'معالج تهيئة المنشأة الموجه'}</span>
            </div>
            <h2 className="text-xl font-extrabold text-slate-900">
              {isEn ? 'Complete Your Operational Readiness' : 'استكمال الجاهزية التشغيلية للمنشأة'}
            </h2>
            <p className="text-xs text-slate-500">
              {isEn
                ? 'Your progress is saved automatically. You can resume anytime.'
                : 'يتم حفظ تقدمك تلقائياً ويمكنك المتابعة في أي وقت.'}
            </p>
          </div>
          <div className="text-end">
            <div className="text-2xl font-extrabold text-[#0D6E4F]">{pct}%</div>
            <div className="text-xs text-slate-500">
              {completed.length} / {CHECKLIST_ITEMS.length} {isEn ? 'steps' : 'خطوات'}
            </div>
          </div>
        </div>

        <div className="mt-4 h-2 w-full bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#0D6E4F] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="space-y-3">
        {CHECKLIST_ITEMS.map((item) => {
          const isDone = completed.includes(item.key);
          const Icon = item.icon;
          return (
            <div
              key={item.key}
              className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => toggleStep(item.key)}
                  className="mt-0.5 text-[#0D6E4F] cursor-pointer"
                  aria-label={item.key}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-300" />
                  )}
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-slate-500" />
                    <span className="text-sm font-bold text-slate-900">
                      {isEn ? item.titleEn : item.titleAr}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isEn ? item.descEn : item.descAr}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!isDone && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => toggleStep(item.key)}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    {isEn ? 'Mark Done' : 'تحديد كمكتمل'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onNavigate(item.targetTab)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-50 text-[#0D6E4F] hover:bg-emerald-100 text-xs font-bold cursor-pointer"
                >
                  <span>{isEn ? 'Open' : 'فتح القسم'}</span>
                  {isEn ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => handleCompleteOrSkip(true)}
          className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          {isEn ? 'Continue Later' : 'المتابعة لاحقاً'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => handleCompleteOrSkip(false)}
          className="px-5 py-2 rounded-xl bg-[#0D6E4F] hover:bg-[#0A5A40] text-white text-xs font-bold cursor-pointer"
        >
          {isEn ? 'Finish & Go to Dashboard' : 'إنهاء والانتقال للوحة التحكم'}
        </button>
      </div>
    </div>
  );
};
