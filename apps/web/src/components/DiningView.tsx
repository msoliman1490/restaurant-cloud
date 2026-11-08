import { useState } from 'react';
import { Armchair, Users, Ban, Plus } from 'lucide-react';

interface TableCard {
  id: string;
  tableNumber: string;
  section: string;
  capacity: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';
  guestCount?: number;
  activeOrderTotal?: number;
}

const INITIAL_TABLES: TableCard[] = [
  { id: 't-1', tableNumber: 'T-01', section: 'الصالة الرئيسية', capacity: 4, status: 'OCCUPIED', guestCount: 3, activeOrderTotal: 145.0 },
  { id: 't-2', tableNumber: 'T-02', section: 'الصالة الرئيسية', capacity: 2, status: 'AVAILABLE' },
  { id: 't-3', tableNumber: 'T-03', section: 'قسم العوائل', capacity: 6, status: 'OCCUPIED', guestCount: 5, activeOrderTotal: 380.0 },
  { id: 't-4', tableNumber: 'T-04', section: 'قسم العوائل', capacity: 4, status: 'RESERVED' },
  { id: 't-5', tableNumber: 'VIP-01', section: 'جناح كبار الشخصيات', capacity: 8, status: 'AVAILABLE' },
  { id: 't-6', tableNumber: 'P-01', section: 'الجلسات الخارجية (Patio)', capacity: 4, status: 'AVAILABLE' },
];

export const DiningView = () => {
  const [tables, setTables] = useState<TableCard[]>(INITIAL_TABLES);
  const [activeTab, setActiveTab] = useState<'floor' | 'voids'>('floor');

  const handleAddTable = () => {
    const nextNum = tables.length + 1;
    const newTable: TableCard = {
      id: `t-${Date.now()}`,
      tableNumber: `T-${String(nextNum).padStart(2, '0')}`,
      section: 'الصالة الرئيسية',
      capacity: 4,
      status: 'AVAILABLE',
    };
    setTables([...tables, newTable]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">إدارة صالات الطعام والطاولات (Dining Floor & Tables)</h2>
          <p className="text-sm text-slate-500">
            مخطط الصالة اللحظي، حالة الطاولات، جلسات الضيوف، وسجل الإلغاءات المعتمدة (Manager Voids)
          </p>
        </div>
        <button
          onClick={handleAddTable}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة طاولة جديدة</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('floor')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'floor' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Armchair className="w-4 h-4" />
          <span>مخطط الطاولات (Live Floor Plan)</span>
        </button>
        <button
          onClick={() => setActiveTab('voids')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'voids' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Ban className="w-4 h-4" />
          <span>سجل إلغاءات الكاشير (Manager Voids)</span>
        </button>
      </div>

      {/* Tables Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {tables.map((t) => (
          <div
            key={t.id}
            className={`p-5 rounded-3xl border transition-all text-right flex flex-col justify-between h-44 shadow-xs ${
              t.status === 'OCCUPIED'
                ? 'bg-emerald-950/10 border-emerald-500/40 text-emerald-950'
                : t.status === 'RESERVED'
                ? 'bg-amber-950/10 border-amber-500/40 text-amber-950'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono font-black text-lg text-slate-900">{t.tableNumber}</span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                    t.status === 'OCCUPIED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : t.status === 'RESERVED'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {t.status === 'OCCUPIED' ? 'مشغولة (Active)' : t.status === 'RESERVED' ? 'محجوزة' : 'شاغرة (Available)'}
                </span>
              </div>
              <span className="text-xs text-slate-500 block">{t.section}</span>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-end justify-between">
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <span>{t.guestCount ? `${t.guestCount} / ${t.capacity} ضيوف` : `${t.capacity} مقاعد`}</span>
              </div>
              {t.activeOrderTotal && (
                <div className="text-left font-mono font-bold text-xs text-emerald-600">
                  {t.activeOrderTotal.toFixed(2)} ر.س
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
