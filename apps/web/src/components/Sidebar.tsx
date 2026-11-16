import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { NAVIGATION_GROUPS, type NavTab, type NavItemConfig } from '../config/navigation';

export type { NavTab };

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeIndustries?: string[];
  isOpen?: boolean;
  onClose?: () => void;
  locale?: 'ar' | 'en';
}

const COLLAPSED_STORAGE_KEY = 'rc_sidebar_collapsed_v1';
const GROUPS_STORAGE_KEY = 'rc_sidebar_groups_v1';

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  activeIndustries = ['RESTAURANT'],
  isOpen = false,
  onClose,
  locale = 'ar',
}) => {
  const { user, role, permissions, hasPermission } = useAuth();
  const isCashierOnly = role?.name === 'CASHIER';
  const isEn = locale === 'en';
  const navRef = useRef<HTMLElement>(null);

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {};
    NAVIGATION_GROUPS.forEach((g) => {
      defaults[g.id] = g.defaultOpen !== false;
    });
    try {
      const saved = localStorage.getItem(GROUPS_STORAGE_KEY);
      if (saved) {
        return { ...defaults, ...JSON.parse(saved) };
      }
    } catch {
      // Ignore storage errors
    }
    return defaults;
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, String(isCollapsed));
    } catch {
      // Ignore
    }
  }, [isCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(openGroups));
    } catch {
      // Ignore
    }
  }, [openGroups]);

  // Ensure the group containing the active tab stays open when navigating
  useEffect(() => {
    const activeGroup = NAVIGATION_GROUPS.find((g) =>
      g.items.some((item) => item.id === currentTab),
    );
    if (activeGroup && !openGroups[activeGroup.id]) {
      setOpenGroups((prev) => ({ ...prev, [activeGroup.id]: true }));
    }
  }, [currentTab]);

  const canAccessItem = (item: NavItemConfig): boolean => {
    if (item.requiresPlatformAdmin && !user?.isPlatformAdmin) return false;
    if (isCashierOnly && !item.cashierAllowed) return false;
    if (item.requiredIndustry && !activeIndustries.includes(item.requiredIndustry)) {
      return false;
    }
    if (!item.requiredPermissions || item.requiredPermissions.length === 0) {
      return true;
    }
    if (!permissions || permissions.length === 0 || permissions.includes('*')) {
      return true;
    }
    return item.requiredPermissions.some((perm) => hasPermission(perm));
  };

  const visibleGroups = useMemo(
    () =>
      NAVIGATION_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(canAccessItem),
      })).filter((group) => group.items.length > 0),
    [activeIndustries, isCashierOnly, permissions, user?.isPlatformAdmin],
  );

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const handleSelect = (tab: NavTab) => {
    onSelectTab(tab);
    onClose?.();
  };

  // Keyboard navigation with ArrowUp / ArrowDown across visible sidebar items
  const handleNavKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = Array.from(
      navRef.current?.querySelectorAll<HTMLButtonElement>('button[data-nav-item="true"]') || [],
    );
    if (buttons.length === 0) return;
    const activeIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (activeIndex === -1) return;

    e.preventDefault();
    const nextIndex =
      e.key === 'ArrowDown'
        ? (activeIndex + 1) % buttons.length
        : (activeIndex - 1 + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  const drawerSideClass = isEn ? 'left-0 border-r' : 'right-0 border-l';
  const drawerTranslateClass = isOpen
    ? 'translate-x-0'
    : isEn
    ? '-translate-x-full lg:translate-x-0'
    : 'translate-x-full lg:translate-x-0';

  const desktopWidthClass = isCollapsed ? 'lg:w-[74px]' : 'lg:w-64';

  return (
    <>
      {isOpen && (
        <div
          className="no-print fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-[1px] lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`no-print fixed inset-y-0 ${drawerSideClass} z-40 w-64 ${desktopWidthClass} bg-[#0B1614] text-slate-200 flex flex-col border-[#1E3530] transition-all duration-200 ease-in-out lg:static lg:translate-x-0 shrink-0 ${drawerTranslateClass}`}
        aria-label={isEn ? 'Main navigation' : 'القائمة الرئيسية'}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-[#1E3530] shrink-0">
          <div className={`flex items-center gap-3 min-w-0 ${isCollapsed ? 'lg:justify-center lg:w-full' : ''}`}>
            <div className="w-9 h-9 rounded-xl bg-[#0D6E4F] flex items-center justify-center font-bold text-white shadow-sm shrink-0">
              RC
            </div>
            {!isCollapsed && (
              <div className="min-w-0">
                <h1 className="font-bold text-sm text-white leading-tight truncate">
                  Restaurant Cloud
                </h1>
                <span className="text-[11px] text-emerald-300/80 block truncate">
                  {isEn ? 'Cloud Restaurant ERP' : 'إدارة المطاعم السحابية'}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Desktop Collapse Toggle */}
            <button
              type="button"
              onClick={() => setIsCollapsed((prev) => !prev)}
              aria-label={
                isCollapsed
                  ? isEn ? 'Expand sidebar' : 'توسيع القائمة الجانبية'
                  : isEn ? 'Collapse sidebar' : 'تصغير القائمة الجانبية'
              }
              title={
                isCollapsed
                  ? isEn ? 'Expand sidebar' : 'توسيع القائمة'
                  : isEn ? 'Collapse sidebar' : 'تصغير القائمة'
              }
              className="hidden lg:inline-flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#122420] transition-colors cursor-pointer"
            >
              {isCollapsed ? (
                isEn ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />
              ) : (
                isEn ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />
              )}
            </button>

            {/* Mobile Close */}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label={isEn ? 'Close navigation menu' : 'إغلاق القائمة الجانبية'}
                className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#122420] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation Groups */}
        <nav
          ref={navRef}
          onKeyDown={handleNavKeyDown}
          className="flex-1 p-3 space-y-3 overflow-y-auto"
        >
          {visibleGroups.map((group) => {
            const isGroupOpen = isCollapsed ? true : openGroups[group.id] !== false;
            return (
              <div key={group.id} className="space-y-1">
                {!isCollapsed ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={isGroupOpen}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    <span className="truncate">{isEn ? group.titleEn : group.titleAr}</span>
                    {isGroupOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    ) : isEn ? (
                      <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    ) : (
                      <ChevronLeft className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    )}
                  </button>
                ) : (
                  <div className="mx-2 my-1 border-t border-[#1E3530]" />
                )}

                {isGroupOpen && (
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentTab === item.id;
                      const label = isEn ? item.labelEn : item.labelAr;

                      return (
                        <div key={item.id} className="relative group/nav">
                          <button
                            type="button"
                            data-nav-item="true"
                            onClick={() => handleSelect(item.id)}
                            aria-current={isActive ? 'page' : undefined}
                            aria-label={label}
                            title={isCollapsed ? label : undefined}
                            className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] transition-all cursor-pointer ${
                              isCollapsed ? 'lg:justify-center lg:px-2' : ''
                            } ${
                              isActive
                                ? 'bg-[#0D6E4F]/25 text-white font-semibold'
                                : 'text-slate-300 hover:bg-[#122420] hover:text-white font-medium'
                            }`}
                          >
                            {/* Thin Side Accent Bar for Active Item */}
                            {isActive && (
                              <span
                                aria-hidden="true"
                                className={`absolute top-2 bottom-2 w-1 rounded-full bg-emerald-400 ${
                                  isEn ? 'left-0' : 'right-0'
                                }`}
                              />
                            )}
                            <Icon
                              className={`w-4 h-4 shrink-0 ${
                                isActive ? 'text-emerald-400' : 'text-slate-400 group-hover/nav:text-slate-200'
                              }`}
                            />
                            {!isCollapsed && (
                              <span className="truncate flex-1 text-start">{label}</span>
                            )}
                            {!isCollapsed && typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                              <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                {item.badgeCount}
                              </span>
                            )}
                          </button>

                          {/* Tooltip when sidebar is collapsed on desktop */}
                          {isCollapsed && (
                            <span
                              role="tooltip"
                              className={`hidden lg:group-hover/nav:flex lg:group-focus-within/nav:flex items-center whitespace-nowrap absolute top-1/2 -translate-y-1/2 z-50 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium shadow-lg border border-slate-700 pointer-events-none ${
                                isEn ? 'left-full ml-2.5' : 'right-full mr-2.5'
                              }`}
                            >
                              {label}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Clean Footer */}
        <div className="p-3.5 border-t border-[#1E3530] text-[11px] text-slate-400 flex items-center justify-between">
          {!isCollapsed ? (
            <>
              <span className="truncate">Restaurant Cloud</span>
              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                {isEn ? 'Online' : 'متصل'}
              </span>
            </>
          ) : (
            <span className="mx-auto w-2 h-2 rounded-full bg-emerald-400" title={isEn ? 'Online' : 'متصل'} />
          )}
        </div>
      </aside>
    </>
  );
};
