import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Users,
  UserPlus,
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  X,
  Lock,
  Unlock,
} from 'lucide-react';

interface MemberItem {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  phone?: string | null;
  userStatus: string;
  membershipStatus: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  createdAt: string;
  scopes: Array<{
    id: string;
    membershipId: string;
    scopeType: string;
    scopeId: string;
    accessMode: string;
  }>;
}

interface RoleItem {
  id: string;
  code: string;
  name: string;
  isSystemRole: boolean;
}

export const UsersView: React.FC = () => {
  const { hierarchy } = useAuth();
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Invite Modal
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    displayName: '',
    email: '',
    phone: '',
    password: '',
    roleId: '',
    selectedBranchIds: [] as string[],
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [membersRes, rolesRes] = await Promise.all([
        apiClient.request<MemberItem[]>('/users'),
        apiClient.request<RoleItem[]>('/roles'),
      ]);
      setMembers(membersRes || []);
      setRoles(rolesRes || []);
      if (rolesRes && rolesRes.length > 0 && !inviteForm.roleId) {
        setInviteForm((prev) => ({ ...prev, roleId: rolesRes[0].id }));
      }
    } catch (err: any) {
      setError(err?.message || 'فشل في تحميل المستخدمين والصلاحيات');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleToggleStatus = async (member: MemberItem) => {
    const nextStatus = member.membershipStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    try {
      await apiClient.request(`/users/${member.userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setSuccessMsg(`تم تغيير حالة المستخدم '${member.displayName}' إلى ${nextStatus === 'ACTIVE' ? 'نشط' : 'معلق'}`);
      await fetchData();
    } catch (err: any) {
      setError(err?.message || 'فشل في تحديث حالة المستخدم');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const scopes = inviteForm.selectedBranchIds.map((branchId) => ({
        scopeType: 'BRANCH',
        scopeId: branchId,
      }));

      await apiClient.request('/users', {
        method: 'POST',
        body: JSON.stringify({
          displayName: inviteForm.displayName,
          email: inviteForm.email,
          phone: inviteForm.phone || undefined,
          password: inviteForm.password,
          roleId: inviteForm.roleId,
          scopes,
        }),
      });

      setSuccessMsg('تمت إضافة المستخدم بنجاح');
      setIsInviteModalOpen(false);
      setInviteForm({
        displayName: '',
        email: '',
        phone: '',
        password: '',
        roleId: roles[0]?.id || '',
        selectedBranchIds: [],
      });
      await fetchData();
    } catch (err: any) {
      setError(err?.message || 'فشل في إنشاء المستخدم');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-7 h-7 text-indigo-600" />
            المستخدمون والصلاحيات
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            إدارة أعضاء الفريق، أدوارهم التشغيلية، ونطاق الفروع المصرح لهم بالوصول إليها.
          </p>
        </div>
        <button
          onClick={() => setIsInviteModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 shadow-sm transition-all"
        >
          <UserPlus className="w-4 h-4" />
          إضافة مستخدم جديد
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-3 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="mr-auto text-rose-500 hover:text-rose-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center gap-3 text-sm">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="mr-auto text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Users Table Card */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">أعضاء المنشأة ({members.length})</h2>
            <p className="text-xs text-slate-500">الحسابات النشطة والصلاحيات المرتبطة بالمنشأة.</p>
          </div>
          <button
            onClick={fetchData}
            className="p-2 text-slate-400 hover:text-indigo-600 rounded-xl hover:bg-slate-50 transition-all"
            title="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {isLoading ? (
          <div className="py-16 flex justify-center items-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">
            لا يوجد مستخدمون مسجلون.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs font-semibold border-b border-slate-200/60">
                <tr>
                  <th className="px-6 py-4">المستخدم</th>
                  <th className="px-6 py-4">الدور الوظيفي</th>
                  <th className="px-6 py-4">نطاق الفروع (Scopes)</th>
                  <th className="px-6 py-4">الحالة</th>
                  <th className="px-6 py-4">تاريخ الانضمام</th>
                  <th className="px-6 py-4 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {members.map((m) => (
                  <tr key={m.membershipId} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <span className="font-bold text-slate-900 block">{m.displayName}</span>
                        <span className="text-xs text-slate-400 font-mono">{m.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                        <Shield className="w-3.5 h-3.5" />
                        {m.roleName}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {m.scopes.length === 0 ? (
                        <span className="text-xs text-slate-400 font-medium">كل الفروع (شامل)</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {m.scopes.map((sc) => {
                            const branch = hierarchy?.branches.find((b) => b.id === sc.scopeId);
                            return (
                              <span
                                key={sc.id}
                                className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium"
                              >
                                {branch?.name || sc.scopeId.slice(0, 8)}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                          m.membershipStatus === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {m.membershipStatus === 'ACTIVE' ? 'نشط' : 'معلق'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-400 font-mono">
                      {new Date(m.createdAt).toLocaleDateString('ar-SA')}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleToggleStatus(m)}
                        className={`p-2 rounded-xl border text-xs font-semibold transition-all inline-flex items-center gap-1 ${
                          m.membershipStatus === 'ACTIVE'
                            ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                            : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                        }`}
                        title={m.membershipStatus === 'ACTIVE' ? 'تعليق الحساب' : 'تنشيط الحساب'}
                      >
                        {m.membershipStatus === 'ACTIVE' ? (
                          <>
                            <Lock className="w-3.5 h-3.5" />
                            تعليق
                          </>
                        ) : (
                          <>
                            <Unlock className="w-3.5 h-3.5" />
                            تنشيط
                          </>
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite User Modal */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900">إضافة مستخدم جديد</h3>
              <button
                onClick={() => setIsInviteModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4 text-sm">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">اسم المستخدم الكامل *</label>
                <input
                  type="text"
                  required
                  value={inviteForm.displayName}
                  onChange={(e) => setInviteForm({ ...inviteForm, displayName: e.target.value })}
                  placeholder="مثال: أحمد عبد الله"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">البريد الإلكتروني *</label>
                <input
                  type="email"
                  required
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  placeholder="ahmed@example.com"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={inviteForm.phone}
                    onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })}
                    placeholder="0501234567"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">كلمة المرور *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={inviteForm.password}
                    onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
                    placeholder="8 محارف كحد أدنى"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">الدور الوظيفي والصلاحيات *</label>
                <select
                  required
                  value={inviteForm.roleId}
                  onChange={(e) => setInviteForm({ ...inviteForm, roleId: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
              </div>

              {hierarchy?.branches && hierarchy.branches.length > 0 && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    الفروع المصرح بها (نطاق الوصول):
                  </label>
                  <p className="text-xs text-slate-400 mb-2">
                    اتركها فارغة إذا كان للمستخدم وصول شامل لكل فروع المنشأة.
                  </p>
                  <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 border border-slate-200 rounded-xl">
                    {hierarchy.branches.map((b) => (
                      <label key={b.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={inviteForm.selectedBranchIds.includes(b.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setInviteForm({
                                ...inviteForm,
                                selectedBranchIds: [...inviteForm.selectedBranchIds, b.id],
                              });
                            } else {
                              setInviteForm({
                                ...inviteForm,
                                selectedBranchIds: inviteForm.selectedBranchIds.filter((id) => id !== b.id),
                              });
                            }
                          }}
                          className="rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>{b.name} ({b.code})</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  إضافة المستخدم
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
