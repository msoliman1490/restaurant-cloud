import React from 'react';
import {
  LayoutDashboard,
  UtensilsCrossed,
  Boxes,
  ArrowLeftRight,
  Building2,
  Receipt,
  ShoppingCart,
  ChefHat,
  Utensils,
  BookOpen,
  Layers,
  Users,
  ShieldCheck,
  Settings,
  FileText,
  Lock,
  QrCode,
  Truck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type NavTab =
  | 'dashboard'
  | 'pos'
  | 'catalog'
  | 'inventory'
  | 'transfers'
  | 'purchasing'
  | 'production'
  | 'dining'
  | 'accounting'
  | 'reconciliation'
  | 'period-closing'
  | 'zatca-v2'
  | 'entities'
  | 'users'
  | 'hr'
  | 'delivery'
  | 'roles'
  | 'settings'
  | 'audit'
  | 'industries';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeIndustries?: string[];
  isOpen?: boolean;
  onClose?: () => void;
  locale?: 'ar' | 'en';
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  activeIndustries = ['RESTAURANT'],
  isOpen = false,
  onClose,
  locale = 'ar',
}) => {
  const { role } = useAuth();
  const isCashierOnly = role?.name === 'CASHIER';
  const isEn = locale === 'en';

  const operationsNav = [
    {
      id: 'dashboard' as NavTab,
      labelAr: 'لوحة التحكم',
      labelEn: 'Dashboard',
      icon: LayoutDashboard,
      show: !isCashierOnly,
    },
    {
      id: 'pos' as NavTab,
      labelAr: 'نقاط البيع والكاشير (POS)',
      labelEn: 'Point of Sale (POS)',
      icon: Receipt,
      show: true,
    },
    {
      id: 'catalog' as NavTab,
      labelAr: 'قائمة المنتجات والتسعير',
      labelEn: 'Catalog & Pricing',
      icon: UtensilsCrossed,
      show: !isCashierOnly,
    },
    {
      id: 'dining' as NavTab,
      labelAr: 'إدارة الصالة والطاولات',
      labelEn: 'Dining & Tables',
      icon: Utensils,
      show: !isCashierOnly && activeIndustries.includes('RESTAURANT'),
    },
    {
      id: 'inventory' as NavTab,
      labelAr: 'أرصدة المخزون والتكلفة',
      labelEn: 'Inventory & Costing',
      icon: Boxes,
      show: !isCashierOnly,
    },
    {
      id: 'purchasing' as NavTab,
      labelAr: 'المشتريات وسلاسل الإمداد',
      labelEn: 'Purchasing & Supply',
      icon: ShoppingCart,
      show: !isCashierOnly,
    },
    {
      id: 'production' as NavTab,
      labelAr: 'الوصفات والتصنيع (BOM)',
      labelEn: 'Recipes & Production',
      icon: ChefHat,
      show:
        !isCashierOnly &&
        activeIndustries.some((ind) =>
          ['RESTAURANT', 'CAFE', 'BAKERY', 'CATERING'].includes(ind)
        ),
    },
    {
      id: 'transfers' as NavTab,
      labelAr: 'التحويلات والمناقلات',
      labelEn: 'Stock Transfers',
      icon: ArrowLeftRight,
      show: !isCashierOnly,
    },
  ];

  const filteredOperationsNav = operationsNav.filter((item) => item.show);

  const enterpriseNav = [
    {
      id: 'entities' as NavTab,
      labelAr: 'الشركات والفروع',
      labelEn: 'Entities & Branches',
      icon: Building2,
      show: !isCashierOnly,
    },
    {
      id: 'users' as NavTab,
      labelAr: 'المستخدمون',
      labelEn: 'Users',
      icon: Users,
      show: !isCashierOnly,
    },
    {
      id: 'roles' as NavTab,
      labelAr: 'الأدوار والصلاحيات',
      labelEn: 'Roles & Permissions',
      icon: ShieldCheck,
      show: !isCashierOnly,
    },
    {
      id: 'settings' as NavTab,
      labelAr: 'إعدادات المنشأة',
      labelEn: 'Organization Settings',
      icon: Settings,
      show: !isCashierOnly,
    },
    {
      id: 'audit' as NavTab,
      labelAr: 'سجل الرقابة (Audit)',
      labelEn: 'Audit Logs',
      icon: FileText,
      show: !isCashierOnly,
    },
    {
      id: 'accounting' as NavTab,
      labelAr: 'المحاسبة ودفتر الأستاذ',
      labelEn: 'Accounting & Ledger',
      icon: BookOpen,
      show: !isCashierOnly,
    },
    {
      id: 'reconciliation' as NavTab,
      labelAr: 'المصالحات والتقارير المالية',
      labelEn: 'Reconciliation & Reports',
      icon: ShieldCheck,
      show: !isCashierOnly,
    },
    {
      id: 'period-closing' as NavTab,
      labelAr: 'إقفال الفترات المالية',
      labelEn: 'Period Closing',
      icon: Lock,
      show: !isCashierOnly,
    },
    {
      id: 'zatca-v2' as NavTab,
      labelAr: 'الفوترة الإلكترونية ZATCA V2',
      labelEn: 'ZATCA V2 E-Invoicing',
      icon: QrCode,
      show: !isCashierOnly,
    },
    {
      id: 'hr' as NavTab,
      labelAr: 'الموظفون والموارد البشرية',
      labelEn: 'HR & Employees',
      icon: Users,
      show: !isCashierOnly,
    },
    {
      id: 'delivery' as NavTab,
      labelAr: 'التوصيل والسائقون',
      labelEn: 'Delivery & Drivers',
      icon: Truck,
      show: !isCashierOnly,
    },
    {
      id: 'industries' as NavTab,
      labelAr: 'قطاعات المنشأة وباقات SaaS',
      labelEn: 'Industries & SaaS Packs',
      icon: Layers,
      show: !isCashierOnly,
    },
  ];

  const filteredEnterpriseNav = enterpriseNav.filter((item) => item.show);

  const handleSelect = (tab: NavTab) => {
    onSelectTab(tab);
    onClose?.();
  };

  const drawerSideClass = isEn ? 'left-0 border-r' : 'right-0 border-l';
  const drawerTranslateClass = isOpen
    ? 'translate-x-0'
    : isEn
    ? '-translate-x-full lg:translate-x-0'
    : 'translate-x-full lg:translate-x-0';

  return (
    <>
      {/* Mobile/Tablet Backdrop */}
      {isOpen && (
        <div
          className="no-print fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-[1px] lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`no-print fixed inset-y-0 ${drawerSideClass} z-40 w-64 bg-[#0B1614] text-slate-300 flex flex-col border-[#1E3530] transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 shrink-0 ${drawerTranslateClass}`}
        aria-label={isEn ? 'Main navigation' : 'القائمة الرئيسية'}
      >
        <div className="h-16 flex items-center justify-between px-5 border-b border-[#1E3530]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#0D6E4F] flex items-center justify-center font-bold text-white shadow-sm shrink-0">
              RC
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-sm text-white leading-tight truncate">
                Restaurant Cloud
              </h1>
              <span className="text-[11px] text-emerald-300/80 block truncate">
                {isEn ? 'Enterprise ERP & POS' : 'منصة المطاعم السحابية'}
              </span>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={isEn ? 'Close navigation menu' : 'إغلاق القائمة الجانبية'}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#122420] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 p-3.5 space-y-1 overflow-y-auto">
          <div className="text-[11px] font-semibold text-slate-400 px-3 py-1.5 uppercase tracking-wider">
            {isEn ? 'Operations' : 'العمليات والتشغيل'}
          </div>
          {filteredOperationsNav.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#0D6E4F] text-white shadow-sm'
                    : 'hover:bg-[#122420] hover:text-white text-slate-300'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{isEn ? item.labelEn : item.labelAr}</span>
              </button>
            );
          })}

          {!isCashierOnly && filteredEnterpriseNav.length > 0 && (
            <>
              <div className="text-[11px] font-semibold text-slate-400 px-3 pt-5 pb-1.5 uppercase tracking-wider">
                {isEn ? 'Enterprise & Finance' : 'إدارة المنشأة والمالية'}
              </div>
              {filteredEnterpriseNav.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[#0D6E4F] text-white shadow-sm'
                        : 'hover:bg-[#122420] hover:text-white text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{isEn ? item.labelEn : item.labelAr}</span>
                  </button>
                );
              })}
            </>
          )}
        </nav>

        {/* Footer System Info */}
        <div className="p-4 border-t border-[#1E3530] text-[11px] text-slate-400 flex items-center justify-between">
          <span>{isEn ? 'Enterprise v2.0' : 'الإصدار 2.0 (Staging)'}</span>
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
        </div>
      </aside>
    </>
  );
};
