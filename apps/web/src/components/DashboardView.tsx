import React, { useEffect, useState, useCallback } from 'react';
import {
  Building,
  Store,
  MonitorCheck,
  CheckCircle2,
  Shield,
  ArrowUpRight,
  Warehouse,
  TrendingUp,
  ShoppingCart,
  Package,
  AlertCircle,
  RefreshCw,
  Loader2,
  Download,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import { exportToCsv } from '../utils/export';

interface DashboardSummary {
  salesToday: { orderCount: number; totalAmount: number };
  weeklySales: Array<{ day: string; total: number; orders: number }>;
  purchasing: {
    openPoCount: number;
    openPoAmount: number;
    unpaidInvoiceCount: number;
    unpaidInvoiceAmount: number;
  };
  inventory: { trackedBalances: number; totalOnHandQty: number };
  zatca: { egsUnitsCount: number };
}

interface DashboardViewProps {
  onNavigateToCatalog: () => void;
  onNavigateToInventory: () => void;
  locale?: 'ar' | 'en';
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigateToCatalog,
  onNavigateToInventory,
  locale = 'ar',
}) => {
  const { activeTenant, activeBranch, activeLegalEntity, hierarchy } = useAuth();
  const isEn = locale === 'en';
  const currency = isEn ? 'SAR' : 'ر.س';

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.request<DashboardSummary>('/tenants/dashboard-summary');
      setSummary(res ?? null);
    } catch (err: unknown) {
      setError(
        (err as Error)?.message ||
          (isEn
            ? 'Failed to load live dashboard metrics.'
            : 'تعذر تحميل مؤشرات لوحة التحكم الحية.')
      );
    } finally {
      setIsLoading(false);
    }
  }, [isEn]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary, activeTenant?.id]);

  const entityCount = hierarchy?.legalEntities.length || 0;
  const branchCount = hierarchy?.branches.length || 0;
  const warehouseCount = hierarchy?.warehouses.length || 0;
  const deviceCount = hierarchy?.devices.length || 0;

  const days: Array<{ date: string; label: string; total: number; orders: number }> = [];
  const dayMap = new Map(
    (summary?.weeklySales || []).map((d) => [d.day, { total: d.total, orders: d.orders }])
  );
  for (let i = 6; i >= 0; i--) {
    const dt = new Date();
    dt.setUTCDate(dt.getUTCDate() - i);
    const key = dt.toISOString().slice(0, 10);
    const found = dayMap.get(key);
    days.push({
      date: key,
      label: key.slice(5),
      total: found?.total || 0,
      orders: found?.orders || 0,
    });
  }
  const maxVal = Math.max(...days.map((d) => d.total), 1);

  const handleExportWeeklySales = () => {
    exportToCsv(
      `weekly-sales-${new Date().toISOString().slice(0, 10)}.csv`,
      days,
      [
        { key: 'date', header: isEn ? 'Date' : 'التاريخ' },
        { key: 'orders', header: isEn ? 'Orders' : 'عدد الطلبات' },
        { key: 'total', header: isEn ? 'Total (SAR)' : 'الإجمالي (ر.س)' },
      ]
    );
  };

  return (
    <div className="space-y-6">
      {/* Executive Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 text-white shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800/70 mb-3">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              {isEn ? 'Live Context: PostgreSQL 16 + RLS' : 'سياق حي: PostgreSQL 16 + RLS'}
            </span>
            <h2 className="text-xl md:text-2xl font-bold mb-2">
              {isEn
                ? `Welcome to ${activeTenant?.name || 'Restaurant Cloud'}`
                : `مرحباً بك في ${activeTenant?.name || 'منصة Restaurant Cloud'}`}
            </h2>
            <p className="text-slate-300 text-sm leading-relaxed">
              {isEn ? 'Active Branch:' : 'الفرع النشط حالياً:'}{' '}
              <strong className="text-white">
                {activeBranch
                  ? `${activeBranch.name} (${activeBranch.code})`
                  : isEn
                  ? 'Not selected'
                  : 'غير محدد'}
              </strong>{' '}
              • {isEn ? 'Legal Entity:' : 'الكيان القانوني:'}{' '}
              <strong className="text-white">
                {activeLegalEntity
                  ? activeLegalEntity.legalName
                  : isEn
                  ? 'Main Entity'
                  : 'الشركة الرئيسية'}
              </strong>
            </p>
          </div>

          <div className="flex flex-wrap gap-3 shrink-0">
            <button
              type="button"
              onClick={onNavigateToCatalog}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-lg font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>{isEn ? 'Browse Catalog' : 'استعراض كتالوج الأصناف'}</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onNavigateToInventory}
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 px-4 py-2.5 rounded-lg font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>{isEn ? 'Inventory & Transfers' : 'أرصدة المستودعات والمناقلات'}</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Error State Banner */}
      {error && (
        <div
          role="alert"
          className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
          <button
            type="button"
            onClick={loadSummary}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-100 font-semibold transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{isEn ? 'Retry' : 'إعادة المحاولة'}</span>
          </button>
        </div>
      )}

      {/* Organizational Hierarchy Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rc-card p-5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>{isEn ? 'Legal Entities' : 'الكيانات القانونية المعتمدة'}</span>
            <Building className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
            {entityCount}{' '}
            <span className="text-sm font-sans font-semibold text-slate-600">
              {isEn ? (entityCount === 1 ? 'Entity' : 'Entities') : entityCount === 1 ? 'كيان' : 'كيانات'}
            </span>
          </p>
          <span className="text-xs text-emerald-700 font-medium mt-1.5 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {isEn ? 'Live database records' : 'بيانات حية من قاعدة البيانات'}
          </span>
        </div>

        <div className="rc-card p-5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>{isEn ? 'Registered Branches' : 'الفروع المسجلة للشركة'}</span>
            <Store className="w-4 h-4 text-slate-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
            {branchCount}{' '}
            <span className="text-sm font-sans font-semibold text-slate-600">
              {isEn ? (branchCount === 1 ? 'Branch' : 'Branches') : branchCount === 1 ? 'فرع' : 'فروع'}
            </span>
          </p>
          <span className="text-xs text-slate-500 mt-1.5 block truncate">
            {hierarchy?.branches.map((b) => b.name).slice(0, 2).join(isEn ? ', ' : '، ') ||
              (isEn ? 'Main Branch' : 'فرع رئيسي')}
          </span>
        </div>

        <div className="rc-card p-5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>{isEn ? 'Warehouses' : 'المستودعات والتموين'}</span>
            <Warehouse className="w-4 h-4 text-slate-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
            {warehouseCount}{' '}
            <span className="text-sm font-sans font-semibold text-slate-600">
              {isEn
                ? warehouseCount === 1
                  ? 'Warehouse'
                  : 'Warehouses'
                : warehouseCount === 1
                ? 'مستودع'
                : 'مستودعات'}
            </span>
          </p>
          <span className="text-xs text-slate-500 mt-1.5 block">
            {isEn
              ? 'Isolated stock ownership & shared hubs'
              : 'عزل ملكية المخزون مع دعم المستودع المشترك'}
          </span>
        </div>

        <div className="rc-card p-5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>{isEn ? 'POS Terminals' : 'أجهزة ونقاط البيع المسجلة'}</span>
            <MonitorCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
            {deviceCount}{' '}
            <span className="text-sm font-sans font-semibold text-slate-600">
              {isEn ? (deviceCount === 1 ? 'Device' : 'Devices') : deviceCount === 1 ? 'جهاز' : 'أجهزة'}
            </span>
          </p>
          <span className="text-xs text-emerald-700 font-medium mt-1.5 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {isEn ? 'Authorized per branch' : 'معتمدة على مستوى الفروع'}
          </span>
        </div>
      </div>

      {/* Live Operational KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rc-card p-5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>{isEn ? "Today's Sales (POS & Dining)" : 'مبيعات اليوم (POS & Dining)'}</span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          {isLoading ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span>{isEn ? 'Loading...' : 'جارٍ التحميل...'}</span>
            </div>
          ) : (
            <>
              <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
                {(summary?.salesToday.totalAmount ?? 0).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                })}{' '}
                <span className="text-sm font-semibold text-slate-500">{currency}</span>
              </p>
              <span className="text-xs text-slate-500 mt-1.5 block">
                {summary?.salesToday.orderCount ?? 0}{' '}
                {isEn ? 'orders recorded today' : 'طلبات مسجلة اليوم'}
              </span>
            </>
          )}
        </div>

        <div className="rc-card p-5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>
              {isEn ? 'Purchasing & Payables' : 'أوامر الشراء والذمم الدائنة'}
            </span>
            <ShoppingCart className="w-4 h-4 text-slate-600" />
          </div>
          {isLoading ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span>{isEn ? 'Loading...' : 'جارٍ التحميل...'}</span>
            </div>
          ) : (
            <>
              <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
                {(summary?.purchasing.unpaidInvoiceAmount ?? 0).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                })}{' '}
                <span className="text-sm font-semibold text-slate-500">{currency}</span>
              </p>
              <span className="text-xs text-slate-500 mt-1.5 block">
                {isEn
                  ? `${summary?.purchasing.openPoCount ?? 0} open POs • ${summary?.purchasing.unpaidInvoiceCount ?? 0} unpaid invoices`
                  : `${summary?.purchasing.openPoCount ?? 0} أمر شراء مفتوح • ${summary?.purchasing.unpaidInvoiceCount ?? 0} فاتورة مستحقة`}
              </span>
            </>
          )}
        </div>

        <div className="rc-card p-5">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>{isEn ? 'Available Inventory' : 'الرصيد المخزني المتاح'}</span>
            <Package className="w-4 h-4 text-amber-600" />
          </div>
          {isLoading ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span>{isEn ? 'Loading...' : 'جارٍ التحميل...'}</span>
            </div>
          ) : (
            <>
              <p className="text-2xl font-bold text-slate-900 mt-2 font-mono">
                {(summary?.inventory.totalOnHandQty ?? 0).toLocaleString('en-US', {
                  maximumFractionDigits: 2,
                })}{' '}
                <span className="text-sm font-sans font-semibold text-slate-500">
                  {isEn ? 'units' : 'وحدة'}
                </span>
              </p>
              <span className="text-xs text-slate-500 mt-1.5 block">
                {isEn
                  ? `Across ${summary?.inventory.trackedBalances ?? 0} active stock records`
                  : `عبر ${summary?.inventory.trackedBalances ?? 0} سجل مخزون نشط`}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Live 7-Day Sales Chart & Compliance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rc-card p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-slate-800">
                {isEn ? 'Sales Trend (Last 7 Days)' : 'مخطط المبيعات (آخر 7 أيام)'}
              </h3>
              <span className="rc-badge-emerald">
                {isEn ? 'Live PostgreSQL' : 'بيانات حية'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleExportWeeklySales}
              aria-label={isEn ? 'Export weekly sales CSV' : 'تصدير مبيعات الأسبوع CSV'}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>

          <div className="h-44 flex items-end justify-between gap-2 pt-6">
            {days.map((d, idx) => {
              const pct =
                d.total > 0 ? Math.max(8, Math.round((d.total / maxVal) * 100)) : 4;
              return (
                <div
                  key={idx}
                  className="flex-1 flex flex-col items-center gap-2"
                  title={`${d.date}: ${d.total.toFixed(2)} SAR`}
                >
                  <div
                    className={`w-full rounded-md transition-all ${
                      d.total > 0
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : 'bg-slate-100'
                    }`}
                    style={{ height: `${pct}%` }}
                  />
                  <span className="text-[10px] text-slate-500 font-mono">{d.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rc-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm text-slate-800">
              {isEn ? 'Saudi Compliance & Integrations' : 'الامتثال والتكاملات السعودية'}
            </h3>
            <span className="rc-badge-slate">
              {isEn ? 'Current Status' : 'الحالة الحالية'}
            </span>
          </div>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200/70">
              <span className="font-medium text-slate-700">
                {isEn ? 'VAT 15% Calculation' : 'ضريبة القيمة المضافة 15%'}
              </span>
              <span className="text-emerald-700 font-bold">
                {isEn ? 'Active & Verified' : 'محتسبة ومختبرة'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200/70">
              <span className="font-medium text-slate-700">
                {isEn ? 'Unified Entity Invoice Sequencing' : 'ترقيم الفواتير الموحد للكيان'}
              </span>
              <span className="text-emerald-700 font-bold">
                {isEn ? 'Enforced' : 'معتمد برمجياً'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200/70">
              <span className="font-medium text-slate-700">
                {isEn ? 'Registered ZATCA Phase 2 Units' : 'وحدات ZATCA Phase 2 المسجلة'}
              </span>
              <span className="text-slate-900 font-bold font-mono">
                {summary?.zatca.egsUnitsCount ?? 0} {isEn ? 'EGS Units' : 'وحدة EGS'}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200/70">
              <span className="font-medium text-slate-700">
                {isEn ? 'WhatsApp & Webhook Notifications' : 'إشعارات WhatsApp و Webhooks'}
              </span>
              <span className="text-emerald-700 font-bold">
                {isEn ? 'Configurable in Settings' : 'جاهز من الإعدادات'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
