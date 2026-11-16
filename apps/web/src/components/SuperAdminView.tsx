import React, { useEffect, useState } from 'react';
import {
  Building2,
  CreditCard,
  FileText,
  Loader2,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import { apiClient } from '../api/client';

interface AdminOverview {
  totalTenants: number;
  subscriptionsByStatus: Record<string, number>;
  totalPaidRevenueSar: number;
  paidInvoiceCount: number;
  activePlanCount: number;
}

interface AdminTenantRow {
  id: string;
  code: string;
  displayName: string;
  status: string;
  planCode: string | null;
  subscriptionStatus: string | null;
  billingCycle: string | null;
  maxBranches: number | null;
}

interface AdminPlanRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  monthlyPriceSar: string;
  annualPriceSar: string;
  trialDays: number;
  maxBranches: number;
  maxDevices: number;
  maxUsers: number;
  isActive: boolean;
}

export const SuperAdminView: React.FC<{ locale: 'ar' | 'en' }> = ({ locale }) => {
  const isEn = locale === 'en';
  const [section, setSection] = useState<'tenants' | 'plans' | 'invoices' | 'audit'>('tenants');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [tenantsList, setTenantsList] = useState<AdminTenantRow[]>([]);
  const [plansList, setPlansList] = useState<AdminPlanRow[]>([]);
  const [invoicesList, setInvoicesList] = useState<
    Array<{
      id: string;
      tenantName: string;
      invoiceNumber: string;
      planCode: string;
      totalSar: string;
      status: string;
    }>
  >([]);
  const [auditList, setAuditList] = useState<
    Array<{ id: string; action: string; entityType: string; createdAt: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [ov, tn, pl, inv, au] = await Promise.all([
        apiClient.get<AdminOverview>('/super-admin/overview'),
        apiClient.get<AdminTenantRow[]>('/super-admin/tenants'),
        apiClient.get<AdminPlanRow[]>('/super-admin/plans'),
        apiClient.get<typeof invoicesList>('/super-admin/invoices'),
        apiClient.get<typeof auditList>('/super-admin/audit-logs'),
      ]);
      setOverview(ov);
      setTenantsList(tn);
      setPlansList(pl);
      setInvoicesList(inv);
      setAuditList(au);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleUpdateTenantStatus = async (
    tenantId: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'REACTIVATED'
  ) => {
    setBusyId(tenantId);
    try {
      await apiClient.patch(`/super-admin/tenants/${tenantId}/subscription`, {
        status,
        reason: `Platform admin action: ${status}`,
      });
      await loadAll();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-slate-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-[#0D6E4F]" />
        <span className="text-sm">{isEn ? 'Loading Platform Console...' : 'جاري تحميل بوابة إدارة المنصة...'}</span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0D6E4F] text-white flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">
              {isEn ? 'SaaS Platform Super Admin Console' : 'بوابة الإدارة المركزية للمنصة (Super Admin)'}
            </h2>
            <p className="text-xs text-slate-500">
              {isEn
                ? 'Centralized management of tenants, subscription plans, billing, and platform audit logs.'
                : 'إدارة مركزية للمنشآت، الباقات، الاشتراكات، الفواتير، وسجلات التدقيق.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(
            [
              { id: 'tenants', label: isEn ? 'Tenants' : 'المنشآت', icon: Building2 },
              { id: 'plans', label: isEn ? 'Plans' : 'الباقات', icon: Sliders },
              { id: 'invoices', label: isEn ? 'Invoices' : 'الفواتير', icon: CreditCard },
              { id: 'audit', label: isEn ? 'Audit Logs' : 'التدقيق', icon: FileText },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSection(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                  section === tab.id
                    ? 'bg-[#0D6E4F] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* KPIs */}
      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-500">{isEn ? 'Total Tenants' : 'إجمالي المنشآت'}</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{overview.totalTenants}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-500">{isEn ? 'Paid SaaS Revenue' : 'إيرادات الاشتراكات'}</div>
            <div className="text-2xl font-extrabold text-[#0D6E4F] mt-1">
              {overview.totalPaidRevenueSar.toFixed(2)} SAR
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-500">{isEn ? 'Paid Invoices' : 'الفواتير المدفوعة'}</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{overview.paidInvoiceCount}</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="text-xs text-slate-500">{isEn ? 'Active Plans' : 'الباقات الفعالة'}</div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{overview.activePlanCount}</div>
          </div>
        </div>
      )}

      {/* Tenants Table */}
      {section === 'tenants' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 text-start">{isEn ? 'Code' : 'الرمز'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Organization' : 'المنشأة'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Plan' : 'الباقة'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Status' : 'الحالة'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Actions' : 'إجراءات'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenantsList.map((t) => (
                <tr key={t.id}>
                  <td className="py-2.5 font-mono">{t.code}</td>
                  <td className="py-2.5 font-bold">{t.displayName}</td>
                  <td className="py-2.5">
                    {t.planCode || '-'} ({t.billingCycle || 'MONTHLY'})
                  </td>
                  <td className="py-2.5">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 font-semibold">
                      {t.subscriptionStatus || t.status}
                    </span>
                  </td>
                  <td className="py-2.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={() => handleUpdateTenantStatus(t.id, 'ACTIVE')}
                      className="px-2.5 py-1 rounded-lg bg-emerald-50 text-[#0D6E4F] font-semibold cursor-pointer"
                    >
                      {isEn ? 'Activate' : 'تفعيل'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === t.id}
                      onClick={() => handleUpdateTenantStatus(t.id, 'SUSPENDED')}
                      className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 font-semibold cursor-pointer"
                    >
                      {isEn ? 'Suspend' : 'تعليق'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Plans Table */}
      {section === 'plans' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 text-start">{isEn ? 'Code' : 'الرمز'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Name' : 'الاسم'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Monthly (SAR)' : 'شهري'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Annual (SAR)' : 'سنوي'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Limits (B/D/U)' : 'الحدود'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {plansList.map((p) => (
                <tr key={p.id}>
                  <td className="py-2.5 font-mono font-bold">{p.code}</td>
                  <td className="py-2.5">{isEn ? p.nameEn : p.nameAr}</td>
                  <td className="py-2.5">{p.monthlyPriceSar}</td>
                  <td className="py-2.5">{p.annualPriceSar}</td>
                  <td className="py-2.5">
                    {p.maxBranches} / {p.maxDevices} / {p.maxUsers}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invoices Table */}
      {section === 'invoices' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 text-start">{isEn ? 'Invoice' : 'الفاتورة'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Tenant' : 'المنشأة'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Plan' : 'الباقة'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Total' : 'الإجمالي'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Status' : 'الحالة'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoicesList.map((inv) => (
                <tr key={inv.id}>
                  <td className="py-2.5 font-mono">{inv.invoiceNumber}</td>
                  <td className="py-2.5">{inv.tenantName}</td>
                  <td className="py-2.5">{inv.planCode}</td>
                  <td className="py-2.5 font-bold">{inv.totalSar} SAR</td>
                  <td className="py-2.5">{inv.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit Logs */}
      {section === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2.5 text-start">{isEn ? 'Action' : 'الحدث'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Entity' : 'الكيان'}</th>
                <th className="py-2.5 text-start">{isEn ? 'Timestamp' : 'التاريخ'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditList.map((a) => (
                <tr key={a.id}>
                  <td className="py-2.5 font-mono font-semibold">{a.action}</td>
                  <td className="py-2.5">{a.entityType}</td>
                  <td className="py-2.5">{new Date(a.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
