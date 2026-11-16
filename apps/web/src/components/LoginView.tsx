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
  ArrowLeft,
  ArrowRight,
  Globe,
  KeyRound,
  MailCheck,
  UserPlus,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiClient, ApiError } from '../api/client';
import { RegisterTenantView } from './RegisterTenantView';

interface LoginViewProps {
  locale?: 'ar' | 'en';
  onToggleLocale?: () => void;
  onRegisteredToOnboarding?: () => void;
}

type AuthPortalMode = 'login' | 'register' | 'forgot' | 'verify';

export const LoginView: React.FC<LoginViewProps> = ({
  locale = 'ar',
  onToggleLocale,
  onRegisteredToOnboarding,
}) => {
  const { login } = useAuth();
  const isEn = locale === 'en';

  const [mode, setMode] = useState<AuthPortalMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantCode, setTenantCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Forgot / Reset Password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetRequested, setResetRequested] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Verify Email / Phone state
  const [verifyTarget, setVerifyTarget] = useState('');
  const [verifyPurpose, setVerifyPurpose] = useState<'EMAIL_VERIFY' | 'PHONE_VERIFY'>('EMAIL_VERIFY');
  const [verifyRequested, setVerifyRequested] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');

  if (mode === 'register') {
    return (
      <RegisterTenantView
        locale={locale}
        onBackToLogin={() => setMode('login')}
        onRegisteredToOnboarding={() => {
          onRegisteredToOnboarding?.();
        }}
      />
    );
  }

  const handleLoginSubmit = async (e: React.FormEvent) => {
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
    setSuccessMessage(null);

    try {
      await login(email, password, tenantCode.trim() || undefined);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(
          (err as Error)?.message ||
            (isEn
              ? 'Failed to connect to the server.'
              : 'فشل الاتصال بالخادم.')
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      if (!resetRequested) {
        await apiClient.post('/auth/forgot-password', {
          email: resetEmail.trim().toLowerCase(),
        });
        setResetRequested(true);
        setSuccessMessage(
          isEn
            ? 'If an account matches this email, a reset code has been issued.'
            : 'إذا كان البريد مسجلاً لدينا، فقد تم إرسال رمز إعادة تعيين كلمة المرور.'
        );
      } else {
        await apiClient.post('/auth/reset-password', {
          email: resetEmail.trim().toLowerCase(),
          code: resetCode.trim(),
          newPassword,
        });
        setSuccessMessage(
          isEn
            ? 'Password updated! You can now sign in.'
            : 'تم تحديث كلمة المرور بنجاح! يمكنك تسجيل الدخول الآن.'
        );
        setMode('login');
        setResetRequested(false);
        setResetCode('');
        setNewPassword('');
      }
    } catch (err: unknown) {
      setErrorMessage((err as Error)?.message || 'Request failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      if (!verifyRequested) {
        await apiClient.post('/auth/request-verification', {
          target: verifyTarget.trim(),
          purpose: verifyPurpose,
        });
        setVerifyRequested(true);
        setSuccessMessage(
          isEn ? 'Verification code sent.' : 'تم إرسال رمز التحقق.'
        );
      } else {
        await apiClient.post('/auth/verify-contact', {
          target: verifyTarget.trim(),
          purpose: verifyPurpose,
          code: verifyCode.trim(),
        });
        setSuccessMessage(
          isEn ? 'Contact verified successfully!' : 'تم توثيق وسيلة التواصل بنجاح!'
        );
        setVerifyRequested(false);
        setVerifyCode('');
      }
    } catch (err: unknown) {
      setErrorMessage((err as Error)?.message || 'Verification failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-[#F6F7F9] flex flex-col items-center justify-center p-4 sm:p-6 text-slate-900 font-sans antialiased"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      {/* Top Bar */}
      <div className="w-full max-w-md flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <ShieldCheck className="w-4 h-4 text-[#0D6E4F]" />
          <span>{isEn ? 'Saudi SaaS Cloud Platform' : 'منصة المطاعم السحابية'}</span>
        </div>
        {onToggleLocale && (
          <button
            type="button"
            onClick={onToggleLocale}
            aria-label={isEn ? 'Switch language to Arabic' : 'تبديل اللغة إلى الإنجليزية'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-[#0D6E4F]" />
            <span>{isEn ? 'العربية' : 'English'}</span>
          </button>
        )}
      </div>

      {/* Main Card */}
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-[#0D6E4F] text-white flex items-center justify-center mx-auto shadow-sm">
            <Building2 className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-extrabold text-slate-900">
            {mode === 'login' && (isEn ? 'Sign In to Your Workspace' : 'تسجيل الدخول إلى منشأتك')}
            {mode === 'forgot' && (isEn ? 'Reset Password' : 'استعادة كلمة المرور')}
            {mode === 'verify' && (isEn ? 'Verify Email or Mobile' : 'توثيق البريد أو الجوال')}
          </h1>
          <p className="text-xs text-slate-500">
            {isEn
              ? 'Enterprise POS, Inventory, Accounting & ZATCA Phase 2'
              : 'نقاط البيع، المخزون، المحاسبة، والفوترة الإلكترونية ZATCA'}
          </p>
        </div>

        {/* Alerts */}
        {errorMessage && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[#0D6E4F] text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Mode: Sign In */}
        {mode === 'login' && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                {isEn ? 'Email Address' : 'البريد الإلكتروني'}
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3.5" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@restaurant.sa"
                  dir="ltr"
                  className="w-full ps-10 pe-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0D6E4F] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="login-password"
                  className="block text-xs font-semibold text-slate-700"
                >
                  {isEn ? 'Password' : 'كلمة المرور'}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setSuccessMessage(null);
                    setMode('forgot');
                  }}
                  className="text-xs font-semibold text-[#0D6E4F] hover:underline cursor-pointer"
                >
                  {isEn ? 'Forgot password?' : 'نسيت كلمة المرور؟'}
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3.5" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  dir="ltr"
                  className="w-full ps-10 pe-10 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0D6E4F] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute top-1/2 -translate-y-1/2 end-3 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="login-tenant-code"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                {isEn ? 'Workspace Code (Optional)' : 'رمز المنشأة (اختياري)'}
              </label>
              <div className="relative">
                <Building2 className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3.5" />
                <input
                  id="login-tenant-code"
                  type="text"
                  value={tenantCode}
                  onChange={(e) => setTenantCode(e.target.value)}
                  placeholder="rc-brand-..."
                  dir="ltr"
                  className="w-full ps-10 pe-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0D6E4F] focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 rounded-xl bg-[#0D6E4F] hover:bg-[#0A5A40] text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <span>{isEn ? 'Sign In' : 'تسجيل الدخول'}</span>
                  {isEn ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
                </>
              )}
            </button>
          </form>
        )}

        {/* Mode: Forgot / Reset Password */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgotSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {isEn ? 'Registered Email' : 'البريد الإلكتروني المسجل'}
              </label>
              <input
                type="email"
                required
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                dir="ltr"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
              />
            </div>
            {resetRequested && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {isEn ? 'Verification Code' : 'رمز التحقق'}
                  </label>
                  <input
                    type="text"
                    required
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    dir="ltr"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {isEn ? 'New Password (min 8 chars)' : 'كلمة المرور الجديدة'}
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    dir="ltr"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
              </>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 rounded-xl bg-[#0D6E4F] hover:bg-[#0A5A40] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              <span>
                {resetRequested
                  ? isEn
                    ? 'Confirm New Password'
                    : 'تأكيد كلمة المرور الجديدة'
                  : isEn
                    ? 'Send Reset Code'
                    : 'إرسال رمز الاستعادة'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode('login')}
              className="w-full text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              {isEn ? 'Back to Sign In' : 'العودة لتسجيل الدخول'}
            </button>
          </form>
        )}

        {/* Mode: Verify Contact */}
        {mode === 'verify' && (
          <form onSubmit={handleVerifySubmit} className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setVerifyPurpose('EMAIL_VERIFY')}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                  verifyPurpose === 'EMAIL_VERIFY'
                    ? 'border-[#0D6E4F] bg-emerald-50 text-[#0D6E4F]'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                {isEn ? 'Email' : 'البريد الإلكتروني'}
              </button>
              <button
                type="button"
                onClick={() => setVerifyPurpose('PHONE_VERIFY')}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                  verifyPurpose === 'PHONE_VERIFY'
                    ? 'border-[#0D6E4F] bg-emerald-50 text-[#0D6E4F]'
                    : 'border-slate-200 text-slate-600'
                }`}
              >
                {isEn ? 'Mobile' : 'الجوال'}
              </button>
            </div>
            <input
              type="text"
              required
              value={verifyTarget}
              onChange={(e) => setVerifyTarget(e.target.value)}
              placeholder={verifyPurpose === 'EMAIL_VERIFY' ? 'owner@company.sa' : '+966500000000'}
              dir="ltr"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
            />
            {verifyRequested && (
              <input
                type="text"
                required
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="123456"
                dir="ltr"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
              />
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 rounded-xl bg-[#0D6E4F] hover:bg-[#0A5A40] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <MailCheck className="w-4 h-4" />
              <span>
                {verifyRequested
                  ? isEn
                    ? 'Verify Code'
                    : 'تأكيد الرمز'
                  : isEn
                    ? 'Send Verification Code'
                    : 'إرسال رمز التحقق'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode('login')}
              className="w-full text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              {isEn ? 'Back to Sign In' : 'العودة لتسجيل الدخول'}
            </button>
          </form>
        )}

        {/* Secondary Actions */}
        {mode === 'login' && (
          <div className="pt-4 border-t border-slate-100 space-y-2.5">
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setSuccessMessage(null);
                setMode('register');
              }}
              className="w-full py-2.5 px-4 rounded-xl border border-[#0D6E4F]/30 bg-emerald-50/40 hover:bg-emerald-50 text-[#0D6E4F] text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>{isEn ? 'Create New Organization Account' : 'إنشاء حساب منشأة جديد'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setSuccessMessage(null);
                setMode('verify');
              }}
              className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              {isEn ? 'Verify Email or Mobile OTP' : 'توثيق البريد الإلكتروني أو الجوال'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
