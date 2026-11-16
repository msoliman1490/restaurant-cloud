import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import {
  Users,
  Calendar,
  Clock,
  FileCheck2,
  Plus,
  LogIn,
  LogOut,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  FolderOpen,
  Wallet,
  Briefcase,
} from 'lucide-react';

interface EmployeeRow {
  id: string;
  legalEntityId: string;
  primaryBranchId: string;
  userId?: string | null;
  employeeCode: string;
  fullNameAr: string;
  fullNameEn?: string | null;
  phone?: string | null;
  email?: string | null;
  jobTitle: string;
  department?: string | null;
  hireDate: string;
  status: string;
}

interface ShiftScheduleRow {
  id: string;
  employeeId: string;
  branchId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  shiftType: string;
  status: string;
}

interface AttendanceRow {
  id: string;
  employeeId: string;
  branchId: string;
  attendanceDate: string;
  checkInAt: string;
  checkOutAt?: string | null;
  workedMinutes?: number | null;
  status: string;
}

interface LeaveRow {
  id: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  status: string;
  reason?: string | null;
}

export const HrEmployeesView: React.FC = () => {
  const { hierarchy, activeLegalEntity, activeBranch } = useAuth();
  const legalEntities = hierarchy?.legalEntities || [];
  const branches = hierarchy?.branches || [];
  const { showToast } = useToast();
  const [subTab, setSubTab] = useState<
    'employees' | 'schedules' | 'attendance' | 'leaves' | 'documents' | 'advances' | 'custodies'
  >('employees');
  const [loading, setLoading] = useState(false);

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [schedules, setSchedules] = useState<ShiftScheduleRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [advances, setAdvances] = useState<any[]>([]);
  const [advanceTxs, setAdvanceTxs] = useState<any[]>([]);
  const [selectedAdvanceId, setSelectedAdvanceId] = useState('');
  const [custodies, setCustodies] = useState<any[]>([]);
  const [vaults, setVaults] = useState<any[]>([]);

  // Document form
  const [docEmpId, setDocEmpId] = useState('');
  const [docType, setDocType] = useState('NATIONAL_ID');
  const [docTitle, setDocTitle] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [docExpiry, setDocExpiry] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);

  // Advance form
  const [advEmpId, setAdvEmpId] = useState('');
  const [advVaultId, setAdvVaultId] = useState('');
  const [advAmount, setAdvAmount] = useState('');
  const [advReason, setAdvReason] = useState('');
  const [recoverAmount, setRecoverAmount] = useState('');

  // Custody form
  const [custEmpId, setCustEmpId] = useState('');
  const [custCode, setCustCode] = useState('');
  const [custItem, setCustItem] = useState('');
  const [custCategory, setCustCategory] = useState('DEVICE');
  const [custSerial, setCustSerial] = useState('');
  const [custValue] = useState('0');

  const [search, setSearch] = useState('');
  const [showAddEmp, setShowAddEmp] = useState(false);
  const { dir } = useLocale();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showAddEmp) {
        setShowAddEmp(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showAddEmp]);

  const [empCode, setEmpCode] = useState('');
  const [fullNameAr, setFullNameAr] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('CASHIER');
  const [legalEntityId, setLegalEntityId] = useState(activeLegalEntity?.id || legalEntities[0]?.id || '');
  const [branchId, setBranchId] = useState(activeBranch?.id || branches[0]?.id || '');
  const [hireDate, setHireDate] = useState(new Date().toISOString().slice(0, 10));
  const [posPin, setPosPin] = useState('');

  const [schedEmpId, setSchedEmpId] = useState('');
  const [schedDate, setSchedDate] = useState(new Date().toISOString().slice(0, 10));
  const [schedStart, setSchedStart] = useState('09:00');
  const [schedEnd, setSchedEnd] = useState('17:00');
  const [schedType, setSchedType] = useState('MORNING');

  const [attEmpId, setAttEmpId] = useState('');
  const [leaveEmpId, setLeaveEmpId] = useState('');
  const [leaveType, setLeaveType] = useState('ANNUAL');
  const [leaveStart, setLeaveStart] = useState(new Date().toISOString().slice(0, 10));
  const [leaveEnd, setLeaveEnd] = useState(new Date().toISOString().slice(0, 10));
  const [leaveReason, setLeaveReason] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [empRes, schedRes, attRes, leaveRes, docRes, advRes, custRes] = await Promise.all([
        apiClient.get<any>(`/hr/employees?search=${encodeURIComponent(search)}`),
        apiClient.get<any>('/hr/schedules'),
        apiClient.get<any>('/hr/attendance'),
        apiClient.get<any>('/hr/leaves'),
        apiClient.get<any>('/hr/documents?page=1&limit=50'),
        apiClient.get<any>('/hr/advances?page=1&limit=50'),
        apiClient.get<any>('/hr/custodies?page=1&limit=50'),
      ]);
      const empItems: EmployeeRow[] = Array.isArray(empRes) ? empRes : empRes?.items || [];
      setEmployees(empItems);
      setSchedules(Array.isArray(schedRes) ? schedRes : schedRes?.items || []);
      setAttendance(Array.isArray(attRes) ? attRes : attRes?.items || []);
      setLeaves(Array.isArray(leaveRes) ? leaveRes : leaveRes?.items || []);
      setDocuments(Array.isArray(docRes) ? docRes : docRes?.items || []);
      setAdvances(Array.isArray(advRes) ? advRes : advRes?.items || []);
      setCustodies(Array.isArray(custRes) ? custRes : custRes?.items || []);
      if (legalEntityId) {
        const vRes = await apiClient.get<any>(`/accounting/vaults?legalEntityId=${encodeURIComponent(legalEntityId)}`).catch(() => null);
        if (Array.isArray(vRes)) setVaults(vRes);
        else if (vRes?.items) setVaults(vRes.items);
      }
      if (empItems[0]) {
        if (!schedEmpId) setSchedEmpId(empItems[0].id);
        if (!attEmpId) setAttEmpId(empItems[0].id);
        if (!leaveEmpId) setLeaveEmpId(empItems[0].id);
        if (!docEmpId) setDocEmpId(empItems[0].id);
        if (!advEmpId) setAdvEmpId(empItems[0].id);
        if (!custEmpId) setCustEmpId(empItems[0].id);
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحميل بيانات الموارد البشرية', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!legalEntityId && legalEntities[0]?.id) setLegalEntityId(legalEntities[0].id);
    if (!branchId && branches[0]?.id) setBranchId(branches[0].id);
  }, [legalEntities, branches]);

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/hr/employees', {
        legalEntityId,
        primaryBranchId: branchId,
        employeeCode: empCode,
        fullNameAr,
        phone: phone || null,
        jobTitle,
        hireDate,
        posPin: posPin || null,
      });
      showToast('تمت إضافة الموظف بنجاح', 'success');
      setShowAddEmp(false);
      setEmpCode('');
      setFullNameAr('');
      setPhone('');
      setPosPin('');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'فشل إضافة الموظف', 'error');
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/hr/schedules', {
        employeeId: schedEmpId,
        branchId,
        shiftDate: schedDate,
        startTime: schedStart,
        endTime: schedEnd,
        shiftType: schedType,
      });
      showToast('تمت جدولة الوردية بنجاح', 'success');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'فشل إنشاء الجدول', 'error');
    }
  };

  const handleCheckIn = async () => {
    if (!attEmpId) return;
    try {
      await apiClient.post('/hr/attendance/check-in', {
        employeeId: attEmpId,
        branchId,
      });
      showToast('تم تسجيل الحضور', 'success');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تسجيل الحضور', 'error');
    }
  };

  const handleCheckOut = async () => {
    if (!attEmpId) return;
    try {
      await apiClient.post('/hr/attendance/check-out', { employeeId: attEmpId });
      showToast('تم تسجيل الانصراف', 'success');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تسجيل الانصراف', 'error');
    }
  };

  const handleCreateLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/hr/leaves', {
        employeeId: leaveEmpId,
        leaveType,
        startDate: leaveStart,
        endDate: leaveEnd,
        reason: leaveReason || undefined,
      });
      showToast('تم تقديم طلب الإجازة', 'success');
      setLeaveReason('');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'فشل تقديم طلب الإجازة', 'error');
    }
  };

  const handleReviewLeave = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    try {
      await apiClient.post(`/hr/leaves/${id}/review`, { decision });
      showToast(decision === 'APPROVED' ? 'تم اعتماد الإجازة' : 'تم رفض الإجازة', 'success');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'تعذر مراجعة الطلب', 'error');
    }
  };

  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile) {
      showToast('اختر ملفاً أولاً', 'error');
      return;
    }
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(docFile);
      });
      await apiClient.post('/hr/documents', {
        employeeId: docEmpId,
        documentType: docType,
        documentNumber: docNumber || undefined,
        title: docTitle,
        originalName: docFile.name,
        mimeType: docFile.type || 'application/pdf',
        base64Data,
        expiryDate: docExpiry || undefined,
      });
      showToast('تم رفع المستند بنجاح', 'success');
      setDocTitle('');
      setDocNumber('');
      setDocFile(null);
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'فشل رفع المستند', 'error');
    }
  };

  const handleArchiveDocument = async (id: string) => {
    try {
      await apiClient.post(`/hr/documents/${id}/archive`, {});
      showToast('تم أرشفة المستند', 'success');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'تعذر أرشفة المستند', 'error');
    }
  };

  const handleDisburseAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/hr/advances', {
        employeeId: advEmpId,
        cashVaultId: advVaultId,
        principalAmount: Number(advAmount),
        reason: advReason || undefined,
        idempotencyKey: `adv-ui-${advEmpId}-${Date.now()}`,
      });
      showToast('تم صرف السلفة وترحيل القيد بنجاح', 'success');
      setAdvAmount('');
      setAdvReason('');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'فشل صرف السلفة', 'error');
    }
  };

  const handleRecoverAdvance = async (advanceId: string) => {
    const amt = Number(recoverAmount);
    if (!amt || amt <= 0) {
      showToast('أدخل مبلغ الاسترداد أولاً', 'error');
      return;
    }
    try {
      await apiClient.post(`/hr/advances/${advanceId}/recover`, {
        amount: amt,
        idempotencyKey: `rec-ui-${advanceId}-${Date.now()}`,
      });
      showToast('تم استرداد السلفة وترحيل القيد بنجاح', 'success');
      setRecoverAmount('');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'فشل استرداد السلفة', 'error');
    }
  };

  const handleLoadAdvanceTxs = async (advanceId: string) => {
    setSelectedAdvanceId(advanceId);
    try {
      const res = await apiClient.get<any>(`/hr/advances/${advanceId}/transactions?page=1&limit=50`);
      setAdvanceTxs(Array.isArray(res) ? res : res?.items || []);
    } catch {
      setAdvanceTxs([]);
    }
  };

  const handleHandoverCustody = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/hr/custodies', {
        employeeId: custEmpId,
        custodyCode: custCode,
        itemName: custItem,
        category: custCategory,
        serialNumber: custSerial || undefined,
        estimatedValue: Number(custValue || 0),
        responsibilityAccepted: true,
        idempotencyKey: `cust-ui-${custCode}-${Date.now()}`,
      });
      showToast('تم تسليم العهدة بنجاح', 'success');
      setCustCode('');
      setCustItem('');
      setCustSerial('');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'فشل تسليم العهدة', 'error');
    }
  };

  const handleReturnCustody = async (id: string, status: 'RETURNED' | 'DAMAGED' | 'LOST') => {
    try {
      await apiClient.post(`/hr/custodies/${id}/return`, { status });
      showToast('تم تحديث حالة العهدة', 'success');
      await loadAll();
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحديث العهدة', 'error');
    }
  };

  const empName = (id: string) =>
    employees.find((e) => e.id === id)?.fullNameAr || id.slice(0, 8);

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">الموظفون والموارد البشرية</h1>
          <p className="text-sm text-slate-500">
            إدارة ملفات الموظفين، تعيين الفروع، جداول الورديات، الحضور والانصراف، والإجازات (بدون مسير الرواتب).
          </p>
        </div>
        <button
          onClick={() => setShowAddEmp((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#0D6E4F] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0A583F]"
        >
          <Plus className="w-4 h-4" />
          إضافة موظف
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {[
          { id: 'employees', label: 'الموظفون', icon: Users },
          { id: 'schedules', label: 'جداول الورديات', icon: Calendar },
          { id: 'attendance', label: 'الحضور والانصراف', icon: Clock },
          { id: 'leaves', label: 'الإجازات', icon: FileCheck2 },
          { id: 'documents', label: 'المستندات والملفات', icon: FolderOpen },
          { id: 'advances', label: 'السلف', icon: Wallet },
          { id: 'custodies', label: 'العُهد', icon: Briefcase },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id as any)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
                subTab === t.id
                  ? 'bg-[#0D6E4F] text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {showAddEmp && (
        <form
          onSubmit={handleCreateEmployee}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-2xl bg-white p-6 border border-slate-200 shadow-sm"
        >
          <input
            value={empCode}
            onChange={(e) => setEmpCode(e.target.value)}
            placeholder="رمز الموظف (EMP-001)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            value={fullNameAr}
            onChange={(e) => setFullNameAr(e.target.value)}
            placeholder="الاسم الكامل"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="رقم الجوال"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="CASHIER">كاشير</option>
            <option value="WAITER">نادل / صالة</option>
            <option value="CHEF">طاهٍ / مطبخ</option>
            <option value="DRIVER">مندوب توصيل</option>
            <option value="BRANCH_MANAGER">مدير فرع</option>
            <option value="ACCOUNTANT">محاسب</option>
            <option value="STAFF">موظف عام</option>
          </select>
          <select
            value={legalEntityId}
            onChange={(e) => setLegalEntityId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          >
            {legalEntities.map((le) => (
              <option key={le.id} value={le.id}>
                {le.commercialName || le.legalName}
              </option>
            ))}
          </select>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={hireDate}
            onChange={(e) => setHireDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            required
          />
          <input
            type="password"
            value={posPin}
            onChange={(e) => setPosPin(e.target.value)}
            placeholder="رمز PIN لنقاط البيع (اختياري)"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            حفظ الموظف
          </button>
        </form>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          جارٍ التحميل...
        </div>
      )}

      {subTab === 'employees' && (
        <div className="space-y-4 rounded-2xl bg-white p-6 border border-slate-200">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالاسم أو الرمز أو الجوال..."
                className="w-full rounded-lg border border-slate-300 pr-9 pl-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={() => void loadAll()}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
            >
              بحث
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-3">الرمز</th>
                  <th className="p-3">الاسم</th>
                  <th className="p-3">المسمى الوظيفي</th>
                  <th className="p-3">الجوال</th>
                  <th className="p-3">تاريخ التعيين</th>
                  <th className="p-3">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employees.map((emp) => (
                  <tr key={emp.id}>
                    <td className="p-3 font-mono">{emp.employeeCode}</td>
                    <td className="p-3 font-medium">{emp.fullNameAr}</td>
                    <td className="p-3">{emp.jobTitle}</td>
                    <td className="p-3">{emp.phone || '-'}</td>
                    <td className="p-3">{emp.hireDate}</td>
                    <td className="p-3">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        {emp.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400">
                      لا يوجد موظفون مسجلون بعد.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'schedules' && (
        <div className="space-y-4 rounded-2xl bg-white p-6 border border-slate-200">
          <form onSubmit={handleCreateSchedule} className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <select
              value={schedEmpId}
              onChange={(e) => setSchedEmpId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">اختر الموظف</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullNameAr}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={schedDate}
              onChange={(e) => setSchedDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <input
              value={schedStart}
              onChange={(e) => setSchedStart(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <input
              value={schedEnd}
              onChange={(e) => setSchedEnd(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <select
              value={schedType}
              onChange={(e) => setSchedType(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="MORNING">صباحي</option>
              <option value="EVENING">مسائي</option>
              <option value="NIGHT">ليلي</option>
              <option value="FULL_DAY">يوم كامل</option>
            </select>
            <button
              type="submit"
              className="rounded-lg bg-[#0D6E4F] px-4 py-2 text-sm text-white hover:bg-[#0A583F]"
            >
              جدولة
            </button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-3">الموظف</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">من</th>
                  <th className="p-3">إلى</th>
                  <th className="p-3">الوردية</th>
                  <th className="p-3">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <td className="p-3">{empName(s.employeeId)}</td>
                    <td className="p-3">{s.shiftDate}</td>
                    <td className="p-3">{s.startTime}</td>
                    <td className="p-3">{s.endTime}</td>
                    <td className="p-3">{s.shiftType}</td>
                    <td className="p-3">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'attendance' && (
        <div className="space-y-4 rounded-2xl bg-white p-6 border border-slate-200">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={attEmpId}
              onChange={(e) => setAttEmpId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">اختر الموظف</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullNameAr}
                </option>
              ))}
            </select>
            <button
              onClick={handleCheckIn}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700"
            >
              <LogIn className="w-4 h-4" />
              تسجيل حضور
            </button>
            <button
              onClick={handleCheckOut}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-700"
            >
              <LogOut className="w-4 h-4" />
              تسجيل انصراف
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3">الموظف</th>
                <th className="p-3">التاريخ</th>
                <th className="p-3">وقت الدخول</th>
                <th className="p-3">وقت الخروج</th>
                <th className="p-3">الدقائق</th>
                <th className="p-3">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {attendance.map((a) => (
                <tr key={a.id}>
                  <td className="p-3">{empName(a.employeeId)}</td>
                  <td className="p-3">{a.attendanceDate}</td>
                  <td className="p-3">{new Date(a.checkInAt).toLocaleTimeString('ar-SA')}</td>
                  <td className="p-3">
                    {a.checkOutAt ? new Date(a.checkOutAt).toLocaleTimeString('ar-SA') : '-'}
                  </td>
                  <td className="p-3">{a.workedMinutes ?? '-'}</td>
                  <td className="p-3">{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {subTab === 'leaves' && (
        <div className="space-y-4 rounded-2xl bg-white p-6 border border-slate-200">
          <form onSubmit={handleCreateLeave} className="grid grid-cols-1 md:grid-cols-6 gap-3">
            <select
              value={leaveEmpId}
              onChange={(e) => setLeaveEmpId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            >
              <option value="">اختر الموظف</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullNameAr}
                </option>
              ))}
            </select>
            <select
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="ANNUAL">سنوية</option>
              <option value="SICK">مرضية</option>
              <option value="EMERGENCY">اضطرارية</option>
              <option value="UNPAID">بدون راتب</option>
            </select>
            <input
              type="date"
              value={leaveStart}
              onChange={(e) => setLeaveStart(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <input
              type="date"
              value={leaveEnd}
              onChange={(e) => setLeaveEnd(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              required
            />
            <input
              value={leaveReason}
              onChange={(e) => setLeaveReason(e.target.value)}
              placeholder="السبب"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-[#0D6E4F] px-4 py-2 text-sm text-white hover:bg-[#0A583F]"
            >
              تقديم الطلب
            </button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3">الموظف</th>
                <th className="p-3">النوع</th>
                <th className="p-3">من</th>
                <th className="p-3">إلى</th>
                <th className="p-3">الأيام</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leaves.map((l) => (
                <tr key={l.id}>
                  <td className="p-3">{empName(l.employeeId)}</td>
                  <td className="p-3">{l.leaveType}</td>
                  <td className="p-3">{l.startDate}</td>
                  <td className="p-3">{l.endDate}</td>
                  <td className="p-3">{l.daysCount}</td>
                  <td className="p-3">{l.status}</td>
                  <td className="p-3 flex gap-2">
                    {l.status === 'PENDING' && (
                      <>
                        <button
                          onClick={() => void handleReviewLeave(l.id, 'APPROVED')}
                          className="text-emerald-600 hover:text-emerald-800"
                          title="اعتماد"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => void handleReviewLeave(l.id, 'REJECTED')}
                          className="text-rose-600 hover:text-rose-800"
                          title="رفض"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {subTab === 'documents' && (
        <div className="space-y-4">
          <form onSubmit={handleUploadDocument} className="grid grid-cols-1 md:grid-cols-6 gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <select value={docEmpId} onChange={(e) => setDocEmpId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" required>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.fullNameAr}</option>
              ))}
            </select>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="NATIONAL_ID">هوية وطنية</option>
              <option value="IQAMA">إقامة</option>
              <option value="PASSPORT">جواز سفر</option>
              <option value="HEALTH_CERTIFICATE">شهادة صحية</option>
              <option value="CONTRACT">عقد عمل</option>
              <option value="OTHER">أخرى</option>
            </select>
            <input placeholder="عنوان المستند" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
            <input placeholder="رقم المستند" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input type="date" value={docExpiry} onChange={(e) => setDocExpiry(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setDocFile(e.target.files?.[0] || null)} className="text-xs" required />
            <button type="submit" className="md:col-span-6 rounded-lg bg-[#0D6E4F] px-4 py-2 text-sm font-medium text-white hover:bg-[#0A583F]">
              رفع مستند الموظف
            </button>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-3">الموظف</th>
                  <th className="p-3">النوع</th>
                  <th className="p-3">العنوان</th>
                  <th className="p-3">الانتهاء</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} className="border-t border-slate-100">
                    <td className="p-3">{empName(doc.employeeId)}</td>
                    <td className="p-3">{doc.documentType}</td>
                    <td className="p-3">{doc.title}</td>
                    <td className="p-3">{doc.expiryDate || '-'}</td>
                    <td className="p-3">{doc.status}</td>
                    <td className="p-3">
                      {doc.status === 'ACTIVE' && (
                        <button onClick={() => void handleArchiveDocument(doc.id)} className="text-xs text-rose-600 hover:underline">
                          أرشفة
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'advances' && (
        <div className="space-y-4">
          <form onSubmit={handleDisburseAdvance} className="grid grid-cols-1 md:grid-cols-5 gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <select value={advEmpId} onChange={(e) => setAdvEmpId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" required>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.fullNameAr}</option>
              ))}
            </select>
            <select value={advVaultId} onChange={(e) => setAdvVaultId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" required>
              <option value="">اختر خزينة الصرف...</option>
              {vaults.map((v) => (
                <option key={v.id} value={v.id}>{v.nameAr} ({Number(v.balance).toFixed(2)})</option>
              ))}
            </select>
            <input type="number" step="0.01" placeholder="مبلغ السلفة" value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
            <input placeholder="السبب" value={advReason} onChange={(e) => setAdvReason(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
              صرف سلفة
            </button>
          </form>

          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 border border-slate-200">
            <input type="number" step="0.01" placeholder="مبلغ الاسترداد" value={recoverAmount} onChange={(e) => setRecoverAmount(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white" />
            <span className="text-xs text-slate-500">أدخل مبلغ الاسترداد ثم اضغط استرداد أمام السلفة المفتوحة</span>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-3">رقم السلفة</th>
                  <th className="p-3">الموظف</th>
                  <th className="p-3">المبلغ</th>
                  <th className="p-3">المسترد</th>
                  <th className="p-3">المتبقي</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {advances.map((adv) => (
                  <tr key={adv.id} className="border-t border-slate-100">
                    <td className="p-3 font-mono text-xs">{adv.advanceNumber}</td>
                    <td className="p-3">{empName(adv.employeeId)}</td>
                    <td className="p-3 font-mono">{Number(adv.principalAmount).toFixed(2)}</td>
                    <td className="p-3 font-mono">{Number(adv.recoveredAmount).toFixed(2)}</td>
                    <td className="p-3 font-mono font-bold">{Number(adv.remainingAmount).toFixed(2)}</td>
                    <td className="p-3">{adv.status}</td>
                    <td className="p-3 flex gap-2">
                      {adv.status !== 'SETTLED' && (
                        <button onClick={() => void handleRecoverAdvance(adv.id)} className="text-xs text-emerald-700 hover:underline">
                          استرداد
                        </button>
                      )}
                      <button onClick={() => void handleLoadAdvanceTxs(adv.id)} className="text-xs text-[#0D6E4F] hover:underline">
                        الحركات
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedAdvanceId && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-bold text-slate-800 mb-2">سجل حركات السلفة</h3>
              <ul className="space-y-1 text-xs text-slate-600">
                {advanceTxs.map((tx) => (
                  <li key={tx.id} className="flex justify-between border-b border-slate-100 py-1">
                    <span>{tx.transactionType} — {tx.notes}</span>
                    <span className="font-mono">{Number(tx.amount).toFixed(2)} (المتبقي: {Number(tx.balanceAfter).toFixed(2)})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {subTab === 'custodies' && (
        <div className="space-y-4">
          <form onSubmit={handleHandoverCustody} className="grid grid-cols-1 md:grid-cols-6 gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <select value={custEmpId} onChange={(e) => setCustEmpId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" required>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.fullNameAr}</option>
              ))}
            </select>
            <input placeholder="كود العهدة" value={custCode} onChange={(e) => setCustCode(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
            <input placeholder="اسم العهدة" value={custItem} onChange={(e) => setCustItem(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
            <select value={custCategory} onChange={(e) => setCustCategory(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="DEVICE">جهاز</option>
              <option value="KEY">مفتاح</option>
              <option value="UNIFORM">زي رسمي</option>
              <option value="CASH_FLOAT">عهدة نقدية</option>
              <option value="VEHICLE">مركبة</option>
              <option value="OTHER">أخرى</option>
            </select>
            <input placeholder="الرقم التسلسلي" value={custSerial} onChange={(e) => setCustSerial(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" className="rounded-lg bg-[#0D6E4F] px-4 py-2 text-sm font-medium text-white hover:bg-[#0A583F]">
              تسليم عهدة
            </button>
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-3">الكود</th>
                  <th className="p-3">الموظف</th>
                  <th className="p-3">العهدة</th>
                  <th className="p-3">التصنيف</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {custodies.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="p-3 font-mono text-xs">{c.custodyCode}</td>
                    <td className="p-3">{empName(c.employeeId)}</td>
                    <td className="p-3">{c.itemName}</td>
                    <td className="p-3">{c.category}</td>
                    <td className="p-3">{c.status}</td>
                    <td className="p-3 flex gap-2">
                      {c.status === 'HANDED_OVER' && (
                        <>
                          <button onClick={() => void handleReturnCustody(c.id, 'RETURNED')} className="text-xs text-emerald-700 hover:underline">
                            استلام سليم
                          </button>
                          <button onClick={() => void handleReturnCustody(c.id, 'DAMAGED')} className="text-xs text-rose-600 hover:underline">
                            تالف
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
