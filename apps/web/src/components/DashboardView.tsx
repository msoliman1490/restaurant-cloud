import {
  Building,
  Store,
  MonitorCheck,
  CheckCircle2,
  Shield,
  Layers,
  ArrowUpRight,
} from 'lucide-react';

interface DashboardViewProps {
  onNavigateToCatalog: () => void;
  onNavigateToInventory: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigateToCatalog,
  onNavigateToInventory,
}) => {
  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 rounded-3xl p-8 text-white relative overflow-hidden shadow-lg shadow-indigo-950/20">
        <div className="relative z-10 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 mb-3">
            <Shield className="w-3.5 h-3.5" />
            المرحلة 2: محرك الكتالوج والمخزون المالي مكتمل
          </span>
          <h2 className="text-2xl font-black mb-2">منصة Restaurant Cloud المركزية</h2>
          <p className="text-indigo-200 text-sm leading-relaxed mb-6">
            النواة المعمارية المتكاملة: هرمية الشركات المتعددة، عزل المستأجرين على مستوى الصف (RLS)،
            وإدارة المخزون والتكلفة اللحظية المتوافقة مع هيئة الزكاة والضريبة والجمارك (ZATCA).
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={onNavigateToCatalog}
              className="bg-white text-slate-900 px-4 py-2.5 rounded-xl font-bold text-xs hover:bg-slate-100 transition-colors flex items-center gap-1.5"
            >
              <span>استعراض كتالوج الأصناف</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
            <button
              onClick={onNavigateToInventory}
              className="bg-indigo-600/60 hover:bg-indigo-600 border border-indigo-400/40 text-white px-4 py-2.5 rounded-xl font-bold text-xs transition-colors flex items-center gap-1.5"
            >
              <span>أرصدة المستودعات والمناقلات</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>الكيانات القانونية المسجلة</span>
            <Building className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">2 شركات</p>
          <span className="text-xs text-emerald-600 font-medium mt-1 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            أرقام ضريبية مستقلة (15 رقم)
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>الفروع النشطة</span>
            <Store className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">4 فروع</p>
          <span className="text-xs text-slate-500 mt-1 block">الرياض، جدة، الخبر</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>محطات POS المتصلة</span>
            <MonitorCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">8 أجهزة</p>
          <span className="text-xs text-emerald-600 font-medium mt-1 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Offline Quota Leases نشطة
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>التوافق الضريبي ZATCA</span>
            <Shield className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-emerald-600 mt-2">جاهز للاعتماد</p>
          <span className="text-xs text-slate-500 mt-1 block">Phase 2 E-Invoicing</span>
        </div>
      </div>

      {/* Architectural Readiness Checklist */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            حالة حزم المسار الهندسي للمنتج (Engineering Readiness)
          </h3>
          <span className="text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full">
            المرحلة 2 نشطة
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-800">Track A: النواة وقاعدة البيانات</p>
              <p className="text-xs text-slate-500 mt-0.5">
                تطبيق RLS على 18 جدولاً، فهارس مركبة مطابقة، وترحيلات Drizzle migration منظمة.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-800">Track B: خدمات الكتالوج والمخزون</p>
              <p className="text-xs text-slate-500 mt-0.5">
                CRUD متكامل، تسعير الفروع المخصص، ومسار مناقلات المخزون الذري مع التحقق من الأرصدة.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-800">Track E: الاختبارات وجودة الكود</p>
              <p className="text-xs text-slate-500 mt-0.5">
                41 اختباراً محلياً ناجحاً بنسبة 100%، واختبارات تكامل PostgreSQL 16 مهيأة للـ CI.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-800">Track C & D: واجهات Backoffice و POS</p>
              <p className="text-xs text-slate-500 mt-0.5">
                واجهة مستخدم React 19 حديثة بنمط RTL كامل ومصممة خصيصاً للضيافة والمطاعم.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
