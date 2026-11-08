import { Bell, ShieldCheck, User } from 'lucide-react';

export const Navbar = () => {
  return (
    <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between select-none">
      <div className="flex items-center gap-4">
        <span className="font-bold text-lg text-slate-800">
          شركة الضيافة الفندقية المحدودة
        </span>
        <span className="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-medium border border-indigo-100 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          بيئة معزولة RLS مفعلة
        </span>
      </div>

      <div className="flex items-center gap-4 text-sm text-slate-600">
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <span className="text-xs font-medium text-slate-700">قاعدة البيانات: PostgreSQL 16 (RLS Active)</span>
        </div>

        <button className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors">
          <Bell className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 pr-2 border-r border-slate-200">
          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
            <User className="w-4 h-4" />
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-slate-800 leading-tight">مسؤول النظام</p>
            <p className="text-[10px] text-slate-400">مالك المنشأة (Owner)</p>
          </div>
        </div>
      </div>
    </header>
  );
};
