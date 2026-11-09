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
  | 'entities'
  | 'users'
  | 'roles'
  | 'settings'
  | 'audit'
  | 'industries';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeIndustries?: string[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  activeIndustries = ['RESTAURANT'],
}) => {
  const { role } = useAuth();

  const isCashierOnly = role?.name === 'CASHIER';

  const operationsNav = [
    {
      id: 'dashboard' as NavTab,
      label: 'لوحة التحكم',
      icon: LayoutDashboard,
      show: !isCashierOnly,
    },
    {
      id: 'pos' as NavTab,
      label: 'نقاط البيع والكاشير (POS)',
      icon: Receipt,
      show: true,
    },
    {
      id: 'catalog' as NavTab,
      label: 'قائمة المنتجات والتسعير',
      icon: UtensilsCrossed,
      show: !isCashierOnly,
    },
    {
      id: 'dining' as NavTab,
      label: 'إدارة الصالة والطاولات',
      icon: Utensils,
      show: !isCashierOnly && activeIndustries.includes('RESTAURANT'),
    },
    {
      id: 'inventory' as NavTab,
      label: 'أرصدة المخزون والتكلفة',
      icon: Boxes,
      show: !isCashierOnly,
    },
    {
      id: 'purchasing' as NavTab,
      label: 'المشتريات وسلاسل الإمداد',
      icon: ShoppingCart,
      show: !isCashierOnly,
    },
    {
      id: 'production' as NavTab,
      label: 'الوصفات والتصنيع (BOM)',
      icon: ChefHat,
      show:
        !isCashierOnly &&
        activeIndustries.some((ind) =>
          ['RESTAURANT', 'CAFE', 'BAKERY', 'CATERING'].includes(ind)
        ),
    },
    {
      id: 'transfers' as NavTab,
      label: 'التحويلات والمناقلات',
      icon: ArrowLeftRight,
      show: !isCashierOnly,
    },
  ];

  const filteredOperationsNav = operationsNav.filter((item) => item.show);

  const enterpriseNav = [
    {
      id: 'entities' as NavTab,
      label: 'الشركات والفروع',
      icon: Building2,
      show: !isCashierOnly,
    },
    {
      id: 'users' as NavTab,
      label: 'المستخدمون',
      icon: Users,
      show: !isCashierOnly,
    },
    {
      id: 'roles' as NavTab,
      label: 'الأدوار والصلاحيات',
      icon: ShieldCheck,
      show: !isCashierOnly,
    },
    {
      id: 'settings' as NavTab,
      label: 'إعدادات المنشأة',
      icon: Settings,
      show: !isCashierOnly,
    },
    {
      id: 'audit' as NavTab,
      label: 'سجل الرقابة (Audit)',
      icon: FileText,
      show: !isCashierOnly,
    },
    {
      id: 'accounting' as NavTab,
      label: 'المحاسبة ودفتر الأستاذ',
      icon: BookOpen,
      show: !isCashierOnly,
    },
    {
      id: 'industries' as NavTab,
      label: 'قطاعات المنشأة وباقات SaaS',
      icon: Layers,
      show: !isCashierOnly,
    },
  ];

  const filteredEnterpriseNav = enterpriseNav.filter((item) => item.show);

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col border-l border-slate-800 select-none">
      <div className="h-16 flex items-center px-6 border-b border-slate-800 gap-3">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-sm">
          RC
        </div>
        <div>
          <h1 className="font-bold text-sm text-white leading-tight">Restaurant Cloud</h1>
          <span className="text-[11px] text-slate-400">نظام إدارة المطاعم المركزي</span>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
        <div className="text-[11px] font-semibold text-slate-400 px-3 py-1">العمليات والتشغيل</div>
        {filteredOperationsNav.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'hover:bg-slate-800 hover:text-white text-slate-400'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}

        {!isCashierOnly && filteredEnterpriseNav.length > 0 && (
          <>
            <div className="text-[11px] font-semibold text-slate-400 px-3 pt-5 pb-1">
              إدارة المنشأة والمالية
            </div>
            {filteredEnterpriseNav.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                      : 'hover:bg-slate-800 hover:text-white text-slate-400'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </>
        )}
      </nav>

      {/* Footer System Info */}
      <div className="p-4 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
        <span>الإصدار 1.0 (Live Context)</span>
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
      </div>
    </aside>
  );
};
