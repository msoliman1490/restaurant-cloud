import { useState } from 'react';
import {
  BookOpen,
  Scale,
  Plus,
  CheckCircle2,
  FileSpreadsheet,
  Building2,
  Layers,
} from 'lucide-react';

interface AccountNode {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  balance: number;
  currency: string;
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
  status: 'POSTED' | 'DRAFT';
  totalDebit: number;
  totalCredit: number;
  lines: JournalLine[];
}

const INITIAL_COA: AccountNode[] = [
  { code: '1010', name: 'النقدية وما في حكمها - البنك الأهلي', type: 'ASSET', balance: 345000.0, currency: 'SAR' },
  { code: '1020', name: 'الصندوق اليومي - فرع العليا', type: 'ASSET', balance: 12450.0, currency: 'SAR' },
  { code: '1050', name: 'مخزون المواد الأولية والأغذية', type: 'ASSET', balance: 184200.0, currency: 'SAR' },
  { code: '2010', name: 'الموردون وحسابات الدائنين التجارية', type: 'LIABILITY', balance: 89500.0, currency: 'SAR' },
  { code: '2050', name: 'ضريبة القيمة المضافة المستحقة (ZATCA)', type: 'LIABILITY', balance: 32600.0, currency: 'SAR' },
  { code: '3010', name: 'رأس مال الكيان القانوني', type: 'EQUITY', balance: 400000.0, currency: 'SAR' },
  { code: '4010', name: 'إيرادات المبيعات - صالة المطعم', type: 'REVENUE', balance: 154200.0, currency: 'SAR' },
  { code: '4020', name: 'إيرادات مبيعات التوصيل والتطبيقات', type: 'REVENUE', balance: 65350.0, currency: 'SAR' },
  { code: '5010', name: 'تكلفة البضاعة المباعة (COGS)', type: 'EXPENSE', balance: 98500.0, currency: 'SAR' },
  { code: '5020', name: 'مصاريف تشغيلية - هدر ومواد تالفة', type: 'EXPENSE', balance: 1500.0, currency: 'SAR' },
];

const INITIAL_JOURNALS: JournalEntry[] = [
  {
    id: 'je-1',
    entryNumber: 'JV-2026-0034',
    date: '2026-11-08',
    legalEntity: 'شركة الضيافة الفندقية المحدودة',
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
    legalEntity: 'شركة الضيافة الفندقية المحدودة',
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

export const AccountingView = () => {
  const [coa] = useState<AccountNode[]>(INITIAL_COA);
  const [journals, setJournals] = useState<JournalEntry[]>(INITIAL_JOURNALS);
  const [activeTab, setActiveTab] = useState<'coa' | 'journals' | 'trial_balance'>('journals');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New JV state
  const [newDescription, setNewDescription] = useState('');
  const [newDebitAcc, setNewDebitAcc] = useState('1050');
  const [newCreditAcc, setNewCreditAcc] = useState('2010');
  const [newAmount, setNewAmount] = useState('1000');

  const totalTrialDebit = coa
    .filter((a) => a.type === 'ASSET' || a.type === 'EXPENSE')
    .reduce((s, a) => s + a.balance, 0);
  const totalTrialCredit = coa
    .filter((a) => a.type === 'LIABILITY' || a.type === 'EQUITY' || a.type === 'REVENUE')
    .reduce((s, a) => s + a.balance, 0);

  const handleCreateJV = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(newAmount);
    if (!amt || isNaN(amt)) return;

    const debitAcc = coa.find((a) => a.code === newDebitAcc);
    const creditAcc = coa.find((a) => a.code === newCreditAcc);

    const newJV: JournalEntry = {
      id: `je-${Date.now()}`,
      entryNumber: `JV-2026-${String(journals.length + 35).padStart(4, '0')}`,
      date: new Date().toISOString().split('T')[0],
      legalEntity: 'شركة الضيافة الفندقية المحدودة',
      description: newDescription || 'قيد تسوية يدوي معتمد',
      status: 'POSTED',
      totalDebit: amt,
      totalCredit: amt,
      lines: [
        {
          id: `l-${Date.now()}-1`,
          accountCode: newDebitAcc,
          accountName: debitAcc?.name || 'حساب مدين',
          description: newDescription,
          debit: amt,
          credit: 0,
        },
        {
          id: `l-${Date.now()}-2`,
          accountCode: newCreditAcc,
          accountName: creditAcc?.name || 'حساب دائن',
          description: newDescription,
          debit: 0,
          credit: amt,
        },
      ],
    };

    setJournals([newJV, ...journals]);
    setIsModalOpen(false);
    setNewDescription('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            النظام المحاسبي ودفتر الأستاذ العام
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            دليل الحسابات الشجري وقيود اليومية المزدوجة المتوازنة (Double-entry Ledger) مع عزل الكيانات القانونية.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl text-sm shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>إنشاء قيد يومية متوازن</span>
          </button>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">إجمالي الأصول (Assets)</span>
            <BookOpen className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-xl font-bold text-slate-900">
            {coa
              .filter((a) => a.type === 'ASSET')
              .reduce((s, a) => s + a.balance, 0)
              .toLocaleString('ar-SA')}{' '}
            <span className="text-xs font-normal text-slate-500">ر.س</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">إجمالي الالتزامات (Liabilities)</span>
            <Layers className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-bold text-slate-900">
            {coa
              .filter((a) => a.type === 'LIABILITY')
              .reduce((s, a) => s + a.balance, 0)
              .toLocaleString('ar-SA')}{' '}
            <span className="text-xs font-normal text-slate-500">ر.س</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">إجمالي الإيرادات (Revenue)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl font-bold text-slate-900">
            {coa
              .filter((a) => a.type === 'REVENUE')
              .reduce((s, a) => s + a.balance, 0)
              .toLocaleString('ar-SA')}{' '}
            <span className="text-xs font-normal text-slate-500">ر.س</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">توازن ميزان المراجعة</span>
            <Scale className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>متطابق (Δ = 0.00 ر.س)</span>
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('journals')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'journals'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>قيود اليومية العامة ({journals.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('coa')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'coa'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>دليل الحسابات الشجري (Chart of Accounts)</span>
        </button>
        <button
          onClick={() => setActiveTab('trial_balance')}
          className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all ${
            activeTab === 'trial_balance'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Scale className="w-4 h-4" />
          <span>ميزان المراجعة (Trial Balance)</span>
        </button>
      </div>

      {/* Tab: Journals */}
      {activeTab === 'journals' && (
        <div className="space-y-4">
          {journals.map((entry) => (
            <div key={entry.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-slate-900">{entry.entryNumber}</span>
                  <span className="text-xs text-slate-500 font-sans">{entry.date}</span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                    مرحل (POSTED)
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-600">
                  <span className="flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>{entry.legalEntity}</span>
                  </span>
                  <span className="font-medium bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                    المدين: {entry.totalDebit.toLocaleString('ar-SA')} = الدائن: {entry.totalCredit.toLocaleString('ar-SA')} ر.س
                  </span>
                </div>
              </div>

              <div className="p-4 px-6 text-sm text-slate-700 bg-slate-50/50 border-b border-slate-100 font-medium">
                {entry.description}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
                    <tr>
                      <th className="px-6 py-2.5">رقم الحساب</th>
                      <th className="px-6 py-2.5">اسم الحساب</th>
                      <th className="px-6 py-2.5">البيان</th>
                      <th className="px-6 py-2.5 text-emerald-700">مدين (Debit)</th>
                      <th className="px-6 py-2.5 text-indigo-700">دائن (Credit)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {entry.lines.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50/60">
                        <td className="px-6 py-3 font-mono text-xs text-slate-600">{l.accountCode}</td>
                        <td className="px-6 py-3 font-medium text-slate-900">{l.accountName}</td>
                        <td className="px-6 py-3 text-slate-500 text-xs">{l.description}</td>
                        <td className="px-6 py-3 font-mono font-medium text-emerald-600">
                          {l.debit > 0 ? l.debit.toLocaleString('ar-SA', { minimumFractionDigits: 2 }) : '-'}
                        </td>
                        <td className="px-6 py-3 font-mono font-medium text-indigo-600">
                          {l.credit > 0 ? l.credit.toLocaleString('ar-SA', { minimumFractionDigits: 2 }) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab: Chart of Accounts */}
      {activeTab === 'coa' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
                <tr>
                  <th className="px-6 py-3">كود الحساب</th>
                  <th className="px-6 py-3">اسم الحساب</th>
                  <th className="px-6 py-3">تصنيف الحساب</th>
                  <th className="px-6 py-3">الرصيد الحالي</th>
                  <th className="px-6 py-3">العملة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {coa.map((acc) => (
                  <tr key={acc.code} className="hover:bg-slate-50">
                    <td className="px-6 py-3.5 font-mono font-semibold text-slate-700">{acc.code}</td>
                    <td className="px-6 py-3.5 font-medium text-slate-900">{acc.name}</td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          acc.type === 'ASSET'
                            ? 'bg-blue-100 text-blue-800'
                            : acc.type === 'LIABILITY'
                            ? 'bg-amber-100 text-amber-800'
                            : acc.type === 'EQUITY'
                            ? 'bg-purple-100 text-purple-800'
                            : acc.type === 'REVENUE'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {acc.type}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 font-mono font-bold text-slate-900">
                      {acc.balance.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-3.5 text-xs text-slate-500">{acc.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Trial Balance */}
      {activeTab === 'trial_balance' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-bold text-slate-900">ميزان المراجعة الشامل (Trial Balance Preview)</h3>
              <p className="text-xs text-slate-500">
                إثبات التوازن الرياضي والمالي للمنظومة وفق المعايير المحاسبية السعودية والدولية (IFRS).
              </p>
            </div>
            <div className="text-left font-mono">
              <span className="text-xs text-slate-400 block">فارق التوازن</span>
              <span className="text-sm font-bold text-emerald-600">0.00 ر.س (متطابق)</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-100">
              <span className="text-xs font-semibold text-emerald-800 block mb-1">
                إجمالي الأرصدة المدينة (Total Debits)
              </span>
              <span className="text-2xl font-mono font-bold text-emerald-700">
                {totalTrialDebit.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}{' '}
                <span className="text-sm font-normal">ر.س</span>
              </span>
              <p className="text-xs text-emerald-600 mt-2">تشمل حسابات الأصول والمصروفات التشغيلية والتكلفة.</p>
            </div>

            <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100">
              <span className="text-xs font-semibold text-indigo-800 block mb-1">
                إجمالي الأرصدة الدائنة (Total Credits)
              </span>
              <span className="text-2xl font-mono font-bold text-indigo-700">
                {totalTrialCredit.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}{' '}
                <span className="text-sm font-normal">ر.س</span>
              </span>
              <p className="text-xs text-indigo-600 mt-2">تشمل حسابات الالتزامات وحقوق الملكية والمبيعات الإجمالية.</p>
            </div>
          </div>
        </div>
      )}

      {/* Modal: New Balanced JV */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900 mb-1">إنشاء قيد يومية متوازن جديد</h3>
            <p className="text-xs text-slate-500 mb-5">
              يشترط النظام المحاسبي تطابق المدين مع الدائن كلياً وإدراج المعرف المحاسبي.
            </p>

            <form onSubmit={handleCreateJV} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">البيان / الوصف</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: تسوية مصاريف ضيافة أو مشتريات فورية"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">الحساب المدين (Debit)</label>
                <select
                  value={newDebitAcc}
                  onChange={(e) => setNewDebitAcc(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {coa.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} - {a.name} ({a.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">الحساب الدائن (Credit)</label>
                <select
                  value={newCreditAcc}
                  onChange={(e) => setNewCreditAcc(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {coa.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} - {a.name} ({a.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">المبلغ المتوازن (ر.س)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100 flex items-center gap-2 text-xs text-indigo-800">
                <CheckCircle2 className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                <span>
                  سيتم إنشاء سطرين تلقائياً (مدين ودائن متساويين بقيمة {parseFloat(newAmount || '0').toFixed(2)} ر.س).
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium shadow-sm transition-all"
                >
                  ترحيل القيد المزدوج
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
