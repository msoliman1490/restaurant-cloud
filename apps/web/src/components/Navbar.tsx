import React, { useState } from 'react';
import {
  Bell,
  ShieldCheck,
  User,
  LogOut,
  Building,
  Store,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const Navbar: React.FC = () => {
  const {
    user,
    role,
    activeTenant,
    activeBranch,
    hierarchy,
    selectBranch,
    logout,
  } = useAuth();

  const [showBranchDropdown, setShowBranchDropdown] = useState(false);

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between select-none">
      {/* Right side (RTL): Organization & Active Branch */}
      <div className="flex items-center gap-4">
        {/* Tenant Information */}
        <div className="flex items-center gap-2">
          <Building className="w-5 h-5 text-indigo-600" />
          <span className="font-bold text-base text-slate-800">
            {activeTenant?.name || 'الشركة الافتراضية'}
          </span>
          <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
            {activeTenant?.code}
          </span>
        </div>

        <span className="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-medium border border-indigo-100 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>عزل RLS نشط</span>
        </span>

        {/* Branch Selector Dropdown */}
        {hierarchy && hierarchy.branches.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowBranchDropdown(!showBranchDropdown)}
              className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 transition-colors"
            >
              <Store className="w-3.5 h-3.5 text-indigo-600" />
              <span>الفرع: {activeBranch?.name || 'اختر الفرع'}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showBranchDropdown && (
              <div className="absolute top-full right-0 mt-1.5 w-56 bg-white border border-slate-200 rounded-2xl shadow-xl py-2 z-50 animate-fadeIn">
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 mb-1">
                  الفروع المتاحة ({hierarchy.branches.length})
                </div>
                {hierarchy.branches.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      selectBranch(b.id);
                      setShowBranchDropdown(false);
                    }}
                    className={`w-full text-right px-3 py-2 text-xs flex items-center justify-between hover:bg-indigo-50 transition-colors ${
                      activeBranch?.id === b.id
                        ? 'bg-indigo-50/70 text-indigo-700 font-bold'
                        : 'text-slate-700'
                    }`}
                  >
                    <span>{b.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {b.code}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Left side (RTL): Live Status, User, Logout */}
      <div className="flex items-center gap-4 text-sm text-slate-600">
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-medium text-slate-700">
            PostgreSQL 16 متصل
          </span>
        </div>

        <button className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors">
          <Bell className="w-4 h-4" />
        </button>

        {/* User Card */}
        <div className="flex items-center gap-3 pr-2 border-r border-slate-200">
          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
            <User className="w-4 h-4" />
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-slate-800 leading-tight">
              {user?.displayName || 'المستخدم'}
            </p>
            <p className="text-[10px] text-slate-400">
              {role?.name || 'مستخدم النظام'}
            </p>
          </div>

          {/* Logout Button */}
          <button
            onClick={logout}
            title="تسجيل الخروج"
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer mr-1"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
