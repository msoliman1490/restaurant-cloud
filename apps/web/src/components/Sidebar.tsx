import {
  LayoutDashboard,
  UtensilsCrossed,
  Boxes,
  ArrowLeftRight,
  Building2,
  Receipt,
  Users,
  ShoppingCart,
  ChefHat,
  Utensils,
  BookOpen,
} from 'lucide-react';

export type NavTab =
  | 'dashboard'
  | 'catalog'
  | 'inventory'
  | 'transfers'
  | 'purchasing'
  | 'production'
  | 'dining'
  | 'accounting'
  | 'entities';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab }) => {
  const operationsNav = [
    { id: 'dashboard' as NavTab, label: 'لوحة التحكم', icon: LayoutDashboard },
    { id: 'catalog' as NavTab, label: 'قائمة المنتجات والتسعير', icon: UtensilsCrossed },
    { id: 'dining' as NavTab, label: 'إدارة الصالة والطاولات', icon: Utensils },
    { id: 'inventory' as NavTab, label: 'أرصدة المخزون والتكلفة', icon: Boxes },
    { id: 'purchasing' as NavTab, label: 'المشتريات وسلاسل الإمداد', icon: ShoppingCart },
    { id: 'production' as NavTab, label: 'الوصفات والتصنيع (BOM)', icon: ChefHat },
    { id: 'transfers' as NavTab, label: 'التحويلات والمناقلات', icon: ArrowLeftRight },
  ];

  const enterpriseNav = [
    { id: 'accounting' as NavTab, label: 'المحاسبة ودفتر الأستاذ', icon: BookOpen },
    { id: 'entities' as NavTab, label: 'الشركات والفروع', icon: Building2 },
  ];

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
        {operationsNav.map((item) => {
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

        <div className="pt-4 text-[11px] font-semibold text-slate-400 px-3 py-1">المالية والحوكمة</div>
        {enterpriseNav.map((item) => {
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

        <div className="pt-4 text-[11px] font-semibold text-slate-400 px-3 py-1">الامتثال والتكامل</div>
        <div className="flex items-center gap-3 px-3 py-2 text-sm text-slate-400 opacity-60">
          <Receipt className="w-4 h-4" />
          <span>الفوترة ZATCA Phase 2</span>
        </div>
        <div className="flex items-center gap-3 px-3 py-2 text-sm text-slate-400 opacity-60">
          <Users className="w-4 h-4" />
          <span>المستخدمين والصلاحيات</span>
        </div>
      </nav>

      <div className="p-4 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
        <span>الإصدار 3.0 (Enterprise)</span>
        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
      </div>
    </aside>
  );
};
