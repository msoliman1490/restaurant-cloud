import React, { useState, useEffect, useCallback } from 'react';
import {
  Wallet,
  Landmark,
  CreditCard,
  Monitor,
  Cpu,
  Plus,
  RefreshCw,
  AlertCircle,
  X,
  Pencil,
  Trash2,
  ArrowRightLeft,
  Building2,
  Store,
  ShieldCheck,
  History,
  ClipboardCheck,
  ArrowDownLeft,
  ArrowUpRight,
  Power,
  FileText,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useToast } from '../context/ToastContext';
import { AccountNode } from './AccountingView';

export interface CashVault {
  id: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  balance: string;
  status: 'ACTIVE' | 'INACTIVE' | 'FROZEN';
  createdAt?: string;
}

export interface VaultTransaction {
  id: string;
  vaultId: string;
  transactionType: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'COUNT_VARIANCE';
  amount: string;
  balanceAfter: string;
  sourceDocumentType?: string | null;
  sourceDocumentId?: string | null;
  notes?: string | null;
  createdAt: string;
  performedBy?: string | null;
  performedByName?: string | null;
  performedByEmail?: string | null;
}

export interface BankAccount {
  id: string;
  legalEntityId: string;
  bankName: string;
  accountNumber: string;
  iban?: string | null;
  swiftCode?: string | null;
  currency: string;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  balance: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  authorizedBranches?: Array<{ branchId: string; branchName: string; isActive: boolean }>;
}

export interface PaymentMethodRecord {
  id: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  type: string;
  displayOrder: number;
  isActive: boolean;
  requiresTerminal: boolean;
  requiresReference: boolean;
}

export interface PosDeviceRecord {
  id: string;
  deviceCode: string;
  name?: string | null;
  deviceType: string;
  legalEntityId?: string | null;
  branchId: string;
  branchName?: string | null;
  cashVaultId?: string | null;
  vaultName?: string | null;
  vaultCode?: string | null;
  ipAddress?: string | null;
  status: string;
  lastSeenAt?: string | null;
  createdAt: string;
}

export interface PaymentTerminalRecord {
  id: string;
  terminalCode: string;
  name: string;
  provider: string;
  model?: string | null;
  serialNumber?: string | null;
  ipAddress?: string | null;
  legalEntityId: string;
  branchId: string;
  branchName?: string | null;
  linkedPosDeviceId?: string | null;
  linkedPosDeviceName?: string | null;
  linkedPosDeviceCode?: string | null;
  clearingAccountId?: string | null;
  clearingAccountCode?: string | null;
  status: string;
  createdAt: string;
}

export interface BranchOption {
  id: string;
  name: string;
  code?: string;
}

interface FinancialResourcesViewProps {
  legalEntityId: string;
  theme: 'light' | 'dark';
  flatAccounts: AccountNode[];
}

export const FinancialResourcesView: React.FC<FinancialResourcesViewProps> = ({
  legalEntityId,
  theme,
  flatAccounts,
}) => {
  const toast = useToast();

  // Active Sub-Tab
  const [subTab, setSubTab] = useState<'vaults' | 'banks' | 'payment_methods' | 'pos_devices' | 'terminals'>('vaults');

  // Data States
  const [vaults, setVaults] = useState<CashVault[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRecord[]>([]);
  const [posDevices, setPosDevices] = useState<PosDeviceRecord[]>([]);
  const [terminals, setPaymentTerminals] = useState<PaymentTerminalRecord[]>([]);
  const [branchesList, setBranchesList] = useState<BranchOption[]>([]);
  const [loading, setLoading] = useState(false);

  // Modals Open State
  const [isVaultModalOpen, setIsVaultModalOpen] = useState(false);
  const [isBankModalOpen, setIsBankModalOpen] = useState(false);
  const [isBranchAccessModalOpen, setIsBranchAccessModalOpen] = useState(false);
  const [isPayMethodModalOpen, setIsPayMethodModalOpen] = useState(false);
  const [isPosDeviceModalOpen, setIsPosDeviceModalOpen] = useState(false);
  const [isTerminalModalOpen, setIsTerminalModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [isCountModalOpen, setIsCountModalOpen] = useState(false);
  const [isVoucherModalOpen, setIsVoucherModalOpen] = useState(false);

  // Modal Error States (In-Place)
  const [vaultModalError, setVaultModalError] = useState<string | null>(null);
  const [bankModalError, setBankModalError] = useState<string | null>(null);
  const [branchAccessModalError, setBranchAccessModalError] = useState<string | null>(null);
  const [payMethodModalError, setPayMethodModalError] = useState<string | null>(null);
  const [posDeviceModalError, setPosDeviceModalError] = useState<string | null>(null);
  const [terminalModalError, setTerminalModalError] = useState<string | null>(null);
  const [transferModalError, setTransferModalError] = useState<string | null>(null);
  const [countModalError, setCountModalError] = useState<string | null>(null);
  const [voucherModalError, setVoucherModalError] = useState<string | null>(null);

  // Vault Detail States
  const [selectedVaultForTx, setSelectedVaultForTx] = useState<CashVault | null>(null);
  const [vaultTxList, setVaultTxList] = useState<VaultTransaction[]>([]);
  const [loadingVaultTx, setLoadingVaultTx] = useState(false);

  // Vault Count State
  const [selectedVaultForCount, setSelectedVaultForCount] = useState<CashVault | null>(null);
  const [countForm, setCountForm] = useState({
    actualAmount: '',
    notes: '',
  });

  // Vault Voucher State (Receipt & Payment)
  const [selectedVaultForVoucher, setSelectedVaultForVoucher] = useState<CashVault | null>(null);
  const [voucherMode, setVoucherMode] = useState<'RECEIPT' | 'PAYMENT'>('RECEIPT');
  const [voucherForm, setVoucherForm] = useState({
    voucherNumber: '',
    partyName: '',
    accountId: '',
    amount: '',
    notes: '',
  });

  // Form States
  const [vaultForm, setVaultForm] = useState({
    id: '',
    code: '',
    nameAr: '',
    nameEn: '',
    branchId: '',
    accountId: '',
    custodianId: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'FROZEN',
  });

  const [bankForm, setBankForm] = useState({
    id: '',
    bankName: '',
    accountNumber: '',
    iban: '',
    swiftCode: '',
    currency: 'SAR',
    accountId: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    authorizedBranchIds: [] as string[],
  });

  const [selectedBankForAccess, setSelectedBankForAccess] = useState<BankAccount | null>(null);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);

  const [payMethodForm, setPayMethodForm] = useState({
    id: '',
    code: '',
    nameAr: '',
    nameEn: '',
    type: 'CARD' as 'CASH' | 'CARD' | 'WALLET' | 'BANK_TRANSFER' | 'AGGREGATOR',
    displayOrder: 0,
    isActive: true,
    requiresTerminal: false,
    requiresReference: false,
  });

  const [posDeviceForm, setPosDeviceForm] = useState({
    id: '',
    deviceCode: '',
    name: '',
    branchId: '',
    cashVaultId: '',
    ipAddress: '',
    deviceType: 'POS' as 'POS' | 'KDS' | 'WAITER_PAD' | 'KIOSK',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  });

  const [terminalForm, setTerminalForm] = useState({
    id: '',
    terminalCode: '',
    name: '',
    branchId: '',
    provider: 'GEIDEA' as 'GEIDEA' | 'NEARPAY' | 'HYPERPAY' | 'ALRAJHI' | 'SNB' | 'MANUAL',
    model: '',
    serialNumber: '',
    ipAddress: '',
    linkedPosDeviceId: '',
    clearingAccountId: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE',
  });

  const [transferForm, setTransferForm] = useState({
    fromVaultId: '',
    toVaultId: '',
    amount: '',
    notes: '',
  });

  // Postable Asset Accounts for Vaults & Banks
  const postableAssetAccounts = flatAccounts.filter((a) => a.isPostable && a.accountType === 'ASSET');

  // Load All Resources
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [vRes, bRes, pmRes, posRes, termRes, branchesRes] = await Promise.all([
        apiClient.get<CashVault[]>(`/accounting/vaults?legalEntityId=${legalEntityId}`).catch(() => []),
        apiClient.get<BankAccount[]>(`/accounting/bank-accounts?legalEntityId=${legalEntityId}`).catch(() => []),
        apiClient.get<PaymentMethodRecord[]>('/accounting/payment-methods').catch(() => []),
        apiClient.get<PosDeviceRecord[]>(`/accounting/pos-devices?legalEntityId=${legalEntityId}`).catch(() => []),
        apiClient.get<PaymentTerminalRecord[]>(`/accounting/payment-terminals?legalEntityId=${legalEntityId}`).catch(() => []),
        apiClient.get<BranchOption[]>(`/branches?legalEntityId=${legalEntityId}`).catch(() => []),
      ]);

      setVaults(vRes || []);
      setBanks(bRes || []);
      setPaymentMethods(pmRes || []);
      setPosDevices(posRes || []);
      setPaymentTerminals(termRes || []);
      setBranchesList(branchesRes || []);
    } catch (err) {
      console.warn('Failed to load financial resources:', err);
    } finally {
      setLoading(false);
    }
  }, [legalEntityId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ====================================================================
  // Handlers: Cash Vaults
  // ====================================================================

  const handleOpenVaultModal = (vault?: CashVault) => {
    setVaultModalError(null);
    if (vault) {
      setVaultForm({
        id: vault.id,
        code: vault.code,
        nameAr: vault.nameAr,
        nameEn: vault.nameEn || '',
        branchId: vault.branchId || '',
        accountId: vault.accountId,
        custodianId: '',
        status: vault.status,
      });
    } else {
      setVaultForm({
        id: '',
        code: `VLT-${Math.floor(Math.random() * 900 + 100)}`,
        nameAr: '',
        nameEn: '',
        branchId: branchesList[0]?.id || '',
        accountId: postableAssetAccounts[0]?.id || '',
        custodianId: '',
        status: 'ACTIVE',
      });
    }
    setIsVaultModalOpen(true);
  };

  const handleSaveVault = async () => {
    try {
      setVaultModalError(null);
      if (!vaultForm.code || !vaultForm.nameAr || !vaultForm.accountId) {
        setVaultModalError('يرجى ملء جميع الحقول الإلزامية (الرمز، الاسم، وحساب الأستاذ العام)');
        return;
      }

      if (vaultForm.id) {
        await apiClient.put(`/accounting/vaults/${vaultForm.id}`, {
          nameAr: vaultForm.nameAr.trim(),
          nameEn: vaultForm.nameEn ? vaultForm.nameEn.trim() : null,
          status: vaultForm.status,
        });
        toast.success(`تم تحديث الخزينة ${vaultForm.code} بنجاح`);
      } else {
        await apiClient.post('/accounting/vaults', {
          legalEntityId,
          branchId: vaultForm.branchId || null,
          code: vaultForm.code.trim(),
          nameAr: vaultForm.nameAr.trim(),
          nameEn: vaultForm.nameEn ? vaultForm.nameEn.trim() : null,
          accountId: vaultForm.accountId,
        });
        toast.success(`تم إنشاء الخزينة ${vaultForm.code} بنجاح`);
      }

      setIsVaultModalOpen(false);
      await loadAll();
    } catch (err: any) {
      const msg = err.message || 'فشل حفظ بيانات الخزينة';
      setVaultModalError(msg);
      toast.error(msg);
    }
  };

  const handleDeleteVault = async (vault: CashVault) => {
    if (!window.confirm(`هل أنت متأكد من حذف الخزينة "${vault.code} - ${vault.nameAr}"؟`)) return;
    try {
      await apiClient.delete(`/accounting/vaults/${vault.id}`);
      toast.success('تم حذف الخزينة بنجاح');
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || 'لا يمكن حذف الخزينة');
    }
  };

  const handleToggleVaultStatus = async (vault: CashVault) => {
    const newStatus = vault.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const actionText = newStatus === 'ACTIVE' ? 'تفعيل' : 'تعطيل';
    if (!window.confirm(`هل تريد ${actionText} الخزينة "${vault.code} - ${vault.nameAr}"؟`)) return;
    try {
      await apiClient.put(`/accounting/vaults/${vault.id}`, {
        status: newStatus,
      });
      toast.success(`تم ${actionText} الخزينة بنجاح`);
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || `فشل ${actionText} الخزينة`);
    }
  };

  const handleOpenTransactionsModal = async (vault: CashVault) => {
    setSelectedVaultForTx(vault);
    setIsTxModalOpen(true);
    setLoadingVaultTx(true);
    try {
      const res = await apiClient.get<VaultTransaction[]>(`/accounting/vaults/${vault.id}/transactions`);
      setVaultTxList(res || []);
    } catch (err: any) {
      toast.error(err.message || 'فشل تحميل سجل حركات الخزينة');
      setVaultTxList([]);
    } finally {
      setLoadingVaultTx(false);
    }
  };

  const handleOpenCountModal = (vault: CashVault) => {
    setSelectedVaultForCount(vault);
    setCountModalError(null);
    setCountForm({
      actualAmount: parseFloat(vault.balance || '0').toFixed(2),
      notes: '',
    });
    setIsCountModalOpen(true);
  };

  const handleExecuteCount = async () => {
    if (!selectedVaultForCount) return;
    try {
      setCountModalError(null);
      if (countForm.actualAmount === '' || isNaN(parseFloat(countForm.actualAmount))) {
        setCountModalError('يرجى إدخال الرصيد الفعلي المعدود بشكل صحيح');
        return;
      }
      if (parseFloat(countForm.actualAmount) < 0) {
        setCountModalError('الرصيد الفعلي لا يمكن أن يكون سالباً');
        return;
      }

      await apiClient.post('/accounting/vaults/count', {
        legalEntityId,
        vaultId: selectedVaultForCount.id,
        actualAmount: parseFloat(countForm.actualAmount).toFixed(4),
        varianceAction: 'POST_VARIANCE',
        notes: countForm.notes || 'جرد دوري للخزينة النقدية',
      });

      toast.success('تم اعتماد الجرد الفعلي بنجاح وترحيل قيود الفروقات آلياً');
      setIsCountModalOpen(false);
      await loadAll();
    } catch (err: any) {
      const msg = err.message || 'فشل حفظ وتأكيد الجرد';
      setCountModalError(msg);
      toast.error(msg);
    }
  };

  const handleOpenVoucherModal = (vault: CashVault, mode: 'RECEIPT' | 'PAYMENT') => {
    setSelectedVaultForVoucher(vault);
    setVoucherMode(mode);
    setVoucherModalError(null);
    const prefix = mode === 'RECEIPT' ? 'RV' : 'PV';
    const randNum = Math.floor(Math.random() * 900000 + 100000);
    // Suggest relevant default accounts
    const defaultAcc = mode === 'RECEIPT'
      ? flatAccounts.find((a) => a.isPostable && a.accountType === 'REVENUE')?.id || postableAssetAccounts[0]?.id || ''
      : flatAccounts.find((a) => a.isPostable && a.accountType === 'EXPENSE')?.id || postableAssetAccounts[0]?.id || '';

    setVoucherForm({
      voucherNumber: `${prefix}-${randNum}`,
      partyName: '',
      accountId: defaultAcc,
      amount: '',
      notes: '',
    });
    setIsVoucherModalOpen(true);
  };

  const handleExecuteVoucher = async () => {
    if (!selectedVaultForVoucher) return;
    try {
      setVoucherModalError(null);
      if (!voucherForm.voucherNumber || !voucherForm.partyName || !voucherForm.accountId || !voucherForm.amount) {
        setVoucherModalError('يرجى ملء جميع الحقول الإلزامية (رقم السند، اسم الطرف، الحساب المقابل، والمبلغ)');
        return;
      }
      const amt = parseFloat(voucherForm.amount);
      if (isNaN(amt) || amt <= 0) {
        setVoucherModalError('المبلغ يجب أن يكون رقماً أكبر من صفر');
        return;
      }

      if (voucherMode === 'PAYMENT') {
        const curBal = parseFloat(selectedVaultForVoucher.balance || '0');
        if (amt > curBal) {
          setVoucherModalError(`المبلغ المطلوب صرفه (${amt.toFixed(2)}) يتجاوز رصيد الخزينة المتاح (${curBal.toFixed(2)} SAR). السحب على المكشوف محظور.`);
          return;
        }

        await apiClient.post('/accounting/payment-vouchers', {
          legalEntityId,
          branchId: selectedVaultForVoucher.branchId || null,
          voucherNumber: voucherForm.voucherNumber.trim(),
          beneficiaryName: voucherForm.partyName.trim(),
          sourceType: 'VAULT',
          sourceId: selectedVaultForVoucher.id,
          accountId: voucherForm.accountId,
          amount: amt.toFixed(4),
          notes: voucherForm.notes ? voucherForm.notes.trim() : null,
        });
        toast.success(`تم إصدار سند الصرف #${voucherForm.voucherNumber} بنجاح وترحيل القيد الدفتري`);
      } else {
        await apiClient.post('/accounting/receipt-vouchers', {
          legalEntityId,
          branchId: selectedVaultForVoucher.branchId || null,
          voucherNumber: voucherForm.voucherNumber.trim(),
          payerName: voucherForm.partyName.trim(),
          destinationType: 'VAULT',
          destinationId: selectedVaultForVoucher.id,
          accountId: voucherForm.accountId,
          amount: amt.toFixed(4),
          notes: voucherForm.notes ? voucherForm.notes.trim() : null,
        });
        toast.success(`تم إصدار سند القبض #${voucherForm.voucherNumber} بنجاح وترحيل القيد الدفتري`);
      }

      setIsVoucherModalOpen(false);
      await loadAll();
    } catch (err: any) {
      const msg = err.message || 'فشل حفظ وإصدار السند المالي';
      setVoucherModalError(msg);
      toast.error(msg);
    }
  };

  // ====================================================================
  // Handlers: Bank Accounts & Branch Access
  // ====================================================================

  const handleOpenBankModal = (bank?: BankAccount) => {
    setBankModalError(null);
    if (bank) {
      setBankForm({
        id: bank.id,
        bankName: bank.bankName,
        accountNumber: bank.accountNumber,
        iban: bank.iban || '',
        swiftCode: bank.swiftCode || '',
        currency: bank.currency || 'SAR',
        accountId: bank.accountId,
        status: bank.status,
        authorizedBranchIds: (bank.authorizedBranches || []).map((ab) => ab.branchId),
      });
    } else {
      setBankForm({
        id: '',
        bankName: '',
        accountNumber: '',
        iban: '',
        swiftCode: '',
        currency: 'SAR',
        accountId: postableAssetAccounts[0]?.id || '',
        status: 'ACTIVE',
        authorizedBranchIds: branchesList.map((b) => b.id), // All branches by default
      });
    }
    setIsBankModalOpen(true);
  };

  const handleSaveBank = async () => {
    try {
      setBankModalError(null);
      if (!bankForm.bankName || !bankForm.accountNumber || !bankForm.accountId) {
        setBankModalError('يرجى ملء جميع الحقول الإلزامية (اسم البنك، رقم الحساب، وحساب الأستاذ العام)');
        return;
      }

      if (bankForm.id) {
        await apiClient.put(`/accounting/bank-accounts/${bankForm.id}`, {
          bankName: bankForm.bankName.trim(),
          iban: bankForm.iban ? bankForm.iban.trim() : null,
          swiftCode: bankForm.swiftCode ? bankForm.swiftCode.trim() : null,
          status: bankForm.status,
        });
        toast.success(`تم تحديث الحساب البنكي ${bankForm.bankName} بنجاح`);
      } else {
        await apiClient.post('/accounting/bank-accounts', {
          legalEntityId,
          bankName: bankForm.bankName.trim(),
          accountNumber: bankForm.accountNumber.trim(),
          iban: bankForm.iban ? bankForm.iban.trim() : null,
          swiftCode: bankForm.swiftCode ? bankForm.swiftCode.trim() : null,
          currency: bankForm.currency,
          accountId: bankForm.accountId,
          authorizedBranchIds: bankForm.authorizedBranchIds,
        });
        toast.success(`تم إنشاء الحساب البنكي ${bankForm.bankName} بنجاح`);
      }

      setIsBankModalOpen(false);
      await loadAll();
    } catch (err: any) {
      const msg = err.message || 'فشل حفظ بيانات الحساب البنكي';
      setBankModalError(msg);
      toast.error(msg);
    }
  };

  const handleOpenBranchAccessModal = (bank: BankAccount) => {
    setSelectedBankForAccess(bank);
    setSelectedBranchIds((bank.authorizedBranches || []).map((ab) => ab.branchId));
    setBranchAccessModalError(null);
    setIsBranchAccessModalOpen(true);
  };

  const handleSaveBranchAccess = async () => {
    if (!selectedBankForAccess) return;
    try {
      setBranchAccessModalError(null);
      await apiClient.post('/accounting/bank-accounts/branch-access', {
        legalEntityId,
        bankAccountId: selectedBankForAccess.id,
        branchIds: selectedBranchIds,
      });

      toast.success('تم تحديث صلاحيات الفروع للحساب البنكي بنجاح');
      setIsBranchAccessModalOpen(false);
      await loadAll();
    } catch (err: any) {
      const msg = err.message || 'فشل تحديث صلاحيات الفروع';
      setBranchAccessModalError(msg);
      toast.error(msg);
    }
  };

  // ====================================================================
  // Handlers: Payment Methods
  // ====================================================================

  const handleOpenPayMethodModal = (pm?: PaymentMethodRecord) => {
    setPayMethodModalError(null);
    if (pm) {
      setPayMethodForm({
        id: pm.id,
        code: pm.code,
        nameAr: pm.nameAr,
        nameEn: pm.nameEn || '',
        type: pm.type as any,
        displayOrder: pm.displayOrder,
        isActive: pm.isActive,
        requiresTerminal: pm.requiresTerminal,
        requiresReference: pm.requiresReference,
      });
    } else {
      setPayMethodForm({
        id: '',
        code: '',
        nameAr: '',
        nameEn: '',
        type: 'CARD',
        displayOrder: paymentMethods.length + 1,
        isActive: true,
        requiresTerminal: false,
        requiresReference: false,
      });
    }
    setIsPayMethodModalOpen(true);
  };

  const handleSavePayMethod = async () => {
    try {
      setPayMethodModalError(null);
      if (!payMethodForm.code || !payMethodForm.nameAr) {
        setPayMethodModalError('يرجى إدخال رمز وسيلة الدفع والاسم بالعربية');
        return;
      }

      if (payMethodForm.id) {
        await apiClient.put(`/accounting/payment-methods/${payMethodForm.id}`, {
          nameAr: payMethodForm.nameAr.trim(),
          nameEn: payMethodForm.nameEn ? payMethodForm.nameEn.trim() : null,
          type: payMethodForm.type,
          displayOrder: Number(payMethodForm.displayOrder),
          isActive: payMethodForm.isActive,
          requiresTerminal: payMethodForm.requiresTerminal,
          requiresReference: payMethodForm.requiresReference,
        });
        toast.success(`تم تحديث وسيلة الدفع ${payMethodForm.nameAr} بنجاح`);
      } else {
        await apiClient.post('/accounting/payment-methods', {
          code: payMethodForm.code.trim().toUpperCase(),
          nameAr: payMethodForm.nameAr.trim(),
          nameEn: payMethodForm.nameEn ? payMethodForm.nameEn.trim() : null,
          type: payMethodForm.type,
          displayOrder: Number(payMethodForm.displayOrder),
          isActive: payMethodForm.isActive,
          requiresTerminal: payMethodForm.requiresTerminal,
          requiresReference: payMethodForm.requiresReference,
        });
        toast.success(`تمت إضافة وسيلة الدفع ${payMethodForm.nameAr} بنجاح`);
      }

      setIsPayMethodModalOpen(false);
      await loadAll();
    } catch (err: any) {
      const msg = err.message || 'فشل حفظ وسيلة الدفع';
      setPayMethodModalError(msg);
      toast.error(msg);
    }
  };

  const handleSeedDefaults = async () => {
    try {
      await apiClient.post('/accounting/payment-methods/seed-defaults', {});
      toast.success('تم توليد وسائل الدفع القياسية للسوق السعودي بنجاح');
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || 'فشل توليد وسائل الدفع الافتراضية');
    }
  };

  const handleDeletePayMethod = async (pm: PaymentMethodRecord) => {
    if (!window.confirm(`هل أنت متأكد من حذف طريقة الدفع "${pm.nameAr}"؟`)) return;
    try {
      await apiClient.delete(`/accounting/payment-methods/${pm.id}`);
      toast.success('تم حذف وسيلة الدفع بنجاح');
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || 'فشل حذف وسيلة الدفع');
    }
  };

  // ====================================================================
  // Handlers: POS Devices
  // ====================================================================

  const handleOpenPosDeviceModal = (device?: PosDeviceRecord) => {
    setPosDeviceModalError(null);
    if (device) {
      setPosDeviceForm({
        id: device.id,
        deviceCode: device.deviceCode,
        name: device.name || '',
        branchId: device.branchId,
        cashVaultId: device.cashVaultId || '',
        ipAddress: device.ipAddress || '',
        deviceType: device.deviceType as any,
        status: device.status as any,
      });
    } else {
      setPosDeviceForm({
        id: '',
        deviceCode: `POS-${Math.floor(Math.random() * 900 + 100)}`,
        name: '',
        branchId: branchesList[0]?.id || '',
        cashVaultId: '',
        ipAddress: '',
        deviceType: 'POS',
        status: 'ACTIVE',
      });
    }
    setIsPosDeviceModalOpen(true);
  };

  const handleSavePosDevice = async () => {
    try {
      setPosDeviceModalError(null);
      if (!posDeviceForm.deviceCode || !posDeviceForm.branchId) {
        setPosDeviceModalError('يرجى ملء جميع الحقول الإلزامية (رمز الجهاز والفرع)');
        return;
      }

      if (posDeviceForm.id) {
        await apiClient.put(`/accounting/pos-devices/${posDeviceForm.id}`, {
          name: posDeviceForm.name ? posDeviceForm.name.trim() : null,
          cashVaultId: posDeviceForm.cashVaultId || null,
          ipAddress: posDeviceForm.ipAddress ? posDeviceForm.ipAddress.trim() : null,
          status: posDeviceForm.status,
        });
        toast.success(`تم تحديث جهاز POS ${posDeviceForm.deviceCode} بنجاح`);
      } else {
        await apiClient.post('/accounting/pos-devices', {
          legalEntityId,
          branchId: posDeviceForm.branchId,
          deviceCode: posDeviceForm.deviceCode.trim(),
          name: posDeviceForm.name ? posDeviceForm.name.trim() : null,
          cashVaultId: posDeviceForm.cashVaultId || null,
          ipAddress: posDeviceForm.ipAddress ? posDeviceForm.ipAddress.trim() : null,
          deviceType: posDeviceForm.deviceType,
        });
        toast.success(`تم تسجيل جهاز POS ${posDeviceForm.deviceCode} بنجاح`);
      }

      setIsPosDeviceModalOpen(false);
      await loadAll();
    } catch (err: any) {
      const msg = err.message || 'فشل حفظ بيانات جهاز POS';
      setPosDeviceModalError(msg);
      toast.error(msg);
    }
  };

  const handleDeletePosDevice = async (device: PosDeviceRecord) => {
    if (!window.confirm(`هل أنت متأكد من حذف جهاز POS "${device.deviceCode}"؟`)) return;
    try {
      await apiClient.delete(`/accounting/pos-devices/${device.id}`);
      toast.success('تم حذف جهاز POS بنجاح');
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || 'فشل حذف جهاز POS');
    }
  };

  // ====================================================================
  // Handlers: Payment Terminals (EDC)
  // ====================================================================

  const handleOpenTerminalModal = (term?: PaymentTerminalRecord) => {
    setTerminalModalError(null);
    if (term) {
      setTerminalForm({
        id: term.id,
        terminalCode: term.terminalCode,
        name: term.name,
        branchId: term.branchId,
        provider: term.provider as any,
        model: term.model || '',
        serialNumber: term.serialNumber || '',
        ipAddress: term.ipAddress || '',
        linkedPosDeviceId: term.linkedPosDeviceId || '',
        clearingAccountId: term.clearingAccountId || '',
        status: term.status as any,
      });
    } else {
      setTerminalForm({
        id: '',
        terminalCode: `EDC-${Math.floor(Math.random() * 900 + 100)}`,
        name: '',
        branchId: branchesList[0]?.id || '',
        provider: 'GEIDEA',
        model: '',
        serialNumber: '',
        ipAddress: '',
        linkedPosDeviceId: '',
        clearingAccountId: '',
        status: 'ACTIVE',
      });
    }
    setIsTerminalModalOpen(true);
  };

  const handleSaveTerminal = async () => {
    try {
      setTerminalModalError(null);
      if (!terminalForm.terminalCode || !terminalForm.name || !terminalForm.branchId) {
        setTerminalModalError('يرجى ملء جميع الحقول الإلزامية (رمز الجهاز، الاسم، والفرع)');
        return;
      }

      if (terminalForm.id) {
        await apiClient.put(`/accounting/payment-terminals/${terminalForm.id}`, {
          name: terminalForm.name.trim(),
          provider: terminalForm.provider,
          model: terminalForm.model ? terminalForm.model.trim() : null,
          serialNumber: terminalForm.serialNumber ? terminalForm.serialNumber.trim() : null,
          ipAddress: terminalForm.ipAddress ? terminalForm.ipAddress.trim() : null,
          linkedPosDeviceId: terminalForm.linkedPosDeviceId || null,
          clearingAccountId: terminalForm.clearingAccountId || null,
          status: terminalForm.status,
        });
        toast.success(`تم تحديث جهاز الدفع ${terminalForm.terminalCode} بنجاح`);
      } else {
        await apiClient.post('/accounting/payment-terminals', {
          legalEntityId,
          branchId: terminalForm.branchId,
          terminalCode: terminalForm.terminalCode.trim(),
          name: terminalForm.name.trim(),
          provider: terminalForm.provider,
          model: terminalForm.model ? terminalForm.model.trim() : null,
          serialNumber: terminalForm.serialNumber ? terminalForm.serialNumber.trim() : null,
          ipAddress: terminalForm.ipAddress ? terminalForm.ipAddress.trim() : null,
          linkedPosDeviceId: terminalForm.linkedPosDeviceId || null,
          clearingAccountId: terminalForm.clearingAccountId || null,
        });
        toast.success(`تم تسجيل جهاز الدفع ${terminalForm.terminalCode} بنجاح`);
      }

      setIsTerminalModalOpen(false);
      await loadAll();
    } catch (err: any) {
      const msg = err.message || 'فشل حفظ بيانات جهاز الدفع';
      setTerminalModalError(msg);
      toast.error(msg);
    }
  };

  const handleDeleteTerminal = async (term: PaymentTerminalRecord) => {
    if (!window.confirm(`هل أنت متأكد من حذف جهاز الدفع الإلكتروني "${term.terminalCode} - ${term.name}"؟`)) return;
    try {
      await apiClient.delete(`/accounting/payment-terminals/${term.id}`);
      toast.success('تم حذف جهاز الدفع الإلكتروني بنجاح');
      await loadAll();
    } catch (err: any) {
      toast.error(err.message || 'فشل حذف جهاز الدفع');
    }
  };

  // ====================================================================
  // Handlers: Vault Cash Transfers
  // ====================================================================

  const handleOpenTransferModal = () => {
    setTransferModalError(null);
    setTransferForm({
      fromVaultId: vaults[0]?.id || '',
      toVaultId: vaults[1]?.id || '',
      amount: '',
      notes: '',
    });
    setIsTransferModalOpen(true);
  };

  const handleExecuteTransfer = async () => {
    try {
      setTransferModalError(null);
      if (!transferForm.fromVaultId || !transferForm.toVaultId || !transferForm.amount) {
        setTransferModalError('يرجى اختيار الخزينة المصدر والخزينة الوجهة وإدخال المبلغ');
        return;
      }
      if (transferForm.fromVaultId === transferForm.toVaultId) {
        setTransferModalError('لا يمكن التحويل لنفس الخزينة');
        return;
      }
      if (parseFloat(transferForm.amount) <= 0) {
        setTransferModalError('مبلغ التحويل يجب أن يكون أكبر من صفر');
        return;
      }

      await apiClient.post('/accounting/vaults/transfer', {
        legalEntityId,
        fromVaultId: transferForm.fromVaultId,
        toVaultId: transferForm.toVaultId,
        amount: parseFloat(transferForm.amount).toFixed(4),
        notes: transferForm.notes,
      });

      toast.success('تم التحويل النقدي بنجاح وتوليد القيد المزدوج آلياً');
      setIsTransferModalOpen(false);
      await loadAll();
    } catch (err: any) {
      const msg = err.message || 'فشل تنفيذ التحويل النقدي';
      setTransferModalError(msg);
      toast.error(msg);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Unified Sub-Tabs Navigation */}
      <div className={`flex items-center gap-2 p-1.5 rounded-2xl border ${
        theme === 'dark' ? 'bg-slate-900/60 border-slate-800' : 'bg-slate-100 border-slate-200'
      }`}>
        <button
          type="button"
          onClick={() => setSubTab('vaults')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            subTab === 'vaults'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>الخزائن النقدية ({vaults.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('banks')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            subTab === 'banks'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Landmark className="w-4 h-4" />
          <span>الحسابات البنكية ({banks.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('payment_methods')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            subTab === 'payment_methods'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>طرق الدفع ({paymentMethods.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('pos_devices')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            subTab === 'pos_devices'
              ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Monitor className="w-4 h-4" />
          <span>أجهزة نقاط البيع POS ({posDevices.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('terminals')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition ${
            subTab === 'terminals'
              ? 'bg-teal-600 text-white shadow-md shadow-teal-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>أجهزة الشبكة EDC ({terminals.length})</span>
        </button>

        <div className="mr-auto flex items-center gap-2">
          <button
            type="button"
            onClick={loadAll}
            disabled={loading}
            className={`p-2 rounded-xl border hover:opacity-80 transition ${
              theme === 'dark' ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-600'
            }`}
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ================================================================== */}
      {/* SUB-TAB 1: CASH VAULTS */}
      {/* ================================================================== */}
      {subTab === 'vaults' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base">إدارة الخزائن والصناديق النقدية التشغيلية</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                دعم الخزائن المركزية (على مستوى الشركة) وخزائن الفروع مع حظر التعديل المباشر للأرصدة
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenTransferModal}
                disabled={vaults.length < 2}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white transition disabled:opacity-50"
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>تحويل بين الخزائن</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenVaultModal()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة خزينة جديدة</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {vaults.map((vault) => (
              <div
                key={vault.id}
                className={`p-4 rounded-2xl border flex flex-col justify-between transition hover:shadow-lg ${
                  theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 font-bold">
                      {vault.code}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleVaultStatus(vault)}
                      className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full cursor-pointer hover:opacity-80 transition flex items-center gap-1 ${
                        vault.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-red-500/10 text-red-400 border border-red-500/30'
                      }`}
                      title="انقر لتفعيل أو تعطيل الخزينة"
                    >
                      <Power className="w-2.5 h-2.5" />
                      <span>{vault.status === 'ACTIVE' ? 'نشط' : 'معطل'}</span>
                    </button>
                  </div>

                  <h5 className="font-bold text-base mt-2.5">{vault.nameAr}</h5>
                  {vault.nameEn && <p className="text-xs text-slate-400 font-mono">{vault.nameEn}</p>}

                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                    {vault.branchId ? (
                      <span className="flex items-center gap-1 text-slate-300">
                        <Store className="w-3.5 h-3.5 text-amber-400" />
                        <span>فرع: {vault.branchName || vault.branchId}</span>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-blue-400 font-medium">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>خزينة مركزية للشركة</span>
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500 font-mono mt-1">
                    حساب الدليل: {vault.accountCode} - {vault.accountName}
                  </p>

                  <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-slate-400 block">الرصيد التشغيلي:</span>
                      <span className="font-mono font-bold text-lg text-emerald-400">
                        {parseFloat(vault.balance || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })} SAR
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenVaultModal(vault)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="تعديل بيانات الخزينة"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteVault(vault)}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-900/20 transition"
                        title="حذف الخزينة"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Granular Operational Action Toolbar */}
                <div className="mt-4 pt-3 border-t border-slate-800/60 grid grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleOpenTransactionsModal(vault)}
                    className="flex flex-col items-center justify-center p-2 rounded-xl text-[11px] font-semibold bg-slate-800/70 hover:bg-slate-800 text-slate-300 transition"
                    title="عرض سجل حركات الخزينة الكامل"
                  >
                    <History className="w-3.5 h-3.5 mb-1 text-blue-400" />
                    <span>سجل الحركات</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenCountModal(vault)}
                    disabled={vault.status !== 'ACTIVE'}
                    className="flex flex-col items-center justify-center p-2 rounded-xl text-[11px] font-semibold bg-slate-800/70 hover:bg-slate-800 text-slate-300 transition disabled:opacity-40"
                    title="جرد الخزينة الفعلي وتسوية الفروقات"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5 mb-1 text-purple-400" />
                    <span>جرد فعلي</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenVoucherModal(vault, 'RECEIPT')}
                    disabled={vault.status !== 'ACTIVE'}
                    className="flex flex-col items-center justify-center p-2 rounded-xl text-[11px] font-semibold bg-emerald-950/40 hover:bg-emerald-950/70 text-emerald-300 border border-emerald-800/30 transition disabled:opacity-40"
                    title="إصدار سند قبض وإيداع نقدي"
                  >
                    <ArrowDownLeft className="w-3.5 h-3.5 mb-1 text-emerald-400" />
                    <span>سند قبض</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenVoucherModal(vault, 'PAYMENT')}
                    disabled={vault.status !== 'ACTIVE' || parseFloat(vault.balance || '0') <= 0}
                    className="flex flex-col items-center justify-center p-2 rounded-xl text-[11px] font-semibold bg-amber-950/40 hover:bg-amber-950/70 text-amber-300 border border-amber-800/30 transition disabled:opacity-40"
                    title="إصدار سند صرف نقدي"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5 mb-1 text-amber-400" />
                    <span>سند صرف</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-TAB 2: BANK ACCOUNTS & BRANCH ACCESS */}
      {/* ================================================================== */}
      {subTab === 'banks' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base">إدارة الحسابات البنكية ومشاركة الفروع المصرحة</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                الحساب البنكي ملك للشركة القانونية، ويمكن منح الصلاحية لفروع محددة بنظام Access Control
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleOpenBankModal()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة حساب بنكي جديد</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {banks.map((bank) => (
              <div
                key={bank.id}
                className={`p-4 rounded-2xl border flex flex-col justify-between transition hover:shadow-lg ${
                  theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-400 font-mono px-2 py-0.5 rounded bg-blue-500/10">
                      {bank.currency}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        bank.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      {bank.status === 'ACTIVE' ? 'نشط' : 'معطل'}
                    </span>
                  </div>

                  <h5 className="font-bold text-base mt-2">{bank.bankName}</h5>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">{bank.accountNumber}</p>
                  {bank.iban && <p className="text-[11px] text-slate-500 font-mono mt-0.5">IBAN: {bank.iban}</p>}

                  {/* Authorized Branches Section */}
                  <div className="mt-3 pt-2 border-t border-slate-800/40">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-400">الفروع المصرح لها:</span>
                      <button
                        type="button"
                        onClick={() => handleOpenBranchAccessModal(bank)}
                        className="text-[11px] text-blue-400 hover:underline flex items-center gap-1 font-bold"
                      >
                        <ShieldCheck className="w-3 h-3" />
                        <span>تعديل الصلاحيات</span>
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {bank.authorizedBranches && bank.authorizedBranches.length > 0 ? (
                        bank.authorizedBranches.map((ab) => (
                          <span
                            key={ab.branchId}
                            className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium"
                          >
                            {ab.branchName}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/30 text-emerald-400 font-medium">
                          متاح لجميع فروع الشركة
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-slate-400 block">الرصيد الدفتري:</span>
                    <span className="font-mono font-bold text-lg text-blue-400">
                      {parseFloat(bank.balance || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}{' '}
                      {bank.currency}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenBankModal(bank)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                    title="تعديل بيانات الحساب البنكي"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-TAB 3: PAYMENT METHODS */}
      {/* ================================================================== */}
      {subTab === 'payment_methods' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base">إدارة طرق ووسائل الدفع (Payment Methods)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                تهيئة وسائل الدفع للسوق السعودي (مدى، كاش، فيزا/ماستركارد، أبل باي، STC Pay، وتطبيقات التوصيل)
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSeedDefaults}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-purple-900/30 text-purple-300 border border-purple-700/50 hover:bg-purple-900/50 transition"
              >
                <RefreshCw className="w-4 h-4" />
                <span>توليد وسائل الدفع القياسية</span>
              </button>

              <button
                type="button"
                onClick={() => handleOpenPayMethodModal()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 transition"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة طريقة دفع</span>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border overflow-hidden border-slate-800">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-900/90 text-slate-400 font-bold border-b border-slate-800">
                <tr>
                  <th className="p-3">الترتيب</th>
                  <th className="p-3">الرمز</th>
                  <th className="p-3">الاسم بالعربية</th>
                  <th className="p-3">الاسم بالإنجليزية</th>
                  <th className="p-3">النوع</th>
                  <th className="p-3">يتطلب شبكة؟</th>
                  <th className="p-3">يتطلب مرجع؟</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {paymentMethods.map((pm) => (
                  <tr key={pm.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3 font-mono text-slate-400">{pm.displayOrder}</td>
                    <td className="p-3 font-mono font-bold text-purple-400">{pm.code}</td>
                    <td className="p-3 font-bold">{pm.nameAr}</td>
                    <td className="p-3 text-slate-400">{pm.nameEn || '—'}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 font-bold">
                        {pm.type}
                      </span>
                    </td>
                    <td className="p-3">
                      {pm.requiresTerminal ? (
                        <span className="text-emerald-400 font-medium">نعم (جهاز شبكة)</span>
                      ) : (
                        <span className="text-slate-500">لا</span>
                      )}
                    </td>
                    <td className="p-3">
                      {pm.requiresReference ? (
                        <span className="text-blue-400 font-medium">نعم (رقم حوالة/إيصال)</span>
                      ) : (
                        <span className="text-slate-500">لا</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          pm.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                        }`}
                      >
                        {pm.isActive ? 'نشط' : 'معطل'}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenPayMethodModal(pm)}
                          className="p-1 rounded text-slate-400 hover:text-white"
                          title="تعديل طريقة الدفع"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePayMethod(pm)}
                          className="p-1 rounded text-red-400 hover:text-red-300"
                          title="حذف طريقة الدفع"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-TAB 4: POS DEVICES */}
      {/* ================================================================== */}
      {subTab === 'pos_devices' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base">أجهزة نقاط البيع (POS Devices)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                ربط كل جهاز بفرع محدد وخزينة تشغيلية مع ضمان استقلال الهوية التقنية عن المورد المالي
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleOpenPosDeviceModal()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/30 transition"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة جهاز POS جديد</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {posDevices.map((dev) => (
              <div
                key={dev.id}
                className={`p-4 rounded-2xl border flex flex-col justify-between transition hover:shadow-lg ${
                  theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 font-bold">
                      {dev.deviceCode}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        dev.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      {dev.status === 'ACTIVE' ? 'نشط' : 'معطل'}
                    </span>
                  </div>

                  <h5 className="font-bold text-base mt-2">{dev.name || dev.deviceCode}</h5>

                  <div className="mt-3 flex flex-col gap-1.5 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <Store className="w-3.5 h-3.5 text-slate-400" />
                      <span>الفرع: {dev.branchName || dev.branchId}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                      <span>
                        الخزينة المرتبطة: {dev.vaultName ? `${dev.vaultCode} - ${dev.vaultName}` : 'غير مرتبطة بخزينة'}
                      </span>
                    </div>

                    {dev.ipAddress && (
                      <div className="font-mono text-[11px] text-slate-500">IP: {dev.ipAddress}</div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase font-bold font-mono">
                    النوع: {dev.deviceType}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenPosDeviceModal(dev)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                      title="تعديل جهاز POS"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePosDevice(dev)}
                      className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-900/20 transition"
                      title="حذف جهاز POS"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-TAB 5: PAYMENT TERMINALS (EDC) */}
      {/* ================================================================== */}
      {subTab === 'terminals' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-base">أجهزة الدفع الإلكتروني والشبكة (Payment Terminals - EDC)</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                أجهزة الدفع بالبطاقات (Geidea, NearPay, AlRajhi, etc.) وربطها بأجهزة نقاط البيع وحسابات التسوية
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleOpenTerminalModal()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-600/30 transition"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة جهاز شبكة EDC</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {terminals.map((term) => (
              <div
                key={term.id}
                className={`p-4 rounded-2xl border flex flex-col justify-between transition hover:shadow-lg ${
                  theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs px-2.5 py-1 rounded-lg bg-teal-500/10 text-teal-400 font-bold">
                      {term.terminalCode}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        term.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : term.status === 'MAINTENANCE'
                          ? 'bg-amber-500/10 text-amber-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      {term.status === 'ACTIVE' ? 'نشط' : term.status === 'MAINTENANCE' ? 'صيانة' : 'معطل'}
                    </span>
                  </div>

                  <h5 className="font-bold text-base mt-2">{term.name}</h5>
                  <p className="text-xs text-teal-400 font-semibold mt-0.5">مزود الخدمة: {term.provider}</p>

                  <div className="mt-3 flex flex-col gap-1.5 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <Store className="w-3.5 h-3.5 text-slate-400" />
                      <span>الفرع: {term.branchName || term.branchId}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Monitor className="w-3.5 h-3.5 text-amber-400" />
                      <span>
                        جهاز POS المرتبط:{' '}
                        {term.linkedPosDeviceName
                          ? `${term.linkedPosDeviceCode} - ${term.linkedPosDeviceName}`
                          : 'مستقل (بدون ربط POS)'}
                      </span>
                    </div>

                    {term.serialNumber && (
                      <div className="font-mono text-[11px] text-slate-500">S/N: {term.serialNumber}</div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-mono">
                    {term.model ? `الموديل: ${term.model}` : 'EDC Terminal'}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenTerminalModal(term)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                      title="تعديل جهاز الدفع"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTerminal(term)}
                      className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-900/20 transition"
                      title="حذف جهاز الدفع"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 1: CASH VAULT MODAL */}
      {/* ================================================================== */}
      {isVaultModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`w-full max-w-lg rounded-3xl border p-6 flex flex-col gap-4 shadow-2xl ${
              theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-800">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" />
                <span>{vaultForm.id ? 'تعديل بيانات الخزينة النقدية' : 'إضافة خزينة نقدية جديدة'}</span>
              </h4>
              <button type="button" onClick={() => setIsVaultModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {vaultModalError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{vaultModalError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-slate-400">رمز الخزينة:</label>
                <input
                  type="text"
                  disabled={Boolean(vaultForm.id)}
                  value={vaultForm.code}
                  onChange={(e) => setVaultForm({ ...vaultForm, code: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="مثال: VLT-101"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">نطاق التبعية:</label>
                <select
                  disabled={Boolean(vaultForm.id)}
                  value={vaultForm.branchId}
                  onChange={(e) => setVaultForm({ ...vaultForm, branchId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="">-- خزينة مركزية للشركة (بدون فرع) --</option>
                  {branchesList.map((b) => (
                    <option key={b.id} value={b.id}>
                      فرع: {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">اسم الخزينة بالعربية (إلزامي):</label>
                <input
                  type="text"
                  value={vaultForm.nameAr}
                  onChange={(e) => setVaultForm({ ...vaultForm, nameAr: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="مثال: خزينة كاشير 1"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">الاسم بالإنجليزية (اختياري):</label>
                <input
                  type="text"
                  value={vaultForm.nameEn}
                  onChange={(e) => setVaultForm({ ...vaultForm, nameEn: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="e.g. Cashier 1 Safe"
                />
              </div>

              <div className="col-span-2">
                <label className="block font-semibold mb-1 text-slate-400">حساب الأستاذ العام المرتبط (COA):</label>
                <select
                  disabled={Boolean(vaultForm.id)}
                  value={vaultForm.accountId}
                  onChange={(e) => setVaultForm({ ...vaultForm, accountId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="">-- اختر حساب نقدي فرعي من الدليل --</option>
                  {postableAssetAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.accountCode} - {acc.nameAr || acc.name}
                    </option>
                  ))}
                </select>
              </div>

              {vaultForm.id && (
                <div>
                  <label className="block font-semibold mb-1 text-slate-400">حالة الخزينة:</label>
                  <select
                    value={vaultForm.status}
                    onChange={(e) => setVaultForm({ ...vaultForm, status: e.target.value as any })}
                    className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                      theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <option value="ACTIVE">نشط (ACTIVE)</option>
                    <option value="INACTIVE">معطل (INACTIVE)</option>
                    <option value="FROZEN">مجمد (FROZEN)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsVaultModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveVault}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30"
              >
                حفظ بيانات الخزينة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 2: BANK ACCOUNT MODAL */}
      {/* ================================================================== */}
      {isBankModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`w-full max-w-lg rounded-3xl border p-6 flex flex-col gap-4 shadow-2xl ${
              theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-800">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <Landmark className="w-4 h-4 text-blue-400" />
                <span>{bankForm.id ? 'تعديل بيانات الحساب البنكي' : 'إضافة حساب بنكي جديد'}</span>
              </h4>
              <button type="button" onClick={() => setIsBankModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {bankModalError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{bankModalError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-slate-400">اسم البنك (إلزامي):</label>
                <input
                  type="text"
                  value={bankForm.bankName}
                  onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="مثال: مصرف الراجحي"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">رقم الحساب البنكي:</label>
                <input
                  type="text"
                  disabled={Boolean(bankForm.id)}
                  value={bankForm.accountNumber}
                  onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="SA000000000000000000"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">رقم الآيبان (IBAN):</label>
                <input
                  type="text"
                  value={bankForm.iban}
                  onChange={(e) => setBankForm({ ...bankForm, iban: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="SA..."
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">رمز السويفت (SWIFT):</label>
                <input
                  type="text"
                  value={bankForm.swiftCode}
                  onChange={(e) => setBankForm({ ...bankForm, swiftCode: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="RJHI..."
                />
              </div>

              <div className="col-span-2">
                <label className="block font-semibold mb-1 text-slate-400">حساب الأستاذ العام المرتبط (COA):</label>
                <select
                  disabled={Boolean(bankForm.id)}
                  value={bankForm.accountId}
                  onChange={(e) => setBankForm({ ...bankForm, accountId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="">-- اختر حساب بنكي فرعي من الدليل --</option>
                  {postableAssetAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.accountCode} - {acc.nameAr || acc.name}
                    </option>
                  ))}
                </select>
              </div>

              {!bankForm.id && (
                <div className="col-span-2">
                  <label className="block font-semibold mb-1 text-slate-400">الفروع المصرح لها بالاستخدام:</label>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 rounded-xl border border-slate-800 bg-slate-950/40">
                    {branchesList.map((b) => (
                      <label key={b.id} className="flex items-center gap-1.5 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={bankForm.authorizedBranchIds.includes(b.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setBankForm({ ...bankForm, authorizedBranchIds: [...bankForm.authorizedBranchIds, b.id] });
                            } else {
                              setBankForm({
                                ...bankForm,
                                authorizedBranchIds: bankForm.authorizedBranchIds.filter((id) => id !== b.id),
                              });
                            }
                          }}
                          className="accent-blue-500 rounded"
                        />
                        <span>{b.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsBankModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveBank}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30"
              >
                حفظ بيانات الحساب البنكي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 3: BRANCH ACCESS CONTROL FOR BANK ACCOUNT */}
      {/* ================================================================== */}
      {isBranchAccessModalOpen && selectedBankForAccess && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-3xl border p-6 flex flex-col gap-4 shadow-2xl ${
              theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-800">
              <div>
                <h4 className="font-bold text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-400" />
                  <span>صلاحيات فروع الحساب البنكي</span>
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">{selectedBankForAccess.bankName} - {selectedBankForAccess.accountNumber}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsBranchAccessModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {branchAccessModalError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{branchAccessModalError}</span>
              </div>
            )}

            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
              {branchesList.map((b) => {
                const isChecked = selectedBranchIds.includes(b.id);
                return (
                  <label
                    key={b.id}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ${
                      isChecked
                        ? 'border-blue-500/50 bg-blue-500/10 text-white'
                        : 'border-slate-800 bg-slate-950/40 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Store className="w-4 h-4" />
                      <span className="font-medium text-xs">{b.name}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedBranchIds([...selectedBranchIds, b.id]);
                        } else {
                          setSelectedBranchIds(selectedBranchIds.filter((id) => id !== b.id));
                        }
                      }}
                      className="accent-blue-500 w-4 h-4 rounded"
                    />
                  </label>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setSelectedBranchIds(branchesList.map((b) => b.id))}
                className="text-blue-400 hover:underline font-bold"
              >
                تحديد جميع الفروع
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsBranchAccessModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-white"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleSaveBranchAccess}
                  className="px-4 py-1.5 rounded-lg font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30"
                >
                  تأكيد وحفظ الصلاحيات
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 4: PAYMENT METHOD MODAL */}
      {/* ================================================================== */}
      {isPayMethodModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-3xl border p-6 flex flex-col gap-4 shadow-2xl ${
              theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-800">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-purple-400" />
                <span>{payMethodForm.id ? 'تعديل طريقة الدفع' : 'إضافة طريقة دفع جديدة'}</span>
              </h4>
              <button type="button" onClick={() => setIsPayMethodModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {payMethodModalError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{payMethodModalError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-slate-400">الرمز البرمجي (Code):</label>
                <input
                  type="text"
                  disabled={Boolean(payMethodForm.id)}
                  value={payMethodForm.code}
                  onChange={(e) => setPayMethodForm({ ...payMethodForm, code: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono uppercase focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="MADA, VISA..."
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">النوع (Type):</label>
                <select
                  value={payMethodForm.type}
                  onChange={(e) => setPayMethodForm({ ...payMethodForm, type: e.target.value as any })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="CARD">بطاقة بنكية (CARD)</option>
                  <option value="CASH">نقدي (CASH)</option>
                  <option value="WALLET">محفظة إلكترونية (WALLET)</option>
                  <option value="BANK_TRANSFER">تحويل بنكي (BANK_TRANSFER)</option>
                  <option value="AGGREGATOR">تطبيقات توصيل (AGGREGATOR)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">الاسم بالعربية:</label>
                <input
                  type="text"
                  value={payMethodForm.nameAr}
                  onChange={(e) => setPayMethodForm({ ...payMethodForm, nameAr: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="مدى..."
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">الاسم بالإنجليزية:</label>
                <input
                  type="text"
                  value={payMethodForm.nameEn}
                  onChange={(e) => setPayMethodForm({ ...payMethodForm, nameEn: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="Mada Debit..."
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">ترتيب العرض:</label>
                <input
                  type="number"
                  value={payMethodForm.displayOrder}
                  onChange={(e) => setPayMethodForm({ ...payMethodForm, displayOrder: Number(e.target.value) })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                />
              </div>

              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={payMethodForm.requiresTerminal}
                    onChange={(e) => setPayMethodForm({ ...payMethodForm, requiresTerminal: e.target.checked })}
                    className="accent-purple-500 rounded"
                  />
                  <span>يتطلب جهاز شبكة (EDC)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={payMethodForm.requiresReference}
                    onChange={(e) => setPayMethodForm({ ...payMethodForm, requiresReference: e.target.checked })}
                    className="accent-purple-500 rounded"
                  />
                  <span>يتطلب رقم مرجع العملية</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsPayMethodModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSavePayMethod}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30"
              >
                حفظ وسيلة الدفع
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 5: POS DEVICE MODAL */}
      {/* ================================================================== */}
      {isPosDeviceModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`w-full max-w-lg rounded-3xl border p-6 flex flex-col gap-4 shadow-2xl ${
              theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-800">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <Monitor className="w-4 h-4 text-amber-400" />
                <span>{posDeviceForm.id ? 'تعديل جهاز نقطة البيع POS' : 'إضافة جهاز POS جديد'}</span>
              </h4>
              <button type="button" onClick={() => setIsPosDeviceModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {posDeviceModalError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{posDeviceModalError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-slate-400">رمز الجهاز (Device Code):</label>
                <input
                  type="text"
                  disabled={Boolean(posDeviceForm.id)}
                  value={posDeviceForm.deviceCode}
                  onChange={(e) => setPosDeviceForm({ ...posDeviceForm, deviceCode: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="POS-01"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">الفرع التشغيلي:</label>
                <select
                  disabled={Boolean(posDeviceForm.id)}
                  value={posDeviceForm.branchId}
                  onChange={(e) => setPosDeviceForm({ ...posDeviceForm, branchId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  {branchesList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">اسم أو وصف الجهاز:</label>
                <input
                  type="text"
                  value={posDeviceForm.name}
                  onChange={(e) => setPosDeviceForm({ ...posDeviceForm, name: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="كاشير الصالة 1"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">الخزينة النقدية المرتبطة (درج الكاش):</label>
                <select
                  value={posDeviceForm.cashVaultId}
                  onChange={(e) => setPosDeviceForm({ ...posDeviceForm, cashVaultId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="">-- بدون خزينة مرتبطة --</option>
                  {vaults
                    .filter((v) => !v.branchId || v.branchId === posDeviceForm.branchId)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.code} - {v.nameAr}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">نوع الجهاز:</label>
                <select
                  value={posDeviceForm.deviceType}
                  onChange={(e) => setPosDeviceForm({ ...posDeviceForm, deviceType: e.target.value as any })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="POS">نقطة بيع رئيسية (POS)</option>
                  <option value="KDS">شاشة مطبخ (KDS)</option>
                  <option value="WAITER_PAD">جهاز ويتر (WAITER_PAD)</option>
                  <option value="KIOSK">جهاز خدمة ذاتية (KIOSK)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">عنوان IP المحلي (اختياري):</label>
                <input
                  type="text"
                  value={posDeviceForm.ipAddress}
                  onChange={(e) => setPosDeviceForm({ ...posDeviceForm, ipAddress: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="192.168.1.100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsPosDeviceModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSavePosDevice}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/30"
              >
                حفظ جهاز POS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 6: PAYMENT TERMINAL MODAL (EDC) */}
      {/* ================================================================== */}
      {isTerminalModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`w-full max-w-lg rounded-3xl border p-6 flex flex-col gap-4 shadow-2xl ${
              theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-800">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <Cpu className="w-4 h-4 text-teal-400" />
                <span>{terminalForm.id ? 'تعديل جهاز الدفع الإلكتروني EDC' : 'إضافة جهاز دفع إلكتروني جديد'}</span>
              </h4>
              <button type="button" onClick={() => setIsTerminalModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {terminalModalError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{terminalModalError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-slate-400">رمز الجهاز (Terminal Code):</label>
                <input
                  type="text"
                  disabled={Boolean(terminalForm.id)}
                  value={terminalForm.terminalCode}
                  onChange={(e) => setTerminalForm({ ...terminalForm, terminalCode: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="EDC-01"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">الفرع التابع له:</label>
                <select
                  disabled={Boolean(terminalForm.id)}
                  value={terminalForm.branchId}
                  onChange={(e) => setTerminalForm({ ...terminalForm, branchId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  {branchesList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">اسم الجهاز (الوصف):</label>
                <input
                  type="text"
                  value={terminalForm.name}
                  onChange={(e) => setTerminalForm({ ...terminalForm, name: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="جهاز شبكة الكاشير 1"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">مزود خدمة الدفع:</label>
                <select
                  value={terminalForm.provider}
                  onChange={(e) => setTerminalForm({ ...terminalForm, provider: e.target.value as any })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="GEIDEA">جيديا (GEIDEA)</option>
                  <option value="NEARPAY">نيرباي (NEARPAY SoftPOS)</option>
                  <option value="HYPERPAY">هايبرباي (HYPERPAY)</option>
                  <option value="ALRAJHI">مصرف الراجحي POS</option>
                  <option value="SNB">البنك الأهلي SNB</option>
                  <option value="MANUAL">يدوي / بنوك أخرى (MANUAL)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">ربط بجهاز POS (اختياري):</label>
                <select
                  value={terminalForm.linkedPosDeviceId}
                  onChange={(e) => setTerminalForm({ ...terminalForm, linkedPosDeviceId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="">-- جهاز مستقل (بدون ربط POS) --</option>
                  {posDevices
                    .filter((d) => d.branchId === terminalForm.branchId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.deviceCode} - {d.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">الرقم التسلسلي (S/N):</label>
                <input
                  type="text"
                  value={terminalForm.serialNumber}
                  onChange={(e) => setTerminalForm({ ...terminalForm, serialNumber: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="SN12345678"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">الموديل (Model):</label>
                <input
                  type="text"
                  value={terminalForm.model}
                  onChange={(e) => setTerminalForm({ ...terminalForm, model: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="PAX A920, Verifone..."
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">الحالة التشغيلية:</label>
                <select
                  value={terminalForm.status}
                  onChange={(e) => setTerminalForm({ ...terminalForm, status: e.target.value as any })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="ACTIVE">جاهز للعمل (ACTIVE)</option>
                  <option value="MAINTENANCE">تحت الصيانة (MAINTENANCE)</option>
                  <option value="INACTIVE">معطل (INACTIVE)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsTerminalModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveTerminal}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-600/30"
              >
                حفظ جهاز الدفع EDC
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 7: VAULT TRANSFER MODAL */}
      {/* ================================================================== */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-3xl border p-6 flex flex-col gap-4 shadow-2xl ${
              theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between border-b pb-3 border-slate-800">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-blue-400" />
                <span>تحويل نقدي بين الخزائن</span>
              </h4>
              <button type="button" onClick={() => setIsTransferModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {transferModalError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{transferModalError}</span>
              </div>
            )}

            <div className="flex flex-col gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-slate-400">الخزينة المصدر (من):</label>
                <select
                  value={transferForm.fromVaultId}
                  onChange={(e) => setTransferForm({ ...transferForm, fromVaultId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="">-- اختر خزينة المصدر --</option>
                  {vaults.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code} - {v.nameAr} (الرصيد: {parseFloat(v.balance).toFixed(2)} SAR)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">الخزينة الوجهة (إلى):</label>
                <select
                  value={transferForm.toVaultId}
                  onChange={(e) => setTransferForm({ ...transferForm, toVaultId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="">-- اختر خزينة الوجهة --</option>
                  {vaults
                    .filter((v) => v.id !== transferForm.fromVaultId)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.code} - {v.nameAr}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">المبلغ المراد تحويله (SAR):</label>
                <input
                  type="number"
                  step="0.01"
                  value={transferForm.amount}
                  onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border font-mono font-bold text-sm focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800 text-emerald-400' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-400">ملاحظات التحويل:</label>
                <input
                  type="text"
                  value={transferForm.notes}
                  onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="مثال: إيداع نهاية الوردية..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleExecuteTransfer}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30"
              >
                تأكيد التحويل وإنشاء القيد
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 8: VAULT TRANSACTIONS LEDGER (سجل حركات الخزينة) */}
      {/* ================================================================== */}
      {isTxModalOpen && selectedVaultForTx && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden ${
              theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            {/* Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-blue-400" />
                  <h3 className="font-bold text-base">سجل الحركات النقدية الكامل للخزينة</h3>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  خزينة: <span className="font-semibold text-white">{selectedVaultForTx.nameAr}</span> ({selectedVaultForTx.code}) | الرصيد الحالي:{' '}
                  <span className="font-mono font-bold text-emerald-400">
                    {parseFloat(selectedVaultForTx.balance || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })} SAR
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTxModalOpen(false)}
                className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Table */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingVaultTx ? (
                <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>جاري تحميل سجل الحركات النقدية...</span>
                </div>
              ) : vaultTxList.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">لا توجد حركات مالية مسجلة لهذه الخزينة حتى الآن</p>
                </div>
              ) : (
                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-800/60 text-slate-400 font-semibold border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">التاريخ والوقت</th>
                        <th className="py-2.5 px-3">نوع الحركة</th>
                        <th className="py-2.5 px-3">المبلغ</th>
                        <th className="py-2.5 px-3">الرصيد بعد الحركة</th>
                        <th className="py-2.5 px-3">البيان / المرجع</th>
                        <th className="py-2.5 px-3">المستخدم المنفذ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {vaultTxList.map((tx) => {
                        const isCredit = tx.transactionType === 'WITHDRAWAL' || tx.transactionType === 'TRANSFER_OUT';
                        return (
                          <tr key={tx.id} className="hover:bg-slate-800/30 transition">
                            <td className="py-2.5 px-3 font-mono text-slate-300">
                              {new Date(tx.createdAt).toLocaleString('ar-SA')}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  tx.transactionType === 'DEPOSIT'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : tx.transactionType === 'WITHDRAWAL'
                                    ? 'bg-amber-500/10 text-amber-400'
                                    : tx.transactionType === 'TRANSFER_IN'
                                    ? 'bg-blue-500/10 text-blue-400'
                                    : tx.transactionType === 'TRANSFER_OUT'
                                    ? 'bg-purple-500/10 text-purple-400'
                                    : 'bg-indigo-500/10 text-indigo-400'
                                }`}
                              >
                                {tx.transactionType === 'DEPOSIT' && 'إيداع نقدي'}
                                {tx.transactionType === 'WITHDRAWAL' && 'صرف نقدي'}
                                {tx.transactionType === 'TRANSFER_IN' && 'تحويل وارد'}
                                {tx.transactionType === 'TRANSFER_OUT' && 'تحويل صادر'}
                                {tx.transactionType === 'COUNT_VARIANCE' && 'تسوية جرد'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold">
                              <span className={isCredit ? 'text-amber-400' : 'text-emerald-400'}>
                                {isCredit ? '-' : '+'}
                                {parseFloat(tx.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} SAR
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-200">
                              {parseFloat(tx.balanceAfter).toLocaleString('en-US', { minimumFractionDigits: 2 })} SAR
                            </td>
                            <td className="py-2.5 px-3 text-slate-300">
                              <span>{tx.notes || '-'}</span>
                              {tx.sourceDocumentType && (
                                <span className="block text-[10px] text-slate-500 font-mono">
                                  {tx.sourceDocumentType}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-slate-400">
                              {tx.performedByName || tx.performedByEmail || 'النظام'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-slate-800 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setIsTxModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white"
              >
                إغلاق النافذة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 9: VAULT PHYSICAL COUNT (جرد الخزينة الفعلي وتسوية الفروقات) */}
      {/* ================================================================== */}
      {isCountModalOpen && selectedVaultForCount && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`w-full max-w-lg rounded-2xl border p-5 shadow-2xl ${
              theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-base">جرد الخزينة الفعلي وتسوية الفروقات</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCountModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {countModalError && (
              <div className="mt-3 p-3 rounded-xl bg-red-950/50 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{countModalError}</span>
              </div>
            )}

            <div className="flex flex-col gap-4 mt-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-slate-400 block">الخزينة المجرودة:</span>
                  <span className="font-bold text-sm text-white">
                    {selectedVaultForCount.nameAr} ({selectedVaultForCount.code})
                  </span>
                </div>
                <div className="text-left">
                  <span className="text-slate-400 block">الرصيد الدفتري المسجل:</span>
                  <span className="font-mono font-bold text-base text-emerald-400">
                    {parseFloat(selectedVaultForCount.balance || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })} SAR
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-300">
                  الرصيد الفعلي المعدود (SAR): <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={countForm.actualAmount}
                  onChange={(e) => setCountForm({ ...countForm, actualAmount: e.target.value })}
                  className={`w-full px-3 py-2 text-base font-mono font-bold rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="0.00"
                />
              </div>

              {/* Dynamic Variance Preview */}
              {countForm.actualAmount !== '' && !isNaN(parseFloat(countForm.actualAmount)) && (
                (() => {
                  const book = parseFloat(selectedVaultForCount.balance || '0');
                  const actual = parseFloat(countForm.actualAmount);
                  const diff = actual - book;
                  const isMatch = Math.abs(diff) < 0.0001;
                  const isSurplus = diff > 0.0001;

                  return (
                    <div
                      className={`p-3 rounded-xl border flex items-center justify-between ${
                        isMatch
                          ? 'bg-slate-800/40 border-slate-700 text-slate-300'
                          : isSurplus
                          ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-300'
                          : 'bg-amber-950/40 border-amber-800/50 text-amber-300'
                      }`}
                    >
                      <div>
                        <span className="block font-bold">
                          {isMatch ? 'الرصيد مطابق تماماً' : isSurplus ? 'فائض جرد نقدي' : 'عجز جرد نقدي'}
                        </span>
                        <span className="text-[11px] opacity-80">
                          {isMatch
                            ? 'لا توجد فروقات دائنة أو مدينة'
                            : isSurplus
                            ? 'سيتم ترحيل قيد إثبات الفائض لحساب الإيرادات المتنوعة آلياً'
                            : 'سيتم ترحيل قيد إثبات العجز لحساب المصروفات العامة آلياً'}
                        </span>
                      </div>
                      <div className="font-mono font-bold text-base text-left">
                        {isMatch ? '0.00 SAR' : `${diff > 0 ? '+' : ''}${diff.toFixed(2)} SAR`}
                      </div>
                    </div>
                  );
                })()
              )}

              <div>
                <label className="block font-semibold mb-1 text-slate-300">ملاحظات / أسباب الفروقات:</label>
                <input
                  type="text"
                  value={countForm.notes}
                  onChange={(e) => setCountForm({ ...countForm, notes: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                  placeholder="مثال: جرد مفاجئ في نهاية نوبة العمل..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsCountModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleExecuteCount}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30"
              >
                اعتماد الجرد والترحيل المحاسبي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL 10: VAULT VOUCHERS (سندات القبض والصرف المرتبطة بالخزينة) */}
      {/* ================================================================== */}
      {isVoucherModalOpen && selectedVaultForVoucher && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className={`w-full max-w-lg rounded-2xl border p-5 shadow-2xl ${
              theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                {voucherMode === 'RECEIPT' ? (
                  <ArrowDownLeft className="w-5 h-5 text-emerald-400" />
                ) : (
                  <ArrowUpRight className="w-5 h-5 text-amber-400" />
                )}
                <h3 className="font-bold text-base">
                  {voucherMode === 'RECEIPT' ? 'إصدار سند قبض وإيداع نقدي بالخزينة' : 'إصدار سند صرف نقدي من الخزينة'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsVoucherModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {voucherModalError && (
              <div className="mt-3 p-3 rounded-xl bg-red-950/50 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{voucherModalError}</span>
              </div>
            )}

            <div className="flex flex-col gap-4 mt-4 text-xs">
              <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-slate-400 block">الخزينة المحددة:</span>
                  <span className="font-bold text-sm text-white">
                    {selectedVaultForVoucher.nameAr} ({selectedVaultForVoucher.code})
                  </span>
                </div>
                <div className="text-left">
                  <span className="text-slate-400 block">الرصيد المتاح:</span>
                  <span className="font-mono font-bold text-base text-emerald-400">
                    {parseFloat(selectedVaultForVoucher.balance || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })} SAR
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1 text-slate-300">
                    رقم السند: <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={voucherForm.voucherNumber}
                    onChange={(e) => setVoucherForm({ ...voucherForm, voucherNumber: e.target.value })}
                    className={`w-full px-3 py-2 rounded-xl border focus:outline-none font-mono ${
                      theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1 text-slate-300">
                    {voucherMode === 'RECEIPT' ? 'اسم الدافع / العميل:' : 'اسم المستفيد / المورد:'}{' '}
                    <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={voucherForm.partyName}
                    onChange={(e) => setVoucherForm({ ...voucherForm, partyName: e.target.value })}
                    placeholder={voucherMode === 'RECEIPT' ? 'اسم العميل أو جهة الدفع' : 'اسم المستفيد أو المورد'}
                    className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                      theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-300">
                  {voucherMode === 'RECEIPT' ? 'الحساب الدائن (إيراد / طرف):' : 'الحساب المدين (مصروف / طرف):'}{' '}
                  <span className="text-red-400">*</span>
                </label>
                <select
                  value={voucherForm.accountId}
                  onChange={(e) => setVoucherForm({ ...voucherForm, accountId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="">-- اختر الحساب المقابل من الدليل المحاسبي --</option>
                  {flatAccounts
                    .filter((a) => a.isPostable)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountCode} - {a.nameAr} ({a.accountType})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-300">
                  المبلغ (SAR): <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={voucherForm.amount}
                  onChange={(e) => setVoucherForm({ ...voucherForm, amount: e.target.value })}
                  placeholder="0.00"
                  className={`w-full px-3 py-2 text-base font-mono font-bold rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-300">بيان وملاحظات السند:</label>
                <input
                  type="text"
                  value={voucherForm.notes}
                  onChange={(e) => setVoucherForm({ ...voucherForm, notes: e.target.value })}
                  placeholder="بيان تفصيلي للحركة النقدية..."
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
                  }`}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsVoucherModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleExecuteVoucher}
                className={`px-5 py-2 rounded-xl text-xs font-bold text-white shadow-lg ${
                  voucherMode === 'RECEIPT'
                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
                    : 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30'
                }`}
              >
                {voucherMode === 'RECEIPT' ? 'حفظ وترحيل سند القبض' : 'حفظ وترحيل سند الصرف'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
