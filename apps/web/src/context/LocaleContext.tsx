import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type AppLocale = 'ar' | 'en';

interface LocaleContextValue {
  locale: AppLocale;
  dir: 'rtl' | 'ltr';
  isRtl: boolean;
  setLocale: (locale: AppLocale) => void;
  toggleLocale: () => void;
  t: (ar: string, en: string) => string;
}

const STORAGE_KEY = 'rc_app_locale_v1';

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<AppLocale>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'en' ? 'en' : 'ar';
    } catch {
      return 'ar';
    }
  });

  const dir: 'rtl' | 'ltr' = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Ignore storage errors
    }
  }, [locale, dir]);

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => (prev === 'ar' ? 'en' : 'ar'));
  }, []);

  const t = useCallback(
    (ar: string, en: string) => (locale === 'ar' ? ar : en),
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, dir, isRtl: dir === 'rtl', setLocale, toggleLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
};

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return ctx;
}
