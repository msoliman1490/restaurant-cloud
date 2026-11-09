import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Building2,
  GitBranch,
  Plus,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';

interface LegalEntityItem {
  id: string;
  tenantId: string;
  legalName: string;
  commercialName?: string | null;
  crNumber?: string | null;
  vatNumber: string;
  functionalCurrency: string;
  timezone: string;
}

interface BranchItem {
  id: string;
  tenantId: string;
  legalEntityId: string;
  code: string;
  name: string;
  businessType: string;
  timezone: string;
}

export const CompaniesView: React.FC = () => {
  const { activeTenant, refreshHierarchy } = useAuth();
  const [entities, setEntities] = useState<LegalEntityItem[]>([]);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modals state
  const [isEntityModalOpen, setIsEntityModalOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<LegalEntityItem | null>(null);
  const [entityForm, setEntityForm] = useState({
    legalName: '',
    commercialName: '',
    crNumber: '',
    vatNumber: '',
    functionalCurrency: 'SAR',
    timezone: 'Asia/Riyadh',
  });

  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchItem | null>(null);
  const [branchForm, setBranchForm] = useState({
    legalEntityId: '',
    code: '',
    name: '',
    businessType: 'RESTAURANT',
    timezone: 'Asia/Riyadh',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [entitiesRes, branchesRes] = await Promise.all([
        apiClient.request<LegalEntityItem[]>('/legal-entities'),
        apiClient.request<BranchItem[]>('/branches'),
      ]);
      setEntities(entitiesRes || []);
      setBranches(branchesRes || []);
    } catch (err: any) {
      setError(err?.message || 'فشل في تحميل بيانات الشركات والفروع');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      if (editingEntity) {
        await apiClient.request(`/legal-entities/${editingEntity.id}`, {
          method: 'PATCH',
          body: JSON.stringify(entityForm),
        });
        setSuccessMsg('تم تحديث بيانات الشركة بنجاح');
      } else {
        await apiClient.request('/legal-entities', {
          method: 'POST',
          body: JSON.stringify(entityForm),
        });
        setSuccessMsg('تم إنشاء الشركة القانونية بنجاح');
      }
      setIsEntityModalOpen(false);
      setEditingEntity(null);
      await fetchData();
      await refreshHierarchy();
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء حفظ الشركة');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      if (editingBranch) {
        await apiClient.request(`/branches/${editingBranch.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: branchForm.name,
            code: branchForm.code,
            businessType: branchForm.businessType,
            timezone: branchForm.timezone,
          }),
        });
        setSuccessMsg('تم تحديث بيانات الفرع بنجاح');
      } else {
        await apiClient.request('/branches', {
          method: 'POST',
          body: JSON.stringify(branchForm),
        });
        setSuccessMsg('تم إضافة الفرع الجديد بنجاح');
      }
      setIsBranchModalOpen(false);
      setEditingBranch(null);
      await fetchData();
      await refreshHierarchy();
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء حفظ الفرع');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredBranches = selectedEntityId === 'all'
    ? branches
    : branches.filter((b) => b.legalEntityId === selectedEntityId);

  return (
    <div className="space-y-8" dir="rtl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="w-7 h-7 text-indigo-600" />
            إدارة الشركات والفروع
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            إدارة الهيكل التنظيمي، الكيانات الضريبية المعتمدة، والفروع التشغيلية تحت ({activeTenant?.name}).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setEditingEntity(null);
              setEntityForm({
                legalName: '',
                commercialName: '',
                crNumber: '',
                vatNumber: '',
                functionalCurrency: 'SAR',
                timezone: 'Asia/Riyadh',
              });
              setIsEntityModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            إضافة شركة جديدة
          </button>
          <button
            onClick={() => {
              setEditingBranch(null);
              setBranchForm({
                legalEntityId: entities[0]?.id || '',
                code: '',
                name: '',
                businessType: 'RESTAURANT',
                timezone: 'Asia/Riyadh',
              });
              setIsBranchModalOpen(true);
            }}
            disabled={entities.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 transition-all"
          >
            <GitBranch className="w-4 h-4" />
            إضافة فرع جديد
          </button>
        </div>
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

      {/* Legal Entities Section */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">الشركات والكيانات القانونية ({entities.length})</h2>
            <p className="text-xs text-slate-500">الكيانات المعرفة لضريبة القيمة المضافة وإصدار الفواتير القانونية.</p>
          </div>
          <button
            onClick={fetchData}
            className="p-2 text-slate-400 hover:text-indigo-600 rounded-xl hover:bg-slate-50 transition-all"
            title="تحديث البيانات"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {isLoading ? (
          <div className="py-12 flex justify-center items-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : entities.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">
            لا توجد شركات مسجلة حالياً. انقر على "إضافة شركة جديدة" للبدء.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {entities.map((entity) => (
              <div
                key={entity.id}
                className="p-5 rounded-2xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-indigo-300 transition-all shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">{entity.legalName}</h3>
                    {entity.commercialName && (
                      <p className="text-xs text-slate-500 font-medium">{entity.commercialName}</p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setEditingEntity(entity);
                      setEntityForm({
                        legalName: entity.legalName,
                        commercialName: entity.commercialName || '',
                        crNumber: entity.crNumber || '',
                        vatNumber: entity.vatNumber,
                        functionalCurrency: entity.functionalCurrency,
                        timezone: entity.timezone,
                      });
                      setIsEntityModalOpen(true);
                    }}
                    className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                    title="تعديل"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="text-xs text-slate-600 space-y-1.5 pt-2 border-t border-slate-200/60 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">الرقم الضريبي:</span>
                    <strong className="text-slate-800">{entity.vatNumber}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">السجل التجاري:</span>
                    <span>{entity.crNumber || 'غير مسجل'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-sans">العملة / التوقيت:</span>
                    <span>{entity.functionalCurrency} ({entity.timezone})</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Branches Section */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">الفروع التشغيلية ({filteredBranches.length})</h2>
            <p className="text-xs text-slate-500">مواقع تقديم الخدمة ونقاط البيع المربوطة بالشركات.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">تصفية حسب الشركة:</span>
            <select
              value={selectedEntityId}
              onChange={(e) => setSelectedEntityId(e.target.value)}
              className="text-xs px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="all">جميع الشركات ({branches.length} فرع)</option>
              {entities.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.legalName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="py-12 flex justify-center items-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : filteredBranches.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">
            لا توجد فروع مسجلة لهذه الشركة.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBranches.map((branch) => {
              const entity = entities.find((e) => e.id === branch.legalEntityId);
              return (
                <div
                  key={branch.id}
                  className="p-5 rounded-2xl border border-slate-200 bg-white hover:border-indigo-300 transition-all shadow-sm space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-bold">
                          {branch.code}
                        </span>
                        <h3 className="font-bold text-slate-900 text-base">{branch.name}</h3>
                      </div>
                      <p className="text-xs text-indigo-600 font-medium mt-1">
                        {entity?.legalName || 'شركة غير محددة'}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setEditingBranch(branch);
                        setBranchForm({
                          legalEntityId: branch.legalEntityId,
                          code: branch.code,
                          name: branch.name,
                          businessType: branch.businessType,
                          timezone: branch.timezone,
                        });
                        setIsBranchModalOpen(true);
                      }}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                      title="تعديل"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="text-xs text-slate-500 flex items-center justify-between pt-2 border-t border-slate-100">
                    <span>نوع النشاط: <strong className="text-slate-700">{branch.businessType}</strong></span>
                    <span>{branch.timezone}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Entity Modal */}
      {isEntityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900">
                {editingEntity ? 'تعديل بيانات الشركة' : 'إضافة شركة قانونية جديدة'}
              </h3>
              <button
                onClick={() => setIsEntityModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEntity} className="space-y-4 text-sm">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">الاسم القانوني للشركة *</label>
                <input
                  type="text"
                  required
                  value={entityForm.legalName}
                  onChange={(e) => setEntityForm({ ...entityForm, legalName: e.target.value })}
                  placeholder="مثال: شركة ضيافة السحاب المحدودة"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">الاسم التجاري (اختياري)</label>
                <input
                  type="text"
                  value={entityForm.commercialName}
                  onChange={(e) => setEntityForm({ ...entityForm, commercialName: e.target.value })}
                  placeholder="مثال: مطاعم كلاود"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">الرقم الضريبي (15 رقم) *</label>
                  <input
                    type="text"
                    required
                    pattern="^\d{15}$"
                    value={entityForm.vatNumber}
                    onChange={(e) => setEntityForm({ ...entityForm, vatNumber: e.target.value })}
                    placeholder="300000000000003"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">السجل التجاري</label>
                  <input
                    type="text"
                    value={entityForm.crNumber}
                    onChange={(e) => setEntityForm({ ...entityForm, crNumber: e.target.value })}
                    placeholder="1010000000"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">عملة القوائم المالية</label>
                  <input
                    type="text"
                    required
                    maxLength={3}
                    value={entityForm.functionalCurrency}
                    onChange={(e) => setEntityForm({ ...entityForm, functionalCurrency: e.target.value.toUpperCase() })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">المنطقة الزمنية</label>
                  <input
                    type="text"
                    required
                    value={entityForm.timezone}
                    onChange={(e) => setEntityForm({ ...entityForm, timezone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEntityModalOpen(false)}
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
                  {editingEntity ? 'حفظ التعديلات' : 'إنشاء الشركة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Branch Modal */}
      {isBranchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-slate-200 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-900">
                {editingBranch ? 'تعديل بيانات الفرع' : 'إضافة فرع تشغيلي جديد'}
              </h3>
              <button
                onClick={() => setIsBranchModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBranch} className="space-y-4 text-sm">
              {!editingBranch && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">الشركة التابع لها *</label>
                  <select
                    required
                    value={branchForm.legalEntityId}
                    onChange={(e) => setBranchForm({ ...branchForm, legalEntityId: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.legalName} ({e.vatNumber})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">رمز الفرع (الكود) *</label>
                  <input
                    type="text"
                    required
                    value={branchForm.code}
                    onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value.toUpperCase() })}
                    placeholder="مثال: BR-02"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">اسم الفرع *</label>
                  <input
                    type="text"
                    required
                    value={branchForm.name}
                    onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                    placeholder="مثال: فرع التحلية"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">نوع النشاط التشغيلي</label>
                  <select
                    value={branchForm.businessType}
                    onChange={(e) => setBranchForm({ ...branchForm, businessType: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="RESTAURANT">مطعم (Restaurant)</option>
                    <option value="CAFE">مقهى (Cafe)</option>
                    <option value="BAKERY">مخبز وحلويات (Bakery)</option>
                    <option value="CLOUD_KITCHEN">مطبخ سحابي (Cloud Kitchen)</option>
                    <option value="RETAIL">تجزئة وتموينات (Retail)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">المنطقة الزمنية</label>
                  <input
                    type="text"
                    required
                    value={branchForm.timezone}
                    onChange={(e) => setBranchForm({ ...branchForm, timezone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsBranchModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingBranch ? 'حفظ التعديلات' : 'إضافة الفرع'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
