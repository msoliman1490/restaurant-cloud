import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  ShieldCheck,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  X,
  Lock,
} from 'lucide-react';

interface PermissionItem {
  id: string;
  code: string;
  resource: string;
  action: string;
  description?: string | null;
}

interface RoleWithPermissions {
  id: string;
  code: string;
  name: string;
  isSystemRole: boolean;
  tenantId?: string | null;
  permissions: PermissionItem[];
}

export const RolesView: React.FC = () => {
  const { activeTenant } = useAuth();
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [allPermissions, setAllPermissions] = useState<PermissionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Create Role Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [roleForm, setRoleForm] = useState({
    code: '',
    name: '',
    permissionIds: [] as string[],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        apiClient.request<RoleWithPermissions[]>('/roles'),
        apiClient.request<PermissionItem[]>('/permissions'),
      ]);
      setRoles(rolesRes || []);
      setAllPermissions(permsRes || []);
    } catch (err: any) {
      setError(err?.message || 'فشل في تحميل الأدوار والصلاحيات');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roleForm.permissionIds.length === 0) {
      setError('يرجى تحديد صلاحية واحدة على الأقل');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await apiClient.request('/roles', {
        method: 'POST',
        body: JSON.stringify(roleForm),
      });
      setSuccessMsg('تم إنشاء الدور المخصص بنجاح');
      setIsModalOpen(false);
      setRoleForm({ code: '', name: '', permissionIds: [] });
      await fetchData();
    } catch (err: any) {
      setError(err?.message || 'فشل في إنشاء الدور');
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
            <ShieldCheck className="w-7 h-7 text-indigo-600" />
            الأدوار والصلاحيات (RBAC)
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            إدارة مصفوفة الصلاحيات، أدوار النظام الافتراضية، والأدوار المخصصة للمنشأة ({activeTenant?.name}).
          </p>
        </div>
        <button
          onClick={() => {
            setRoleForm({ code: '', name: '', permissionIds: [] });
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 shadow-sm transition-all"
        >
          <Plus className="w-4 h-4" />
          إنشاء دور مخصص
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

      {/* Roles Grid */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">الأدوار المتاحة ({roles.length})</h2>
            <p className="text-xs text-slate-500">مجموعات الصلاحيات المعرفة لتحديد صلاحيات المستخدمين بدقة.</p>
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
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {roles.map((r) => (
              <div
                key={r.id}
                className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-indigo-300 transition-all shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs bg-slate-200/80 text-slate-700 px-2 py-0.5 rounded-md font-bold">
                        {r.code}
                      </span>
                      <h3 className="font-bold text-slate-900 text-base">{r.name}</h3>
                    </div>
                  </div>
                  {r.isSystemRole ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full border border-indigo-100">
                      <Lock className="w-3 h-3" />
                      دور نظام قياسي
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full border border-emerald-100">
                      مخصص للمنشأة
                    </span>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-200/60">
                  <div className="text-xs font-semibold text-slate-500 mb-2">
                    الصلاحيات الممنوحة ({r.permissions.length}):
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {r.permissions.map((p) => (
                      <span
                        key={p.id}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-mono"
                        title={p.description || p.code}
                      >
                        {p.code}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Role Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900">إنشاء دور مخصص جديد</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRole} className="space-y-4 text-sm">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">رمز الدور (Code) *</label>
                <input
                  type="text"
                  required
                  value={roleForm.code}
                  onChange={(e) => setRoleForm({ ...roleForm, code: e.target.value.toUpperCase() })}
                  placeholder="مثال: SHIFT_SUPERVISOR"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">اسم الدور بالعربية *</label>
                <input
                  type="text"
                  required
                  value={roleForm.name}
                  onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                  placeholder="مثال: مشرف وردية"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  تحديد الصلاحيات ({roleForm.permissionIds.length} محددة) *
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2 border border-slate-200 rounded-xl">
                  {allPermissions.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={roleForm.permissionIds.includes(p.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setRoleForm({
                              ...roleForm,
                              permissionIds: [...roleForm.permissionIds, p.id],
                            });
                          } else {
                            setRoleForm({
                              ...roleForm,
                              permissionIds: roleForm.permissionIds.filter((id) => id !== p.id),
                            });
                          }
                        }}
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="font-mono">{p.code}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
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
                  إنشاء الدور
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
