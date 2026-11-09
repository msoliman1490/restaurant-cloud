import React, { useState } from 'react';
import {
  BookOpen,
  Scale,
  Plus,
  CheckCircle2,
  FileSpreadsheet,
  Wallet,
  Landmark,
  Receipt,
  ArrowUpDown,
  ShieldCheck,
  PieChart,
  TrendingUp,
  RefreshCw,
  FolderTree,
  FileText,
} from 'lucide-react';

interface AccountNode {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COGS' | 'EXPENSE' | 'OTHER_INCOME' | 'OTHER_EXPENSE';
  balance: number;
  currency: string;
  parentId?: string | null;
  isPostable: boolean;
  level: number;
}

interface JournalLine {
  id: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

interface JournalEntry {
  id: string;
  entryNumber: string;
  date: string;
  legalEntity: string;
  description: string;
  status: 'POSTED' | 'REVERSED';
  totalDebit: number;
  totalCredit: number;
  lines: JournalLine[];
}

interface CashVault {
  id: string;
  code: string;
  nameAr: string;
  branchName: string;
  balance: number;
  status: string;
}

interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  iban: string;
  balance: number;
  currency: string;
  status: string;
}

interface PaymentVoucher {
  id: string;
  voucherNumber: string;
  date: string;
  voucherType: string;
  beneficiaryName: string;
  paymentMethod: string;
  amount: number;
  sourceName: string;
  status: string;
}

interface ReceiptVoucher {
  id: string;
  voucherNumber: string;
  date: string;
  voucherType: string;
  payerName: string;
  paymentMethod: string;
  amount: number;
  destinationName: string;
  status: string;
}

const INITIAL_COA: AccountNode[] = [
  // 1. Assets
  { id: '1', code: '1000', name: 'الأصول المتداولة', nameAr: 'الأصول المتداولة', type: 'ASSET', balance: 541650, currency: 'SAR', isPostable: false, level: 1 },
  { id: '11', code: '1010', name: 'البنك الأهلي السعودي - جاري', nameAr: 'البنك الأهلي السعودي - جاري', type: 'ASSET', balance: 345000, currency: 'SAR', parentId: '1', isPostable: true, level: 2 },
  { id: '12', code: '1020', name: 'الخزينة الرئيسية - الإدارة', nameAr: 'الخزينة الرئيسية - الإدارة', type: 'ASSET', balance: 12450, currency: 'SAR', parentId: '1', isPostable: true, level: 2 },
  { id: '13', code: '1030', name: 'صندوق كاشير فرع العليا', nameAr: 'صندوق كاشير فرع العليا', type: 'ASSET', balance: 5000, currency: 'SAR', parentId: '1', isPostable: true, level: 2 },
  { id: '14', code: '1050', name: 'مخزون المواد الغذائية والأولية', nameAr: 'مخزون المواد الغذائية والأولية', type: 'ASSET', balance: 179200, currency: 'SAR', parentId: '1', isPostable: true, level: 2 },
  // 2. Liabilities
  { id: '2', code: '2000', name: 'الالتزامات المتداولة', nameAr: 'الالتزامات المتداولة', type: 'LIABILITY', balance: 122100, currency: 'SAR', isPostable: false, level: 1 },
  { id: '21', code: '2010', name: 'ذمم الموردين التجارية (AP)', nameAr: 'ذمم الموردين التجارية (AP)', type: 'LIABILITY', balance: 89500, currency: 'SAR', parentId: '2', isPostable: true, level: 2 },
  { id: '22', code: '2050', name: 'ضريبة القيمة المضافة المستحقة (ZATCA)', nameAr: 'ضريبة القيمة المضافة المستحقة (ZATCA)', type: 'LIABILITY', balance: 32600, currency: 'SAR', parentId: '2', isPostable: true, level: 2 },
  // 3. Equity
  { id: '3', code: '3000', name: 'حقوق الملكية', nameAr: 'حقوق الملكية', type: 'EQUITY', balance: 400000, currency: 'SAR', isPostable: false, level: 1 },
  { id: '31', code: '3010', name: 'رأس مال الشركة', nameAr: 'رأس مال الشركة', type: 'EQUITY', balance: 350000, currency: 'SAR', parentId: '3', isPostable: true, level: 2 },
  { id: '32', code: '3020', name: 'الأرباح المبقاة (Retained Earnings)', nameAr: 'الأرباح المبقاة (Retained Earnings)', type: 'EQUITY', balance: 50000, currency: 'SAR', parentId: '3', isPostable: true, level: 2 },
  // 4. Revenues
  { id: '4', code: '4000', name: 'إيرادات المبيعات والتشغيل', nameAr: 'إيرادات المبيعات والتشغيل', type: 'REVENUE', balance: 219550, currency: 'SAR', isPostable: false, level: 1 },
  { id: '41', code: '4010', name: 'مبيعات صالة المطعم (Dine-In)', nameAr: 'مبيعات صالة المطعم (Dine-In)', type: 'REVENUE', balance: 154200, currency: 'SAR', parentId: '4', isPostable: true, level: 2 },
  { id: '42', code: '4020', name: 'مبيعات تطبيقات التوصيل والسفري', nameAr: 'مبيعات تطبيقات التوصيل والسفري', type: 'REVENUE', balance: 65350, currency: 'SAR', parentId: '4', isPostable: true, level: 2 },
  // 5. COGS & Expenses
  { id: '5', code: '5000', name: 'تكلفة المبيعات والمصروفات التشغيلية', nameAr: 'تكلفة المبيعات والمصروفات التشغيلية', type: 'COGS', balance: 100000, currency: 'SAR', isPostable: false, level: 1 },
  { id: '51', code: '5010', name: 'تكلفة الأغذية والمشروبات المباعة (COGS)', nameAr: 'تكلفة الأغذية والمشروبات المباعة (COGS)', type: 'COGS', balance: 98500, currency: 'SAR', parentId: '5', isPostable: true, level: 2 },
  { id: '52', code: '6010', name: 'مصاريف إيجارات الفروع', nameAr: 'مصاريف إيجارات الفروع', type: 'EXPENSE', balance: 15000, currency: 'SAR', parentId: '5', isPostable: true, level: 2 },
  { id: '53', code: '6020', name: 'رواتب وأجور موظفي التشغيل', nameAr: 'رواتب وأجور موظفي التشغيل', type: 'EXPENSE', balance: 45000, currency: 'SAR', parentId: '5', isPostable: true, level: 2 },
];

const INITIAL_JOURNALS: JournalEntry[] = [
  {
    id: 'je-1',
    entryNumber: 'JV-2026-0034',
    date: '2026-11-08',
    legalEntity: 'شركة مطاعم السحاب المحدودة',
    description: 'تسوية استلام مشتريات توريد ألبان ولحوم (PO-0081)',
    status: 'POSTED',
    totalDebit: 4830.0,
    totalCredit: 4830.0,
    lines: [
      { id: 'l1', accountCode: '1050', accountName: 'مخزون المواد الأولية', description: 'إضافة مخزون بسعر التكلفة', debit: 4200.0, credit: 0 },
      { id: 'l2', accountCode: '2050', accountName: 'ضريبة القيمة المضافة للمدخلات', description: 'ضريبة 15%', debit: 630.0, credit: 0 },
      { id: 'l3', accountCode: '2010', accountName: 'حساب المورد - المراعي', description: 'مستحق فاتورة التوريد', debit: 0, credit: 4830.0 },
    ],
  },
  {
    id: 'je-2',
    entryNumber: 'JV-2026-0033',
    date: '2026-11-08',
    legalEntity: 'شركة مطاعم السحاب المحدودة',
    description: 'إثبات مبيعات الوردية الصباحية - فرع العليا',
    status: 'POSTED',
    totalDebit: 14720.0,
    totalCredit: 14720.0,
    lines: [
      { id: 'l4', accountCode: '1010', accountName: 'حساب البنك - نقاط بيع مدى', description: 'تحصيل إلكتروني POS', debit: 12200.0, credit: 0 },
      { id: 'l5', accountCode: '1020', accountName: 'الصندوق - نقد كاش', description: 'تحصيل كاش الوردية', debit: 2520.0, credit: 0 },
      { id: 'l6', accountCode: '4010', accountName: 'إيرادات المبيعات - صالة', description: 'صافي المبيعات بدون ضريبة', debit: 0, credit: 12800.0 },
      { id: 'l7', accountCode: '2050', accountName: 'ضريبة المخرجات المستحقة', description: 'ضريبة 15%', debit: 0, credit: 1920.0 },
    ],
  },
];

const INITIAL_VAULTS: CashVault[] = [
  { id: 'v1', code: 'VLT-01', nameAr: 'خزينة الإدارة العامة (الرئيسية)', branchName: 'المركز الرئيسي', balance: 12450.0, status: 'ACTIVE' },
  { id: 'v2', code: 'VLT-02', nameAr: 'صندوق درج كاشير 1 - فرع العليا', branchName: 'فرع العليا', balance: 5000.0, status: 'ACTIVE' },
  { id: 'v3', code: 'VLT-03', nameAr: 'صندوق درج كاشير 2 - فرع السليمانية', branchName: 'فرع السليمانية', balance: 3500.0, status: 'ACTIVE' },
];

const INITIAL_BANKS: BankAccount[] = [
  { id: 'b1', bankName: 'البنك الأهلي السعودي (SNB)', accountNumber: '1029384756', iban: 'SA0310000001029384756', balance: 345000.0, currency: 'SAR', status: 'ACTIVE' },
  { id: 'b2', bankName: 'مصرف الراجحي (Al Rajhi)', accountNumber: '5566778899', iban: 'SA448000005566778899', balance: 85200.0, currency: 'SAR', status: 'ACTIVE' },
];

const INITIAL_PAYMENTS: PaymentVoucher[] = [
  { id: 'pv1', voucherNumber: 'PV-00102', date: '2026-11-08', voucherType: 'سداد مورد', beneficiaryName: 'شركة المراعي للأغذية', paymentMethod: 'تحويل بنكي', amount: 4830.0, sourceName: 'البنك الأهلي', status: 'POSTED' },
  { id: 'pv2', voucherNumber: 'PV-00103', date: '2026-11-08', voucherType: 'مصروف تشغيلي', beneficiaryName: 'مؤسسة النظافة الشاملة', paymentMethod: 'نقداً كاش', amount: 350.0, sourceName: 'خزينة الإدارة', status: 'POSTED' },
];

const INITIAL_RECEIPTS: ReceiptVoucher[] = [
  { id: 'rv1', voucherNumber: 'RV-00089', date: '2026-11-08', voucherType: 'تحصيل مبيعات', payerName: 'عميل شركات - تموين فنادق', paymentMethod: 'تحويل بنكي', amount: 15400.0, destinationName: 'البنك الأهلي', status: 'POSTED' },
];

export const AccountingView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'coa' | 'journals' | 'vouchers' | 'vaults_banks' | 'reports'>('journals');
  const [coa] = useState<AccountNode[]>(INITIAL_COA);
  const [journals, setJournals] = useState<JournalEntry[]>(INITIAL_JOURNALS);
  const [vaults, setVaults] = useState<CashVault[]>(INITIAL_VAULTS);
  const [banks] = useState<BankAccount[]>(INITIAL_BANKS);
  const [paymentVouchers] = useState<PaymentVoucher[]>(INITIAL_PAYMENTS);
  const [receiptVouchers] = useState<ReceiptVoucher[]>(INITIAL_RECEIPTS);

  // New Journal Entry Modal State
  const [isJvModalOpen, setIsJvModalOpen] = useState(false);
  const [jvNumber, setJvNumber] = useState(`JV-2026-${Math.floor(Math.random() * 9000 + 1000)}`);
  const [jvDescription, setJvDescription] = useState('');
  const [jvDebitAcc, setJvDebitAcc] = useState('1050');
  const [jvCreditAcc, setJvCreditAcc] = useState('2010');
  const [jvAmount, setJvAmount] = useState('1500');

  // Vault Transfer Modal State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [fromVault, setFromVault] = useState('v1');
  const [toVault, setToVault] = useState('v2');
  const [transferAmount, setTransferAmount] = useState('1000');

  // Handle Journal Post
  const handlePostJournal = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(jvAmount);
    if (!amount || amount <= 0) return;

    const debitAccObj = coa.find((a) => a.code === jvDebitAcc);
    const creditAccObj = coa.find((a) => a.code === jvCreditAcc);

    const newEntry: JournalEntry = {
      id: `je-${Date.now()}`,
      entryNumber: jvNumber,
      date: new Date().toISOString().split('T')[0] || '2026-11-08',
      legalEntity: 'شركة مطاعم السحاب المحدودة',
      description: jvDescription || 'قيد محاسبي يدوي متوازن',
      status: 'POSTED',
      totalDebit: amount,
      totalCredit: amount,
      lines: [
        {
          id: `l-${Date.now()}-1`,
          accountCode: jvDebitAcc,
          accountName: debitAccObj?.nameAr || jvDebitAcc,
          description: jvDescription,
          debit: amount,
          credit: 0,
        },
        {
          id: `l-${Date.now()}-2`,
          accountCode: jvCreditAcc,
          accountName: creditAccObj?.nameAr || jvCreditAcc,
          description: jvDescription,
          debit: 0,
          credit: amount,
        },
      ],
    };

    setJournals([newEntry, ...journals]);
    setIsJvModalOpen(false);
    setJvDescription('');
    setJvNumber(`JV-2026-${Math.floor(Math.random() * 9000 + 1000)}`);
  };

  // Handle Inviolable Reversal
  const handleReverseJournal = (id: string) => {
    const target = journals.find((j) => j.id === id);
    if (!target || target.status === 'REVERSED') return;

    const reversalEntry: JournalEntry = {
      id: `je-rev-${Date.now()}`,
      entryNumber: `REV-${target.entryNumber}`,
      date: new Date().toISOString().split('T')[0] || '2026-11-08',
      legalEntity: target.legalEntity,
      description: `عكس القيد المحاسبي #${target.entryNumber} (قيد تسوية عكسي)`,
      status: 'POSTED',
      totalDebit: target.totalCredit,
      totalCredit: target.totalDebit,
      lines: target.lines.map((l, idx) => ({
        id: `rev-l-${idx}-${Date.now()}`,
        accountCode: l.accountCode,
        accountName: l.accountName,
        description: `عكس: ${l.description}`,
        debit: l.credit, // Invert
        credit: l.debit, // Invert
      })),
    };

    setJournals(
      journals.map((j) => (j.id === id ? { ...j, status: 'REVERSED' as const } : j)).concat(reversalEntry)
    );
  };

  // Handle Vault Transfer
  const handleVaultTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(transferAmount);
    if (!amt || amt <= 0) return;

    const fromV = vaults.find((v) => v.id === fromVault);
    if (!fromV || fromV.balance < amt) {
      alert('خطأ: رصيد الخزينة المصدر غير كافٍ. نظام منع السحب على المكشوف صارم.');
      return;
    }

    setVaults(
      vaults.map((v) => {
        if (v.id === fromVault) return { ...v, balance: v.balance - amt };
        if (v.id === toVault) return { ...v, balance: v.balance + amt };
        return v;
      })
    );
    setIsTransferModalOpen(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 p-6 overflow-y-auto" dir="rtl">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-wide">
                المحرك المالي والمحاسبي المتكامل
              </h1>
              <p className="text-sm text-slate-400">
                إدارة دليل الحسابات، قيود اليومية، السندات، الخزائن والبنوك، وإقرارات الزكاة والضريبة
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Badges */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-300 text-xs font-medium">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>نظام القيد المزدوج الصارم (Strict Double-Entry Balanced)</span>
          </div>
          <button
            onClick={() => setIsJvModalOpen(true)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium text-sm transition shadow-lg shadow-emerald-900/30"
          >
            <Plus className="w-4 h-4" />
            <span>إنشاء قيد يومية متوازن</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 mt-6 border-b border-slate-800 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab('journals')}
          className={`flex items-center gap-2 px-4 py-3 font-medium text-sm rounded-t-lg transition border-b-2 ${
            activeTab === 'journals'
              ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>قيود اليومية والأستاذ العام</span>
          <span className="bg-slate-700/80 text-xs px-2 py-0.5 rounded-full text-slate-300">
            {journals.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('coa')}
          className={`flex items-center gap-2 px-4 py-3 font-medium text-sm rounded-t-lg transition border-b-2 ${
            activeTab === 'coa'
              ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <FolderTree className="w-4 h-4" />
          <span>دليل الحسابات الشجري (COA)</span>
        </button>

        <button
          onClick={() => setActiveTab('vouchers')}
          className={`flex items-center gap-2 px-4 py-3 font-medium text-sm rounded-t-lg transition border-b-2 ${
            activeTab === 'vouchers'
              ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>سندات الصرف والقبض</span>
          <span className="bg-slate-700/80 text-xs px-2 py-0.5 rounded-full text-slate-300">
            {paymentVouchers.length + receiptVouchers.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('vaults_banks')}
          className={`flex items-center gap-2 px-4 py-3 font-medium text-sm rounded-t-lg transition border-b-2 ${
            activeTab === 'vaults_banks'
              ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <Wallet className="w-4 h-4" />
          <span>الخزائن والصناديق والبنوك</span>
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={`flex items-center gap-2 px-4 py-3 font-medium text-sm rounded-t-lg transition border-b-2 ${
            activeTab === 'reports'
              ? 'border-emerald-500 text-emerald-400 bg-slate-800/60'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>التقارير المالية وإقرار ZATCA</span>
        </button>
      </div>

      {/* TAB CONTENT 1: JOURNALS & GENERAL LEDGER */}
      {activeTab === 'journals' && (
        <div className="mt-6 flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">إجمالي القيود المرحلة</p>
                <p className="text-xl font-bold text-white mt-1">{journals.length} قيد مالي</p>
              </div>
              <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
                <FileText className="w-5 h-5" />
              </div>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">إجمالي الحركات المدينة</p>
                <p className="text-xl font-bold text-emerald-400 mt-1">
                  {journals.reduce((acc, j) => acc + j.totalDebit, 0).toLocaleString()} ر.س
                </p>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">حالة التوازن المحاسبي</p>
                <div className="flex items-center gap-1.5 mt-1 text-emerald-400 font-semibold text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>متطابق ومتزن بالكامل (الفرق: 0.00)</span>
                </div>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
                <Scale className="w-5 h-5" />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {journals.map((entry) => (
              <div
                key={entry.id}
                className="bg-slate-800/50 border border-slate-700/60 rounded-xl overflow-hidden"
              >
                <div className="bg-slate-800/90 px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-700">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded border border-emerald-800">
                      {entry.entryNumber}
                    </span>
                    <span className="text-sm font-medium text-slate-200">{entry.description}</span>
                    <span className="text-xs text-slate-400">({entry.date})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        entry.status === 'POSTED'
                          ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800'
                          : 'bg-red-950/60 text-red-400 border border-red-800'
                      }`}
                    >
                      {entry.status === 'POSTED' ? 'مرحّل وغير قابل للتعديل' : 'تم عكس القيد (Reversed)'}
                    </span>
                    {entry.status === 'POSTED' && (
                      <button
                        onClick={() => handleReverseJournal(entry.id)}
                        className="text-xs flex items-center gap-1 bg-red-900/30 hover:bg-red-900/60 text-red-300 border border-red-700/50 px-2.5 py-1 rounded transition"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>عكس القيد</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                    <thead>
                      <tr className="bg-slate-800/30 text-slate-400 text-xs border-b border-slate-700/50">
                        <th className="py-2.5 px-4 font-medium">رمز الحساب</th>
                        <th className="py-2.5 px-4 font-medium">اسم الحساب</th>
                        <th className="py-2.5 px-4 font-medium">البيان</th>
                        <th className="py-2.5 px-4 font-medium text-left">مدين (SAR)</th>
                        <th className="py-2.5 px-4 font-medium text-left">دائن (SAR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {entry.lines.map((line) => (
                        <tr key={line.id} className="hover:bg-slate-800/20">
                          <td className="py-2.5 px-4 font-mono text-xs text-slate-300">{line.accountCode}</td>
                          <td className="py-2.5 px-4 text-slate-200">{line.accountName}</td>
                          <td className="py-2.5 px-4 text-slate-400 text-xs">{line.description}</td>
                          <td className="py-2.5 px-4 font-mono text-left font-semibold text-emerald-400">
                            {line.debit > 0 ? line.debit.toFixed(2) : '-'}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-left font-semibold text-amber-400">
                            {line.credit > 0 ? line.credit.toFixed(2) : '-'}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-800/60 font-bold border-t border-slate-700">
                        <td colSpan={3} className="py-2.5 px-4 text-slate-300">
                          الإجمالي المتوازن:
                        </td>
                        <td className="py-2.5 px-4 font-mono text-left text-emerald-400">
                          {entry.totalDebit.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-left text-amber-400">
                          {entry.totalCredit.toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB CONTENT 2: CHART OF ACCOUNTS (COA) */}
      {activeTab === 'coa' && (
        <div className="mt-6 flex flex-col gap-6">
          <div className="flex items-center justify-between bg-slate-800/60 border border-slate-700 p-4 rounded-xl">
            <div>
              <h3 className="font-bold text-white text-base">دليل الحسابات الشجري المعتمد</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                هيكل محاسبي موحد يدعم الأصول، الالتزامات، حقوق الملكية، الإيرادات، وتكاليف التشغيل
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs bg-slate-700 px-3 py-1.5 rounded-lg text-slate-300">
                إجمالي الحسابات: {coa.length}
              </span>
            </div>
          </div>

          <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl overflow-hidden">
            <table className="w-full text-right text-sm">
              <thead>
                <tr className="bg-slate-800/80 text-slate-400 text-xs border-b border-slate-700">
                  <th className="py-3 px-4">رمز الحساب</th>
                  <th className="py-3 px-4">اسم الحساب</th>
                  <th className="py-3 px-4">تصنيف الحساب</th>
                  <th className="py-3 px-4">النوع</th>
                  <th className="py-3 px-4 text-left">الرصيد المالي الحالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {coa.map((acc) => (
                  <tr
                    key={acc.id}
                    className={`hover:bg-slate-800/30 ${!acc.isPostable ? 'font-bold bg-slate-800/20' : ''}`}
                  >
                    <td className="py-3 px-4 font-mono text-slate-300 text-xs">
                      <span className="inline-block" style={{ marginRight: `${(acc.level - 1) * 16}px` }}>
                        {acc.code}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-200">
                      <span style={{ marginRight: `${(acc.level - 1) * 16}px` }}>
                        {acc.isPostable ? '• ' : '📁 '}
                        {acc.nameAr}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-medium ${
                          acc.type === 'ASSET'
                            ? 'bg-blue-950/60 text-blue-300 border border-blue-800'
                            : acc.type === 'LIABILITY'
                            ? 'bg-amber-950/60 text-amber-300 border border-amber-800'
                            : acc.type === 'EQUITY'
                            ? 'bg-purple-950/60 text-purple-300 border border-purple-800'
                            : acc.type === 'REVENUE'
                            ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800'
                            : 'bg-rose-950/60 text-rose-300 border border-rose-800'
                        }`}
                      >
                        {acc.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-400">
                      {acc.isPostable ? 'حساب فرعي مرحل' : 'حساب رئيسي تجميعي'}
                    </td>
                    <td className="py-3 px-4 font-mono text-left font-semibold text-slate-100">
                      {acc.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} {acc.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB CONTENT 3: PAYMENT & RECEIPT VOUCHERS */}
      {activeTab === 'vouchers' && (
        <div className="mt-6 flex flex-col gap-6">
          {/* Payment Vouchers Section */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Receipt className="w-5 h-5 text-rose-400" />
                <span>سندات الصرف التشغيلية (Payment Vouchers)</span>
              </h3>
            </div>
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="bg-slate-800/80 text-slate-400 text-xs border-b border-slate-700">
                    <th className="py-2.5 px-4">رقم السند</th>
                    <th className="py-2.5 px-4">التاريخ</th>
                    <th className="py-2.5 px-4">نوع الصرف</th>
                    <th className="py-2.5 px-4">المستفيد</th>
                    <th className="py-2.5 px-4">طريقة الدفع ومصدر الأموال</th>
                    <th className="py-2.5 px-4 text-left">المبلغ المصروف</th>
                    <th className="py-2.5 px-4">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {paymentVouchers.map((pv) => (
                    <tr key={pv.id} className="hover:bg-slate-800/20">
                      <td className="py-2.5 px-4 font-mono text-rose-400 font-bold text-xs">{pv.voucherNumber}</td>
                      <td className="py-2.5 px-4 text-slate-300 text-xs">{pv.date}</td>
                      <td className="py-2.5 px-4 text-slate-200">{pv.voucherType}</td>
                      <td className="py-2.5 px-4 text-slate-200 font-medium">{pv.beneficiaryName}</td>
                      <td className="py-2.5 px-4 text-slate-400 text-xs">
                        {pv.paymentMethod} - {pv.sourceName}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-left font-bold text-rose-400">
                        {pv.amount.toLocaleString()} ر.س
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800">
                          {pv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Receipt Vouchers Section */}
          <div className="flex flex-col gap-3 mt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-400" />
                <span>سندات القبض والتحصيل (Receipt Vouchers)</span>
              </h3>
            </div>
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="bg-slate-800/80 text-slate-400 text-xs border-b border-slate-700">
                    <th className="py-2.5 px-4">رقم السند</th>
                    <th className="py-2.5 px-4">التاريخ</th>
                    <th className="py-2.5 px-4">نوع القبض</th>
                    <th className="py-2.5 px-4">الدافع / العميل</th>
                    <th className="py-2.5 px-4">طريقة التحصيل والوجهة</th>
                    <th className="py-2.5 px-4 text-left">المبلغ المحصل</th>
                    <th className="py-2.5 px-4">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {receiptVouchers.map((rv) => (
                    <tr key={rv.id} className="hover:bg-slate-800/20">
                      <td className="py-2.5 px-4 font-mono text-emerald-400 font-bold text-xs">{rv.voucherNumber}</td>
                      <td className="py-2.5 px-4 text-slate-300 text-xs">{rv.date}</td>
                      <td className="py-2.5 px-4 text-slate-200">{rv.voucherType}</td>
                      <td className="py-2.5 px-4 text-slate-200 font-medium">{rv.payerName}</td>
                      <td className="py-2.5 px-4 text-slate-400 text-xs">
                        {rv.paymentMethod} - {rv.destinationName}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-left font-bold text-emerald-400">
                        {rv.amount.toLocaleString()} ر.س
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800">
                          {rv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT 4: VAULTS & BANKS */}
      {activeTab === 'vaults_banks' && (
        <div className="mt-6 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-white text-base">إدارة الخزائن والصناديق النقدية والحسابات البنكية</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                متابعة أرصدة الكاشير والخزائن الرئيسية مع منع السحب على المكشوف
              </p>
            </div>
            <button
              onClick={() => setIsTransferModalOpen(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3.5 py-2 rounded-lg font-medium transition"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>تحويل نقدي بين الخزائن</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {vaults.map((vault) => (
              <div
                key={vault.id}
                className="bg-slate-800/60 border border-slate-700 rounded-xl p-5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
                      {vault.code}
                    </span>
                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{vault.status}</span>
                    </span>
                  </div>
                  <h4 className="font-bold text-white text-base mt-2">{vault.nameAr}</h4>
                  <p className="text-xs text-slate-400 mt-0.5">{vault.branchName}</p>
                </div>
                <div className="mt-6 pt-4 border-t border-slate-700/60 flex items-end justify-between">
                  <span className="text-xs text-slate-400">الرصيد الفعلي الحالي:</span>
                  <span className="font-mono text-xl font-bold text-emerald-400">
                    {vault.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} ر.س
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <h4 className="text-base font-bold text-white flex items-center gap-2">
              <Landmark className="w-5 h-5 text-blue-400" />
              <span>الحسابات البنكية المعتمدة</span>
            </h4>
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl overflow-hidden">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="bg-slate-800/80 text-slate-400 text-xs border-b border-slate-700">
                    <th className="py-3 px-4">اسم البنك</th>
                    <th className="py-3 px-4">رقم الحساب</th>
                    <th className="py-3 px-4">الآيبان الدولي (IBAN)</th>
                    <th className="py-3 px-4 text-left">الرصيد الدفتري</th>
                    <th className="py-3 px-4">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {banks.map((bank) => (
                    <tr key={bank.id} className="hover:bg-slate-800/20">
                      <td className="py-3 px-4 font-medium text-slate-200">{bank.bankName}</td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-300">{bank.accountNumber}</td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-400">{bank.iban}</td>
                      <td className="py-3 px-4 font-mono text-left font-bold text-blue-400">
                        {bank.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} {bank.currency}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800">
                          {bank.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT 5: FINANCIAL REPORTS & ZATCA TAX */}
      {activeTab === 'reports' && (
        <div className="mt-6 flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* ZATCA VAT Return Box */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
              <div className="flex items-center gap-2 border-b border-slate-700 pb-3">
                <Receipt className="w-5 h-5 text-emerald-400" />
                <h4 className="font-bold text-white text-base">إقرار ضريبة القيمة المضافة (ZATCA VAT Return 15%)</h4>
              </div>
              <div className="flex flex-col gap-3 mt-4 text-sm">
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">إجمالي المبيعات الخاضعة للضريبة الأساسية (15%):</span>
                  <span className="font-mono font-bold text-slate-200">219,550.00 ر.س</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">ضريبة المخرجات المستحقة (Output VAT):</span>
                  <span className="font-mono font-bold text-amber-400">32,932.50 ر.س</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">إجمالي المشتريات الخاضعة للضريبة الأساسية (15%):</span>
                  <span className="font-mono font-bold text-slate-200">98,500.00 ر.س</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">ضريبة المدخلات القابلة للخصم (Input VAT):</span>
                  <span className="font-mono font-bold text-blue-400">14,775.00 ر.س</span>
                </div>
                <div className="flex justify-between py-2 bg-emerald-950/40 px-3 rounded-lg border border-emerald-800/60 mt-2">
                  <span className="font-bold text-emerald-300">صافي الضريبة الواجبة السداد للهيئة:</span>
                  <span className="font-mono font-bold text-emerald-400 text-base">18,157.50 ر.س</span>
                </div>
              </div>
            </div>

            {/* Income Statement Summary */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
              <div className="flex items-center gap-2 border-b border-slate-700 pb-3">
                <PieChart className="w-5 h-5 text-blue-400" />
                <h4 className="font-bold text-white text-base">ملخص قائمة الدخل والأرباح (P&L Summary)</h4>
              </div>
              <div className="flex flex-col gap-3 mt-4 text-sm">
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">إجمالي إيرادات المبيعات:</span>
                  <span className="font-mono font-bold text-emerald-400">219,550.00 ر.س</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">تكلفة البضاعة المباعة (COGS):</span>
                  <span className="font-mono font-bold text-rose-400">(98,500.00) ر.س</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800 font-semibold">
                  <span className="text-slate-300">مجمل الربح (Gross Profit):</span>
                  <span className="font-mono text-emerald-400">121,050.00 ر.س</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-800">
                  <span className="text-slate-400">المصروفات التشغيلية والعمومية:</span>
                  <span className="font-mono font-bold text-rose-400">(60,000.00) ر.س</span>
                </div>
                <div className="flex justify-between py-2 bg-blue-950/40 px-3 rounded-lg border border-blue-800/60 mt-2">
                  <span className="font-bold text-blue-300">صافي ربح الفترة التشغيلية:</span>
                  <span className="font-mono font-bold text-blue-400 text-base">61,050.00 ر.س</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Balanced Journal Entry */}
      {isJvModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 w-full max-w-lg rounded-2xl p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <BookOpen className="w-5 h-5 text-emerald-400" />
              <span>إنشاء قيد يومية محاسبي متوازن</span>
            </h3>

            <form onSubmit={handlePostJournal} className="flex flex-col gap-4 text-sm">
              <div>
                <label className="block text-xs text-slate-400 mb-1">رقم القيد</label>
                <input
                  type="text"
                  value={jvNumber}
                  onChange={(e) => setJvNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">البيان والشرح</label>
                <input
                  type="text"
                  value={jvDescription}
                  onChange={(e) => setJvDescription(e.target.value)}
                  placeholder="مثال: تسوية مصاريف ضيافة أو مشتريات"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">الحساب المدين (Debit)</label>
                  <select
                    value={jvDebitAcc}
                    onChange={(e) => setJvDebitAcc(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs"
                  >
                    {coa
                      .filter((a) => a.isPostable)
                      .map((a) => (
                        <option key={a.id} value={a.code}>
                          {a.code} - {a.nameAr}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">الحساب الدائن (Credit)</label>
                  <select
                    value={jvCreditAcc}
                    onChange={(e) => setJvCreditAcc(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs"
                  >
                    {coa
                      .filter((a) => a.isPostable)
                      .map((a) => (
                        <option key={a.id} value={a.code}>
                          {a.code} - {a.nameAr}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">المبلغ المتوازن (SAR)</label>
                <input
                  type="number"
                  step="0.01"
                  value={jvAmount}
                  onChange={(e) => setJvAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-base font-bold text-emerald-400"
                  required
                />
              </div>

              <div className="bg-emerald-950/40 border border-emerald-800 rounded-lg p-3 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>إجمالي المدين ({jvAmount} ر.س) يساوي إجمالي الدائن تماماً (قيد متوازن آلياً).</span>
              </div>

              <div className="flex items-center justify-end gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => setIsJvModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-5 py-2 rounded-lg transition"
                >
                  ترحيل القيد المالي
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Vault Cash Transfer */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-700 w-full max-w-md rounded-2xl p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
              <ArrowUpDown className="w-5 h-5 text-blue-400" />
              <span>تحويل نقدي بين الخزائن</span>
            </h3>

            <form onSubmit={handleVaultTransfer} className="flex flex-col gap-4 text-sm">
              <div>
                <label className="block text-xs text-slate-400 mb-1">خزينة المصدر (سحب)</label>
                <select
                  value={fromVault}
                  onChange={(e) => setFromVault(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
                >
                  {vaults.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nameAr} (الرصيد: {v.balance.toLocaleString()} ر.س)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">خزينة الوجهة (إيداع)</label>
                <select
                  value={toVault}
                  onChange={(e) => setToVault(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
                >
                  {vaults
                    .filter((v) => v.id !== fromVault)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nameAr}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">المبلغ المراد تحويله (SAR)</label>
                <input
                  type="number"
                  step="0.01"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-500 text-white font-medium px-5 py-2 rounded-lg transition"
                >
                  إتمام التحويل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default AccountingView;
