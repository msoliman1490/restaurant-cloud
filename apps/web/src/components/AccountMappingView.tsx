import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Building2,
  Store,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  Trash2,
  RefreshCw,
  Search,
  Filter,
  ShieldCheck,
  X,
  Info,
  GitFork,
  CheckCircle,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { AccountNode } from './AccountingView';

export interface MappingRecord {
  id?: string | null;
  mappingKey: string;
  source: 'BRANCH_OVERRIDE' | 'COMPANY_MAPPING' | 'SYSTEM_DEFAULT' | 'NOT_CONFIGURED';
  isOverride: boolean;
  branchId?: string | null;
  branchName?: string | null;
  accountId?: string | null;
  accountCode?: string | null;
  accountName?: string | null;
  accountType?: string | null;
  normalBalance?: string | null;
  description?: string | null;
  isActive: boolean;
  companyAccountId?: string | null;
  companyAccountCode?: string | null;
}

export interface BranchOption {
  id: string;
  name: string;
  code: string;
}

export const MAPPING_KEY_METADATA: Record<
  string,
  {
    nameAr: string;
    description: string;
    category: 'SALES' | 'INVENTORY' | 'PAYMENTS' | 'AGGREGATORS' | 'CASH_OPS' | 'INTER_BRANCH';
    categoryAr: string;
    expectedType: string;
    expectedBalance: string;
    expectedTypeLabel: string;
  }
> = {
  SALES: {
    nameAr: 'إيرادات المبيعات الرئيسية',
    description: 'حساب الإيرادات الأساسي لتسجيل مبيعات الأطعمة والمشروبات',
    category: 'SALES',
    categoryAr: 'المبيعات والضرائب',
    expectedType: 'REVENUE',
    expectedBalance: 'CREDIT',
    expectedTypeLabel: 'إيرادات (REVENUE) - دائن',
  },
  SALES_RETURNS: {
    nameAr: 'مردودات المبيعات',
    description: 'حساب تخفيض الإيرادات عند إرجاع أو إلغاء الطلبات بعد إصدار الفاتورة',
    category: 'SALES',
    categoryAr: 'المبيعات والضرائب',
    expectedType: 'REVENUE',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'إيرادات مقابلة أو مصروفات',
  },
  SALES_DISCOUNTS: {
    nameAr: 'خصومات المبيعات الممنوحة',
    description: 'حساب الخصومات الترويجية والتخفيضات الممنوحة للعملاء',
    category: 'SALES',
    categoryAr: 'المبيعات والضرائب',
    expectedType: 'REVENUE',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'إيرادات مقابلة أو مصروفات',
  },
  VAT_OUTPUT: {
    nameAr: 'ضريبة القيمة المضافة المستحقة (المخرجات)',
    description: 'حساب التزامات ضريبة القيمة المضافة 15% على المبيعات لهيئة الزكاة والضريبة والجمارك',
    category: 'SALES',
    categoryAr: 'المبيعات والضرائب',
    expectedType: 'LIABILITY',
    expectedBalance: 'CREDIT',
    expectedTypeLabel: 'التزامات (LIABILITY) - دائن',
  },
  ROUNDING_DIFFERENCE: {
    nameAr: 'فروقات تقريب الهللات',
    description: 'حساب معالجة فروقات الكسور والهللات الناتجة عن احتساب الضريبة والتقريب',
    category: 'SALES',
    categoryAr: 'المبيعات والضرائب',
    expectedType: 'EXPENSE',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'مصروفات (EXPENSE) أو إيرادات',
  },
  INVENTORY: {
    nameAr: 'مخزون المواد الأولية والأغذية',
    description: 'حساب الأصول المتداولة لقيمة المخزون بالمستودعات والمطابخ',
    category: 'INVENTORY',
    categoryAr: 'المخزون والتكلفة',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  COGS: {
    nameAr: 'تكلفة البضاعة المباعة (الأغذية والمشروبات)',
    description: 'حساب تكلفة استهلاك المواد والمقادير المستخدمة في الوجبات المباعة',
    category: 'INVENTORY',
    categoryAr: 'المخزون والتكلفة',
    expectedType: 'COGS',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'تكلفة مبيعات (COGS) - مدين',
  },
  CASH_VAULT: {
    nameAr: 'خزائن وصناديق النقد الافتراضية',
    description: 'الحساب الوسيط الافتراضي للمقبوضات النقدية قبل تعيين خزينة الفرع',
    category: 'PAYMENTS',
    categoryAr: 'التحصيل ووسائل الدفع',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  BANK: {
    nameAr: 'الحسابات البنكية الجارية',
    description: 'الحساب البنكي الافتراضي للتحويلات والإيداعات المصرفية',
    category: 'PAYMENTS',
    categoryAr: 'التحصيل ووسائل الدفع',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  MADA_CLEARING: {
    nameAr: 'وسيط تسوية شبكة مدى (EDC Mada)',
    description: 'حساب وسيط للأصول المتداولة لعمليات بطاقات مدى حتى مطابقتها بنكياً',
    category: 'PAYMENTS',
    categoryAr: 'التحصيل ووسائل الدفع',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  VISA_CLEARING: {
    nameAr: 'وسيط تسوية فيزا وماستركارد',
    description: 'حساب وسيط لعمليات البطاقات الائتمانية الدولية حتى التسوية البنكية',
    category: 'PAYMENTS',
    categoryAr: 'التحصيل ووسائل الدفع',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  APPLE_PAY_CLEARING: {
    nameAr: 'وسيط تسوية أبل باي',
    description: 'حساب وسيط لعمليات الدفع عبر محفظة Apple Pay الإلكترونية',
    category: 'PAYMENTS',
    categoryAr: 'التحصيل ووسائل الدفع',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  STC_PAY_CLEARING: {
    nameAr: 'وسيط تسوية إس تي سي باي',
    description: 'حساب وسيط لعمليات محفظة STC Pay الإلكترونية ورمز الاستجابة السريع QR',
    category: 'PAYMENTS',
    categoryAr: 'التحصيل ووسائل الدفع',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  CARD_CLEARING: {
    nameAr: 'وسيط تسوية أجهزة الدفع الإلكتروني الموحد',
    description: 'حساب وسيط عام لمدفوعات أجهزة الدفع عند عدم فصل الشبكات',
    category: 'PAYMENTS',
    categoryAr: 'التحصيل ووسائل الدفع',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  GATEWAY_FEES: {
    nameAr: 'عمولات ورسوم مزودي الدفع الإلكتروني',
    description: 'حساب مصروفات عمولات بوابات الدفع وأجهزة مدى والبطاقات (Mada, Visa, Apple Pay, Geidea...)',
    category: 'PAYMENTS',
    categoryAr: 'التحصيل ووسائل الدفع',
    expectedType: 'EXPENSE',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'مصروفات (EXPENSE) - مدين',
  },
  AGGREGATOR_RECEIVABLE: {
    nameAr: 'ذمم منصات وتطبيقات التوصيل (جاهز، هنقرستيشن...) ',
    description: 'حساب مدين لتسجيل مبيعات تطبيقات التوصيل كذمم مدينة مستحقة على المنصة',
    category: 'AGGREGATORS',
    categoryAr: 'تطبيقات التوصيل',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  AGGREGATOR_COMMISSION: {
    nameAr: 'عمولات ورسوم تطبيقات التوصيل',
    description: 'حساب مصروفات لعمولة المنصة المخصومة عند تحويل مبالغ المبيعات',
    category: 'AGGREGATORS',
    categoryAr: 'تطبيقات التوصيل',
    expectedType: 'EXPENSE',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'مصروفات (EXPENSE) - مدين',
  },
  AGGREGATOR_SUSPENSE: {
    nameAr: 'وسيط تسوية وتوفيق تطبيقات التوصيل',
    description: 'حساب معلق لمطابقة الحركات المستلمة من التطبيق مع كشف الحساب الفعلي',
    category: 'AGGREGATORS',
    categoryAr: 'تطبيقات التوصيل',
    expectedType: 'LIABILITY',
    expectedBalance: 'CREDIT',
    expectedTypeLabel: 'وسيط تسوية (أصول أو التزامات)',
  },
  CASH_OVER_SHORT: {
    nameAr: 'عجز الصندوق والورديات',
    description: 'حساب مصروف/خسارة لمعالجة النقص النقدي (العجز) عند إقفال الوردية',
    category: 'CASH_OPS',
    categoryAr: 'الورديات والنقدية',
    expectedType: 'EXPENSE',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'مصروفات أو مصروفات أخرى (EXPENSE) - مدين',
  },
  CASH_OVERAGE: {
    nameAr: 'فائض وزيادة الصندوق والورديات',
    description: 'حساب إيرادات مستقلة لمعالجة الزيادة النقدية (الفائض) عند إقفال الوردية',
    category: 'CASH_OPS',
    categoryAr: 'الورديات والنقدية',
    expectedType: 'REVENUE',
    expectedBalance: 'CREDIT',
    expectedTypeLabel: 'إيرادات أو إيرادات أخرى (REVENUE / OTHER_INCOME) - دائن',
  },
  CASH_IN_TRANSIT: {
    nameAr: 'نقدية في الطريق والتحويل',
    description: 'حساب أصول وسيط للنقدية أثناء نقلها من الفرع إلى البنك أو بين الخزائن',
    category: 'CASH_OPS',
    categoryAr: 'الورديات والنقدية',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  INTER_BRANCH_CLEARING: {
    nameAr: 'حساب تسوية المعاملات بين الفروع (Inter-Branch)',
    description: 'حساب وسيط لمطابقة التحويلات وحركات المخزون والمصروفات المشتركة بين الفروع',
    category: 'INTER_BRANCH',
    categoryAr: 'المعاملات بين الفروع',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'حساب وسيط (أصول أو التزامات)',
  },
  INVENTORY_IN_TRANSIT: {
    nameAr: 'مخزون في الطريق (Inventory In Transit)',
    description: 'حساب أصول لتتبع قيمة المخزون المشحون بين الفروع قبل استلامه فعلياً',
    category: 'INTER_BRANCH',
    categoryAr: 'المعاملات بين الفروع',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  INVENTORY_DAMAGE_LOSS: {
    nameAr: 'خسائر وتلف وفقدان المخزون بالتحويلات',
    description: 'حساب مصروفات لتسجيل العجز أو التلف أو الفقدان المعتمد أثناء التحويلات المخزنية',
    category: 'INTER_BRANCH',
    categoryAr: 'المعاملات بين الفروع',
    expectedType: 'EXPENSE',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'مصروفات (EXPENSE / OTHER_EXPENSE) - مدين',
  },
  INVENTORY_GAIN: {
    nameAr: 'فائض وزيادة استلام المخزون',
    description: 'حساب إيرادات أخرى لتسجيل الزيادة الفعلية المعتمدة عند استلام التحويلات المخزنية',
    category: 'INTER_BRANCH',
    categoryAr: 'المعاملات بين الفروع',
    expectedType: 'REVENUE',
    expectedBalance: 'CREDIT',
    expectedTypeLabel: 'إيرادات أخرى (REVENUE / OTHER_INCOME) - دائن',
  },
  DUE_FROM_AFFILIATE: {
    nameAr: 'ذمم مدينة من منشآت شقيقة (Due From Affiliate)',
    description: 'حساب أصول متداولة لتسجيل المستحقات الناتجة عن تحويلات المخزون بين الكيانات القانونية',
    category: 'INTER_BRANCH',
    categoryAr: 'المعاملات بين الفروع',
    expectedType: 'ASSET',
    expectedBalance: 'DEBIT',
    expectedTypeLabel: 'أصول (ASSET) - مدين',
  },
  DUE_TO_AFFILIATE: {
    nameAr: 'ذمم دائنة لمنشآت شقيقة (Due To Affiliate)',
    description: 'حساب التزامات متداولة لتسجيل المستحقات للدفع عن تحويلات المخزون بين الكيانات القانونية',
    category: 'INTER_BRANCH',
    categoryAr: 'المعاملات بين الفروع',
    expectedType: 'LIABILITY',
    expectedBalance: 'CREDIT',
    expectedTypeLabel: 'التزامات (LIABILITY) - دائن',
  },
};

interface AccountMappingViewProps {
  legalEntityId: string;
  theme: 'light' | 'dark';
  flatAccounts: AccountNode[];
}

export const AccountMappingView: React.FC<AccountMappingViewProps> = ({
  legalEntityId,
  theme: _theme,
  flatAccounts,
}) => {
  const toast = useToast();
  const { dir } = useLocale();
  const [activeSubTab, setActiveSubTab] = useState<'company' | 'branch_overrides'>('company');
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const [companyMappings, setCompanyMappings] = useState<MappingRecord[]>([]);
  const [effectiveMappings, setEffectiveMappings] = useState<MappingRecord[]>([]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [targetMappingKey, setTargetMappingKey] = useState<string>('');
  const [targetBranchId, setTargetBranchId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [mappingDesc, setMappingDesc] = useState<string>('');
  const [modalError, setModalError] = useState<string | null>(null);

  // Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  // Load branches
  useEffect(() => {
    async function loadBranches() {
      try {
        const res = await apiClient.get<BranchOption[]>(`/branches?legalEntityId=${legalEntityId}`);
        const list = res || [];
        setBranches(list);
        if (list.length > 0 && !selectedBranchId) {
          setSelectedBranchId(list[0].id);
        }
      } catch (err) {
        console.warn('Failed to load branches:', err);
      }
    }
    if (legalEntityId) {
      loadBranches();
    }
  }, [legalEntityId]);

  // Load company mappings
  const loadCompanyMappings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<MappingRecord[]>(
        `/accounting/account-mappings?legalEntityId=${legalEntityId}`
      );
      setCompanyMappings(res || []);
    } catch (err: any) {
      toast.error(err.message || 'فشل تحميل إعدادات الربط المحاسبي');
    } finally {
      setLoading(false);
    }
  }, [legalEntityId]);

  // Load effective mappings for branch
  const loadEffectiveMappings = useCallback(async () => {
    if (!selectedBranchId) return;
    setLoading(true);
    try {
      const res = await apiClient.get<MappingRecord[]>(
        `/accounting/account-mappings?legalEntityId=${legalEntityId}&branchId=${selectedBranchId}&includeEffective=true`
      );
      setEffectiveMappings(res || []);
    } catch (err: any) {
      toast.error(err.message || 'فشل تحميل استثناءات الفرع');
    } finally {
      setLoading(false);
    }
  }, [legalEntityId, selectedBranchId]);

  useEffect(() => {
    if (activeSubTab === 'company') {
      loadCompanyMappings();
    } else {
      loadEffectiveMappings();
    }
  }, [activeSubTab, loadCompanyMappings, loadEffectiveMappings]);

  // Handle open modal
  const handleOpenEditModal = (key: string, branchId: string | null = null, currentAccId?: string | null) => {
    setModalError(null);
    setTargetMappingKey(key);
    setTargetBranchId(branchId);
    setSelectedAccountId(currentAccId || '');
    setMappingDesc('');
    setIsModalOpen(true);
  };

  // Compatibility validation for modal
  const selectedAccount = useMemo(() => {
    return flatAccounts.find((a) => a.id === selectedAccountId);
  }, [flatAccounts, selectedAccountId]);

  const targetMeta = useMemo(() => {
    return MAPPING_KEY_METADATA[targetMappingKey] || null;
  }, [targetMappingKey]);

  const validationResult = useMemo(() => {
    if (!selectedAccount || !targetMeta) return { isValid: true, message: '' };

    if (!selectedAccount.isPostable) {
      return { isValid: false, message: 'الحساب المحدد رئيسي/تجميعي ولا يقبل ترحيل القيود' };
    }
    if (selectedAccount.status && selectedAccount.status !== 'ACTIVE') {
      return { isValid: false, message: 'الحساب المحدد غير نشط' };
    }

    const type = selectedAccount.accountType.toUpperCase();
    const balance = selectedAccount.normalBalance.toUpperCase();

    if (targetMappingKey === 'SALES' && (type !== 'REVENUE' || balance !== 'CREDIT')) {
      return { isValid: false, message: 'مفتاح المبيعات يتطلب حساب إيرادات بطبيعة دائنة (REVENUE/CREDIT)' };
    }
    if (targetMappingKey === 'VAT_OUTPUT' && (type !== 'LIABILITY' || balance !== 'CREDIT')) {
      return { isValid: false, message: 'مفتاح ضريبة المخرجات يتطلب حساب التزامات بطبيعة دائنة (LIABILITY/CREDIT)' };
    }
    if (
      ['INVENTORY', 'CASH_VAULT', 'BANK', 'MADA_CLEARING', 'VISA_CLEARING', 'APPLE_PAY_CLEARING', 'STC_PAY_CLEARING', 'AGGREGATOR_RECEIVABLE'].includes(
        targetMappingKey
      ) &&
      (type !== 'ASSET' || balance !== 'DEBIT')
    ) {
      return { isValid: false, message: 'هذا المفتاح يتطلب حساب أصول بطبيعة مدينة (ASSET/DEBIT)' };
    }
    if (targetMappingKey === 'COGS' && type !== 'COGS' && type !== 'EXPENSE') {
      return { isValid: false, message: 'مفتاح تكلفة المبيعات يتطلب حساب تكلفة أو مصروفات (COGS/EXPENSE)' };
    }

    return { isValid: true, message: 'الحساب متوافق تماماً مع الغرض المحاسبي' };
  }, [selectedAccount, targetMeta, targetMappingKey]);

  // Handle Save
  const handleSaveMapping = async () => {
    if (!selectedAccountId) {
      setModalError('يرجى اختيار حساب من دليل الحسابات');
      return;
    }
    if (!validationResult.isValid) {
      setModalError(validationResult.message);
      return;
    }

    try {
      await apiClient.post('/accounting/account-mappings', {
        legalEntityId,
        branchId: targetBranchId || null,
        mappingKey: targetMappingKey,
        accountId: selectedAccountId,
        description: mappingDesc.trim() || null,
        isActive: true,
      });

      toast.success(
        targetBranchId
          ? `تم حفظ استثناء الفرع للمفتاح ${targetMappingKey} بنجاح`
          : `تم حفظ الربط الافتراضي للمفتاح ${targetMappingKey} بنجاح`
      );
      setIsModalOpen(false);

      if (activeSubTab === 'company') {
        await loadCompanyMappings();
      } else {
        await loadEffectiveMappings();
      }
    } catch (err: any) {
      const msg = err.message || 'فشل حفظ إعداد الربط المحاسبي';
      setModalError(msg);
      toast.error(msg);
    }
  };

  // Handle Delete Override
  const handleDeleteOverride = async (mappingId: string, keyName: string) => {
    if (!window.confirm(`هل أنت متأكد من حذف استثناء الفرع للمفتاح (${keyName}) والعودة للافتراضي؟`)) return;

    try {
      await apiClient.delete(`/accounting/account-mappings/${mappingId}`);
      toast.success('تم حذف استثناء الفرع والعودة للربط الافتراضي للشركة');
      await loadEffectiveMappings();
    } catch (err: any) {
      toast.error(err.message || 'فشل حذف استثناء الفرع');
    }
  };

  // Filtered keys
  const allStandardKeys = useMemo(() => Object.keys(MAPPING_KEY_METADATA), []);

  const displayedList = useMemo(() => {
    if (activeSubTab === 'company') {
      const map = new Map<string, MappingRecord>();
      companyMappings.forEach((m) => {
        if (!m.branchId) map.set(m.mappingKey, m);
      });

      return allStandardKeys
        .map((key) => {
          const rec = map.get(key);
          const meta = MAPPING_KEY_METADATA[key];
          return {
            mappingKey: key,
            meta,
            isConfigured: Boolean(rec),
            mappingId: rec?.id || null,
            accountId: rec?.accountId || null,
            accountCode: rec?.accountCode || null,
            accountName: rec?.accountName || null,
            accountType: rec?.accountType || null,
            normalBalance: rec?.normalBalance || null,
            description: rec?.description || null,
            source: rec ? ('COMPANY_MAPPING' as const) : ('NOT_CONFIGURED' as const),
          };
        })
        .filter((item) => {
          if (selectedCategory !== 'ALL' && item.meta.category !== selectedCategory) return false;
          if (!searchQuery) return true;
          const q = searchQuery.toLowerCase();
          return (
            item.mappingKey.toLowerCase().includes(q) ||
            item.meta.nameAr.includes(q) ||
            (item.accountCode && item.accountCode.includes(q)) ||
            (item.accountName && item.accountName.toLowerCase().includes(q))
          );
        });
    } else {
      return effectiveMappings
        .map((item) => {
          const meta = MAPPING_KEY_METADATA[item.mappingKey] || {
            nameAr: item.mappingKey,
            description: '',
            category: 'SALES',
            categoryAr: 'عام',
            expectedTypeLabel: '',
          };
          return {
            ...item,
            meta,
            isConfigured: item.source !== 'NOT_CONFIGURED',
            mappingId: item.id || null,
          };
        })
        .filter((item) => {
          if (selectedCategory !== 'ALL' && item.meta.category !== selectedCategory) return false;
          if (!searchQuery) return true;
          const q = searchQuery.toLowerCase();
          return (
            item.mappingKey.toLowerCase().includes(q) ||
            item.meta.nameAr.includes(q) ||
            (item.accountCode && item.accountCode.includes(q)) ||
            (item.accountName && item.accountName.toLowerCase().includes(q))
          );
        });
    }
  }, [activeSubTab, companyMappings, effectiveMappings, allStandardKeys, selectedCategory, searchQuery]);

  return (
    <div className="flex flex-col gap-6" dir={dir}>
      {/* Header Banner */}
      <div className="p-5 rounded-2xl border bg-white border-slate-200 text-slate-900 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-emerald-50 text-[#0D6E4F]">
            <GitFork className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <span>الربط المحاسبي واستثناءات الفروع</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 text-[#0D6E4F] font-semibold border border-emerald-200">
                الربط التلقائي
              </span>
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              إدارة الربط المركزي التلقائي لجميع العمليات التشغيلية بالدليل المحاسبي مع دعم استثناءات الفروع (Branch Overrides)
            </p>
          </div>
        </div>

        {/* Priority Banner */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50 text-xs text-blue-800 font-medium">
          <ShieldCheck className="w-4 h-4 text-blue-700" />
          <span>أولوية الاحتساب: استثناء الفرع ← ربط الشركة الافتراضي ← الافتراضي العام</span>
        </div>
      </div>

      {/* Sub Tabs: Company Default vs Branch Overrides */}
      <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveSubTab('company')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeSubTab === 'company'
                ? 'bg-[#0D6E4F] hover:bg-[#0A583F] text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>الربط الافتراضي للشركة القانونية</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('branch_overrides')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeSubTab === 'branch_overrides'
                ? 'bg-[#0D6E4F] hover:bg-[#0A583F] text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Store className="w-4 h-4" />
            <span>استثناءات وتخصيصات الفروع (Branch Overrides)</span>
          </button>
        </div>

        {/* Branch Selector if branch_overrides */}
        {activeSubTab === 'branch_overrides' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">اختر الفرع:</span>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-200 text-slate-900 text-xs font-semibold focus:outline-none"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Filters & Search Bar */}
      <div className="p-4 rounded-2xl border bg-white border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث بالرمز أو اسم المفتاح أو رقم الحساب..."
              className="w-full pr-9 pl-3 py-1.5 rounded-xl border bg-slate-50 border-slate-200 text-slate-900 text-xs focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-1.5 rounded-xl border bg-slate-50 border-slate-200 text-slate-900 text-xs focus:outline-none"
            >
              <option value="ALL">كافة الفئات</option>
              <option value="SALES">المبيعات والضرائب</option>
              <option value="INVENTORY">المخزون والتكلفة</option>
              <option value="PAYMENTS">التحصيل ووسائل الدفع</option>
              <option value="AGGREGATORS">تطبيقات التوصيل</option>
              <option value="CASH_OPS">الورديات والنقدية</option>
              <option value="INTER_BRANCH">بين الفروع</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => (activeSubTab === 'company' ? loadCompanyMappings() : loadEffectiveMappings())}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>تحديث</span>
        </button>
      </div>

      {/* Grid of Mappings */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayedList.map((item) => {
          const isOverride = item.source === 'BRANCH_OVERRIDE';
          const isInherited = item.source === 'COMPANY_MAPPING';
          const isNotConfigured = !item.isConfigured || item.source === 'NOT_CONFIGURED';

          return (
            <div
              key={item.mappingKey}
              className={`p-4 rounded-2xl border shadow-sm transition flex flex-col justify-between gap-3 ${
                isOverride
                  ? 'bg-amber-50/40 border-amber-200 text-slate-900'
                  : isNotConfigured
                  ? 'bg-rose-50/40 border-rose-200 text-slate-900'
                  : 'bg-white border-slate-200 text-slate-900'
              }`}
            >
              <div>
                {/* Header: Key & Source Badge */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200 text-[#0D6E4F]">
                    {item.mappingKey}
                  </span>

                  {/* Status Badge */}
                  {isOverride && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1">
                      <Store className="w-3 h-3" />
                      <span>استثناء مخصص للفرع</span>
                    </span>
                  )}
                  {isInherited && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1">
                      <Building2 className="w-3 h-3" />
                      <span>موروث من الشركة</span>
                    </span>
                  )}
                  {isNotConfigured && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      <span>غير مهيأ</span>
                    </span>
                  )}
                </div>

                <h3 className="font-bold text-sm text-slate-900">{item.meta.nameAr}</h3>
                <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{item.meta.description}</p>

                {/* Expected Category & Nature */}
                <div className="mt-2.5 p-2 rounded-xl bg-slate-50 border border-slate-200 text-[10px] flex flex-col gap-1">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>الطبيعة المطلوبة:</span>
                    <span className="font-semibold text-slate-700">{item.meta.expectedTypeLabel}</span>
                  </div>
                </div>

                {/* Current Mapped Account Display */}
                <div className="mt-3 p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 font-semibold">الحساب المحاسبي المرتبط:</span>
                  {item.accountCode ? (
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="font-bold text-xs text-[#0D6E4F] flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#0D6E4F] shrink-0" />
                        <span className="font-mono">{item.accountCode}</span> - <span>{item.accountName}</span>
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-rose-600 italic flex items-center gap-1 mt-0.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>لم يتم تعيين حساب مرتبط بعد</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 mt-2">
                {activeSubTab === 'branch_overrides' && isOverride && item.mappingId && (
                  <button
                    type="button"
                    onClick={() => handleDeleteOverride(item.mappingId!, item.meta.nameAr)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>إلغاء الاستثناء</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    handleOpenEditModal(
                      item.mappingKey,
                      activeSubTab === 'branch_overrides' ? selectedBranchId : null,
                      item.accountId
                    )
                  }
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-sm ${
                    isOverride
                      ? 'bg-amber-600 hover:bg-amber-700 text-white'
                      : isNotConfigured
                      ? 'bg-rose-600 hover:bg-rose-700 text-white'
                      : 'bg-[#0D6E4F] hover:bg-[#0A583F] text-white'
                  }`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>
                    {activeSubTab === 'branch_overrides'
                      ? isOverride
                        ? 'تعديل الاستثناء'
                        : 'تخصيص استثناء للفرع'
                      : item.accountCode
                      ? 'تعديل الحساب'
                      : 'تعيين الحساب'}
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ================================================================== */}
      {/* MODAL: SET / EDIT MAPPING */}
      {/* ================================================================== */}
      {isModalOpen && targetMeta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border bg-white border-slate-200 text-slate-900 p-6 shadow-xl flex flex-col gap-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2 text-[#0D6E4F] font-bold text-base">
                <GitFork className="w-5 h-5" />
                <span>
                  {targetBranchId
                    ? `تخصيص استثناء للفرع: ${targetMeta.nameAr}`
                    : `تعيين ربط الشركة الافتراضي: ${targetMeta.nameAr}`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error banner */}
            {modalError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {/* Key Info Banner */}
            <div className="p-3 rounded-xl border border-blue-200 bg-blue-50 text-xs flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-blue-800">{targetMappingKey}</span>
                <span className="font-semibold text-slate-600">{targetMeta.categoryAr}</span>
              </div>
              <p className="text-slate-700 text-[11px]">{targetMeta.description}</p>
              <div className="pt-1.5 border-t border-blue-200 flex items-center gap-1.5 text-blue-800 font-semibold text-[11px]">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>الطبيعة المحاسبية المطلوبة: {targetMeta.expectedTypeLabel}</span>
              </div>
            </div>

            {/* Account Selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-700">اختر الحساب المحاسبي من دليل الحسابات (إلزامي):</label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border bg-slate-50 border-slate-200 text-slate-900 text-xs focus:outline-none"
              >
                <option value="">-- يرجى اختيار الحساب المطلوب --</option>
                {flatAccounts
                  .filter((a) => a.isPostable)
                  .map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.accountCode} - {acc.nameAr || acc.name} ({acc.accountType} / {acc.normalBalance})
                    </option>
                  ))}
              </select>
            </div>

            {/* Realtime Compatibility Indicator */}
            {selectedAccount && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  validationResult.isValid
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                {validationResult.isValid ? (
                  <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
                )}
                <span>{validationResult.message}</span>
              </div>
            )}

            {/* Notes / Description */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-700">ملاحظات توثيقية إضافية (اختياري):</label>
              <input
                type="text"
                value={mappingDesc}
                onChange={(e) => setMappingDesc(e.target.value)}
                placeholder="سبب التخصيص أو الملاحظات المحاسبية..."
                className="w-full px-3 py-2 rounded-xl border bg-slate-50 border-slate-200 text-slate-900 text-xs focus:outline-none"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 text-xs text-slate-600 hover:text-slate-900"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveMapping}
                disabled={!selectedAccountId || !validationResult.isValid}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-[#0D6E4F] hover:bg-[#0A583F] disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-sm"
              >
                حفظ الربط المحاسبي
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
