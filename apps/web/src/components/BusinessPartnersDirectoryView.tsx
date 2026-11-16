import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Plus,
  Search,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { useLocale } from '../context/LocaleContext';

interface PartnerRow {
  id: string;
  partnerNumber: string;
  partnerType: 'CORPORATE' | 'INDIVIDUAL';
  legalNameAr: string;
  legalNameEn?: string | null;
  tradeNameAr?: string | null;
  taxIdentificationNumber?: string | null;
  commercialRegistrationNumber?: string | null;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
  isActive: boolean;
  isOnHold: boolean;
  roles: string[];
  arBalance: number;
  apBalance: number;
  totalSales: number;
  lastSaleAt?: string | null;
  totalPurchases: number;
  lastInvoiceAt?: string | null;
}

interface PartnerListResponse {
  items: PartnerRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface StatementResponse {
  partner: PartnerRow;
  arInvoices: Array<{
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    grandTotal: string;
    balanceDue: string;
    status: string;
  }>;
  apInvoices: Array<{
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    grandTotal: string;
    balanceDue: string;
    status: string;
  }>;
}

export const BusinessPartnersDirectoryView: React.FC<{ mode: 'CUSTOMER' | 'VENDOR' }> = ({
  mode,
}) => {
  const { locale, dir } = useLocale();
  const isEn = locale === 'en';
  const isCustomer = mode === 'CUSTOMER';

  const [data, setData] = useState<PartnerListResponse>({
    items: [],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [sortBy, setSortBy] = useState<'createdAt' | 'legalNameAr' | 'partnerNumber'>('createdAt');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [form, setForm] = useState({
    partnerNumber: '',
    partnerType: 'CORPORATE' as 'CORPORATE' | 'INDIVIDUAL',
    legalNameAr: '',
    legalNameEn: '',
    tradeNameAr: '',
    taxIdentificationNumber: '',
    commercialRegistrationNumber: '',
    primaryPhone: '',
    primaryEmail: '',
    bothRoles: false,
    notes: '',
  });

  const [statementData, setStatementData] = useState<StatementResponse | null>(null);

  const loadPartners = async (targetPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        role: mode,
        page: String(targetPage),
        limit: '20',
        sortBy,
        sortDir,
      });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'ALL') params.set('status', statusFilter);

      const res = await apiClient.get<PartnerListResponse>(`/partners?${params.toString()}`);
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load partners');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPartners(page);
  }, [mode, page, statusFilter, sortBy, sortDir]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadPartners(1);
  };

  const handleCreatePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFeedback(null);
    try {
      const roles = form.bothRoles ? ['CUSTOMER', 'VENDOR'] : [mode];
      await apiClient.post('/partners', {
        partnerNumber:
          form.partnerNumber.trim() || `${isCustomer ? 'CUST' : 'SUP'}-${Date.now().toString().slice(-6)}`,
        partnerType: form.partnerType,
        legalNameAr: form.legalNameAr.trim(),
        legalNameEn: form.legalNameEn.trim() || undefined,
        tradeNameAr: form.tradeNameAr.trim() || undefined,
        taxIdentificationNumber: form.taxIdentificationNumber.trim() || undefined,
        commercialRegistrationNumber: form.commercialRegistrationNumber.trim() || undefined,
        primaryPhone: form.primaryPhone.trim() || undefined,
        primaryEmail: form.primaryEmail.trim() || undefined,
        notes: form.notes.trim() || undefined,
        roles,
      });
      setShowCreateModal(false);
      setForm({
        partnerNumber: '',
        partnerType: 'CORPORATE',
        legalNameAr: '',
        legalNameEn: '',
        tradeNameAr: '',
        taxIdentificationNumber: '',
        commercialRegistrationNumber: '',
        primaryPhone: '',
        primaryEmail: '',
        bothRoles: false,
        notes: '',
      });
      setFeedback(isEn ? 'Partner created successfully.' : 'تم حفظ سجل الطرف التجاري بنجاح.');
      await loadPartners(1);
    } catch (err: any) {
      setError(err?.message || 'Failed to create partner');
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivateOppositeRole = async (partner: PartnerRow) => {
    const oppositeRole = isCustomer ? 'VENDOR' : 'CUSTOMER';
    setSubmitting(true);
    try {
      await apiClient.post(`/partners/${partner.id}/roles`, { roleType: oppositeRole });
      setFeedback(
        isEn
          ? `${oppositeRole} role activated for ${partner.legalNameAr}.`
          : `تم تفعيل دور ${oppositeRole === 'VENDOR' ? 'المورد' : 'العميل'} للطرف ${partner.legalNameAr} دون تكرار السجل.`
      );
      await loadPartners(page);
    } catch (err: any) {
      setError(err?.message || 'Failed to add role');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenStatement = async (partnerId: string) => {
    setSubmitting(true);
    try {
      const res = await apiClient.get<StatementResponse>(
        `/partners/${partnerId}/statement?role=${mode}`
      );
      setStatementData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load statement');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'PartnerNumber',
      'LegalNameAr',
      'Phone',
      'Email',
      'VAT',
      'CRN',
      isCustomer ? 'TotalSales' : 'TotalPurchases',
      isCustomer ? 'ARBalance' : 'APBalance',
      'Status',
    ];
    const rows = data.items.map((p) => [
      p.partnerNumber,
      p.legalNameAr,
      p.primaryPhone || '',
      p.primaryEmail || '',
      p.taxIdentificationNumber || '',
      p.commercialRegistrationNumber || '',
      isCustomer ? p.totalSales : p.totalPurchases,
      isCustomer ? p.arBalance : p.apBalance,
      p.isActive ? 'ACTIVE' : 'INACTIVE',
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${isCustomer ? 'customers' : 'suppliers'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i]?.split(',').map((c) => c.replace(/^"|"$/g, '').trim()) ?? [];
        if (!cols[1]) continue;
        await apiClient.post('/partners', {
          partnerNumber: cols[0] || `${isCustomer ? 'CUST' : 'SUP'}-${Date.now().toString().slice(-5)}-${i}`,
          partnerType: 'CORPORATE',
          legalNameAr: cols[1],
          primaryPhone: cols[2] || undefined,
          primaryEmail: cols[3] || undefined,
          taxIdentificationNumber: cols[4] || undefined,
          commercialRegistrationNumber: cols[5] || undefined,
          roles: [mode],
        });
        imported++;
      }
      setFeedback(isEn ? `Imported ${imported} records.` : `تم استيراد ${imported} سجل بنجاح.`);
      await loadPartners(1);
    } catch (err: any) {
      setError(err?.message || 'CSV import failed');
    } finally {
      setSubmitting(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0D6E4F] text-white flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">
              {isCustomer
                ? isEn
                  ? 'Customers Directory (Unified Business Partners)'
                  : 'سجل العملاء الموحد'
                : isEn
                  ? 'Suppliers Directory (Unified Business Partners)'
                  : 'سجل الموردين الموحد'}
            </h2>
            <p className="text-xs text-slate-500">
              {isEn
                ? 'Single unified Business Partner master supporting Customer, Supplier, or Both roles with AR/AP subledger balances.'
                : 'سجل موحد للأطراف التجارية يدعم العميل والمورد أو كليهما معاً مع متابعة المبيعات/المشتريات والأرصدة المستحقة وكشف الحساب.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isEn ? 'Export CSV' : 'تصدير CSV'}</span>
          </button>
          <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>{isEn ? 'Import CSV' : 'استيراد CSV'}</span>
            <input type="file" accept=".csv" className="hidden" onChange={handleImportCsv} />
          </label>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0D6E4F] hover:bg-[#0A5A40] text-white text-xs font-bold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>
              {isCustomer
                ? isEn
                  ? 'New Customer'
                  : 'عميل جديد'
                : isEn
                  ? 'New Supplier'
                  : 'مورد جديد'}
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
          {error}
        </div>
      )}
      {feedback && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[#0D6E4F] text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Search, Filter & Sort Toolbar */}
      <form
        onSubmit={handleSearchSubmit}
        className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-3"
      >
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              isEn
                ? 'Search by name, code, VAT, CRN, or phone...'
                : 'بحث بالاسم أو الرمز أو الرقم الضريبي أو السجل أو الجوال...'
            }
            className="w-full ps-9 pe-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-[#0D6E4F] focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setPage(1);
            setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE');
          }}
          className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
        >
          <option value="ALL">{isEn ? 'All Statuses' : 'جميع الحالات'}</option>
          <option value="ACTIVE">{isEn ? 'Active' : 'نشط'}</option>
          <option value="INACTIVE">{isEn ? 'Inactive' : 'غير نشط'}</option>
        </select>
        <select
          value={`${sortBy}:${sortDir}`}
          onChange={(e) => {
            const [b, d] = e.target.value.split(':');
            setSortBy(b as typeof sortBy);
            setSortDir(d as typeof sortDir);
          }}
          className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
        >
          <option value="createdAt:desc">{isEn ? 'Newest First' : 'الأحدث أولاً'}</option>
          <option value="legalNameAr:asc">{isEn ? 'Name (A-Z)' : 'الاسم تصاعدي'}</option>
          <option value="partnerNumber:asc">{isEn ? 'Code (A-Z)' : 'الرمز تصاعدي'}</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer"
        >
          {isEn ? 'Search' : 'بحث'}
        </button>
      </form>

      {/* Data Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-[#0D6E4F]" />
            <span>{isEn ? 'Loading...' : 'جاري التحميل...'}</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-3 px-4 text-start">{isEn ? 'Partner' : 'الاسم والرمز'}</th>
                  <th className="py-3 px-4 text-start">{isEn ? 'Contact' : 'التواصل'}</th>
                  <th className="py-3 px-4 text-start">{isEn ? 'VAT / CRN' : 'الضريبي / السجل'}</th>
                  <th className="py-3 px-4 text-start">
                    {isCustomer
                      ? isEn
                        ? 'Total Sales'
                        : 'إجمالي المبيعات'
                      : isEn
                        ? 'Total Purchases'
                        : 'إجمالي المشتريات'}
                  </th>
                  <th className="py-3 px-4 text-start">
                    {isCustomer
                      ? isEn
                        ? 'Amount Due'
                        : 'المبلغ المستحق'
                      : isEn
                        ? 'Payable Due'
                        : 'المستحق للمورد'}
                  </th>
                  <th className="py-3 px-4 text-start">
                    {isCustomer
                      ? isEn
                        ? 'Last Sale'
                        : 'آخر عملية بيع'
                      : isEn
                        ? 'Last Invoice'
                        : 'آخر فاتورة شراء'}
                  </th>
                  <th className="py-3 px-4 text-start">{isEn ? 'Status' : 'الحالة'}</th>
                  <th className="py-3 px-4 text-start">{isEn ? 'Actions' : 'إجراءات'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-400">
                      {isEn ? 'No matching partners found.' : 'لا توجد سجلات مطابقة.'}
                    </td>
                  </tr>
                ) : (
                  data.items.map((p) => {
                    const totalAmt = isCustomer ? p.totalSales : p.totalPurchases;
                    const dueAmt = isCustomer ? p.arBalance : p.apBalance;
                    const lastDate = isCustomer ? p.lastSaleAt : p.lastInvoiceAt;
                    const hasBoth = p.roles.includes('CUSTOMER') && p.roles.includes('VENDOR');
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{p.legalNameAr}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[11px] text-slate-500">
                              {p.partnerNumber}
                            </span>
                            {hasBoth && (
                              <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold">
                                {isEn ? 'Customer + Supplier' : 'عميل + مورد'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono">{p.primaryPhone || '-'}</div>
                          <div className="text-slate-500">{p.primaryEmail || ''}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px]">
                          <div>VAT: {p.taxIdentificationNumber || '-'}</div>
                          <div className="text-slate-500">CR: {p.commercialRegistrationNumber || '-'}</div>
                        </td>
                        <td className="py-3 px-4 font-bold">{totalAmt.toFixed(2)} SAR</td>
                        <td className="py-3 px-4 font-bold text-[#0D6E4F]">{dueAmt.toFixed(2)} SAR</td>
                        <td className="py-3 px-4 text-slate-500">
                          {lastDate ? new Date(lastDate).toLocaleDateString() : '-'}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                              p.isActive
                                ? 'bg-emerald-50 text-[#0D6E4F] border border-emerald-200'
                                : 'bg-slate-100 text-slate-500 border border-slate-200'
                            }`}
                          >
                            {p.isActive ? (isEn ? 'Active' : 'نشط') : isEn ? 'Inactive' : 'غير نشط'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenStatement(p.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                            >
                              <FileText className="w-3 h-3" />
                              <span>{isEn ? 'Statement' : 'كشف حساب'}</span>
                            </button>
                            {!hasBoth && (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => handleActivateOppositeRole(p)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-[#0D6E4F] font-semibold cursor-pointer"
                                title={
                                  isCustomer
                                    ? 'تفعيل كمورد أيضاً'
                                    : 'تفعيل كعميل أيضاً'
                                }
                              >
                                <UserPlus className="w-3 h-3" />
                                <span>{isCustomer ? '+ مورد' : '+ عميل'}</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Server-side Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <span>
            {isEn
              ? `Total: ${data.total} · Page ${data.page} of ${Math.max(1, data.totalPages)}`
              : `الإجمالي: ${data.total} · صفحة ${data.page} من ${Math.max(1, data.totalPages)}`}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {isCustomer
                  ? isEn
                    ? 'Add Customer'
                    : 'إضافة عميل جديد'
                  : isEn
                    ? 'Add Supplier'
                    : 'إضافة مورد جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreatePartner} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isEn ? 'Legal Name (AR) *' : 'الاسم القانوني (عربي) *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={form.legalNameAr}
                    onChange={(e) => setForm({ ...form, legalNameAr: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isEn ? 'Partner Code' : 'الرمز (تلقائي عند الترك فارغاً)'}
                  </label>
                  <input
                    type="text"
                    value={form.partnerNumber}
                    onChange={(e) => setForm({ ...form, partnerNumber: e.target.value })}
                    dir="ltr"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isEn ? 'Mobile' : 'رقم الجوال'}
                  </label>
                  <input
                    type="tel"
                    value={form.primaryPhone}
                    onChange={(e) => setForm({ ...form, primaryPhone: e.target.value })}
                    dir="ltr"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isEn ? 'Email' : 'البريد الإلكتروني'}
                  </label>
                  <input
                    type="email"
                    value={form.primaryEmail}
                    onChange={(e) => setForm({ ...form, primaryEmail: e.target.value })}
                    dir="ltr"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isEn ? 'Saudi VAT (15 digits)' : 'الرقم الضريبي (15 خانة)'}
                  </label>
                  <input
                    type="text"
                    value={form.taxIdentificationNumber}
                    onChange={(e) => setForm({ ...form, taxIdentificationNumber: e.target.value })}
                    pattern="^3\d{9}00003$"
                    title="15 digits starting with 3 and ending with 00003"
                    dir="ltr"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isEn ? 'CR Number' : 'السجل التجاري'}
                  </label>
                  <input
                    type="text"
                    value={form.commercialRegistrationNumber}
                    onChange={(e) =>
                      setForm({ ...form, commercialRegistrationNumber: e.target.value })
                    }
                    dir="ltr"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 font-mono"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={form.bothRoles}
                  onChange={(e) => setForm({ ...form, bothRoles: e.target.checked })}
                />
                <span>
                  {isEn
                    ? 'Activate as BOTH Customer & Supplier in unified registry'
                    : 'تفعيل الطرف كعميل ومورد معاً في السجل الموحد'}
                </span>
              </label>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 font-semibold cursor-pointer"
                >
                  {isEn ? 'Cancel' : 'إلغاء'}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-[#0D6E4F] text-white font-bold cursor-pointer"
                >
                  {isEn ? 'Save Partner' : 'حفظ الطرف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Statement Modal */}
      {statementData && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {isEn ? 'Statement of Account:' : 'كشف حساب:'} {statementData.partner.legalNameAr}
              </h3>
              <button
                type="button"
                onClick={() => setStatementData(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-x-auto max-h-80">
              <table className="w-full text-xs text-start">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 px-3 text-start">{isEn ? 'Invoice' : 'الفاتورة'}</th>
                    <th className="py-2 px-3 text-start">{isEn ? 'Date' : 'التاريخ'}</th>
                    <th className="py-2 px-3 text-start">{isEn ? 'Total' : 'الإجمالي'}</th>
                    <th className="py-2 px-3 text-start">{isEn ? 'Balance Due' : 'المتبقي'}</th>
                    <th className="py-2 px-3 text-start">{isEn ? 'Status' : 'الحالة'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(isCustomer ? statementData.arInvoices : statementData.apInvoices).map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-2 px-3 font-mono">{inv.invoiceNumber}</td>
                      <td className="py-2 px-3">{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                      <td className="py-2 px-3 font-bold">{inv.grandTotal} SAR</td>
                      <td className="py-2 px-3 text-[#0D6E4F] font-bold">{inv.balanceDue} SAR</td>
                      <td className="py-2 px-3">{inv.status}</td>
                    </tr>
                  ))}
                  {(isCustomer ? statementData.arInvoices : statementData.apInvoices).length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        {isEn ? 'No posted invoices yet.' : 'لا توجد فواتير مرحلة بعد.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
