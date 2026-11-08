import React, { useState } from 'react';
import {
  CheckCircle2,
  Sparkles,
  UtensilsCrossed,
  Coffee,
  Store,
  Cake,
  Truck,
  ShoppingBag,
  Zap,
} from 'lucide-react';

export interface IndustryPackConfig {
  id: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  icon: any;
  capabilities: string[];
  badgeColor: string;
}

export const AVAILABLE_PACKS: IndustryPackConfig[] = [
  {
    id: 'RESTAURANT',
    nameAr: 'قطاع المطاعم الفاخرة والسريعة (Restaurant)',
    nameEn: 'Full-Service & Fast Food Restaurants',
    descriptionAr: 'يشمل إدارة الطاولات، صالات الطعام، شاشات المطبخ KDS، وصفات الوجبات وتكلفة الأطباق BOM.',
    icon: UtensilsCrossed,
    capabilities: [
      'إدارة الطاولات وصالات الضيافة (Tables & Dining)',
      'شاشات المطبخ وأوامر التحضير (KDS Orders)',
      'هندسة الوجبات وبطاقات الوصفات (Recipe BOM)',
      'حساب تكلفة الطعام الفعلي (Food Costing)',
    ],
    badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  },
  {
    id: 'CAFE',
    nameAr: 'قطاع المقاهي والمشروبات المختصة (Cafe & Specialty Coffee)',
    nameEn: 'Specialty Cafes & Drive-Thru',
    descriptionAr: 'يشمل تخصيص الإضافات (الحليب، السيرب)، أحجام المشروبات، ونقاط الولاء السريعة للكاشير.',
    icon: Coffee,
    capabilities: [
      'تخصيص الإضافات وتعديل المشروبات (Drink Customizations)',
      'أحجام متغيرة مع تسعير تلقائي (Size Pricing Matrix)',
      'طلبات السيارات السريعة (Drive-Thru Fast Checkout)',
      'نقاط المكافآت والولاء (Loyalty Rewards)',
    ],
    badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  },
  {
    id: 'GROCERY',
    nameAr: 'قطاع التموينات والسوبرماركت (Grocery & Supermarkets)',
    nameEn: 'Retail Groceries & Mini-Markets',
    descriptionAr: 'يشمل مسح الباركود السريع، ربط الميزان الإلكتروني، متابعة تواريخ الصلاحية، ودفعات المنتجات.',
    icon: Store,
    capabilities: [
      'مسح الباركود عالي السرعة للكاشير (Fast Barcode POS)',
      'أصناف بالوزن وربط الميزان (Weight Scale Integration)',
      'تتبع تواريخ الانتهاء ورقم التشغيلة (Expiry & Lot Tracking)',
      'إعادة تعبئة المخزون السريع (Rapid Replenishment)',
    ],
    badgeColor: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  },
  {
    id: 'BAKERY',
    nameAr: 'قطاع المخابز والحلويات (Bakeries & Sweets)',
    nameEn: 'Artisan Bakeries & Pastry Shops',
    descriptionAr: 'يشمل إدارة خَبز الدفعات اليومية، تتبع هدر الصباح والمساء، وحساب استهلاك الدقيق والزبدة.',
    icon: Cake,
    capabilities: [
      'دفعات الخَبز والإنتاج اليومي (Daily Baking Batches)',
      'متابعة هدر نهاية اليوم (End-of-day Waste Tracking)',
      'تسعير الصواني والقطع (Tray & Piece Pricing)',
    ],
    badgeColor: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  },
  {
    id: 'CATERING',
    nameAr: 'قطاع الإعاشة والحفلات الخارجية (Catering & Events)',
    nameEn: 'Catering Services & Event Dining',
    descriptionAr: 'يشمل عقود الولائم والمناسبات، جدول مواعيد التسليم، وقوائم التجهيز اللوجستي الضخم.',
    icon: Truck,
    capabilities: [
      'عقود الإعاشة والولائم (Catering Event Contracts)',
      'جدولة مواعيد التسليم الموقوتة (Event Delivery Schedules)',
      'أوامر إنتاج وتجهيز ضخمة (Large-scale Preparation BOM)',
    ],
    badgeColor: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  },
  {
    id: 'RETAIL',
    nameAr: 'قطاع التجزئة العام والملبوسات (General Retail)',
    nameEn: 'Apparel & General Retail Stores',
    descriptionAr: 'يشمل مصفوفة الأصناف (اللون/المقاس)، بطاقات الهدايا، وحسابات العملاء الآجلة.',
    icon: ShoppingBag,
    capabilities: [
      'مصفوفة المتغيرات: المقاس واللون (Variants Matrix)',
      'بطاقات الإهداء والقسائم (Gift Cards & Vouchers)',
      'حسابات العملاء والبيع الآجل (Customer Credit Accounts)',
    ],
    badgeColor: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  },
];

interface IndustryPacksViewProps {
  activeIndustries: string[];
  onToggleIndustry: (industryId: string) => void;
}

export const IndustryPacksView: React.FC<IndustryPacksViewProps> = ({
  activeIndustries,
  onToggleIndustry,
}) => {
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const handleToggle = (pack: IndustryPackConfig) => {
    const isCurrentlyActive = activeIndustries.includes(pack.id);
    onToggleIndustry(pack.id);

    const msg = isCurrentlyActive
      ? `تم إيقاف تفعيل ${pack.nameAr} مؤقتاً (تم حفظ كافة البيانات السابقة بأمان)`
      : `تم تفعيل ${pack.nameAr} بنجاح! تم تحديث الصلاحيات والشاشات فورياً`;
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3500);
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {successToast && (
        <div className="bg-slate-900 border border-emerald-500/50 text-emerald-400 px-6 py-3.5 rounded-2xl flex items-center justify-between text-sm font-semibold shadow-xl animate-in slide-in-from-top duration-200">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={18} className="text-emerald-400" />
            <span>{successToast}</span>
          </div>
        </div>
      )}

      {/* Subscription Plan Overview Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 rounded-3xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
              <Sparkles size={14} />
              <span>اشتراك المنشأة: الباقة الاحترافية (Multi-Industry Enterprise)</span>
            </div>
            <h2 className="text-2xl font-black">إدارة قطاعات المنشأة وصلاحيات SaaS</h2>
            <p className="text-sm text-slate-300 max-w-2xl">
              تتيح لك منصة Restaurant Cloud تفعيل قطاعات تشغيلية متعددة داخل نفس الحساب وتحت نفس الشركة القانونية والفروع، دون الحاجة لفتح اشتراكات منفصلة أو تشتيت بيانات المحاسبة.
            </p>
          </div>

          <div className="flex gap-4">
            <div className="bg-slate-900/80 border border-slate-700/60 p-4 rounded-2xl text-center min-w-[6.5rem]">
              <span className="text-xs text-slate-400">القطاعات المفعلة</span>
              <p className="text-2xl font-black text-emerald-400 mt-0.5">{activeIndustries.length}</p>
            </div>
            <div className="bg-slate-900/80 border border-slate-700/60 p-4 rounded-2xl text-center min-w-[6.5rem]">
              <span className="text-xs text-slate-400">الفروع المتاحة</span>
              <p className="text-2xl font-black text-indigo-400 mt-0.5">10 / 10</p>
            </div>
            <div className="bg-slate-900/80 border border-slate-700/60 p-4 rounded-2xl text-center min-w-[6.5rem]">
              <span className="text-xs text-slate-400">أجهزة POS</span>
              <p className="text-2xl font-black text-white mt-0.5">25 / 25</p>
            </div>
          </div>
        </div>
      </div>

      {/* Available Industry Packs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {AVAILABLE_PACKS.map((pack) => {
          const Icon = pack.icon;
          const isActive = activeIndustries.includes(pack.id);

          return (
            <div
              key={pack.id}
              className={`bg-white rounded-3xl border transition-all p-6 flex flex-col justify-between ${
                isActive
                  ? 'border-indigo-600 shadow-lg shadow-indigo-600/5 ring-1 ring-indigo-600'
                  : 'border-slate-200 hover:border-slate-300 shadow-sm'
              }`}
            >
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                        isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      <Icon size={24} />
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-slate-900">{pack.nameAr}</h3>
                      <span className="text-xs text-slate-500">{pack.nameEn}</span>
                    </div>
                  </div>

                  <span
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    {isActive ? 'مفعل بحسابك' : 'غير مفعل'}
                  </span>
                </div>

                {/* Description */}
                <p className="text-xs text-slate-600 leading-relaxed">{pack.descriptionAr}</p>

                {/* Capabilities List */}
                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                  <div className="text-[11px] font-semibold text-slate-400">الوظائف والقدرات المتخصصة:</div>
                  {pack.capabilities.map((cap, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-slate-700">
                      <CheckCircle2 size={13} className={isActive ? 'text-indigo-600' : 'text-slate-400'} />
                      <span>{cap}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Button */}
              <div className="mt-6 pt-4 border-t border-slate-100">
                <button
                  onClick={() => handleToggle(pack)}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    isActive
                      ? 'bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-600 border border-slate-200'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20'
                  }`}
                >
                  {isActive ? (
                    <span>إيقاف تفعيل القطاع مؤقتاً</span>
                  ) : (
                    <>
                      <Zap size={14} />
                      <span>تفعيل هذا القطاع داخل حسابك</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
