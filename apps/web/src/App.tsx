import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { LocaleProvider, useLocale } from './context/LocaleContext';
import { Sidebar, NavTab } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { CatalogView } from './components/CatalogView';
import { InventoryView } from './components/InventoryView';
import { TransfersView } from './components/TransfersView';
import { PurchasingView } from './components/PurchasingView';
import { ProductionView } from './components/ProductionView';
import { DiningView } from './components/DiningView';
import { AccountingView } from './components/AccountingView';
import { ReconciliationReportingView } from './components/ReconciliationReportingView';
import { PeriodClosingView } from './components/PeriodClosingView';
import { ZatcaV2View } from './components/ZatcaV2View';
import { PosView } from './components/PosView';
import { IndustryPacksView } from './components/IndustryPacksView';
import { CompaniesView } from './components/CompaniesView';
import { UsersView } from './components/UsersView';
import { HrEmployeesView } from './components/HrEmployeesView';
import { DeliveryView } from './components/DeliveryView';
import { RolesView } from './components/RolesView';
import { SettingsView } from './components/SettingsView';
import { AuditLogsView } from './components/AuditLogsView';
import { LoginView } from './components/LoginView';
import { CommandPalette, CommandItem } from './components/ui/CommandPalette';
import { KeyboardShortcutsModal } from './components/ui/KeyboardShortcutsModal';
import { Loader2 } from 'lucide-react';

export { useLocale };
export type { AppLocale as Locale } from './context/LocaleContext';

const COMMAND_ITEMS: CommandItem[] = [
  { id: 'dashboard', labelAr: 'لوحة التحكم', labelEn: 'Dashboard', groupAr: 'العمليات اليومية', groupEn: 'Operations' },
  { id: 'pos', labelAr: 'نقاط البيع والكاشير (POS)', labelEn: 'Point of Sale (POS)', groupAr: 'العمليات اليومية', groupEn: 'Operations', shortcut: 'POS' },
  { id: 'catalog', labelAr: 'قائمة المنتجات والتسعير', labelEn: 'Catalog & Pricing', groupAr: 'العمليات اليومية', groupEn: 'Operations' },
  { id: 'dining', labelAr: 'إدارة الصالة والطاولات', labelEn: 'Dining & Tables', groupAr: 'العمليات اليومية', groupEn: 'Operations' },
  { id: 'delivery', labelAr: 'التوصيل والسائقون', labelEn: 'Delivery & Drivers', groupAr: 'العمليات اليومية', groupEn: 'Operations' },
  { id: 'inventory', labelAr: 'أرصدة المخزون والتكلفة', labelEn: 'Inventory & Costing', groupAr: 'سلسلة الإمداد', groupEn: 'Supply Chain' },
  { id: 'transfers', labelAr: 'التحويلات بين الفروع', labelEn: 'Inter-Branch Transfers', groupAr: 'سلسلة الإمداد', groupEn: 'Supply Chain' },
  { id: 'purchasing', labelAr: 'المشتريات وسلاسل الإمداد', labelEn: 'Purchasing & Suppliers', groupAr: 'سلسلة الإمداد', groupEn: 'Supply Chain' },
  { id: 'production', labelAr: 'الإنتاج والوصفات (BOM)', labelEn: 'Production & Recipes', groupAr: 'سلسلة الإمداد', groupEn: 'Supply Chain' },
  { id: 'accounting', labelAr: 'المحاسبة ودفتر الأستاذ', labelEn: 'Accounting & GL', groupAr: 'المالية والامتثال', groupEn: 'Finance & Compliance' },
  { id: 'reconciliation', labelAr: 'المصالحات والتقارير المالية', labelEn: 'Reconciliation & Reports', groupAr: 'المالية والامتثال', groupEn: 'Finance & Compliance' },
  { id: 'period-closing', labelAr: 'إقفال الفترات المالية', labelEn: 'Period Closing', groupAr: 'المالية والامتثال', groupEn: 'Finance & Compliance' },
  { id: 'zatca-v2', labelAr: 'الفوترة الإلكترونية ZATCA', labelEn: 'ZATCA E-Invoicing', groupAr: 'التكامل والامتثال', groupEn: 'Integrations & Compliance' },
  { id: 'entities', labelAr: 'الشركات والفروع والعنوان الوطني', labelEn: 'Legal Entities & National Address', groupAr: 'الحوكمة والإدارة', groupEn: 'Governance' },
  { id: 'users', labelAr: 'المستخدمون', labelEn: 'Users', groupAr: 'الحوكمة والإدارة', groupEn: 'Governance' },
  { id: 'roles', labelAr: 'الأدوار والصلاحيات', labelEn: 'Roles & Permissions', groupAr: 'الحوكمة والإدارة', groupEn: 'Governance' },
  { id: 'hr', labelAr: 'الموارد البشرية والرواتب', labelEn: 'HR & Payroll', groupAr: 'الحوكمة والإدارة', groupEn: 'Governance' },
  { id: 'industries', labelAr: 'باقات الأنشطة', labelEn: 'Industry Packs', groupAr: 'الحوكمة والإدارة', groupEn: 'Governance' },
  { id: 'audit', labelAr: 'سجل التدقيق', labelEn: 'Audit Logs', groupAr: 'الحوكمة والإدارة', groupEn: 'Governance' },
  { id: 'settings', labelAr: 'الإعدادات والتكاملات', labelEn: 'Settings & Integrations', groupAr: 'الحوكمة والإدارة', groupEn: 'Governance' },
];

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const { locale, dir, toggleLocale } = useLocale();
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isPosFullscreen, setIsPosFullscreen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeIndustries, setActiveIndustries] = useState<string[]>(['RESTAURANT', 'CAFE']);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((prev) => !prev);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (!isTyping && e.key === '?') {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleToggleIndustry = (industryId: string) => {
    setActiveIndustries((prev) =>
      prev.includes(industryId)
        ? prev.filter((id) => id !== industryId)
        : [...prev, industryId]
    );
  };

  return (
    <>
      {isLoading ? (
        <div
          className="min-h-screen bg-[#0B1614] flex flex-col items-center justify-center text-white"
          dir={dir}
        >
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mb-4" />
          <p className="text-sm text-slate-300">
            {locale === 'en'
              ? 'Initializing secure session and verifying credentials...'
              : 'جارٍ تهيئة الجلسة الآمنة وفحص بيانات الاعتماد...'}
          </p>
        </div>
      ) : !isAuthenticated ? (
        <LoginView locale={locale} onToggleLocale={toggleLocale} />
      ) : currentTab === 'pos' && isPosFullscreen ? (
        <div
          className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased p-4 md:p-6 lg:p-8"
          dir={dir}
        >
          <PosView
            isFullscreen={true}
            onToggleFullscreen={() => setIsPosFullscreen(false)}
          />
        </div>
      ) : (
        <div
          className="min-h-screen bg-[#F6F7F9] flex text-slate-900 font-sans antialiased"
          dir={dir}
        >
          <Sidebar
            currentTab={currentTab}
            onSelectTab={setCurrentTab}
            activeIndustries={activeIndustries}
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            locale={locale}
          />

          <div className="flex-1 flex flex-col min-w-0">
            <Navbar
              onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
              locale={locale}
              onToggleLocale={toggleLocale}
              onOpenCommandPalette={() => setShowCommandPalette(true)}
              onOpenShortcuts={() => setShowShortcutsModal(true)}
            />

            <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto">
              <div className="max-w-7xl mx-auto w-full">
                {currentTab === 'dashboard' && (
                  <DashboardView
                    onNavigateToCatalog={() => setCurrentTab('catalog')}
                    onNavigateToInventory={() => setCurrentTab('inventory')}
                    onNavigateTab={setCurrentTab}
                    locale={locale}
                  />
                )}
                {currentTab === 'pos' && (
                  <PosView
                    isFullscreen={false}
                    onToggleFullscreen={() => setIsPosFullscreen(true)}
                  />
                )}
                {currentTab === 'catalog' && <CatalogView />}
                {currentTab === 'inventory' && <InventoryView />}
                {currentTab === 'transfers' && <TransfersView />}
                {currentTab === 'purchasing' && <PurchasingView />}
                {currentTab === 'production' && <ProductionView />}
                {currentTab === 'dining' && <DiningView />}
                {currentTab === 'accounting' && <AccountingView />}
                {currentTab === 'reconciliation' && <ReconciliationReportingView />}
                {currentTab === 'period-closing' && <PeriodClosingView />}
                {currentTab === 'zatca-v2' && <ZatcaV2View />}
                {currentTab === 'industries' && (
                  <IndustryPacksView
                    activeIndustries={activeIndustries}
                    onToggleIndustry={handleToggleIndustry}
                  />
                )}
                {currentTab === 'entities' && <CompaniesView />}
                {currentTab === 'users' && <UsersView />}
                {currentTab === 'hr' && <HrEmployeesView />}
                {currentTab === 'delivery' && <DeliveryView />}
                {currentTab === 'roles' && <RolesView />}
                {currentTab === 'settings' && <SettingsView />}
                {currentTab === 'audit' && <AuditLogsView />}
              </div>
            </main>
          </div>
        </div>
      )}

      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        items={COMMAND_ITEMS}
        onSelect={(id) => setCurrentTab(id as NavTab)}
      />
      <KeyboardShortcutsModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />
    </>
  );
};

export default function App() {
  return (
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>
  );
}
