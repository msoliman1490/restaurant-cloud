import React from 'react';
import {
  Building,
  Store,
  MonitorCheck,
  CheckCircle2,
  Shield,
  ArrowUpRight,
  Warehouse,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface DashboardViewProps {
  onNavigateToCatalog: () => void;
  onNavigateToInventory: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigateToCatalog,
  onNavigateToInventory,
}) => {
  const { activeTenant, activeBranch, activeLegalEntity, hierarchy } = useAuth();

  const entityCount = hierarchy?.legalEntities.length || 0;
  const branchCount = hierarchy?.branches.length || 0;
  const warehouseCount = hierarchy?.warehouses.length || 0;
  const deviceCount = hierarchy?.devices.length || 0;

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 rounded-3xl p-8 text-white relative overflow-hidden shadow-lg shadow-indigo-950/20">
        <div className="relative z-10 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30 mb-3">
            <Shield className="w-3.5 h-3.5" />
            سياق حي: PostgreSQL 16 + RLS
          </span>
          <h2 className="text-2xl font-black mb-2">
            مرحباً بك في {activeTenant?.name || 'منصة Restaurant Cloud'}
          </h2>
          <p className="text-indigo-200 text-sm leading-relaxed mb-6">
            النظام متصل بقاعدة البيانات المركزية. الفرع النشط حالياً:{' '}
            <strong className="text-white">
              {activeBranch ? `${activeBranch.name} (${activeBranch.code})` : 'غير محدد'}
            </strong>{' '}
            • الكيان القانوني:{' '}
            <strong className="text-white">
              {activeLegalEntity ? activeLegalEntity.legalName : 'الشركة الرئيسية'}
            </strong>
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={onNavigateToCatalog}
              className="bg-white text-slate-900 px-4 py-2.5 rounded-xl font-bold text-xs hover:bg-slate-100 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>استعراض كتالوج الأصناف</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
            <button
              onClick={onNavigateToInventory}
              className="bg-indigo-600/60 hover:bg-indigo-600 border border-indigo-400/40 text-white px-4 py-2.5 rounded-xl font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>أرصدة المستودعات والمناقلات</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Real Organizational Hierarchy Stats (Live from Backend Database) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Real Legal Entities */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>الكيانات القانونية المعتمدة</span>
            <Building className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {entityCount} {entityCount === 1 ? 'كيان' : 'كيانات'}
          </p>
          <span className="text-xs text-emerald-600 font-medium mt-1 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            بيانات حية من قاعدة البيانات
          </span>
        </div>

        {/* Real Branches */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>الفروع المسجلة للشركة</span>
            <Store className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {branchCount} {branchCount === 1 ? 'فرع' : 'فروع'}
          </p>
          <span className="text-xs text-slate-500 mt-1 block">
            {hierarchy?.branches.map((b) => b.name).slice(0, 2).join('، ') || 'فرع رئيسي'}
          </span>
        </div>

        {/* Real Warehouses */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>المستودعات والتموين</span>
            <Warehouse className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {warehouseCount} {warehouseCount === 1 ? 'مستودع' : 'مستودعات'}
          </p>
          <span className="text-xs text-slate-500 mt-1 block">
            عزل ملكية المخزون مع دعم المستودع المشترك
          </span>
        </div>

        {/* Real POS Devices */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>أجهزة ونقاط البيع المسجلة</span>
            <MonitorCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">
            {deviceCount} {deviceCount === 1 ? 'جهاز' : 'أجهزة'}
          </p>
          <span className="text-xs text-emerald-600 font-medium mt-1 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            معتمدة على مستوى الفروع
          </span>
        </div>
      </div>

      {/* Simulated Shift & POS Activity Notice (Transparent Labeling) */}
      <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex items-start gap-3 text-xs text-amber-800">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">تنبيه الشفافية (Preview Data Notice):</span>{' '}
          بيانات الهيكل التنظيمي (الشركات، الفروع، والمستودعات أعلاه) مستخرجة مباشرة من قاعدة البيانات. بينما الرسوم البيانية وأرقام مبيعات اليوم أدناه هي قيم استعراضية تجريبية (Mock Data) لحين ربط حركات البيع الحية في المرحلة التالية.
        </div>
      </div>

      {/* Additional Visual Dashboard Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h3 className="font-bold text-sm text-slate-800 mb-4 flex items-center justify-between">
            <span>مخطط المبيعات الأسبوعية</span>
            <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
              بيانات تجريبية (Preview)
            </span>
          </h3>
          <div className="h-44 flex items-end justify-between gap-2 pt-6">
            {[45, 60, 75, 50, 90, 80, 95].map((val, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className="w-full bg-indigo-100 hover:bg-indigo-600 rounded-lg transition-all"
                  style={{ height: `${val}%` }}
                />
                <span className="text-[10px] text-slate-400">
                  {['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'][idx]}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h3 className="font-bold text-sm text-slate-800 mb-4 flex items-center justify-between">
            <span>الامتثال والتكاملات السعودية</span>
            <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
              الحالة الحالية
            </span>
          </h3>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="font-medium text-slate-700">ضريبة القيمة المضافة 15%</span>
              <span className="text-emerald-600 font-bold">محتسبة ومختبرة</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="font-medium text-slate-700">ترقيم الفواتير الموحد للكيان</span>
              <span className="text-emerald-600 font-bold">معتمد برمجياً</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="font-medium text-slate-700">الربط المباشر مع ZATCA Phase 2</span>
              <span className="text-amber-600 font-semibold">مرحلة قادمة (Simulation)</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
              <span className="font-medium text-slate-700">بوابات الدفع وأجهزة مدى</span>
              <span className="text-amber-600 font-semibold">مرحلة قادمة (Simulation)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
