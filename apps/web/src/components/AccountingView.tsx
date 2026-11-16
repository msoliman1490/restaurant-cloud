import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BookOpen,
  Scale,
  Plus,
  CheckCircle2,
  FileSpreadsheet,
  Wallet,
  Receipt,
  RefreshCw,
  FolderTree,
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
  Trash2,
  Copy,
  AlertCircle,
  Undo2,
  X,
  Layers,
  ArrowRightLeft,
  Pencil,
  GitFork,
  Calculator,
  CreditCard,
  Download,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { apiClient } from '../api/client';
import { exportToCsv } from '../utils/export';
import { FinancialResourcesView } from './FinancialResourcesView';
import { AccountMappingView } from './AccountMappingView';
import { PosShiftClosingView } from './PosShiftClosingView';
import { SettlementsView } from './SettlementsView';

// ====================================================================
// Type Definitions
// ====================================================================

export interface AccountNode {
  id: string;
  accountCode: string;
  name: string;
  nameAr: string;
  nameEn?: string | null;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COGS' | 'EXPENSE' | 'OTHER_INCOME' | 'OTHER_EXPENSE';
  normalBalance: 'DEBIT' | 'CREDIT';
  totalDebit?: string | number;
  totalCredit?: string | number;
  netBalance?: string | number;
  parentId?: string | null;
  isPostable: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  children?: AccountNode[];
}

export interface JournalLineItem {
  id?: string;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  branchId?: string | null;
  costCenterId?: string | null;
  partnerId?: string | null;
  partnerName?: string | null;
  partnerRole?: string | null;
  debit: string;
  credit: string;
  currency?: string;
  description?: string;
}

export interface JournalEntryHeader {
  id: string;
  journalNumber: string;
  entryDate: string;
  documentDate?: string;
  journalType: string;
  sourceType: string;
  sourceId?: string;
  description?: string;
  notes?: string;
  status: 'DRAFT' | 'POSTED' | 'REVERSED';
  debitTotal: string;
  creditTotal: string;
  postedAt?: string;
  postedBy?: string;
  lines: JournalLineItem[];
}

export interface CashVault {
  id: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  branchId?: string;
  branchName?: string;
  balance: string;
  accountId: string;
  status: string;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  iban?: string | null;
  currency: string;
  balance: string;
  accountId: string;
  status: string;
}

export interface VoucherRecord {
  id: string;
  voucherNumber: string;
  voucherDate: string;
  voucherType: string;
  payerName?: string;
  beneficiaryName?: string;
  paymentMethod: string;
  amount: string;
  unallocatedAmount?: string;
  destinationType?: string;
  sourceType?: string;
  status: string;
  notes?: string;
}

export interface BusinessPartnerItem {
  id: string;
  partnerNumber: string;
  legalNameAr: string;
  tradeNameAr?: string | null;
  partnerType: string;
  roles?: string[];
}

// ====================================================================
// Component: AccountingView
// ====================================================================

export const AccountingView: React.FC = () => {
  const { activeLegalEntity, activeBranch } = useAuth();
  const { dir } = useLocale();
  const legalEntityId = activeLegalEntity?.id || '00000000-0000-0000-0000-000000000001';

  // Navigation & Theme
  const [activeTab, setActiveTab] = useState<'coa' | 'journals' | 'vouchers' | 'vaults_banks' | 'shifts' | 'settlements' | 'mappings' | 'reports'>('journals');
  const [theme] = useState<'light' | 'dark'>('light');
  const toast = useToast();

  // Core Data States
  const [coaTree, setCoaTree] = useState<AccountNode[]>([]);
  const [flatAccounts, setFlatAccounts] = useState<AccountNode[]>([]);
  const [journals, setJournals] = useState<JournalEntryHeader[]>([]);
  const [vaults, setVaults] = useState<CashVault[]>([]);
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [receiptVouchers, setReceiptVouchers] = useState<VoucherRecord[]>([]);
  const [paymentVouchers, setPaymentVouchers] = useState<VoucherRecord[]>([]);
  const [partners, setPartners] = useState<BusinessPartnerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal In-Place Error States
  const [accountModalError, setAccountModalError] = useState<string | null>(null);
  const [journalModalError, setJournalModalError] = useState<string | null>(null);
  const [transferModalError, setTransferModalError] = useState<string | null>(null);
  const [reversalModalError, setReversalModalError] = useState<string | null>(null);

  // Search & Filters
  const [coaSearch, setCoaSearch] = useState('');
  const [coaTypeFilter, setCoaTypeFilter] = useState<string>('ALL');
  const [coaExpandedNodes, setCoaExpandedNodes] = useState<Set<string>>(new Set());

  const [journalSearch, setJournalSearch] = useState('');
  const [journalStatusFilter, setJournalStatusFilter] = useState<string>('ALL');

  const [voucherTypeTab, setVoucherTypeTab] = useState<'RECEIPT' | 'PAYMENT'>('RECEIPT');
  const [voucherSearch, setVoucherSearch] = useState('');

  // Modals & Drawers
  const [isJournalDrawerOpen, setIsJournalDrawerOpen] = useState(false);
  const [editingJournalId, setEditingJournalId] = useState<string | null>(null);

  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountNode | null>(null);
  const [isContra, setIsContra] = useState(false);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isReversalModalOpen, setIsReversalModalOpen] = useState(false);
  const [reversalTargetEntry, setReversalTargetEntry] = useState<JournalEntryHeader | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  useEffect(() => {
    if (!isJournalDrawerOpen && !isAccountModalOpen && !isTransferModalOpen && !isReversalModalOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsJournalDrawerOpen(false);
        setIsAccountModalOpen(false);
        setIsTransferModalOpen(false);
        setIsReversalModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isJournalDrawerOpen, isAccountModalOpen, isTransferModalOpen, isReversalModalOpen]);

  // Multi-Line Journal Editor Form State
  const [journalForm, setJournalForm] = useState<{
    journalNumber: string;
    entryDate: string;
    dueDate: string;
    journalType: string;
    sourceType: string;
    description: string;
    notes: string;
    status: 'DRAFT' | 'POSTED';
    lines: Array<{
      id: string;
      accountId: string;
      accountCode: string;
      accountName: string;
      isPostable: boolean;
      description: string;
      partnerId: string;
      partnerRole: string;
      costCenterId: string;
      debit: string;
      credit: string;
    }>;
  }>({
    journalNumber: `JV-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`,
    entryDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    journalType: 'GENERAL',
    sourceType: 'MANUAL',
    description: '',
    notes: '',
    status: 'POSTED',
    lines: [
      { id: '1', accountId: '', accountCode: '', accountName: '', isPostable: true, description: '', partnerId: '', partnerRole: '', costCenterId: '', debit: '', credit: '' },
      { id: '2', accountId: '', accountCode: '', accountName: '', isPostable: true, description: '', partnerId: '', partnerRole: '', costCenterId: '', debit: '', credit: '' },
    ],
  });

  // Account Modal Form State
  const [accountForm, setAccountForm] = useState({
    accountCode: '',
    nameAr: '',
    nameEn: '',
    accountType: 'ASSET' as any,
    normalBalance: 'DEBIT' as any,
    parentId: '' as string | null,
    isPostable: true,
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    description: '',
  });

  // Fund Transfer Form State
  const [transferForm, setTransferForm] = useState<{
    sourceType: 'BANK' | 'VAULT';
    sourceId: string;
    destinationType: 'BANK' | 'VAULT';
    destinationId: string;
    amount: string;
    notes: string;
  }>({
    sourceType: 'BANK',
    sourceId: '',
    destinationType: 'VAULT',
    destinationId: '',
    amount: '',
    notes: '',
  });

  // Reports State
  const [reportSubTab, setReportSubTab] = useState<'trial_balance' | 'income_statement' | 'balance_sheet' | 'vat_return'>('trial_balance');
  const [trialBalanceData, setTrialBalanceData] = useState<any>(null);
  const [incomeStatementData, setIncomeStatementData] = useState<any>(null);
  const [balanceSheetData, setBalanceSheetData] = useState<any>(null);
  const [vatReturnData, setVatReturnData] = useState<any>(null);

  // Auto-dismiss notification
  useEffect(() => {
    if (feedbackMessage) {
      const timer = setTimeout(() => setFeedbackMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [feedbackMessage]);

  // ==================================================================
  // API Fetchers
  // ==================================================================

  const loadChartOfAccounts = useCallback(async () => {
    try {
      const hierarchy = await apiClient.get<AccountNode[]>(`/accounting/accounts/hierarchy?legalEntityId=${legalEntityId}`);
      setCoaTree(hierarchy || []);

      // Flatten for quick lookup
      const flat: AccountNode[] = [];
      const flatten = (nodes: AccountNode[]) => {
        for (const n of nodes) {
          flat.push(n);
          if (n.children && n.children.length > 0) flatten(n.children);
        }
      };
      flatten(hierarchy || []);
      setFlatAccounts(flat);

      // Auto-expand root level nodes
      const rootIds = new Set<string>();
      (hierarchy || []).forEach((n) => rootIds.add(n.id));
      setCoaExpandedNodes(rootIds);
    } catch (err: any) {
      console.warn('COA fetch error, using fallback hierarchy:', err);
    }
  }, [legalEntityId]);

  const loadJournalEntries = useCallback(async () => {
    try {
      const res = await apiClient.get<{ items: JournalEntryHeader[]; total: number }>(
        `/accounting/journal-entries?legalEntityId=${legalEntityId}&limit=100`
      );
      setJournals(res.items || []);
    } catch (err: any) {
      console.warn('Journal entries fetch error:', err);
    }
  }, [legalEntityId]);

  const loadVaultsAndBanks = useCallback(async () => {
    try {
      const [vaultsRes, banksRes] = await Promise.all([
        apiClient.get<CashVault[]>(`/accounting/vaults?legalEntityId=${legalEntityId}`),
        apiClient.get<BankAccount[]>(`/accounting/bank-accounts?legalEntityId=${legalEntityId}`),
      ]);
      setVaults(vaultsRes || []);
      setBanks(banksRes || []);
    } catch (err) {
      console.warn('Vaults & Banks fetch error:', err);
    }
  }, [legalEntityId]);

  const loadVouchers = useCallback(async () => {
    try {
      const [receiptsRes, paymentsRes] = await Promise.all([
        apiClient.get<VoucherRecord[]>(`/accounting/receipt-vouchers?legalEntityId=${legalEntityId}`),
        apiClient.get<VoucherRecord[]>(`/accounting/payment-vouchers?legalEntityId=${legalEntityId}`),
      ]);
      setReceiptVouchers(receiptsRes || []);
      setPaymentVouchers(paymentsRes || []);
    } catch (err) {
      console.warn('Vouchers fetch error:', err);
    }
  }, [legalEntityId]);

  const loadPartners = useCallback(async () => {
    try {
      const res = await apiClient.get<{ items: BusinessPartnerItem[] }>(`/partners?limit=100`);
      setPartners(res.items || []);
    } catch (err) {
      console.warn('Partners fetch error:', err);
    }
  }, []);

  const loadReports = useCallback(async () => {
    try {
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
      const nowIso = new Date().toISOString();
      const [tb, inc, bs, vat] = await Promise.all([
        apiClient.get<any>(`/accounting/trial-balance?legalEntityId=${legalEntityId}`).catch(() => null),
        apiClient.get<any>(`/accounting/reports/income-statement?legalEntityId=${legalEntityId}`).catch(() => null),
        apiClient.get<any>(`/accounting/reports/balance-sheet?legalEntityId=${legalEntityId}`).catch(() => null),
        apiClient
          .get<any>(
            `/accounting/reports/vat-return?legalEntityId=${legalEntityId}&startDate=${encodeURIComponent(yearStart)}&endDate=${encodeURIComponent(nowIso)}`
          )
          .catch(() => null),
      ]);
      setTrialBalanceData(tb);
      setIncomeStatementData(inc);
      setBalanceSheetData(bs);
      setVatReturnData(vat);
    } catch (err) {
      console.warn('Reports load error:', err);
    }
  }, [legalEntityId]);

  const refreshAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      loadChartOfAccounts(),
      loadJournalEntries(),
      loadVaultsAndBanks(),
      loadVouchers(),
      loadPartners(),
      loadReports(),
    ]);
    setLoading(false);
  }, [loadChartOfAccounts, loadJournalEntries, loadVaultsAndBanks, loadVouchers, loadPartners, loadReports]);

  useEffect(() => {
    refreshAllData();
  }, [refreshAllData]);

  // ==================================================================
  // Multi-Line Journal Calculations
  // ==================================================================

  const journalTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const line of journalForm.lines) {
      debit += parseFloat(line.debit || '0');
      credit += parseFloat(line.credit || '0');
    }
    const diff = Math.abs(debit - credit);
    const isBalanced = diff < 0.0001 && debit > 0;
    return { debit, credit, diff, isBalanced };
  }, [journalForm.lines]);

  const isPostingEligible = useMemo(() => {
    if (journalForm.lines.length < 2) return false;
    if (!journalTotals.isBalanced) return false;
    // Every line must have an accountId and valid amount
    for (const l of journalForm.lines) {
      if (!l.accountId) return false;
      const d = parseFloat(l.debit || '0');
      const c = parseFloat(l.credit || '0');
      if (d === 0 && c === 0) return false;
      // Control account partner requirement
      if ((l.accountCode === '113000' || l.accountCode === '211000') && !l.partnerId) {
        return false;
      }
    }
    return true;
  }, [journalForm.lines, journalTotals.isBalanced]);

  // Multi-line editor actions
  const openNewJournalDrawer = () => {
    setEditingJournalId(null);
    setJournalForm({
      journalNumber: `JV-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`,
      entryDate: new Date().toISOString().slice(0, 10),
      dueDate: '',
      journalType: 'GENERAL',
      sourceType: 'MANUAL',
      description: '',
      notes: '',
      status: 'POSTED',
      lines: [
        { id: '1', accountId: '', accountCode: '', accountName: '', isPostable: true, description: '', partnerId: '', partnerRole: '', costCenterId: '', debit: '', credit: '' },
        { id: '2', accountId: '', accountCode: '', accountName: '', isPostable: true, description: '', partnerId: '', partnerRole: '', costCenterId: '', debit: '', credit: '' },
      ],
    });
    setJournalModalError(null);
    setIsJournalDrawerOpen(true);
    setTimeout(() => {
      const el = document.getElementById('line-account-0');
      if (el) el.focus();
    }, 100);
  };

  const handleOpenEditDraft = (j: JournalEntryHeader) => {
    if (j.status !== 'DRAFT') {
      setFeedbackMessage({ type: 'error', text: 'لا يمكن تعديل إلا مسودات القيود (DRAFT)' });
      return;
    }
    setEditingJournalId(j.id);
    setJournalForm({
      journalNumber: j.journalNumber,
      entryDate: j.entryDate ? new Date(j.entryDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      dueDate: (j as any).dueDate ? new Date((j as any).dueDate).toISOString().slice(0, 10) : '',
      journalType: j.journalType || 'GENERAL',
      sourceType: j.sourceType || 'MANUAL',
      description: j.description || '',
      notes: j.notes || '',
      status: 'DRAFT',
      lines: (j.lines && j.lines.length > 0)
        ? j.lines.map((l, idx) => {
            const acc = flatAccounts.find((a) => a.id === l.accountId || a.accountCode === l.accountCode);
            const dVal = parseFloat(l.debit || '0');
            const cVal = parseFloat(l.credit || '0');
            return {
              id: l.id || `line-${idx}-${Date.now()}`,
              accountId: l.accountId || acc?.id || '',
              accountCode: l.accountCode || acc?.accountCode || '',
              accountName: l.accountName || acc?.nameAr || acc?.name || '',
              isPostable: acc ? acc.isPostable : true,
              description: l.description || '',
              partnerId: l.partnerId || '',
              partnerRole: l.partnerRole || '',
              costCenterId: l.costCenterId || '',
              debit: dVal > 0 ? String(dVal) : '',
              credit: cVal > 0 ? String(cVal) : '',
            };
          })
        : [
            { id: '1', accountId: '', accountCode: '', accountName: '', isPostable: true, description: '', partnerId: '', partnerRole: '', costCenterId: '', debit: '', credit: '' },
            { id: '2', accountId: '', accountCode: '', accountName: '', isPostable: true, description: '', partnerId: '', partnerRole: '', costCenterId: '', debit: '', credit: '' },
          ],
    });
    setJournalModalError(null);
    setIsJournalDrawerOpen(true);
    setTimeout(() => {
      const el = document.getElementById('line-account-0');
      if (el) el.focus();
    }, 100);
  };

  const handleAddJournalLine = (focusNew = false) => {
    const newLineId = Date.now().toString();
    setJournalForm((prev) => {
      const newLines = [
        ...prev.lines,
        {
          id: newLineId,
          accountId: '',
          accountCode: '',
          accountName: '',
          isPostable: true,
          description: prev.description,
          partnerId: '',
          partnerRole: '',
          costCenterId: '',
          debit: '',
          credit: '',
        },
      ];
      if (focusNew) {
        setTimeout(() => {
          const el = document.getElementById(`line-account-${newLines.length - 1}`);
          if (el) el.focus();
        }, 50);
      }
      return {
        ...prev,
        lines: newLines,
      };
    });
  };

  const handleDuplicateLine = (index: number) => {
    const target = journalForm.lines[index];
    const cloned = { ...target, id: Date.now().toString() };
    const updated = [...journalForm.lines];
    updated.splice(index + 1, 0, cloned);
    setJournalForm((prev) => ({ ...prev, lines: updated }));
    setTimeout(() => {
      const el = document.getElementById(`line-account-${index + 1}`);
      if (el) el.focus();
    }, 50);
  };

  const handleDeleteLine = (index: number) => {
    if (journalForm.lines.length <= 2) {
      setFeedbackMessage({ type: 'error', text: 'يجب أن يحتوي القيد على بندين على الأقل' });
      return;
    }
    setJournalForm((prev) => ({
      ...prev,
      lines: prev.lines.filter((_, idx) => idx !== index),
    }));
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    fieldName: 'account' | 'desc' | 'partner' | 'debit' | 'credit',
    idx: number
  ) => {
    // Ctrl + Enter: Add line and focus first field of new line
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleAddJournalLine(true);
      return;
    }

    // Ctrl + D: Duplicate current line
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      handleDuplicateLine(idx);
      return;
    }

    // Enter key navigation
    if (e.key === 'Enter') {
      e.preventDefault();
      const isControl =
        journalForm.lines[idx].accountCode === '113000' ||
        journalForm.lines[idx].accountCode === '211000';

      if (fieldName === 'account') {
        const el = document.getElementById(`line-desc-${idx}`);
        if (el) el.focus();
      } else if (fieldName === 'desc') {
        if (isControl) {
          const el = document.getElementById(`line-partner-${idx}`);
          if (el) el.focus();
        } else {
          const el = document.getElementById(`line-debit-${idx}`);
          if (el) el.focus();
        }
      } else if (fieldName === 'partner') {
        const el = document.getElementById(`line-debit-${idx}`);
        if (el) el.focus();
      } else if (fieldName === 'debit') {
        const dVal = parseFloat(journalForm.lines[idx].debit || '0');
        if (dVal > 0) {
          if (idx + 1 < journalForm.lines.length) {
            const el = document.getElementById(`line-account-${idx + 1}`);
            if (el) el.focus();
          } else {
            handleAddJournalLine(true);
          }
        } else {
          const el = document.getElementById(`line-credit-${idx}`);
          if (el) el.focus();
        }
      } else if (fieldName === 'credit') {
        if (idx + 1 < journalForm.lines.length) {
          const el = document.getElementById(`line-account-${idx + 1}`);
          if (el) el.focus();
        } else {
          handleAddJournalLine(true);
        }
      }
    }
  };

  const handleLineAccountChange = (index: number, accountId: string) => {
    const acc = flatAccounts.find((a) => a.id === accountId);
    setJournalForm((prev) => {
      const updated = [...prev.lines];
      updated[index] = {
        ...updated[index],
        accountId,
        accountCode: acc?.accountCode || '',
        accountName: acc?.nameAr || acc?.name || '',
        isPostable: acc?.isPostable ?? true,
        partnerId: acc?.accountCode === '113000' || acc?.accountCode === '211000' ? updated[index].partnerId : '',
        partnerRole: acc?.accountCode === '113000' ? 'CUSTOMER' : acc?.accountCode === '211000' ? 'VENDOR' : '',
      };
      return { ...prev, lines: updated };
    });
  };

  const handleSaveJournal = async (targetStatus: 'DRAFT' | 'POSTED') => {
    try {
      setJournalModalError(null);
      if (targetStatus === 'POSTED' && !isPostingEligible) {
        const msg = 'لا يمكن ترحيل القيد: تأكد من توازن المدين والدائن واستيفاء أطراف حسابات المراقبة';
        setJournalModalError(msg);
        toast.error(msg);
        setFeedbackMessage({ type: 'error', text: msg });
        return;
      }

      const formattedLines = journalForm.lines
        .filter((l) => l.accountId && (parseFloat(l.debit || '0') > 0 || parseFloat(l.credit || '0') > 0))
        .map((l) => ({
          accountId: l.accountId,
          accountCode: l.accountCode,
          branchId: activeBranch?.id || null,
          partnerId: l.partnerId || null,
          partnerRole: l.partnerRole || null,
          costCenterId: l.costCenterId || null,
          debit: parseFloat(l.debit || '0') > 0 ? parseFloat(l.debit).toFixed(4) : '0.0000',
          credit: parseFloat(l.credit || '0') > 0 ? parseFloat(l.credit).toFixed(4) : '0.0000',
          currency: 'SAR',
          description: l.description || journalForm.description,
        }));

      if (targetStatus === 'POSTED' && formattedLines.length < 2) {
        const msg = 'يجب أن يحتوي القيد على بندين على الأقل';
        setJournalModalError(msg);
        toast.error(msg);
        setFeedbackMessage({ type: 'error', text: msg });
        return;
      }

      let successText = '';
      if (editingJournalId) {
        // Updating existing draft
        await apiClient.put(`/accounting/journal-entries/${editingJournalId}`, {
          journalType: journalForm.journalType,
          description: journalForm.description,
          notes: journalForm.notes,
          entryDate: journalForm.entryDate,
          dueDate: journalForm.dueDate || undefined,
          lines: formattedLines,
        });

        if (targetStatus === 'POSTED') {
          await apiClient.post(`/accounting/journal-entries/${editingJournalId}/post`, {});
          successText = `تم تحديث وترحيل القيد #${journalForm.journalNumber} بنجاح`;
        } else {
          successText = `تم حفظ تعديلات مسودة القيد #${journalForm.journalNumber} بنجاح`;
        }
      } else {
        // Creating new entry
        const payload = {
          legalEntityId,
          branchId: activeBranch?.id || null,
          journalNumber: journalForm.journalNumber,
          journalType: journalForm.journalType,
          sourceType: 'MANUAL',
          description: journalForm.description || 'قيد يومية يدوي مركب',
          notes: journalForm.notes,
          entryDate: journalForm.entryDate,
          dueDate: journalForm.dueDate || undefined,
          currency: 'SAR',
          status: targetStatus,
          lines: formattedLines,
        };

        const res = await apiClient.post<any>('/accounting/journal-entries', payload);
        successText = targetStatus === 'POSTED'
          ? `تم ترحيل القيد #${res.journalNumber || journalForm.journalNumber} بنجاح`
          : `تم حفظ مسودة القيد #${res.journalNumber || journalForm.journalNumber} بنجاح`;
      }

      toast.success(successText);
      setFeedbackMessage({ type: 'success', text: successText });
      setIsJournalDrawerOpen(false);
      setEditingJournalId(null);
      setJournalModalError(null);
      await loadJournalEntries();
      await loadChartOfAccounts();
    } catch (err: any) {
      const errMsg = err.message || 'فشل حفظ القيد';
      setJournalModalError(errMsg);
      toast.error(errMsg);
      setFeedbackMessage({ type: 'error', text: errMsg });
    }
  };

  const handleReverseJournal = async () => {
    if (!reversalTargetEntry) return;
    try {
      setReversalModalError(null);
      await apiClient.post('/accounting/journal-entries/reverse', {
        journalEntryId: reversalTargetEntry.id,
        reversalReason: reversalReason || 'إلغاء وعكس تصحيحي للقيد',
      });
      const msg = `تم عكس القيد #${reversalTargetEntry.journalNumber} بنجاح وإنشاء قيد عكسي`;
      toast.success(msg);
      setFeedbackMessage({ type: 'success', text: msg });
      setIsReversalModalOpen(false);
      setReversalTargetEntry(null);
      setReversalReason('');
      setReversalModalError(null);
      await loadJournalEntries();
      await loadChartOfAccounts();
    } catch (err: any) {
      const errMsg = err.message || 'فشل عكس القيد';
      setReversalModalError(errMsg);
      toast.error(errMsg);
      setFeedbackMessage({ type: 'error', text: errMsg });
    }
  };

  // ==================================================================
  // COA Tree Handlers
  // ==================================================================

  const toggleCoaNode = (id: string) => {
    setCoaExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAllCoa = () => {
    const all = new Set<string>();
    flatAccounts.forEach((a) => all.add(a.id));
    setCoaExpandedNodes(all);
  };

  const collapseAllCoa = () => {
    setCoaExpandedNodes(new Set());
  };

  const handleParentChange = async (parentId: string | null) => {
    try {
      const endpoint = parentId
        ? `/accounting/accounts/next-code?legalEntityId=${legalEntityId}&parentId=${parentId}`
        : `/accounting/accounts/next-code?legalEntityId=${legalEntityId}&accountType=${accountForm.accountType || 'ASSET'}`;
      const res = await apiClient.get<{
        nextCode: string;
        level: number;
        accountType: string;
        normalBalance: string;
      }>(endpoint);

      setIsContra(false);
      setAccountForm((prev) => ({
        ...prev,
        parentId,
        accountCode: res.nextCode,
        accountType: res.accountType as any,
        normalBalance: res.normalBalance as any,
      }));
    } catch (err: any) {
      console.warn('Failed to fetch next account code:', err);
      setAccountForm((prev) => ({ ...prev, parentId }));
    }
  };

  const handleToggleContra = (checked: boolean) => {
    setIsContra(checked);
    setAccountForm((prev) => {
      const parent = flatAccounts.find((a) => a.id === prev.parentId);
      const baseNormal = parent
        ? parent.normalBalance
        : prev.accountType === 'ASSET' || prev.accountType === 'EXPENSE'
        ? 'DEBIT'
        : 'CREDIT';
      const inverted = baseNormal === 'DEBIT' ? 'CREDIT' : 'DEBIT';
      return {
        ...prev,
        normalBalance: checked ? inverted : baseNormal,
      };
    });
  };

  const handleOpenAccountModal = async (acc?: AccountNode, parentId?: string) => {
    setAccountModalError(null);
    setIsContra(false);
    if (acc) {
      setEditingAccount(acc);
      const parentAcc = flatAccounts.find((a) => a.id === acc.parentId);
      const isContraDetected = parentAcc ? acc.normalBalance !== parentAcc.normalBalance : false;
      setIsContra(isContraDetected);
      setAccountForm({
        accountCode: acc.accountCode,
        nameAr: acc.nameAr || acc.name,
        nameEn: acc.nameEn || '',
        accountType: acc.accountType,
        normalBalance: acc.normalBalance,
        parentId: acc.parentId || null,
        isPostable: acc.isPostable,
        status: acc.status || 'ACTIVE',
        description: '',
      });
      setIsAccountModalOpen(true);
    } else {
      setEditingAccount(null);
      const parentAcc = flatAccounts.find((a) => a.id === parentId);
      setAccountForm({
        accountCode: '',
        nameAr: '',
        nameEn: '',
        accountType: parentAcc ? parentAcc.accountType : 'ASSET',
        normalBalance: parentAcc ? parentAcc.normalBalance : 'DEBIT',
        parentId: parentId || null,
        isPostable: true,
        status: 'ACTIVE',
        description: '',
      });
      setIsAccountModalOpen(true);
      await handleParentChange(parentId || null);
    }
  };

  const handleSaveAccount = async () => {
    try {
      setAccountModalError(null);
      if (!accountForm.accountCode || !accountForm.nameAr) {
        const msg = 'يرجى إدخال رمز الحساب والاسم بالعربية';
        setAccountModalError(msg);
        toast.error(msg);
        setFeedbackMessage({ type: 'error', text: msg });
        return;
      }

      const cleanNameAr = accountForm.nameAr.trim();
      const cleanNameEn = accountForm.nameEn ? accountForm.nameEn.trim() : null;
      const cleanDesc = accountForm.description ? accountForm.description.trim() : null;
      const cleanParentId = accountForm.parentId ? accountForm.parentId : null;

      let successText = '';
      if (editingAccount) {
        await apiClient.put(`/accounting/accounts/${editingAccount.id}`, {
          name: cleanNameAr,
          nameAr: cleanNameAr,
          nameEn: cleanNameEn,
          parentId: cleanParentId,
          isPostable: accountForm.isPostable,
          status: accountForm.status,
          description: cleanDesc,
        });
        successText = `تم تحديث الحساب ${accountForm.accountCode} بنجاح`;
      } else {
        await apiClient.post('/accounting/accounts', {
          legalEntityId,
          accountCode: accountForm.accountCode.trim(),
          name: cleanNameAr,
          nameAr: cleanNameAr,
          nameEn: cleanNameEn,
          accountType: accountForm.accountType,
          normalBalance: accountForm.normalBalance,
          parentId: cleanParentId,
          isPostable: accountForm.isPostable,
          description: cleanDesc,
        });
        successText = `تم إنشاء الحساب ${accountForm.accountCode} بنجاح`;
      }

      toast.success(successText);
      setFeedbackMessage({ type: 'success', text: successText });
      setIsAccountModalOpen(false);
      setAccountModalError(null);
      await loadChartOfAccounts();
    } catch (err: any) {
      const errMsg = err.message || 'فشل حفظ بيانات الحساب';
      setAccountModalError(errMsg);
      toast.error(errMsg);
      setFeedbackMessage({ type: 'error', text: errMsg });
    }
  };

  const handleDeleteAccount = async (account: AccountNode) => {
    if (!window.confirm(`هل أنت متأكد من حذف الحساب "${account.accountCode} - ${account.nameAr}"؟`)) return;
    try {
      await apiClient.delete(`/accounting/accounts/${account.id}`);
      toast.success('تم حذف الحساب بنجاح');
      setFeedbackMessage({ type: 'success', text: 'تم حذف الحساب بنجاح' });
      await loadChartOfAccounts();
    } catch (err: any) {
      const errMsg = err.message || 'لا يمكن حذف الحساب';
      toast.error(errMsg);
      setFeedbackMessage({ type: 'error', text: errMsg });
    }
  };

  // ==================================================================
  // Funds Transfer Handler
  // ==================================================================

  const handleExecuteTransfer = async () => {
    try {
      if (!transferForm.sourceId || !transferForm.destinationId || !transferForm.amount) {
        setFeedbackMessage({ type: 'error', text: 'يرجى تعبئة جميع حقول التحويل والمبلغ' });
        return;
      }

      const sourceAccId =
        transferForm.sourceType === 'BANK'
          ? banks.find((b) => b.id === transferForm.sourceId)?.accountId
          : vaults.find((v) => v.id === transferForm.sourceId)?.accountId;

      const destAccId =
        transferForm.destinationType === 'BANK'
          ? banks.find((b) => b.id === transferForm.destinationId)?.accountId
          : vaults.find((v) => v.id === transferForm.destinationId)?.accountId;

      const isSameAccount =
        (transferForm.sourceType === transferForm.destinationType &&
          transferForm.sourceId === transferForm.destinationId) ||
        Boolean(sourceAccId && destAccId && sourceAccId === destAccId);

      if (isSameAccount) {
        const msg = 'لا يمكن التحويل من الحساب إلى نفسه. اختر حسابًا آخر كوجهة';
        setTransferModalError(msg);
        toast.error(msg);
        setFeedbackMessage({ type: 'error', text: msg });
        return;
      }

      await apiClient.post('/accounting/bank-accounts/transfer', {
        legalEntityId,
        branchId: activeBranch?.id || null,
        sourceType: transferForm.sourceType,
        sourceId: transferForm.sourceId,
        destinationType: transferForm.destinationType,
        destinationId: transferForm.destinationId,
        amount: parseFloat(transferForm.amount).toFixed(4),
        notes: transferForm.notes || 'تحويل نقدي بين الحسابات',
      });

      const successMsg = 'تم تنفيذ التحويل وتحديث الأرصدة وترحيل القيد بنجاح';
      toast.success(successMsg);
      setFeedbackMessage({ type: 'success', text: successMsg });
      setIsTransferModalOpen(false);
      setTransferModalError(null);
      setTransferForm({
        sourceType: 'BANK',
        sourceId: '',
        destinationType: 'VAULT',
        destinationId: '',
        amount: '',
        notes: '',
      });
      await loadVaultsAndBanks();
      await loadJournalEntries();
    } catch (err: any) {
      const errMsg = err.message || 'فشل تنفيذ عملية التحويل';
      setTransferModalError(errMsg);
      toast.error(errMsg);
      setFeedbackMessage({ type: 'error', text: errMsg });
    }
  };

  // ==================================================================
  // Filtering & Rendering Helpers
  // ==================================================================

  const filteredJournals = useMemo(() => {
    return journals.filter((j) => {
      const matchSearch =
        !journalSearch ||
        j.journalNumber.toLowerCase().includes(journalSearch.toLowerCase()) ||
        (j.description && j.description.toLowerCase().includes(journalSearch.toLowerCase()));
      const matchStatus = journalStatusFilter === 'ALL' || j.status === journalStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [journals, journalSearch, journalStatusFilter]);

  const filteredVouchers = useMemo(() => {
    const list = voucherTypeTab === 'RECEIPT' ? receiptVouchers : paymentVouchers;
    return list.filter((v) => {
      const party = v.payerName || v.beneficiaryName || '';
      return (
        !voucherSearch ||
        v.voucherNumber.toLowerCase().includes(voucherSearch.toLowerCase()) ||
        party.toLowerCase().includes(voucherSearch.toLowerCase())
      );
    });
  }, [voucherTypeTab, receiptVouchers, paymentVouchers, voucherSearch]);

  // Recursively render tree nodes
  const renderCoaNode = (node: AccountNode, depth = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = coaExpandedNodes.has(node.id);

    const matchesSearch =
      !coaSearch ||
      node.accountCode.toLowerCase().includes(coaSearch.toLowerCase()) ||
      node.nameAr.toLowerCase().includes(coaSearch.toLowerCase()) ||
      (node.nameEn && node.nameEn.toLowerCase().includes(coaSearch.toLowerCase()));

    const matchesType = coaTypeFilter === 'ALL' || node.accountType === coaTypeFilter;

    if (!matchesSearch || !matchesType) {
      if (!hasChildren) return null;
    }

    const netBal = parseFloat(String(node.netBalance || '0'));

    return (
      <div key={node.id} className="flex flex-col">
        <div
          className={`flex items-center justify-between py-2.5 px-3 rounded-lg transition text-sm ${
            depth === 0
              ? 'bg-slate-100 font-bold text-slate-900 border border-slate-200 my-1'
              : depth === 1
              ? 'hover:bg-slate-100 text-slate-800'
              : 'hover:bg-slate-50 text-slate-700'
          }`}
          style={{ paddingRight: `${Math.max(12, depth * 24)}px` }}
        >
          {/* Left: Code, Name, Badges */}
          <div className="flex items-center gap-2 min-w-0">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCoaNode(node.id)}
                className="p-1 hover:bg-slate-700/30 rounded text-slate-400 hover:text-slate-200 transition"
              >
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            ) : (
              <span className="w-6" />
            )}

            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-700/20 text-slate-400 border border-slate-600/30">
              {node.accountCode}
            </span>

            <span className="truncate font-medium">{node.nameAr || node.name}</span>

            {node.isPostable ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                قابل للترحيل
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
                تجميعي
              </span>
            )}

            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-400">
              {node.normalBalance === 'DEBIT' ? 'مدين طبيعي' : 'دائن طبيعي'}
            </span>

            {node.status === 'INACTIVE' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                موقوف
              </span>
            )}
          </div>

          {/* Right: Balances & Actions */}
          <div className="flex items-center gap-4">
            <div className="text-left font-mono font-semibold">
              <span className={netBal >= 0 ? 'text-slate-900' : 'text-red-500'}>
                {netBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR
              </span>
            </div>

            <div className="flex items-center gap-1 opacity-80 hover:opacity-100">
              <button
                type="button"
                title="إضافة حساب فرعي"
                onClick={() => handleOpenAccountModal(undefined, node.id)}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-500 hover:text-emerald-500 transition"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="تعديل الحساب"
                onClick={() => handleOpenAccountModal(node)}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-500 hover:text-blue-500 transition"
              >
                <FileText className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="حذف الحساب"
                onClick={() => handleDeleteAccount(node)}
                className="p-1.5 hover:bg-slate-200 rounded text-slate-500 hover:text-red-500 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Child Nodes */}
        {hasChildren && isExpanded && (
          <div className="flex flex-col">{node.children!.map((child) => renderCoaNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  // ==================================================================
  // Main View Render
  // ==================================================================

  return (
    <div
      className="min-h-screen transition-colors duration-200 font-sans bg-slate-50 text-slate-900"
      dir={dir}
    >
      {/* Toast Feedback Notification */}
      {feedbackMessage && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl transition border ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-500'
              : 'bg-red-600 text-white border-red-500'
          }`}
        >
          {feedbackMessage.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="text-sm font-medium">{feedbackMessage.text}</span>
          <button type="button" onClick={() => setFeedbackMessage(null)} className="opacity-70 hover:opacity-100 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Top Header */}
      <div className={`border-b ${'bg-white border-slate-200'} px-6 py-4`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-600/20">
                <Scale className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">الوحدة المحاسبية وإدارة العمليات المالية</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  منظومة القيد المزدوج المتوازن، دليل الحسابات الشجري، وإدارة التدفقات النقدية والتقارير القانونية
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Refresh Button */}
            <button
              type="button"
              onClick={refreshAllData}
              disabled={loading}
              className="p-2.5 rounded-xl border transition bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* New Multi-Line Journal Entry Button */}
            <button
              type="button"
              onClick={openNewJournalDrawer}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition shadow-lg shadow-emerald-600/30"
            >
              <Plus className="w-4 h-4" />
              <span>إنشاء قيد يومية مركب</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 mt-6 border-b border-slate-200 -mb-4">
          {[
            { id: 'journals', label: 'قيود اليومية ومحرر القيود', icon: BookOpen },
            { id: 'coa', label: 'دليل الحسابات الشجري (COA)', icon: FolderTree },
            { id: 'vouchers', label: 'سندات القبض والصرف', icon: Receipt },
            { id: 'vaults_banks', label: 'الخزائن والبنوك والموارد', icon: Wallet },
            { id: 'shifts', label: 'إقفال الورديات (POS)', icon: Calculator },
            { id: 'settlements', label: 'تسويات الدفع والتوصيل', icon: CreditCard },
            { id: 'mappings', label: 'الربط المحاسبي واستثناءات الفروع', icon: GitFork },
            { id: 'reports', label: 'التقارير المالية والضريبية', icon: FileSpreadsheet },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-3 font-medium text-sm rounded-t-xl transition border-b-2 ${
                  active
                    ? 'border-emerald-500 text-emerald-600 bg-emerald-50/50'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Tab Content */}
      <div className="p-6 max-w-7xl mx-auto">
        {/* ================================================================== */}
        {/* TAB 1: JOURNALS & MULTI-LINE VIEWS */}
        {/* ================================================================== */}
        {activeTab === 'journals' && (
          <div className="flex flex-col gap-6">
            {/* Journal Metrics Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className={`p-4 rounded-xl border ${'bg-white border-slate-200'}`}>
                <p className="text-xs text-slate-500">إجمالي القيود المرحلة</p>
                <p className="text-2xl font-bold mt-1 text-emerald-600">
                  {journals.filter((j) => j.status === 'POSTED').length}
                </p>
              </div>
              <div className={`p-4 rounded-xl border ${'bg-white border-slate-200'}`}>
                <p className="text-xs text-slate-500">مسودات القيود (قيد المراجعة)</p>
                <p className="text-2xl font-bold mt-1 text-blue-600">
                  {journals.filter((j) => j.status === 'DRAFT').length}
                </p>
              </div>
              <div className={`p-4 rounded-xl border ${'bg-white border-slate-200'}`}>
                <p className="text-xs text-slate-500">القيود المعكوسة (تسويات)</p>
                <p className="text-2xl font-bold mt-1 text-slate-500">
                  {journals.filter((j) => j.status === 'REVERSED').length}
                </p>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 max-w-md">
                <div className="relative w-full">
                  <Search className="w-4 h-4 absolute right-3 top-3 text-slate-400" />
                  <input
                    type="text"
                    value={journalSearch}
                    onChange={(e) => setJournalSearch(e.target.value)}
                    placeholder="البحث برقم القيد أو البيان العام..."
                    className={`w-full pr-9 pl-4 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      'bg-white border-slate-200 text-slate-900'
                    }`}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={journalStatusFilter}
                  onChange={(e) => setJournalStatusFilter(e.target.value)}
                  className={`px-3 py-2 text-xs rounded-xl border focus:outline-none ${
                    'bg-white border-slate-200 text-slate-800'
                  }`}
                >
                  <option value="ALL">جميع الحالات</option>
                  <option value="POSTED">مرحّل (POSTED)</option>
                  <option value="DRAFT">مسودة (DRAFT)</option>
                  <option value="REVERSED">معكوس (REVERSED)</option>
                </select>

                <button
                  type="button"
                  disabled={filteredJournals.length === 0}
                  onClick={() =>
                    exportToCsv(
                      `journal-entries-${new Date().toISOString().slice(0, 10)}.csv`,
                      filteredJournals.map((j) => ({
                        journalNumber: j.journalNumber,
                        entryDate: j.entryDate,
                        journalType: j.journalType || '',
                        status: j.status,
                        description: j.description,
                        totalDebit: (j.lines || []).reduce((s, l) => s + Number(l.debit ?? 0), 0).toFixed(2),
                        totalCredit: (j.lines || []).reduce((s, l) => s + Number(l.credit ?? 0), 0).toFixed(2),
                      })),
                      [
                        { key: 'journalNumber', header: 'رقم القيد' },
                        { key: 'entryDate', header: 'تاريخ القيد' },
                        { key: 'journalType', header: 'النوع' },
                        { key: 'status', header: 'الحالة' },
                        { key: 'description', header: 'البيان' },
                        { key: 'totalDebit', header: 'إجمالي المدين' },
                        { key: 'totalCredit', header: 'إجمالي الدائن' },
                      ]
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-white hover:bg-slate-50 border border-slate-200 disabled:opacity-50 text-slate-700 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تصدير CSV</span>
                </button>
              </div>
            </div>

            {/* Journals Table */}
            <div className={`rounded-xl border overflow-hidden shadow-sm ${'bg-white border-slate-200'}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className={`text-xs uppercase font-semibold ${'bg-slate-100 text-slate-600'}`}>
                    <tr>
                      <th className="py-3.5 px-4">رقم القيد</th>
                      <th className="py-3.5 px-4">تاريخ القيد</th>
                      <th className="py-3.5 px-4">النوع</th>
                      <th className="py-3.5 px-4">البيان العام</th>
                      <th className="py-3.5 px-4 text-left">إجمالي المدين</th>
                      <th className="py-3.5 px-4 text-left">إجمالي الدائن</th>
                      <th className="py-3.5 px-4 text-center">الحالة</th>
                      <th className="py-3.5 px-4 text-center">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredJournals.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-500">
                          لا توجد قيود يومية مطابقة للمعايير المحددة
                        </td>
                      </tr>
                    ) : (
                      filteredJournals.map((j) => (
                        <React.Fragment key={j.id}>
                          <tr className={`hover:bg-slate-50 transition`}>
                            <td className="py-3 px-4 font-mono font-semibold text-emerald-600">
                              {j.journalNumber}
                            </td>
                            <td className="py-3 px-4 text-slate-500 font-mono text-xs">
                              {new Date(j.entryDate).toLocaleDateString('ar-SA')}
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-xs px-2 py-0.5 rounded bg-slate-500/10 text-slate-500">
                                {j.journalType}
                              </span>
                            </td>
                            <td className="py-3 px-4 max-w-xs truncate text-slate-700">
                              {j.description || '-'}
                            </td>
                            <td className="py-3 px-4 text-left font-mono font-semibold text-slate-900">
                              {parseFloat(j.debitTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-left font-mono font-semibold text-slate-900">
                              {parseFloat(j.creditTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {j.status === 'POSTED' && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-medium">
                                  مرحّل
                                </span>
                              )}
                              {j.status === 'DRAFT' && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20 font-medium">
                                  مسودة
                                </span>
                              )}
                              {j.status === 'REVERSED' && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20 font-medium">
                                  معكوس
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                {j.status === 'DRAFT' && (
                                  <>
                                    <button
                                      type="button"
                                      title="تعديل المسودة"
                                      onClick={() => handleOpenEditDraft(j)}
                                      className="p-1.5 hover:bg-blue-50 text-blue-600 rounded transition flex items-center gap-1 text-xs font-semibold"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                      <span>تعديل</span>
                                    </button>
                                    <button
                                      type="button"
                                      title="ترحيل المسودة"
                                      onClick={async () => {
                                        try {
                                          await apiClient.post(`/accounting/journal-entries/${j.id}/post`, {});
                                          setFeedbackMessage({ type: 'success', text: `تم ترحيل القيد #${j.journalNumber} بنجاح` });
                                          await loadJournalEntries();
                                        } catch (err: any) {
                                          setFeedbackMessage({ type: 'error', text: err.message || 'فشل ترحيل المسودة' });
                                        }
                                      }}
                                      className="p-1.5 hover:bg-emerald-50 text-emerald-600 rounded transition"
                                    >
                                      <CheckCircle2 className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      title="حذف المسودة"
                                      onClick={async () => {
                                        if (!window.confirm(`هل أنت متأكد من حذف مسودة القيد #${j.journalNumber}؟`)) return;
                                        try {
                                          await apiClient.delete(`/accounting/journal-entries/${j.id}`);
                                          setFeedbackMessage({ type: 'success', text: 'تم حذف المسودة بنجاح' });
                                          await loadJournalEntries();
                                        } catch (err: any) {
                                          setFeedbackMessage({ type: 'error', text: err.message || 'فشل حذف المسودة' });
                                        }
                                      }}
                                      className="p-1.5 hover:bg-red-50 text-red-500 rounded transition"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </>
                                )}
                                {j.status === 'POSTED' && (
                                  <button
                                    type="button"
                                    title="عكس القيد المحاسبي"
                                    onClick={() => {
                                      setReversalTargetEntry(j);
                                      setReversalReason('');
                                      setReversalModalError(null);
                                      setIsReversalModalOpen(true);
                                    }}
                                    className="p-1.5 hover:bg-amber-50 text-amber-600 rounded transition flex items-center gap-1 text-xs"
                                  >
                                    <Undo2 className="w-3.5 h-3.5" />
                                    <span>عكس</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* Multi-Lines expansion */}
                          {j.lines && j.lines.length > 0 && (
                            <tr className={`${'bg-slate-50/60'}`}>
                              <td colSpan={8} className="p-3">
                                <div className="border rounded-lg p-3 text-xs border-slate-200 bg-white overflow-x-auto">
                                  <table className="w-full text-right font-mono">
                                    <thead>
                                      <tr className="text-slate-400 border-b border-slate-700/30">
                                        <th className="pb-1.5">رمز الحساب</th>
                                        <th className="pb-1.5">اسم الحساب</th>
                                        <th className="pb-1.5">الطرف التجاري</th>
                                        <th className="pb-1.5">البيان</th>
                                        <th className="pb-1.5 text-left">مدين</th>
                                        <th className="pb-1.5 text-left">دائن</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/20">
                                      {j.lines.map((line, idx) => (
                                        <tr key={idx} className="py-1">
                                          <td className="py-1 text-emerald-500 font-semibold">{line.accountCode}</td>
                                          <td className="py-1 text-slate-300 font-sans">{line.accountName || (line as any).accountNameAr}</td>
                                          <td className="py-1 text-slate-400 font-sans">{line.partnerName || '-'}</td>
                                          <td className="py-1 text-slate-500 font-sans">{line.description || '-'}</td>
                                          <td className="py-1 text-left">{parseFloat(line.debit) > 0 ? parseFloat(line.debit).toFixed(2) : '-'}</td>
                                          <td className="py-1 text-left">{parseFloat(line.credit) > 0 ? parseFloat(line.credit).toFixed(2) : '-'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 2: CHART OF ACCOUNTS TREE HIERARCHY */}
        {/* ================================================================== */}
        {activeTab === 'coa' && (
          <div className="flex flex-col gap-6">
            {/* Header Actions */}
            <div className={`flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border ${'bg-white border-slate-200'}`}>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleOpenAccountModal()}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl text-xs font-medium transition shadow-md shadow-emerald-600/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة حساب رئيسي جديد</span>
                </button>

                <button
                  type="button"
                  onClick={expandAllCoa}
                  className={`px-3 py-2 rounded-xl text-xs border font-medium transition ${'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'}`}
                >
                  توسيع الكل
                </button>

                <button
                  type="button"
                  onClick={collapseAllCoa}
                  className={`px-3 py-2 rounded-xl text-xs border font-medium transition ${'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'}`}
                >
                  طي الكل
                </button>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-3">
                <div className="relative w-64">
                  <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={coaSearch}
                    onChange={(e) => setCoaSearch(e.target.value)}
                    placeholder="البحث بالرمز أو الاسم..."
                    className={`w-full pr-9 pl-3 py-1.5 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      'bg-slate-50 border-slate-200 text-slate-900'
                    }`}
                  />
                </div>

                <select
                  value={coaTypeFilter}
                  onChange={(e) => setCoaTypeFilter(e.target.value)}
                  className={`px-3 py-1.5 text-xs rounded-xl border focus:outline-none ${
                    'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  <option value="ALL">جميع الأنواع</option>
                  <option value="ASSET">الأصول (ASSET)</option>
                  <option value="LIABILITY">الالتزامات (LIABILITY)</option>
                  <option value="EQUITY">حقوق الملكية (EQUITY)</option>
                  <option value="REVENUE">الإيرادات (REVENUE)</option>
                  <option value="COGS">تكلفة المبيعات (COGS)</option>
                  <option value="EXPENSE">المصروفات (EXPENSE)</option>
                </select>
              </div>
            </div>

            {/* Tree Container */}
            <div className={`p-4 rounded-xl border shadow-sm ${'bg-white border-slate-200'}`}>
              <div className="flex flex-col gap-1">
                {coaTree.length === 0 ? (
                  <div className="py-12 text-center text-slate-500">جاري تحميل شجرة الحسابات أو لا توجد حسابات مسجلة...</div>
                ) : (
                  coaTree.map((rootNode) => renderCoaNode(rootNode, 0))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 3: PAYMENT & RECEIPT VOUCHERS */}
        {/* ================================================================== */}
        {activeTab === 'vouchers' && (
          <div className="flex flex-col gap-6">
            {/* Voucher Sub-Navigation */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVoucherTypeTab('RECEIPT')}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    voucherTypeTab === 'RECEIPT'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  سندات القبض (Receipt Vouchers)
                </button>
                <button
                  type="button"
                  onClick={() => setVoucherTypeTab('PAYMENT')}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
                    voucherTypeTab === 'PAYMENT'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  سندات الصرف (Payment Vouchers)
                </button>
              </div>

              <div className="relative w-64">
                <Search className="w-4 h-4 absolute right-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={voucherSearch}
                  onChange={(e) => setVoucherSearch(e.target.value)}
                  placeholder="بحث برقم السند أو الطرف..."
                  className={`w-full pr-9 pl-3 py-1.5 text-xs rounded-xl border focus:outline-none ${
                    'bg-white border-slate-200 text-slate-900'
                  }`}
                />
              </div>
            </div>

            {/* Table */}
            <div className={`rounded-xl border overflow-hidden shadow-sm ${'bg-white border-slate-200'}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className={`text-xs uppercase font-semibold ${'bg-slate-100 text-slate-600'}`}>
                    <tr>
                      <th className="py-3 px-4">رقم السند</th>
                      <th className="py-3 px-4">التاريخ</th>
                      <th className="py-3 px-4">{voucherTypeTab === 'RECEIPT' ? 'الدافع / العميل' : 'المستفيد / المورد'}</th>
                      <th className="py-3 px-4">طريقة الدفع</th>
                      <th className="py-3 px-4 text-left">المبلغ الإجمالي</th>
                      <th className="py-3 px-4 text-left">الرصيد غير المخصص</th>
                      <th className="py-3 px-4 text-center">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredVouchers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-500">
                          لا توجد سندات مسجلة مطابقة للبحث
                        </td>
                      </tr>
                    ) : (
                      filteredVouchers.map((v) => (
                        <tr key={v.id} className="hover:bg-slate-50 transition">
                          <td className="py-3 px-4 font-mono font-semibold text-emerald-600">
                            {v.voucherNumber}
                          </td>
                          <td className="py-3 px-4 text-slate-500 text-xs font-mono">
                            {new Date(v.voucherDate).toLocaleDateString('ar-SA')}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-800">
                            {v.payerName || v.beneficiaryName || '-'}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-500">
                            {v.paymentMethod}
                          </td>
                          <td className="py-3 px-4 text-left font-mono font-bold text-slate-900">
                            {parseFloat(v.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} SAR
                          </td>
                          <td className="py-3 px-4 text-left font-mono font-semibold text-blue-600">
                            {parseFloat(v.unallocatedAmount || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })} SAR
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-medium">
                              {v.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================== */}
        {/* TAB 4: VAULTS & BANKS (FINANCIAL RESOURCES) */}
        {/* ================================================================== */}
        {activeTab === 'vaults_banks' && (
          <FinancialResourcesView
            legalEntityId={legalEntityId}
            theme={theme}
            flatAccounts={flatAccounts}
          />
        )}

        {/* ================================================================== */}
        {/* TAB 4B: POS SHIFT CLOSING & CASH RECONCILIATION */}
        {/* ================================================================== */}
        {activeTab === 'shifts' && (
          <PosShiftClosingView
            legalEntityId={legalEntityId}
            theme={theme}
            defaultBranchId={activeBranch?.id || ''}
          />
        )}

        {activeTab === 'settlements' && (
          <SettlementsView
            legalEntityId={legalEntityId}
            theme={theme}
            defaultBranchId={activeBranch?.id || ''}
          />
        )}

        {/* ================================================================== */}
        {/* TAB 5: CENTRAL ACCOUNT MAPPINGS & BRANCH OVERRIDES */}
        {/* ================================================================== */}
        {activeTab === 'mappings' && (
          <AccountMappingView
            legalEntityId={legalEntityId}
            theme={theme}
            flatAccounts={flatAccounts}
          />
        )}

        {/* ================================================================== */}
        {/* TAB 5: FINANCIAL & STATUTORY REPORTS */}
        {/* ================================================================== */}
        {activeTab === 'reports' && (
          <div className="flex flex-col gap-6">
            {/* Report Sub Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              {[
                { id: 'trial_balance', label: 'ميزان المراجعة (Trial Balance)' },
                { id: 'income_statement', label: 'قائمة الدخل (P&L)' },
                { id: 'balance_sheet', label: 'الميزانية العمومية (Balance Sheet)' },
                { id: 'vat_return', label: 'إقرار ضريبة القيمة المضافة (ZATCA VAT)' },
              ].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReportSubTab(r.id as any)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition ${
                    reportSubTab === r.id
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Trial Balance Report */}
            {reportSubTab === 'trial_balance' && (
              <div className={`p-5 rounded-xl border shadow-sm ${'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                  <div>
                    <h4 className="font-bold text-base">ميزان المراجعة بالأرصدة والمجاميع</h4>
                    <p className="text-xs text-slate-400 mt-0.5">مطابقة تامة لإجمالي المدين مع إجمالي الدائن</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {trialBalanceData && (
                      <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                        trialBalanceData.isBalanced ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'
                      }`}>
                        {trialBalanceData.isBalanced ? 'الميزان متوازن 100%' : 'يوجد فرق في الميزان'}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={!trialBalanceData?.accounts?.length}
                      onClick={() =>
                        exportToCsv(
                          `trial-balance-${new Date().toISOString().slice(0, 10)}.csv`,
                          (trialBalanceData?.accounts || []).map((acc: any) => ({
                            accountCode: acc.accountCode,
                            accountName: acc.accountName || acc.nameAr || acc.name || acc.nameEn || '-',
                            totalDebit: parseFloat(acc.totalDebit || '0').toFixed(2),
                            totalCredit: parseFloat(acc.totalCredit || '0').toFixed(2),
                            netBalance: parseFloat(acc.netBalance || '0').toFixed(2),
                          })),
                          [
                            { key: 'accountCode', header: 'رمز الحساب' },
                            { key: 'accountName', header: 'اسم الحساب' },
                            { key: 'totalDebit', header: 'مجموع المدين' },
                            { key: 'totalCredit', header: 'مجموع الدائن' },
                            { key: 'netBalance', header: 'صافي الرصيد' },
                          ]
                        )
                      }
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>تصدير CSV</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs font-mono">
                    <thead className={`font-semibold ${'bg-slate-100 text-slate-600'}`}>
                      <tr>
                        <th className="py-2.5 px-3">رمز الحساب</th>
                        <th className="py-2.5 px-3 font-sans">اسم الحساب</th>
                        <th className="py-2.5 px-3 text-left">مجموع المدين</th>
                        <th className="py-2.5 px-3 text-left">مجموع الدائن</th>
                        <th className="py-2.5 px-3 text-left">صافي الرصيد</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {trialBalanceData?.accounts?.map((acc: any) => (
                        <tr key={acc.accountId} className="hover:bg-slate-50">
                          <td className="py-2 px-3 text-emerald-500 font-semibold">{acc.accountCode}</td>
                          <td className="py-2 px-3 font-sans text-slate-700">
                            {acc.accountName || acc.nameAr || acc.name || acc.nameEn || '-'}
                          </td>
                          <td className="py-2 px-3 text-left">{parseFloat(acc.totalDebit).toFixed(2)}</td>
                          <td className="py-2 px-3 text-left">{parseFloat(acc.totalCredit).toFixed(2)}</td>
                          <td className="py-2 px-3 text-left font-bold">{parseFloat(acc.netBalance).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="font-bold border-t-2 border-slate-300 bg-slate-100">
                      <tr>
                        <td colSpan={2} className="py-3 px-3 font-sans">الإجمالي العام للميزان:</td>
                        <td className="py-3 px-3 text-left text-emerald-500">
                          {parseFloat(trialBalanceData?.grandDebitTotal || trialBalanceData?.totalDebit || '0').toFixed(2)} SAR
                        </td>
                        <td className="py-3 px-3 text-left text-emerald-500">
                          {parseFloat(trialBalanceData?.grandCreditTotal || trialBalanceData?.totalCredit || '0').toFixed(2)} SAR
                        </td>
                        <td className="py-3 px-3 text-left">
                          {parseFloat(trialBalanceData?.discrepancy || trialBalanceData?.difference || '0').toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Income Statement Report */}
            {reportSubTab === 'income_statement' && (
              <div className={`p-5 rounded-xl border shadow-sm ${'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                  <h4 className="font-bold text-base">
                    قائمة الأرباح والخسائر (Income Statement)
                  </h4>
                  <button
                    type="button"
                    disabled={!incomeStatementData}
                    onClick={() =>
                      exportToCsv(
                        `income-statement-${new Date().toISOString().slice(0, 10)}.csv`,
                        [
                          { item: 'إجمالي الإيرادات (Revenues)', amount: parseFloat(incomeStatementData?.revenues?.total || '0').toFixed(2) },
                          { item: 'تكلفة البضاعة المباعة (COGS)', amount: parseFloat(incomeStatementData?.cogs?.total || '0').toFixed(2) },
                          { item: 'المصروفات التشغيلية (Expenses)', amount: parseFloat(incomeStatementData?.expenses?.total || '0').toFixed(2) },
                          { item: 'صافي الدخل التشغيلي (Net Profit)', amount: parseFloat(incomeStatementData?.netIncome || '0').toFixed(2) },
                        ],
                        [
                          { key: 'item', header: 'البند' },
                          { key: 'amount', header: 'المبلغ (SAR)' },
                        ]
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تصدير CSV</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <p className="text-xs text-slate-500">إجمالي الإيرادات</p>
                    <p className="text-xl font-bold font-mono text-emerald-600 mt-1">
                      {parseFloat(incomeStatementData?.revenues?.total || '0').toFixed(2)} SAR
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <p className="text-xs text-slate-500">المصروفات والتكلفة التشغيلية</p>
                    <p className="text-xl font-bold font-mono text-amber-600 mt-1">
                      {(parseFloat(incomeStatementData?.cogs?.total || '0') + parseFloat(incomeStatementData?.expenses?.total || '0')).toFixed(2)} SAR
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                    <p className="text-xs text-slate-500">صافي الدخل التشغيلي (Net Profit)</p>
                    <p className="text-xl font-bold font-mono text-blue-600 mt-1">
                      {parseFloat(incomeStatementData?.netIncome || '0').toFixed(2)} SAR
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Balance Sheet */}
            {reportSubTab === 'balance_sheet' && (
              <div className={`p-5 rounded-xl border shadow-sm ${'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                  <h4 className="font-bold text-base">
                    الميزانية العمومية والمركز المالي (Balance Sheet)
                  </h4>
                  <button
                    type="button"
                    disabled={!balanceSheetData}
                    onClick={() =>
                      exportToCsv(
                        `balance-sheet-${new Date().toISOString().slice(0, 10)}.csv`,
                        [
                          { item: 'إجمالي الأصول (Assets)', amount: parseFloat(balanceSheetData?.assets?.total || '0').toFixed(2) },
                          { item: 'إجمالي الالتزامات (Liabilities)', amount: parseFloat(balanceSheetData?.liabilities?.total || '0').toFixed(2) },
                          { item: 'حقوق الملكية (Equity)', amount: parseFloat(balanceSheetData?.equity?.total || '0').toFixed(2) },
                        ],
                        [
                          { key: 'item', header: 'البند' },
                          { key: 'amount', header: 'المبلغ (SAR)' },
                        ]
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تصدير CSV</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                    <p className="text-xs text-slate-500">إجمالي الأصول (Assets)</p>
                    <p className="text-xl font-bold font-mono text-blue-600 mt-1">
                      {parseFloat(balanceSheetData?.assets?.total || '0').toFixed(2)} SAR
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <p className="text-xs text-slate-500">إجمالي الالتزامات (Liabilities)</p>
                    <p className="text-xl font-bold font-mono text-amber-600 mt-1">
                      {parseFloat(balanceSheetData?.liabilities?.total || '0').toFixed(2)} SAR
                    </p>
                  </div>
                  <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                    <p className="text-xs text-slate-500">حقوق الملكية (Equity)</p>
                    <p className="text-xl font-bold font-mono text-blue-800 mt-1">
                      {parseFloat(balanceSheetData?.equity?.total || '0').toFixed(2)} SAR
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* VAT Return */}
            {reportSubTab === 'vat_return' && (
              <div className={`p-5 rounded-xl border shadow-sm ${'bg-white border-slate-200'}`}>
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                  <h4 className="font-bold text-base">
                    إقرار ضريبة القيمة المضافة لهيئة الزكاة والضريبة والجمارك (ZATCA VAT Return 15%)
                  </h4>
                  <button
                    type="button"
                    disabled={!vatReturnData}
                    onClick={() =>
                      exportToCsv(
                        `vat-return-${new Date().toISOString().slice(0, 10)}.csv`,
                        [
                          { item: 'ضريبة المخرجات للمبيعات (Output VAT 15%)', amount: parseFloat(vatReturnData?.totalOutputVat || '0').toFixed(2) },
                          { item: 'ضريبة المدخلات للمشتريات (Input VAT 15%)', amount: parseFloat(vatReturnData?.totalInputVat || '0').toFixed(2) },
                          { item: 'صافي الضريبة المستحقة للسداد (Net VAT Payable/Refund)', amount: parseFloat(vatReturnData?.netVatPayableOrRefund || '0').toFixed(2) },
                        ],
                        [
                          { key: 'item', header: 'البند' },
                          { key: 'amount', header: 'المبلغ (SAR)' },
                        ]
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>تصدير CSV</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl border border-slate-200">
                    <p className="text-xs text-slate-500">ضريبة المخرجات للمبيعات (15%)</p>
                    <p className="text-xl font-bold font-mono text-red-500 mt-1">
                      {parseFloat(vatReturnData?.totalOutputVat || '0').toFixed(2)} SAR
                    </p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200">
                    <p className="text-xs text-slate-500">ضريبة المدخلات للمشتريات (15%)</p>
                    <p className="text-xl font-bold font-mono text-emerald-500 mt-1">
                      {parseFloat(vatReturnData?.totalInputVat || '0').toFixed(2)} SAR
                    </p>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                    <p className="text-xs text-slate-500">صافي الضريبة المستحقة للسداد</p>
                    <p className="text-xl font-bold font-mono text-slate-900 mt-1">
                      {parseFloat(vatReturnData?.netVatPayableOrRefund || '0').toFixed(2)} SAR
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* DRAWER: MULTI-LINE JOURNAL ENTRY EDITOR */}
      {/* ================================================================== */}
      {isJournalDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div
            className={`w-full max-w-5xl rounded-2xl border shadow-2xl flex flex-col max-h-[92vh] overflow-hidden ${
              'bg-white border-slate-200 text-slate-900'
            }`}
          >
            {/* Drawer Header */}
            <div className={`p-4 border-b flex items-center justify-between ${'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-emerald-500" />
                <h3 className="font-bold text-base">
                  {editingJournalId
                    ? `تعديل مسودة القيد المحاسبي #${journalForm.journalNumber}`
                    : 'محرر قيود اليومية المركبة متعددة الأسطر (Multi-Line Journal Entry)'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsJournalDrawerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-700/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="p-6 overflow-y-auto flex flex-col gap-6">
              {/* Inline Error Banner */}
              {journalModalError && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{journalModalError}</span>
                </div>
              )}
              {/* Header Fields Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">رقم القيد:</label>
                  <input
                    type="text"
                    value={journalForm.journalNumber}
                    onChange={(e) => setJournalForm({ ...journalForm, journalNumber: e.target.value })}
                    className={`w-full px-3 py-2 text-xs font-mono rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      'bg-slate-50 border-slate-200 text-slate-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">تاريخ القيد:</label>
                  <input
                    type="date"
                    value={journalForm.entryDate}
                    onChange={(e) => setJournalForm({ ...journalForm, entryDate: e.target.value })}
                    className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      'bg-slate-50 border-slate-200 text-slate-900'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">نوع القيد:</label>
                  <select
                    value={journalForm.journalType}
                    onChange={(e) => setJournalForm({ ...journalForm, journalType: e.target.value })}
                    className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      'bg-slate-50 border-slate-200 text-slate-900'
                    }`}
                  >
                    <option value="GENERAL">عام (GENERAL)</option>
                    <option value="ADJUSTMENT">تسوية (ADJUSTMENT)</option>
                    <option value="OPENING">افتتاحي (OPENING)</option>
                    <option value="CLOSING">إقفال (CLOSING)</option>
                    <option value="SALES">مبيعات (SALES)</option>
                    <option value="PURCHASES">مشتريات (PURCHASES)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">الفرع المالي:</label>
                  <input
                    type="text"
                    disabled
                    value={activeBranch?.name || 'الفرع الرئيسي'}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 text-slate-600"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-xs font-semibold mb-1 text-slate-500">البيان العام للقيد:</label>
                  <input
                    type="text"
                    value={journalForm.description}
                    onChange={(e) => setJournalForm({ ...journalForm, description: e.target.value })}
                    placeholder="شرح وتوضيح العملية المحاسبية..."
                    className={`w-full px-3 py-2 text-xs rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                      'bg-slate-50 border-slate-200 text-slate-900'
                    }`}
                  />
                </div>
              </div>

              {/* Multi-Line Table */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-emerald-500" />
                    <span>أسطر وبنود القيد المحاسبي ({journalForm.lines.length})</span>
                  </h4>
                  <button
                    type="button"
                    onClick={() => handleAddJournalLine(false)}
                    className="flex items-center gap-1.5 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-500 text-xs px-3 py-1.5 rounded-lg border border-emerald-500/20 font-semibold transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة سطر جديد (Ctrl+Enter)</span>
                  </button>
                </div>

                <div className="rounded-xl border overflow-x-auto border-slate-200 bg-slate-50/50">
                  <table className="w-full text-right text-xs">
                    <thead className={`font-semibold border-b ${'bg-slate-100 border-slate-200 text-slate-600'}`}>
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">#</th>
                        <th className="py-2.5 px-3 w-64">الحساب المحاسبي</th>
                        <th className="py-2.5 px-3">البيان الخاص بالسطر</th>
                        <th className="py-2.5 px-3 w-48">الطرف التجاري</th>
                        <th className="py-2.5 px-3 w-32 text-left">مدين (SAR)</th>
                        <th className="py-2.5 px-3 w-32 text-left">دائن (SAR)</th>
                        <th className="py-2.5 px-3 w-20 text-center">إجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {journalForm.lines.map((line, idx) => {
                        const isControlAcc = line.accountCode === '113000' || line.accountCode === '211000';
                        return (
                          <tr key={line.id} className="hover:bg-slate-50 transition">
                            <td className="py-2.5 px-3 text-center text-slate-500 font-mono">{idx + 1}</td>
                            <td className="py-2.5 px-3">
                              <select
                                id={`line-account-${idx}`}
                                value={line.accountId}
                                onChange={(e) => handleLineAccountChange(idx, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, 'account', idx)}
                                className={`w-full px-2.5 py-1.5 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                                  !line.isPostable
                                    ? 'border-amber-500 bg-amber-50'
                                    : 'bg-white border-slate-300 text-slate-900'
                                }`}
                              >
                                <option value="">-- اختر الحساب --</option>
                                {flatAccounts
                                  .filter((a) => a.isPostable && (!a.children || a.children.length === 0))
                                  .map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.accountCode} - {a.nameAr || a.name}
                                    </option>
                                  ))}
                              </select>
                            </td>

                            <td className="py-2.5 px-3">
                              <input
                                id={`line-desc-${idx}`}
                                type="text"
                                value={line.description}
                                onKeyDown={(e) => handleKeyDown(e, 'desc', idx)}
                                onChange={(e) => {
                                  const updated = [...journalForm.lines];
                                  updated[idx].description = e.target.value;
                                  setJournalForm({ ...journalForm, lines: updated });
                                }}
                                placeholder="بيان السطر..."
                                className="w-full px-2.5 py-1.5 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white border-slate-300 text-slate-900"
                              />
                            </td>

                            <td className="py-2.5 px-3">
                              {isControlAcc ? (
                                <select
                                  id={`line-partner-${idx}`}
                                  value={line.partnerId}
                                  onKeyDown={(e) => handleKeyDown(e, 'partner', idx)}
                                  onChange={(e) => {
                                    const updated = [...journalForm.lines];
                                    updated[idx].partnerId = e.target.value;
                                    setJournalForm({ ...journalForm, lines: updated });
                                  }}
                                  className="w-full px-2.5 py-1.5 rounded-lg border border-blue-500/50 bg-blue-500/10 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                                >
                                  <option value="">-- اختر الطرف التجاري --</option>
                                  {partners.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.partnerNumber} - {p.legalNameAr}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-slate-500 text-[11px] block text-center">-</span>
                              )}
                            </td>

                            <td className="py-2.5 px-3">
                              <input
                                id={`line-debit-${idx}`}
                                type="text"
                                inputMode="decimal"
                                placeholder=""
                                value={line.debit || ''}
                                onKeyDown={(e) => handleKeyDown(e, 'debit', idx)}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/[^0-9.]/g, '');
                                  const updated = [...journalForm.lines];
                                  updated[idx].debit = val;
                                  if (val && parseFloat(val) > 0) {
                                    updated[idx].credit = '';
                                  }
                                  setJournalForm({ ...journalForm, lines: updated });
                                }}
                                className={`w-full text-left font-mono font-semibold px-2.5 py-1.5 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                                  line.debit && parseFloat(line.debit) > 0 ? 'border-emerald-500 text-emerald-500 font-bold bg-emerald-500/5' : ''
                                } bg-white border-slate-300 text-slate-900`}
                              />
                            </td>

                            <td className="py-2.5 px-3">
                              <input
                                id={`line-credit-${idx}`}
                                type="text"
                                inputMode="decimal"
                                placeholder=""
                                value={line.credit || ''}
                                onKeyDown={(e) => handleKeyDown(e, 'credit', idx)}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/[^0-9.]/g, '');
                                  const updated = [...journalForm.lines];
                                  updated[idx].credit = val;
                                  if (val && parseFloat(val) > 0) {
                                    updated[idx].debit = '';
                                  }
                                  setJournalForm({ ...journalForm, lines: updated });
                                }}
                                className={`w-full text-left font-mono font-semibold px-2.5 py-1.5 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                                  line.credit && parseFloat(line.credit) > 0 ? 'border-emerald-500 text-emerald-500 font-bold bg-emerald-500/5' : ''
                                } bg-white border-slate-300 text-slate-900`}
                              />
                            </td>

                            <td className="py-2.5 px-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  type="button"
                                  title="نسخ السطر"
                                  onClick={() => handleDuplicateLine(idx)}
                                  className="p-1 text-slate-400 hover:text-slate-200"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  title="حذف السطر"
                                  onClick={() => handleDeleteLine(idx)}
                                  className="p-1 text-slate-400 hover:text-red-500"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Balance Summary Box */}
              <div
                className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-4 font-mono ${
                  journalTotals.isBalanced
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-500'
                }`}
              >
                <div className="flex items-center gap-6">
                  <div>
                    <span className="text-xs text-slate-400 font-sans block">إجمالي المدين:</span>
                    <span className="text-base font-bold font-mono">
                      {journalTotals.debit.toFixed(2)} SAR
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 font-sans block">إجمالي الدائن:</span>
                    <span className="text-base font-bold font-mono">
                      {journalTotals.credit.toFixed(2)} SAR
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400 font-sans block">الفرق (Discrepancy):</span>
                    <span className="text-base font-bold font-mono">
                      {journalTotals.diff.toFixed(2)} SAR
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 font-sans font-bold text-sm">
                  {journalTotals.isBalanced ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      <span>القيد متوازن وجاهز للترحيل</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-5 h-5 text-amber-500" />
                      <span>القيد غير متوازن بمبلغ {journalTotals.diff.toFixed(2)} SAR</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Drawer Footer Actions */}
            <div className={`p-4 border-t flex items-center justify-between gap-4 ${'border-slate-200 bg-slate-50'}`}>
              <button
                type="button"
                onClick={() => setIsJournalDrawerOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-200 transition"
              >
                إلغاء
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleSaveJournal('DRAFT')}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border border-blue-500/30 text-blue-500 hover:bg-blue-500/10 transition"
                >
                  {editingJournalId ? 'حفظ تعديلات المسودة' : 'حفظ كمسودة (Save Draft)'}
                </button>

                <button
                  type="button"
                  disabled={!isPostingEligible}
                  onClick={() => handleSaveJournal('POSTED')}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white transition shadow-lg ${
                    isPostingEligible
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
                      : 'bg-slate-700 cursor-not-allowed opacity-50'
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>ترحيل القيد النهائي (Post Entry)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: ACCOUNT ADD / EDIT */}
      {/* ================================================================== */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div
            className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl flex flex-col gap-4 ${
              'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
              <h4 className="font-bold text-base flex items-center gap-2">
                <FolderTree className="w-5 h-5 text-emerald-500" />
                <span>{editingAccount ? 'تعديل بيانات الحساب' : 'إضافة حساب مالي جديد'}</span>
              </h4>
              <button type="button" onClick={() => setIsAccountModalOpen(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Inline Error Alert Banner */}
            {accountModalError && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{accountModalError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold mb-1 text-slate-500">رمز الحساب (Code):</label>
                <input
                  type="text"
                  disabled={!!editingAccount}
                  value={accountForm.accountCode}
                  onChange={(e) => setAccountForm({ ...accountForm, accountCode: e.target.value })}
                  placeholder="مثال: 111105"
                  className={`w-full px-3 py-2 font-mono rounded-xl border focus:outline-none ${
                    'bg-slate-50 border-slate-200'
                  }`}
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-500">الحساب الأب (Parent):</label>
                <select
                  value={accountForm.parentId || ''}
                  onChange={(e) => handleParentChange(e.target.value || null)}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="">-- بدون حساب أب (حساب جذر) --</option>
                  {flatAccounts
                    .filter((a) => !editingAccount || a.id !== editingAccount.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountCode} - {a.nameAr}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-500">اسم الحساب بالعربية (إلزامي):</label>
                <input
                  type="text"
                  value={accountForm.nameAr}
                  onChange={(e) => setAccountForm({ ...accountForm, nameAr: e.target.value })}
                  placeholder="اسم الحساب الرسمي بالعربية..."
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    'bg-slate-50 border-slate-200'
                  }`}
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-500">اسم الحساب بالإنجليزية (اختياري):</label>
                <input
                  type="text"
                  value={accountForm.nameEn}
                  onChange={(e) => setAccountForm({ ...accountForm, nameEn: e.target.value })}
                  placeholder="Official Account Name (EN)..."
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    'bg-slate-50 border-slate-200'
                  }`}
                />
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-500">
                  نوع الحساب {accountForm.parentId ? '(موروث من الأب)' : ''}:
                </label>
                <select
                  value={accountForm.accountType}
                  disabled={Boolean(accountForm.parentId)}
                  onChange={(e) => {
                    const newType = e.target.value as any;
                    setAccountForm({ ...accountForm, accountType: newType });
                    if (!accountForm.parentId) {
                      handleParentChange(null);
                    }
                  }}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed ${
                    'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="ASSET">أصول (ASSET)</option>
                  <option value="LIABILITY">التزامات (LIABILITY)</option>
                  <option value="EQUITY">حقوق ملكية (EQUITY)</option>
                  <option value="REVENUE">إيرادات (REVENUE)</option>
                  <option value="COGS">تكلفة مبيعات (COGS)</option>
                  <option value="EXPENSE">مصروفات (EXPENSE)</option>
                </select>
                {accountForm.parentId && (
                  <p className="text-[10px] text-[#0D6E4F] mt-1">موروث إجبارياً من الحساب الأب لضمان تماسك الدليل</p>
                )}
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-500">الطبيعة المحاسبية:</label>
                <select
                  value={accountForm.normalBalance}
                  disabled={true}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none opacity-80 cursor-not-allowed ${
                    'bg-slate-50 border-slate-200'
                  }`}
                >
                  <option value="DEBIT">مدين (DEBIT)</option>
                  <option value="CREDIT">دائن (CREDIT)</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  {isContra ? 'طبيعة معاكسة (حساب مقابل)' : 'طبيعة قياسية موروثة'}
                </p>
              </div>

              {/* Contra Account Toggle */}
              <div className="col-span-2 flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50">
                <div>
                  <span className="block font-bold">حساب مقابل (Contra Account)</span>
                  <span className="text-slate-400 text-[11px]">
                    يعكس الطبيعة المحاسبية (مثل: مجمع الإهلاك تحت الأصول، أو مردودات المبيعات تحت الإيرادات)
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={isContra}
                  onChange={(e) => handleToggleContra(e.target.checked)}
                  className="w-4 h-4 accent-amber-500"
                />
              </div>

              <div className="col-span-2 flex items-center justify-between p-3 rounded-xl border border-slate-700/50">
                <div>
                  <span className="block font-bold">قابلية الترحيل (Postable)</span>
                  <span className="text-slate-400 text-[11px]">إذا كان مفعلاً يمكن تسجيل القيود عليه، وإلا يعتبر حساب تجميعي</span>
                </div>
                <input
                  type="checkbox"
                  checked={accountForm.isPostable}
                  onChange={(e) => setAccountForm({ ...accountForm, isPostable: e.target.checked })}
                  className="w-4 h-4 accent-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-700/50">
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveAccount}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30"
              >
                حفظ بيانات الحساب
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: REVERSE JOURNAL ENTRY */}
      {/* ================================================================== */}
      {isReversalModalOpen && reversalTargetEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl flex flex-col gap-4 ${
              'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
              <h4 className="font-bold text-base flex items-center gap-2 text-amber-500">
                <Undo2 className="w-5 h-5" />
                <span>عكس القيد المحاسبي #{reversalTargetEntry.journalNumber}</span>
              </h4>
              <button type="button" onClick={() => setIsReversalModalOpen(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Inline Error Alert Banner */}
            {reversalModalError && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{reversalModalError}</span>
              </div>
            )}

            <p className="text-xs text-slate-400">
              سيقوم النظام بإنشاء قيد عكسي تلقائي معكوس الأطراف (المدين دائناً والدائن مديناً) وتغيير حالة القيد الأصلي إلى معكوس (REVERSED) لمنع التعديل أو التكرار.
            </p>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-500">سبب العكس المحاسبي (إلزامي للتدقيق):</label>
              <textarea
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="توضيح سبب إلغاء القيد والتسوية..."
                rows={3}
                className={`w-full p-2.5 text-xs rounded-xl border focus:outline-none ${
                  'bg-slate-50 border-slate-200 text-slate-900'
                }`}
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-700/50">
              <button
                type="button"
                onClick={() => setIsReversalModalOpen(false)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleReverseJournal}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/30"
              >
                تأكيد ترحيل القيد العكسي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* MODAL: INTER-BANK & VAULT TRANSFER */}
      {/* ================================================================== */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div
            className={`w-full max-w-lg rounded-2xl border p-6 shadow-2xl flex flex-col gap-4 ${
              'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/50">
              <h4 className="font-bold text-base flex items-center gap-2 text-blue-500">
                <ArrowRightLeft className="w-5 h-5" />
                <span>تحويل نقدي بين الحسابات والخزائن</span>
              </h4>
              <button type="button" onClick={() => setIsTransferModalOpen(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Inline Error Alert Banner */}
            {transferModalError && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{transferModalError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs">
              {/* Source */}
              <div>
                <label className="block font-semibold mb-1 text-slate-500">نوع المصدر:</label>
                <select
                  value={transferForm.sourceType}
                  onChange={(e) => setTransferForm({ ...transferForm, sourceType: e.target.value as any, sourceId: '' })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${'bg-slate-50 border-slate-200'}`}
                >
                  <option value="BANK">حساب بنكي</option>
                  <option value="VAULT">خزينة / صندوق</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-500">المصدر:</label>
                <select
                  value={transferForm.sourceId}
                  onChange={(e) => setTransferForm({ ...transferForm, sourceId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${'bg-slate-50 border-slate-200'}`}
                >
                  <option value="">-- اختر المصدر --</option>
                  {transferForm.sourceType === 'BANK'
                    ? banks
                        .filter((b) => {
                          if (!transferForm.destinationId) return true;
                          if (transferForm.destinationType === 'BANK' && b.id === transferForm.destinationId) return false;
                          const destAccId = transferForm.destinationType === 'BANK'
                            ? banks.find((item) => item.id === transferForm.destinationId)?.accountId
                            : vaults.find((item) => item.id === transferForm.destinationId)?.accountId;
                          if (destAccId && b.accountId === destAccId) return false;
                          return true;
                        })
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.bankName} ({parseFloat(b.balance).toFixed(2)} SAR)
                          </option>
                        ))
                    : vaults
                        .filter((v) => {
                          if (!transferForm.destinationId) return true;
                          if (transferForm.destinationType === 'VAULT' && v.id === transferForm.destinationId) return false;
                          const destAccId = transferForm.destinationType === 'BANK'
                            ? banks.find((item) => item.id === transferForm.destinationId)?.accountId
                            : vaults.find((item) => item.id === transferForm.destinationId)?.accountId;
                          if (destAccId && v.accountId === destAccId) return false;
                          return true;
                        })
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.nameAr} ({parseFloat(v.balance).toFixed(2)} SAR)
                          </option>
                        ))}
                </select>
              </div>

              {/* Destination */}
              <div>
                <label className="block font-semibold mb-1 text-slate-500">نوع الوجهة:</label>
                <select
                  value={transferForm.destinationType}
                  onChange={(e) => setTransferForm({ ...transferForm, destinationType: e.target.value as any, destinationId: '' })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${'bg-slate-50 border-slate-200'}`}
                >
                  <option value="VAULT">خزينة / صندوق</option>
                  <option value="BANK">حساب بنكي</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1 text-slate-500">الوجهة المستلمة:</label>
                <select
                  value={transferForm.destinationId}
                  onChange={(e) => setTransferForm({ ...transferForm, destinationId: e.target.value })}
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${'bg-slate-50 border-slate-200'}`}
                >
                  <option value="">-- اختر الوجهة --</option>
                  {transferForm.destinationType === 'BANK'
                    ? banks
                        .filter((b) => {
                          if (!transferForm.sourceId) return true;
                          if (transferForm.sourceType === 'BANK' && b.id === transferForm.sourceId) return false;
                          const srcAccId = transferForm.sourceType === 'BANK'
                            ? banks.find((item) => item.id === transferForm.sourceId)?.accountId
                            : vaults.find((item) => item.id === transferForm.sourceId)?.accountId;
                          if (srcAccId && b.accountId === srcAccId) return false;
                          return true;
                        })
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.bankName} ({parseFloat(b.balance).toFixed(2)} SAR)
                          </option>
                        ))
                    : vaults
                        .filter((v) => {
                          if (!transferForm.sourceId) return true;
                          if (transferForm.sourceType === 'VAULT' && v.id === transferForm.sourceId) return false;
                          const srcAccId = transferForm.sourceType === 'BANK'
                            ? banks.find((item) => item.id === transferForm.sourceId)?.accountId
                            : vaults.find((item) => item.id === transferForm.sourceId)?.accountId;
                          if (srcAccId && v.accountId === srcAccId) return false;
                          return true;
                        })
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.nameAr} ({parseFloat(v.balance).toFixed(2)} SAR)
                          </option>
                        ))}
                </select>
              </div>

              {/* Same Account Warning Banner */}
              {(() => {
                const srcAccId =
                  transferForm.sourceType === 'BANK'
                    ? banks.find((b) => b.id === transferForm.sourceId)?.accountId
                    : vaults.find((v) => v.id === transferForm.sourceId)?.accountId;
                const destAccId =
                  transferForm.destinationType === 'BANK'
                    ? banks.find((b) => b.id === transferForm.destinationId)?.accountId
                    : vaults.find((v) => v.id === transferForm.destinationId)?.accountId;
                const isSame =
                  (Boolean(transferForm.sourceId) &&
                    Boolean(transferForm.destinationId) &&
                    transferForm.sourceType === transferForm.destinationType &&
                    transferForm.sourceId === transferForm.destinationId) ||
                  Boolean(srcAccId && destAccId && srcAccId === destAccId);

                if (!isSame) return null;

                return (
                  <div className="col-span-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-xs flex items-center gap-2 font-medium">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>لا يمكن التحويل من الحساب إلى نفسه. اختر حسابًا آخر كوجهة</span>
                  </div>
                );
              })()}

              {/* Amount & Notes */}
              <div className="col-span-2">
                <label className="block font-semibold mb-1 text-slate-500">مبلغ التحويل (SAR):</label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  value={transferForm.amount}
                  onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
                  placeholder="0.00"
                  className={`w-full px-3 py-2 font-mono font-bold text-sm rounded-xl border focus:outline-none ${
                    'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
              </div>

              <div className="col-span-2">
                <label className="block font-semibold mb-1 text-slate-500">ملاحظات التحويل والبيان:</label>
                <input
                  type="text"
                  value={transferForm.notes}
                  onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
                  placeholder="مثال: تغذية عهدة الصندوق أو إيداع إيرادات..."
                  className={`w-full px-3 py-2 rounded-xl border focus:outline-none ${
                    'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-700/50">
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-white"
              >
                إلغاء
              </button>
              {(() => {
                const srcAccId =
                  transferForm.sourceType === 'BANK'
                    ? banks.find((b) => b.id === transferForm.sourceId)?.accountId
                    : vaults.find((v) => v.id === transferForm.sourceId)?.accountId;
                const destAccId =
                  transferForm.destinationType === 'BANK'
                    ? banks.find((b) => b.id === transferForm.destinationId)?.accountId
                    : vaults.find((v) => v.id === transferForm.destinationId)?.accountId;
                const isSame =
                  (Boolean(transferForm.sourceId) &&
                    Boolean(transferForm.destinationId) &&
                    transferForm.sourceType === transferForm.destinationType &&
                    transferForm.sourceId === transferForm.destinationId) ||
                  Boolean(srcAccId && destAccId && srcAccId === destAccId);
                const isInvalid = isSame || !transferForm.sourceId || !transferForm.destinationId || !transferForm.amount || parseFloat(transferForm.amount) <= 0;

                return (
                  <button
                    type="button"
                    disabled={isInvalid}
                    onClick={handleExecuteTransfer}
                    className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${
                      isInvalid
                        ? 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-60'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30'
                    }`}
                  >
                    تأكيد التحويل وترحيل القيد
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default AccountingView;
