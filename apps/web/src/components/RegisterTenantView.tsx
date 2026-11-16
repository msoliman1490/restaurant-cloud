import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  Eye,
  EyeOff,
  FileCheck2,
  Loader2,
  MailCheck,
  MapPin,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface PublicPlan {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
  monthlyPriceSar: string;
  annualPriceSar: string;
  trialDays: number;
  maxBranches: number;
  maxDevices: number;
  maxUsers: number;
  features: string[];
}

interface PublicPolicy {
  id: string;
  policyKey: string;
  titleAr: string;
  titleEn: string;
  contentAr: string;
  contentEn: string;
  version: string;
}

interface RegisterTenantViewProps {
  locale: 'ar' | 'en';
  onBackToLogin: () => void;
  onRegisteredToOnboarding: () => void;
}

const STEP_LABELS = [
  { id: 1, ar: 'حساب المسؤول', en: 'Admin Account' },
  { id: 2, ar: 'بيانات المنشأة', en: 'Organization' },
  { id: 3, ar: 'الكيان والعنوان الوطني', en: 'Legal & Address' },
  { id: 4, ar: 'اختيار الباقة', en: 'Select Plan' },
  { id: 5, ar: 'المراجعة والموافقة', en: 'Review & PDPL' },
  { id: 6, ar: 'التحقق', en: 'Verify Contact' },
  { id: 7, ar: 'التفعيل', en: 'Provisioning' },
  { id: 8, ar: 'الانطلاق', en: 'Launch' },
];

export const RegisterTenantView: React.FC<RegisterTenantViewProps> = ({
  locale,
  onBackToLogin,
  onRegisteredToOnboarding,
}) => {
  const { establishSession } = useAuth();
  const isEn = locale === 'en';
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Step 2
  const [orgName, setOrgName] = useState('');
  const [autoCode, setAutoCode] = useState(true);
  const [customCode, setCustomCode] = useState('');
  const [primaryIndustry, setPrimaryIndustry] = useState('RESTAURANT');

  // Step 3
  const [legalName, setLegalName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [crNumber, setCrNumber] = useState('');
  const [buildingNumber, setBuildingNumber] = useState('');
  const [streetName, setStreetName] = useState('');
  const [district, setDistrict] = useState('');
  const [city, setCity] = useState('الرياض');
  const [postalCode, setPostalCode] = useState('');
  const [additionalNumber, setAdditionalNumber] = useState('');

  // Step 4 & 5
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [policies, setPolicies] = useState<PublicPolicy[]>([]);
  const [selectedPlanCode, setSelectedPlanCode] = useState('STARTER');
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [pdplAccepted, setPdplAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Step 6 (OTP)
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpMessage, setOtpMessage] = useState<string | null>(null);

  // Step 7 & 8 result
  const [provisionedResult, setProvisionedResult] = useState<{
    token: string;
    user: { id: string; email: string; displayName: string; isPlatformAdmin?: boolean };
    tenant: { id: string; code: string; displayName: string };
    subscription?: { planCode: string; status: string; trialEndsAt?: string };
  } | null>(null);

  useEffect(() => {
    Promise.all([
      apiClient.get<PublicPlan[]>('/saas/public/plans').catch(() => []),
      apiClient.get<PublicPolicy[]>('/saas/public/policies').catch(() => []),
    ]).then(([plansData, policiesData]) => {
      if (plansData.length > 0) {
        setPlans(plansData);
        const starter = plansData.find((p) => p.code === 'STARTER') ?? plansData[0];
        if (starter) setSelectedPlanCode(starter.code);
      }
      setPolicies(policiesData);
    });
  }, []);

  const selectedPlan = plans.find((p) => p.code === selectedPlanCode) ?? plans[0];

  const validateCurrentStep = (): boolean => {
    setError(null);
    if (step === 1) {
      if (!adminName.trim() || !adminEmail.trim() || adminPassword.length < 8) {
        setError(
          isEn
            ? 'Enter full name, valid email, and password (min 8 chars).'
            : 'يرجى إدخال الاسم الكامل والبريد الإلكتروني وكلمة مرور لا تقل عن 8 أحرف.'
        );
        return false;
      }
    } else if (step === 2) {
      if (!orgName.trim()) {
        setError(isEn ? 'Enter organization name.' : 'يرجى إدخال اسم المنشأة.');
        return false;
      }
      if (!autoCode && !/^[a-z0-9-]{3,50}$/.test(customCode.trim())) {
        setError(
          isEn
            ? 'Tenant code must be 3-50 lowercase letters, numbers, or hyphens.'
            : 'رمز المنشأة يجب أن يكون 3-50 حرفاً إنجليزياً صغيراً أو أرقاماً أو شرطة.'
        );
        return false;
      }
    } else if (step === 3) {
      if (!legalName.trim() || !/^\d{15}$/.test(vatNumber.trim())) {
        setError(
          isEn
            ? 'Enter legal entity name and a valid 15-digit Saudi VAT number.'
            : 'يرجى إدخال الاسم القانوني ورقم ضريبي سعودي مكون من 15 رقماً.'
        );
        return false;
      }
    } else if (step === 5) {
      if (!pdplAccepted || !termsAccepted) {
        setError(
          isEn
            ? 'Please accept the PDPL Privacy Policy and E-Commerce Terms to proceed.'
            : 'يرجى الموافقة على سياسة الخصوصية (PDPL) وشروط التجارة الإلكترونية للمتابعة.'
        );
        return false;
      }
    }
    return true;
  };

  const handleRequestOtp = async () => {
    setError(null);
    setOtpMessage(null);
    try {
      await apiClient.post('/auth/request-verification', {
        target: adminEmail.trim().toLowerCase(),
        purpose: 'EMAIL_VERIFY',
      });
      setOtpRequested(true);
      setOtpMessage(
        isEn
          ? 'Verification code sent to your email.'
          : 'تم إرسال رمز التحقق إلى بريدك الإلكتروني.'
      );
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to send code');
    }
  };

  const handleVerifyOtp = async () => {
    setError(null);
    try {
      await apiClient.post('/auth/verify-contact', {
        target: adminEmail.trim().toLowerCase(),
        purpose: 'EMAIL_VERIFY',
        code: otpCode.trim(),
      });
      setOtpVerified(true);
      setOtpMessage(isEn ? 'Email verified!' : 'تم توثيق البريد الإلكتروني بنجاح!');
    } catch (err: unknown) {
      setError((err as Error)?.message || (isEn ? 'Invalid code' : 'رمز التحقق غير صحيح'));
    }
  };

  const handleProvisionTenant = async () => {
    setError(null);
    setIsSubmitting(true);
    setStep(7);
    try {
      const payload = {
        ...(autoCode ? {} : { code: customCode.trim().toLowerCase() }),
        displayName: orgName.trim(),
        primaryLocale: locale === 'en' ? 'en-SA' : 'ar-SA',
        timezone: 'Asia/Riyadh',
        primaryIndustry,
        planCode: selectedPlanCode,
        billingCycle,
        pdplConsentAccepted: pdplAccepted,
        termsAccepted,
        initialLegalEntity: {
          legalName: legalName.trim(),
          vatNumber: vatNumber.trim(),
          crNumber: crNumber.trim() || undefined,
          functionalCurrency: 'SAR',
          buildingNumber: buildingNumber.trim() || undefined,
          streetName: streetName.trim() || undefined,
          district: district.trim() || undefined,
          city: city.trim() || undefined,
          postalCode: postalCode.trim() || undefined,
          additionalNumber: additionalNumber.trim() || undefined,
          countryCode: 'SA',
        },
        initialAdminUser: {
          email: adminEmail.trim().toLowerCase(),
          displayName: adminName.trim(),
          phone: adminPhone.trim() || undefined,
          password: adminPassword,
        },
      };

      const data = await apiClient.post<NonNullable<typeof provisionedResult>>(
        '/tenants/onboard',
        payload
      );
      setProvisionedResult(data);
      setStep(8);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Provisioning failed');
      setStep(6);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNext = () => {
    if (!validateCurrentStep()) return;
    if (step === 6) {
      handleProvisionTenant();
      return;
    }
    setStep((prev) => Math.min(8, prev + 1));
  };

  const handleLaunchWorkspace = async () => {
    if (!provisionedResult) return;
    await establishSession(
      provisionedResult.token,
      provisionedResult.user,
      {
        id: provisionedResult.tenant.id,
        code: provisionedResult.tenant.code,
        name: provisionedResult.tenant.displayName,
      }
    );
    onRegisteredToOnboarding();
  };

  return (
    <div
      className="min-h-screen bg-[#F6F7F9] text-slate-900 flex flex-col items-center justify-center p-4 sm:p-6"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0D6E4F] text-white flex items-center justify-center">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                {isEn ? 'Create Restaurant Cloud Account' : 'إنشاء حساب منشأة جديد'}
              </h1>
              <p className="text-xs text-slate-500">
                {isEn
                  ? `Step ${step} of 8 — ${STEP_LABELS[step - 1]?.en}`
                  : `الخطوة ${step} من 8 — ${STEP_LABELS[step - 1]?.ar}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onBackToLogin}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 bg-white cursor-pointer"
          >
            {isEn ? 'Back to Sign In' : 'العودة لتسجيل الدخول'}
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-6 pt-4 pb-2">
          <div className="grid grid-cols-8 gap-1.5">
            {STEP_LABELS.map((s) => (
              <div
                key={s.id}
                className={`h-1.5 rounded-full transition-colors ${
                  s.id <= step ? 'bg-[#0D6E4F]' : 'bg-slate-200'
                }`}
                title={isEn ? s.en : s.ar}
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <UserPlus className="w-4 h-4 text-[#0D6E4F]" />
                <span>{isEn ? 'Primary Owner Credentials' : 'بيانات مالك المنشأة'}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {isEn ? 'Full Name *' : 'الاسم الكامل *'}
                  </label>
                  <input
                    type="text"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    placeholder={isEn ? 'e.g. Tariq Al-Otaibi' : 'مثال: طارق العتيبي'}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {isEn ? 'Mobile Number' : 'رقم الجوال'}
                  </label>
                  <input
                    type="tel"
                    value={adminPhone}
                    onChange={(e) => setAdminPhone(e.target.value)}
                    placeholder="+966500000000"
                    dir="ltr"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {isEn ? 'Work Email *' : 'البريد الإلكتروني *'}
                  </label>
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="owner@company.sa"
                    dir="ltr"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {isEn ? 'Password (min 8 chars) *' : 'كلمة المرور (8 أحرف على الأقل) *'}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      dir="ltr"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:border-[#0D6E4F] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <Sparkles className="w-4 h-4 text-[#0D6E4F]" />
                <span>{isEn ? 'Organization & Industry' : 'بيانات المنشأة والنشاط'}</span>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {isEn ? 'Organization / Brand Name *' : 'اسم المنشأة أو العلامة التجارية *'}
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                    if (!legalName) setLegalName(e.target.value);
                  }}
                  placeholder={isEn ? 'e.g. Najd Hospitality Group' : 'مثال: مجموعة نجد للضيافة'}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:border-[#0D6E4F] focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {isEn ? 'Primary Industry' : 'النشاط الرئيسي'}
                  </label>
                  <select
                    value={primaryIndustry}
                    onChange={(e) => setPrimaryIndustry(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:border-[#0D6E4F] focus:outline-none"
                  >
                    <option value="RESTAURANT">{isEn ? 'Restaurant' : 'مطعم'}</option>
                    <option value="CAFE">{isEn ? 'Cafe & Coffee' : 'مقهى'}</option>
                    <option value="BAKERY">{isEn ? 'Bakery & Pastry' : 'مخبز وحلويات'}</option>
                    <option value="RETAIL">{isEn ? 'Retail Store' : 'متجر تجزئة'}</option>
                    <option value="GROCERY">{isEn ? 'Grocery & Market' : 'تموينات وسوبرماركت'}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {isEn ? 'Workspace Code' : 'رمز المنشأة'}
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600 mb-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCode}
                      onChange={(e) => setAutoCode(e.target.checked)}
                    />
                    <span>
                      {isEn
                        ? 'Auto-generate unique code (recommended)'
                        : 'توليد رمز فريد تلقائياً (مستحسن)'}
                    </span>
                  </label>
                  {!autoCode && (
                    <input
                      type="text"
                      value={customCode}
                      onChange={(e) => setCustomCode(e.target.value)}
                      placeholder="my-brand-sa"
                      dir="ltr"
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:border-[#0D6E4F] focus:outline-none"
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <MapPin className="w-4 h-4 text-[#0D6E4F]" />
                <span>
                  {isEn
                    ? 'Primary Legal Entity & Saudi National Address'
                    : 'الكيان القانوني الرئيسي والعنوان الوطني السعودي'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isEn ? 'Legal Entity Name *' : 'الاسم القانوني للشركة *'}
                  </label>
                  <input
                    type="text"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isEn ? '15-Digit VAT Number *' : 'الرقم الضريبي (15 خانة) *'}
                  </label>
                  <input
                    type="text"
                    value={vatNumber}
                    onChange={(e) => setVatNumber(e.target.value)}
                    placeholder="310000000000003"
                    dir="ltr"
                    maxLength={15}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isEn ? 'CR Number' : 'رقم السجل التجاري'}
                  </label>
                  <input
                    type="text"
                    value={crNumber}
                    onChange={(e) => setCrNumber(e.target.value)}
                    dir="ltr"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isEn ? 'City' : 'المدينة'}
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isEn ? 'District' : 'الحي'}
                  </label>
                  <input
                    type="text"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isEn ? 'Street Name' : 'اسم الشارع'}
                  </label>
                  <input
                    type="text"
                    value={streetName}
                    onChange={(e) => setStreetName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isEn ? 'Building No.' : 'رقم المبنى'}
                  </label>
                  <input
                    type="text"
                    value={buildingNumber}
                    onChange={(e) => setBuildingNumber(e.target.value)}
                    dir="ltr"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {isEn ? 'Postal & Additional' : 'الرمز البريدي / الإضافي'}
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      placeholder="12345"
                      dir="ltr"
                      className="w-1/2 px-2.5 py-2 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
                    />
                    <input
                      type="text"
                      value={additionalNumber}
                      onChange={(e) => setAdditionalNumber(e.target.value)}
                      placeholder="4321"
                      dir="ltr"
                      className="w-1/2 px-2.5 py-2 rounded-xl border border-slate-200 text-sm focus:border-[#0D6E4F] focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <CreditCard className="w-4 h-4 text-[#0D6E4F]" />
                  <span>{isEn ? 'Choose Subscription Plan' : 'اختر باقة الاشتراك'}</span>
                </div>
                <div className="inline-flex rounded-xl border border-slate-200 p-1 bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setBillingCycle('MONTHLY')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                      billingCycle === 'MONTHLY' ? 'bg-[#0D6E4F] text-white' : 'text-slate-600'
                    }`}
                  >
                    {isEn ? 'Monthly' : 'شهري'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillingCycle('ANNUAL')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                      billingCycle === 'ANNUAL' ? 'bg-[#0D6E4F] text-white' : 'text-slate-600'
                    }`}
                  >
                    {isEn ? 'Annual' : 'سنوي'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {plans.map((p) => {
                  const isSelected = p.code === selectedPlanCode;
                  const price =
                    billingCycle === 'ANNUAL' ? p.annualPriceSar : p.monthlyPriceSar;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPlanCode(p.code)}
                      className={`text-start p-4 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[#0D6E4F] bg-emerald-50/40 ring-1 ring-[#0D6E4F]'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="text-sm font-bold text-slate-900">
                        {isEn ? p.nameEn : p.nameAr}
                      </div>
                      <div className="text-xl font-extrabold text-[#0D6E4F] mt-1">
                        {price} <span className="text-xs font-medium text-slate-500">SAR</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        {isEn
                          ? `${p.trialDays}-day free trial · ${p.maxBranches} branches · ${p.maxUsers} users`
                          : `تجربة مجانية ${p.trialDays} يوماً · ${p.maxBranches} فروع · ${p.maxUsers} مستخدم`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <FileCheck2 className="w-4 h-4 text-[#0D6E4F]" />
                <span>
                  {isEn ? 'Review & Saudi PDPL Compliance' : 'المراجعة والموافقة على سياسات PDPL'}
                </span>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                <div>
                  <span className="font-semibold">{isEn ? 'Organization:' : 'المنشأة:'}</span>{' '}
                  {orgName} ({legalName})
                </div>
                <div>
                  <span className="font-semibold">{isEn ? 'Selected Plan:' : 'الباقة:'}</span>{' '}
                  {selectedPlan ? (isEn ? selectedPlan.nameEn : selectedPlan.nameAr) : selectedPlanCode}{' '}
                  ({billingCycle})
                </div>
              </div>

              {policies.slice(0, 2).map((pol) => (
                <div key={pol.id} className="p-3 rounded-xl border border-slate-200 bg-white text-xs">
                  <div className="font-bold text-slate-800 mb-1">
                    {isEn ? pol.titleEn : pol.titleAr} (v{pol.version})
                  </div>
                  <p className="text-slate-600 line-clamp-3">
                    {isEn ? pol.contentEn : pol.contentAr}
                  </p>
                </div>
              ))}

              <div className="space-y-2.5 pt-1">
                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pdplAccepted}
                    onChange={(e) => setPdplAccepted(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {isEn
                      ? 'I accept the Saudi Personal Data Protection Law (PDPL) Privacy Policy.'
                      : 'أوافق على سياسة الخصوصية وحماية البيانات الشخصية السعودية (PDPL).'}
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {isEn
                      ? 'I accept the Saudi E-Commerce Law Subscription Terms & Conditions.'
                      : 'أوافق على شروط وأحكام الاشتراك ونظام التجارة الإلكترونية السعودي.'}
                  </span>
                </label>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <MailCheck className="w-4 h-4 text-[#0D6E4F]" />
                <span>{isEn ? 'Email Contact Verification' : 'التحقق من البريد الإلكتروني'}</span>
              </div>
              <p className="text-xs text-slate-600">
                {isEn
                  ? `Verify ${adminEmail} with a one-time code, or continue directly to provision your trial workspace.`
                  : `يمكنك توثيق البريد الإلكتروني ${adminEmail} برمز تحقق لمرة واحدة أو المتابعة مباشرة لتفعيل المساحة التجريبية.`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRequestOtp}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 cursor-pointer"
                >
                  {isEn ? 'Send Verification Code' : 'إرسال رمز التحقق'}
                </button>
                {otpRequested && !otpVerified && (
                  <>
                    <input
                      type="text"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="123456"
                      dir="ltr"
                      className="px-3 py-2 rounded-xl border border-slate-200 text-xs w-32"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyOtp}
                      className="px-4 py-2 rounded-xl bg-[#0D6E4F] text-white text-xs font-semibold cursor-pointer"
                    >
                      {isEn ? 'Verify' : 'تحقق'}
                    </button>
                  </>
                )}
              </div>
              {otpMessage && (
                <div className="text-xs font-medium text-[#0D6E4F]">{otpMessage}</div>
              )}
            </div>
          )}

          {step === 7 && (
            <div className="py-10 flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="w-8 h-8 text-[#0D6E4F] animate-spin" />
              <div className="text-sm font-bold text-slate-800">
                {isEn
                  ? 'Provisioning isolated tenant workspace...'
                  : 'جاري تجهيز بيئة المنشأة المعزولة وبدء الفترة التجريبية...'}
              </div>
            </div>
          )}

          {step === 8 && provisionedResult && (
            <div className="py-4 space-y-4 text-center">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-[#0D6E4F] flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">
                {isEn ? 'Workspace Provisioned!' : 'تم إنشاء وتفعيل حساب المنشأة بنجاح!'}
              </h2>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 text-xs font-mono text-slate-800">
                <ShieldCheck className="w-4 h-4 text-[#0D6E4F]" />
                <span>
                  {isEn ? 'Tenant Code:' : 'رمز المنشأة:'} {provisionedResult.tenant.code}
                </span>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleLaunchWorkspace}
                  className="px-6 py-3 rounded-xl bg-[#0D6E4F] hover:bg-[#0A5A40] text-white text-sm font-bold cursor-pointer"
                >
                  {isEn ? 'Start Guided Setup Wizard' : 'ابدأ معالج التهيئة الموجه'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        {step < 7 && (
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <button
              type="button"
              onClick={() => (step === 1 ? onBackToLogin() : setStep((s) => s - 1))}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {isEn ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
              <span>{isEn ? 'Previous' : 'السابق'}</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#0D6E4F] hover:bg-[#0A5A40] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <span>
                {step === 6
                  ? isEn
                    ? 'Create Workspace'
                    : 'إنشاء وتفعيل المنشأة'
                  : isEn
                    ? 'Continue'
                    : 'التالي'}
              </span>
              {isEn ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
