import React, { useState, useEffect, createContext, useContext } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
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
import { Loader2 } from 'lucide-react';

export type Locale = 'ar' | 'en';

interface LocaleContextValue {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  toggleLocale: () => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'ar',
  dir: 'rtl',
  toggleLocale: () => {},
});

export const useLocale = () => useContext(LocaleContext);

const LOCALE_STORAGE_KEY = 'rc_locale';

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isPosFullscreen, setIsPosFullscreen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeIndustries, setActiveIndustries] = useState<string[]>(['RESTAURANT', 'CAFE']);

  const [locale, setLocale] = useState<Locale>(() => {
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
      return saved === 'en' ? 'en' : 'ar';
    } catch {
      return 'ar';
    }
  });

  const dir: 'rtl' | 'ltr' = locale === 'en' ? 'ltr' : 'rtl';

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }, [locale, dir]);

  const toggleLocale = () => {
    setLocale((prev) => (prev === 'ar' ? 'en' : 'ar'));
  };

  const handleToggleIndustry = (industryId: string) => {
    setActiveIndustries((prev) =>
      prev.includes(industryId)
        ? prev.filter((id) => id !== industryId)
        : [...prev, industryId]
    );
  };

  return (
    <LocaleContext.Provider value={{ locale, dir, toggleLocale }}>
      {isLoading ? (
        <div
          className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white"
          dir={dir}
        >
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mb-4" />
          <p className="text-sm text-slate-400">
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
          className="min-h-screen bg-slate-50 flex text-slate-900 font-sans antialiased"
          dir={dir}
        >
          {/* Responsive Sidebar Drawer */}
          <Sidebar
            currentTab={currentTab}
            onSelectTab={setCurrentTab}
            activeIndustries={activeIndustries}
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            locale={locale}
          />

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col min-w-0">
            <Navbar
              onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
              locale={locale}
              onToggleLocale={toggleLocale}
            />

            <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto">
              <div className="max-w-7xl mx-auto w-full">
                {currentTab === 'dashboard' && (
                  <DashboardView
                    onNavigateToCatalog={() => setCurrentTab('catalog')}
                    onNavigateToInventory={() => setCurrentTab('inventory')}
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
    </LocaleContext.Provider>
  );
};

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ToastProvider>
  );
}
