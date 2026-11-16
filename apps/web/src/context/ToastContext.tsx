import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, title?: string, duration?: number) => string;
  success: (message: string, title?: string, duration?: number) => string;
  error: (message: string, title?: string, duration?: number) => string;
  warning: (message: string, title?: string, duration?: number) => string;
  info: (message: string, title?: string, duration?: number) => string;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', title?: string, duration = 6000) => {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newToast: ToastItem = { id, type, message, title, duration };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          dismiss(id);
        }, duration);
      }

      return id;
    },
    [dismiss]
  );

  const success = useCallback(
    (message: string, title?: string, duration = 5000) =>
      showToast(message, 'success', title, duration),
    [showToast]
  );

  const error = useCallback(
    (message: string, title?: string, duration = 8000) =>
      showToast(message, 'error', title, duration),
    [showToast]
  );

  const warning = useCallback(
    (message: string, title?: string, duration = 7000) =>
      showToast(message, 'warning', title, duration),
    [showToast]
  );

  const info = useCallback(
    (message: string, title?: string, duration = 5000) =>
      showToast(message, 'info', title, duration),
    [showToast]
  );

  const contextValue = useMemo(
    () => ({
      showToast,
      success,
      error,
      warning,
      info,
      dismiss,
      clearAll,
    }),
    [showToast, success, error, warning, info, dismiss, clearAll]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2.5 w-full max-w-md px-4 pointer-events-none"
            dir="rtl"
            aria-live="polite"
          >
            {toasts.map((toast) => {
              const config = {
                success: {
                  bg: 'bg-emerald-950/95 border-emerald-500/80 text-emerald-100',
                  icon: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />,
                  defaultTitle: 'نجحت العملية',
                },
                error: {
                  bg: 'bg-red-950/95 border-red-500/80 text-red-100',
                  icon: <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />,
                  defaultTitle: 'خطأ في التنفيذ',
                },
                warning: {
                  bg: 'bg-amber-950/95 border-amber-500/80 text-amber-100',
                  icon: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
                  defaultTitle: 'تنبيه تحذيري',
                },
                info: {
                  bg: 'bg-blue-950/95 border-blue-500/80 text-blue-100',
                  icon: <Info className="w-5 h-5 text-blue-400 shrink-0" />,
                  defaultTitle: 'إشعار',
                },
              }[toast.type];

              return (
                <div
                  key={toast.id}
                  className={`pointer-events-auto flex items-start gap-3 p-4 rounded-2xl border shadow-2xl backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-top-4 ${config.bg}`}
                  role="alert"
                >
                  <div className="mt-0.5">{config.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold tracking-wide opacity-90 mb-0.5">
                      {toast.title || config.defaultTitle}
                    </p>
                    <p className="text-xs leading-relaxed break-words font-medium">
                      {toast.message}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(toast.id)}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition shrink-0"
                    aria-label="إغلاق التنبيه"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
