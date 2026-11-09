import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Sidebar, NavTab } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { CatalogView } from './components/CatalogView';
import { InventoryView } from './components/InventoryView';
import { PurchasingView } from './components/PurchasingView';
import { ProductionView } from './components/ProductionView';
import { DiningView } from './components/DiningView';
import { AccountingView } from './components/AccountingView';
import { PosView } from './components/PosView';
import { IndustryPacksView } from './components/IndustryPacksView';
import { CompaniesView } from './components/CompaniesView';
import { UsersView } from './components/UsersView';
import { RolesView } from './components/RolesView';
import { SettingsView } from './components/SettingsView';
import { AuditLogsView } from './components/AuditLogsView';
import { LoginView } from './components/LoginView';
import { Loader2 } from 'lucide-react';

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isPosFullscreen, setIsPosFullscreen] = useState(false);
  const [activeIndustries, setActiveIndustries] = useState<string[]>(['RESTAURANT', 'CAFE']);

  const handleToggleIndustry = (industryId: string) => {
    setActiveIndustries((prev) =>
      prev.includes(industryId)
        ? prev.filter((id) => id !== industryId)
        : [...prev, industryId]
    );
  };

  // 1. Initial Authentication Check Loading State
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white" dir="rtl">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
        <p className="text-sm text-slate-400">جارٍ تهيئة الجلسة الآمنة وفحص بيانات الاعتماد...</p>
      </div>
    );
  }

  // 2. Unauthenticated: Display Login Screen
  if (!isAuthenticated) {
    return <LoginView />;
  }

  // 3. Dedicated Cashier Fullscreen Mode: Pure cashier terminal without navigation chrome
  if (currentTab === 'pos' && isPosFullscreen) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased p-8" dir="rtl">
        <PosView
          isFullscreen={true}
          onToggleFullscreen={() => setIsPosFullscreen(false)}
        />
      </div>
    );
  }

  // 4. Authenticated Main Unified SaaS Application
  return (
    <div className="min-h-screen bg-slate-100 flex flex-row-reverse text-slate-900 font-sans antialiased" dir="rtl">
      {/* Sidebar with dynamic industry and permissions filtering */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        activeIndustries={activeIndustries}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto w-full">
            {currentTab === 'dashboard' && (
              <DashboardView
                onNavigateToCatalog={() => setCurrentTab('catalog')}
                onNavigateToInventory={() => setCurrentTab('inventory')}
              />
            )}
            {currentTab === 'pos' && (
              <PosView
                isFullscreen={false}
                onToggleFullscreen={() => setIsPosFullscreen(true)}
              />
            )}
            {currentTab === 'catalog' && <CatalogView />}
            {(currentTab === 'inventory' || currentTab === 'transfers') && <InventoryView />}
            {currentTab === 'purchasing' && <PurchasingView />}
            {currentTab === 'production' && <ProductionView />}
            {currentTab === 'dining' && <DiningView />}
            {currentTab === 'accounting' && <AccountingView />}
            {currentTab === 'industries' && (
              <IndustryPacksView
                activeIndustries={activeIndustries}
                onToggleIndustry={handleToggleIndustry}
              />
            )}
            {currentTab === 'entities' && <CompaniesView />}
            {currentTab === 'users' && <UsersView />}
            {currentTab === 'roles' && <RolesView />}
            {currentTab === 'settings' && <SettingsView />}
            {currentTab === 'audit' && <AuditLogsView />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
