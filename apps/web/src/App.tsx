import { useState } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { CatalogView } from './components/CatalogView';
import { InventoryView } from './components/InventoryView';
import { PurchasingView } from './components/PurchasingView';
import { ProductionView } from './components/ProductionView';
import { DiningView } from './components/DiningView';
import { AccountingView } from './components/AccountingView';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');

  return (
    <div className="min-h-screen bg-slate-100 flex flex-row-reverse text-slate-900 font-sans antialiased" dir="rtl">
      {/* Sidebar */}
      <Sidebar currentTab={currentTab} onSelectTab={setCurrentTab} />

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
            {currentTab === 'catalog' && <CatalogView />}
            {(currentTab === 'inventory' || currentTab === 'transfers') && <InventoryView />}
            {currentTab === 'purchasing' && <PurchasingView />}
            {currentTab === 'production' && <ProductionView />}
            {currentTab === 'dining' && <DiningView />}
            {currentTab === 'accounting' && <AccountingView />}
            {currentTab === 'entities' && (
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
                <h2 className="text-xl font-bold mb-2">إدارة الكيانات القانونية والفروع</h2>
                <p className="text-sm text-slate-500 mb-6">
                  هيكل المنشأة مسجل تحت عزل Multi-Tenant RLS الكامل مع دعم المستودعات المشتركة لعدة شركات.
                </p>
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 text-sm space-y-2">
                  <p><strong>الكيان القانوني 1:</strong> شركة الضيافة الفندقية المحدودة (الرقم الضريبي: 310123456700003)</p>
                  <p><strong>الكيان القانوني 2:</strong> شركة المطاعم السريعة المبتكرة (الرقم الضريبي: 310987654300003)</p>
                  <p><strong>المستودع اللوجستي المشترك:</strong> مستودع الملز المركزي (مخزون منفصل لكل شركة بحسابات تكلفة FIFO مستقلة)</p>
                  <p><strong>الفروع:</strong> الرياض - العليا، الرياض - الملقا، جدة - الروضة، الخبر - الكورنيش</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
