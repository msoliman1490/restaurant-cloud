import React, { useState } from 'react';
import {
  Lock,
  Mail,
  Building2,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Server,
  ArrowLeft,
  ArrowRight,
  Globe,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';

interface LoginViewProps {
  locale?: 'ar' | 'en';
  onToggleLocale?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  locale = 'ar',
  onToggleLocale,
}) => {
  const { login } = useAuth();
  const isEn = locale === 'en';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantCode, setTenantCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMessage(
        isEn
          ? 'Please enter your email address and password.'
          : 'يرجى إدخال البريد الإلكتروني وكلمة المرور.'
      );
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      await login(email, password, tenantCode.trim() || undefined);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(
          (err as Error)?.message ||
            (isEn
              ? 'Failed to connect to the server. Verify that the API and database services are running.'
              : 'فشل الاتصال بالخادم. تأكد من أن خدمة API وقاعدة البيانات قيد التشغيل.')
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 sm:p-6 text-slate-100 font-sans antialiased"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      {/* Top Language Switcher */}
      {onToggleLocale && (
        <div className="w-full max-w-md flex justify-end mb-4">
          <button
            type="button"
            onClick={onToggleLocale}
            aria-label={
              isEn ? 'Switch language to Arabic' : 'تبديل اللغة إلى الإنجليزية'
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-300 transition-colors cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isEn ? 'العربية' : 'English'}</span>
          </button>
        </div>
      )}

      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-emerald-600 shadow-lg shadow-emerald-950/50 mb-4">
            <span className="text-xl font-black text-white tracking-wider">RC</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Restaurant Cloud
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {isEn
              ? 'Unified Cloud Hospitality & POS Enterprise Platform'
              : 'منصة الإدارة السحابية الموحدة ونقاط البيع (Saudi Market)'}
          </p>

          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-emerald-400">
            <Server className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {isEn
                ? 'Live Environment: PostgreSQL 16 + RLS Multi-Tenant'
                : 'بيئة حقيقية: PostgreSQL 16 + RLS Multi-Tenant'}
            </span>
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl shadow-black/40">
          <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-800">
            <div>
              <h2 className="text-base font-bold text-white">
                {isEn ? 'Sign in to your account' : 'تسجيل الدخول للنظام'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isEn
                  ? 'Enter your credentials to continue'
                  : 'أدخل بيانات الاعتماد للمتابعة'}
              </p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="mb-5 p-3.5 rounded-xl bg-rose-950/50 border border-rose-800/60 text-rose-200 text-xs flex items-start gap-2.5 animate-fadeIn"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{errorMessage}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                {isEn ? 'Email Address' : 'البريد الإلكتروني'}{' '}
                <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.sa"
                  autoComplete="email"
                  required
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-4 py-2.5 ps-10 text-sm text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
                <Mail className="w-4 h-4 text-slate-500 absolute start-3.5 top-3 pointer-events-none" />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                {isEn ? 'Password' : 'كلمة المرور'}{' '}
                <span className="text-rose-400">*</span>
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-4 py-2.5 ps-10 pe-10 text-sm text-white placeholder-slate-500 focus:outline-none transition-colors"
                />
                <Lock className="w-4 h-4 text-slate-500 absolute start-3.5 top-3 pointer-events-none" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={
                    showPassword
                      ? isEn
                        ? 'Hide password'
                        : 'إخفاء كلمة المرور'
                      : isEn
                      ? 'Show password'
                      : 'إظهار كلمة المرور'
                  }
                  className="absolute end-3 top-2.5 text-slate-500 hover:text-slate-300 transition-colors p-0.5 cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Optional Tenant Code */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-tenant"
                  className="block text-xs font-semibold text-slate-300"
                >
                  {isEn ? 'Tenant Code' : 'معرف الشركة السحابي (Tenant Code)'}
                </label>
                <span className="text-[10px] text-slate-500">
                  {isEn ? 'Optional' : 'اختياري'}
                </span>
              </div>
              <div className="relative">
                <input
                  id="login-tenant"
                  type="text"
                  value={tenantCode}
                  onChange={(e) => setTenantCode(e.target.value)}
                  placeholder={isEn ? 'e.g. al-nakheel-group' : 'مثال: al-nakheel-group'}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-lg px-4 py-2.5 ps-10 text-sm text-white placeholder-slate-500 focus:outline-none transition-colors text-left font-mono"
                  dir="ltr"
                />
                <Building2 className="w-4 h-4 text-slate-500 absolute start-3.5 top-3 pointer-events-none" />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-4 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-6 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isEn ? 'Verifying credentials...' : 'جارٍ التحقق من الحساب...'}</span>
                </>
              ) : (
                <>
                  <span>{isEn ? 'Sign In' : 'تسجيل الدخول'}</span>
                  {isEn ? (
                    <ArrowRight className="w-4 h-4" />
                  ) : (
                    <ArrowLeft className="w-4 h-4" />
                  )}
                </>
              )}
            </button>
          </form>
        </div>

        {/* Security & Compliance Footer */}
        <div className="mt-6 text-center text-[11px] text-slate-500 flex flex-wrap items-center justify-center gap-3">
          <span>{isEn ? 'ZATCA Phase 2 Compliant' : 'متوافق مع ZATCA المرحلة 2'}</span>
          <span>•</span>
          <span>{isEn ? 'Strict RLS Isolation' : 'عزل RLS تام لكل شركة'}</span>
          <span>•</span>
          <span>SSL 256-bit</span>
        </div>
      </div>
    </div>
  );
};
