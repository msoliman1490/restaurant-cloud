import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell,
  ShieldCheck,
  User,
  LogOut,
  Building,
  Store,
  ChevronDown,
  Menu,
  Globe,
  RefreshCw,
  AlertCircle,
  Loader2,
  Search,
  Keyboard,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';

interface ReadinessResponse {
  status: 'ok' | 'unhealthy' | string;
  checks?: {
    database?: string;
  };
}

interface NotificationLog {
  id: string;
  channel?: string;
  recipient?: string;
  status?: string;
  templateCode?: string;
  message?: string;
  createdAt?: string;
}

interface NavbarProps {
  onToggleSidebar?: () => void;
  locale?: 'ar' | 'en';
  onToggleLocale?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenShortcuts?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onToggleSidebar,
  locale = 'ar',
  onToggleLocale,
  onOpenCommandPalette,
  onOpenShortcuts,
}) => {
  const {
    user,
    role,
    activeTenant,
    activeBranch,
    hierarchy,
    selectBranch,
    logout,
  } = useAuth();

  const isEn = locale === 'en';
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  // Live DB readiness state
  const [dbStatus, setDbStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');

  // Notifications popover state
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);

  const branchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const checkReadiness = useCallback(async () => {
    try {
      const res = await apiClient.get<ReadinessResponse>('/health/readiness');
      const isConnected =
        res?.status === 'ok' && res?.checks?.database !== 'disconnected';
      setDbStatus(isConnected ? 'connected' : 'disconnected');
    } catch {
      setDbStatus('disconnected');
    }
  }, []);

  useEffect(() => {
    checkReadiness();
    const interval = setInterval(checkReadiness, 30000);
    return () => clearInterval(interval);
  }, [checkReadiness]);

  const fetchNotifications = useCallback(async () => {
    setNotifLoading(true);
    setNotifError(null);
    try {
      const data = await apiClient.get<NotificationLog[]>('/tenants/notifications?limit=10');
      setNotifications(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setNotifError(
        (err as Error)?.message ||
          (isEn ? 'Failed to load notifications.' : 'تعذر تحميل الإشعارات.')
      );
    } finally {
      setNotifLoading(false);
    }
  }, [isEn]);

  const handleToggleNotifications = () => {
    const next = !showNotifications;
    setShowNotifications(next);
    setShowBranchDropdown(false);
    if (next) {
      fetchNotifications();
    }
  };

  // Close popovers on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (branchRef.current && !branchRef.current.contains(target)) {
        setShowBranchDropdown(false);
      }
      if (notifRef.current && !notifRef.current.contains(target)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const dbStatusConfig = {
    checking: {
      dot: 'bg-amber-500 animate-pulse',
      label: isEn ? 'Checking DB...' : 'جارٍ فحص الاتصال...',
      pill: 'bg-slate-50 border-slate-200 text-slate-600',
    },
    connected: {
      dot: 'bg-emerald-500',
      label: isEn ? 'PostgreSQL 16 Connected' : 'PostgreSQL 16 متصل',
      pill: 'bg-emerald-50/70 border-emerald-200 text-emerald-800',
    },
    disconnected: {
      dot: 'bg-rose-500',
      label: isEn ? 'DB Disconnected' : 'قاعدة البيانات غير متصلة',
      pill: 'bg-rose-50 border-rose-200 text-rose-700',
    },
  }[dbStatus];

  return (
    <header className="no-print h-16 bg-white border-b border-slate-200 px-4 md:px-6 lg:px-8 flex items-center justify-between gap-3">
      {/* Start side: Mobile Hamburger + Organization & Active Branch */}
      <div className="flex items-center gap-3 min-w-0">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={isEn ? 'Open navigation menu' : 'فتح القائمة الجانبية'}
            className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors cursor-pointer shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {/* Tenant Information */}
        <div className="flex items-center gap-2 min-w-0">
          <Building className="w-5 h-5 text-emerald-600 shrink-0 hidden sm:block" />
          <span className="font-bold text-sm md:text-base text-slate-900 truncate">
            {activeTenant?.name || (isEn ? 'Default Organization' : 'الشركة الافتراضية')}
          </span>
          {activeTenant?.code && (
            <span className="hidden md:inline-block text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono shrink-0">
              {activeTenant.code}
            </span>
          )}
        </div>

        <span className="hidden xl:inline-flex text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full font-medium border border-emerald-200 items-center gap-1.5 shrink-0">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{isEn ? 'RLS Active' : 'عزل RLS نشط'}</span>
        </span>

        {/* Branch Selector Dropdown */}
        {hierarchy && hierarchy.branches.length > 0 && (
          <div className="relative" ref={branchRef}>
            <button
              type="button"
              onClick={() => {
                setShowBranchDropdown(!showBranchDropdown);
                setShowNotifications(false);
              }}
              aria-label={isEn ? 'Select active branch' : 'اختيار الفرع النشط'}
              aria-expanded={showBranchDropdown}
              className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2.5 md:px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              <Store className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="max-w-[110px] md:max-w-[160px] truncate">
                {isEn ? 'Branch:' : 'الفرع:'}{' '}
                {activeBranch?.name || (isEn ? 'Select' : 'اختر الفرع')}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
            </button>

            {showBranchDropdown && (
              <div className="absolute top-full start-0 mt-1.5 w-60 bg-white border border-slate-200 rounded-xl shadow-xl py-2 z-50 animate-fadeIn">
                <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 mb-1">
                  {isEn
                    ? `Available Branches (${hierarchy.branches.length})`
                    : `الفروع المتاحة (${hierarchy.branches.length})`}
                </div>
                {hierarchy.branches.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      selectBranch(b.id);
                      setShowBranchDropdown(false);
                    }}
                    className={`w-full text-start px-3 py-2 text-xs flex items-center justify-between hover:bg-emerald-50 transition-colors cursor-pointer ${
                      activeBranch?.id === b.id
                        ? 'bg-emerald-50/80 text-emerald-700 font-bold'
                        : 'text-slate-700'
                    }`}
                  >
                    <span className="truncate">{b.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono ms-2 shrink-0">
                      {b.code}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* End side: Live DB Status, Language Toggle, Notifications, User, Logout */}
      <div className="flex items-center gap-2 md:gap-3 text-sm text-slate-600 shrink-0">
        {/* Live DB Readiness Pill */}
        <button
          type="button"
          onClick={checkReadiness}
          title={isEn ? 'Check database readiness' : 'فحص جاهزية قاعدة البيانات'}
          aria-label={isEn ? 'Database readiness status' : 'حالة جاهزية قاعدة البيانات'}
          className={`hidden sm:flex items-center gap-2 border px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${dbStatusConfig.pill}`}
        >
          <span className={`w-2 h-2 rounded-full ${dbStatusConfig.dot}`} />
          <span>{dbStatusConfig.label}</span>
        </button>

        {/* Language Toggle (RTL/LTR) */}
        {onToggleLocale && (
          <button
            type="button"
            onClick={onToggleLocale}
            aria-label={
              isEn ? 'Switch language to Arabic' : 'تبديل اللغة إلى الإنجليزية'
            }
            title={isEn ? 'العربية' : 'English'}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-slate-500" />
            <span>{isEn ? 'عربي' : 'EN'}</span>
          </button>
        )}

        {onOpenCommandPalette && (
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title={isEn ? 'Quick Jump (Ctrl+K)' : 'انتقال سريع (Ctrl+K)'}
            className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs text-slate-600 transition-colors cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <span>{isEn ? 'Quick Jump' : 'انتقال سريع'}</span>
            <kbd className="rc-kbd">Ctrl+K</kbd>
          </button>
        )}

        {onOpenShortcuts && (
          <button
            type="button"
            onClick={onOpenShortcuts}
            title={isEn ? 'Keyboard Shortcuts (?)' : 'اختصارات لوحة المفاتيح (?)'}
            aria-label={isEn ? 'Keyboard Shortcuts' : 'اختصارات لوحة المفاتيح'}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors cursor-pointer"
          >
            <Keyboard className="w-4 h-4" />
          </button>
        )}

        {/* Notifications Bell & Popover */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={handleToggleNotifications}
            aria-label={isEn ? 'Open notifications' : 'عرض الإشعارات'}
            aria-expanded={showNotifications}
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors cursor-pointer relative"
          >
            <Bell className="w-4 h-4" />
            {notifications.length > 0 && (
              <span className="absolute top-1.5 end-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute top-full end-0 mt-1.5 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden animate-fadeIn">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">
                  {isEn ? 'Recent Notifications' : 'أحدث الإشعارات'}
                </span>
                <button
                  type="button"
                  onClick={fetchNotifications}
                  aria-label={isEn ? 'Refresh notifications' : 'تحديث الإشعارات'}
                  className="p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${notifLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {notifLoading && notifications.length === 0 ? (
                  <div className="p-6 flex items-center justify-center gap-2 text-xs text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                    <span>{isEn ? 'Loading notifications...' : 'جارٍ تحميل الإشعارات...'}</span>
                  </div>
                ) : notifError ? (
                  <div className="p-4 text-xs text-rose-700 bg-rose-50/70 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">{notifError}</p>
                      <button
                        type="button"
                        onClick={fetchNotifications}
                        className="mt-1 underline text-rose-800 hover:text-rose-950 cursor-pointer"
                      >
                        {isEn ? 'Retry' : 'إعادة المحاولة'}
                      </button>
                    </div>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    {isEn ? 'No notifications found.' : 'لا توجد إشعارات مسجلة حالياً.'}
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className="p-3.5 hover:bg-slate-50/80 transition-colors text-xs">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-semibold text-slate-800 truncate">
                          {n.templateCode || n.channel || (isEn ? 'Notification' : 'إشعار')}
                        </span>
                        {n.status && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              n.status === 'SENT' || n.status === 'DELIVERED'
                                ? 'bg-emerald-50 text-emerald-700'
                                : n.status === 'FAILED'
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {n.status}
                          </span>
                        )}
                      </div>
                      {n.message && (
                        <p className="text-slate-600 line-clamp-2 leading-relaxed">{n.message}</p>
                      )}
                      <div className="flex items-center justify-between mt-1.5 text-[10px] text-slate-400 font-mono">
                        <span className="truncate">{n.recipient || n.channel || ''}</span>
                        {n.createdAt && (
                          <span>{new Date(n.createdAt).toLocaleString(isEn ? 'en-US' : 'ar-SA')}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Card */}
        <div className="flex items-center gap-2.5 ps-2 border-s border-slate-200">
          <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
            <User className="w-4 h-4" />
          </div>
          <div className="hidden md:block text-start">
            <p className="text-xs font-semibold text-slate-800 leading-tight">
              {user?.displayName || (isEn ? 'User' : 'المستخدم')}
            </p>
            <p className="text-[10px] text-slate-500">
              {role?.name || (isEn ? 'System User' : 'مستخدم النظام')}
            </p>
          </div>

          {/* Logout Button */}
          <button
            type="button"
            onClick={logout}
            title={isEn ? 'Sign out' : 'تسجيل الخروج'}
            aria-label={isEn ? 'Sign out' : 'تسجيل الخروج'}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
