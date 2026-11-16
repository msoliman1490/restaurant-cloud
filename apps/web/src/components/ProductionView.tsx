import { useEffect, useState } from 'react';
import { ChefHat, Factory, Trash2, Loader2, Sparkles, Scale, CheckCircle2, XCircle, Calculator, AlertCircle, RefreshCw } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface RecipeItem {
  id: string;
  code?: string;
  recipeCode?: string;
  nameAr?: string;
  nameEn?: string;
  mealNameAr?: string;
  mealNameEn?: string;
  version?: string | number;
  yieldQuantity?: string | number;
  theoreticalCost?: number;
  sellingPrice?: number;
}

interface ProductionBatchRow {
  id: string;
  batchNumber: string;
  recipeId: string;
  plannedQuantity: string | number;
  actualQuantity?: string | number | null;
  status: string;
  createdAt?: string;
}

interface WasteRecordRow {
  id: string;
  wasteNumber?: string;
  itemId: string;
  quantity: string | number;
  reason?: string | null;
  totalCost?: string | number;
  createdAt?: string;
}

export const ProductionView = () => {
  const { activeLegalEntity } = useAuth();
  const { showToast } = useToast();
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [batches, setBatches] = useState<ProductionBatchRow[]>([]);
  const [wasteList, setWasteList] = useState<WasteRecordRow[]>([]);
  const [selectedCost, setSelectedCost] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'recipes' | 'batches' | 'waste'>('recipes');

  const loadProduction = async () => {
    setLoading(true);
    setError(null);
    const q = activeLegalEntity?.id
      ? `?legalEntityId=${encodeURIComponent(activeLegalEntity.id)}`
      : '';
    try {
      const [recRes, batRes, wstRes] = await Promise.all([
        apiClient.get<any>('/api/v1/production/recipes'),
        apiClient.get<any>(`/api/v1/production/batches${q}`),
        apiClient.get<any>(`/api/v1/production/waste${q}`),
      ]);
      setRecipes(Array.isArray(recRes) ? recRes : recRes?.items || []);
      setBatches(Array.isArray(batRes) ? batRes : batRes?.items || []);
      setWasteList(Array.isArray(wstRes) ? wstRes : wstRes?.items || []);
    } catch (err: any) {
      setError(err?.message || 'تعذر تحميل بيانات الإنتاج والوصفات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProduction();
  }, [activeLegalEntity?.id]);

  const handleInspectCost = async (recipeId: string) => {
    try {
      const res = await apiClient.get<any>(`/api/v1/production/recipes/${recipeId}/cost`);
      setSelectedCost(res || null);
    } catch (err: any) {
      showToast(err?.message || 'تعذر احتساب تكلفة الوصفة', 'error');
    }
  };

  const handleCompleteBatch = async (batch: ProductionBatchRow) => {
    try {
      await apiClient.post(`/api/v1/production/batches/${batch.id}/complete`, {
        actualYield: String(batch.plannedQuantity),
      });
      showToast('تم إتمام دفعة الإنتاج وترحيل القيد والمخزون', 'success');
      await loadProduction();
    } catch (err: any) {
      showToast(err?.message || 'فشل إتمام الدفعة', 'error');
    }
  };

  const handleCancelBatch = async (batchId: string) => {
    try {
      await apiClient.post(`/api/v1/production/batches/${batchId}/cancel`, { reason: 'إلغاء تشغيلي' });
      showToast('تم إلغاء دفعة الإنتاج', 'success');
      await loadProduction();
    } catch (err: any) {
      showToast(err?.message || 'تعذر إلغاء الدفعة', 'error');
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">
            الوصفات، جداول التكاليف والإنتاج (Kitchen BOM & Recipes)
          </h2>
          <p className="text-sm text-slate-500">
            شجرة المكونات (BOM)، دفعات التجهيز والتحضير المركزية، ومتابعة هدر المطابخ والتوالف
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('recipes')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'recipes' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ChefHat className="w-4 h-4" />
          <span>دليل الوصفات ({recipes.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('batches')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'batches' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Factory className="w-4 h-4" />
          <span>دفعات التحضير ({batches.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('waste')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'waste' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Trash2 className="w-4 h-4" />
          <span>سجل الهالك والتوالف ({wasteList.length})</span>
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6 text-slate-500 text-sm">
          <Loader2 className="w-4 h-4 ml-2 animate-spin" />
          جارٍ تحميل بيانات الإنتاج والوصفات...
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center justify-between gap-3 text-rose-700 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void loadProduction()}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      )}

      {activeTab === 'recipes' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
          <table className="w-full text-right border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">رمز الوصفة</th>
                <th className="py-3 px-4">الوصفة / الصنف النهائي</th>
                <th className="py-3 px-4 text-center">الإصدار</th>
                <th className="py-3 px-4 text-center">كمية الإنتاج</th>
                <th className="py-3 px-4 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recipes.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600">
                    {r.code || r.recipeCode || r.id.slice(0, 8)}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-slate-900">{r.nameAr || r.mealNameAr || '-'}</div>
                    <div className="text-xs text-slate-400 font-sans">{r.nameEn || r.mealNameEn || ''}</div>
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-xs">{r.version || '1.0'}</td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 font-mono text-xs text-slate-700">
                      <Scale className="w-3 h-3 text-slate-400" />
                      {Number(r.yieldQuantity ?? 1)}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <Sparkles className="w-3 h-3" />
                        نشط
                      </span>
                      <button
                        onClick={() => void handleInspectCost(r.id)}
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                      >
                        <Calculator className="w-3.5 h-3.5" />
                        التكلفة الفعلية
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {recipes.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    لا توجد وصفات مسجلة حالياً
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'batches' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
          <table className="w-full text-right border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">رقم الدفعة</th>
                <th className="py-3 px-4">الوصفة</th>
                <th className="py-3 px-4 text-center">الكمية المخططة</th>
                <th className="py-3 px-4 text-center">الكمية الفعلية</th>
                <th className="py-3 px-4 text-center">الحالة</th>
                <th className="py-3 px-4 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50/80">
                  <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600">{b.batchNumber}</td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-600">{b.recipeId.slice(0, 8)}</td>
                  <td className="py-3.5 px-4 text-center font-mono">{Number(b.plannedQuantity)}</td>
                  <td className="py-3.5 px-4 text-center font-mono">{b.actualQuantity ?? '-'}</td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                      {b.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    {b.status === 'IN_PROGRESS' && (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => void handleCompleteBatch(b)}
                          className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          إتمام
                        </button>
                        <button
                          onClick={() => void handleCancelBatch(b.id)}
                          className="inline-flex items-center gap-1 text-xs text-rose-600 hover:underline"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          إلغاء
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {batches.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    لا توجد دفعات إنتاج مسجلة حالياً
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'waste' && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-xs">
          <table className="w-full text-right border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">المرجع</th>
                <th className="py-3 px-4">الصنف</th>
                <th className="py-3 px-4 text-center">الكمية المهدرة</th>
                <th className="py-3 px-4">السبب</th>
                <th className="py-3 px-4 text-left">التكلفة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {wasteList.map((w) => (
                <tr key={w.id} className="hover:bg-slate-50/80">
                  <td className="py-3.5 px-4 font-mono font-bold text-xs text-rose-600">
                    {w.wasteNumber || w.id.slice(0, 8)}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs text-slate-600">{w.itemId.slice(0, 8)}</td>
                  <td className="py-3.5 px-4 text-center font-mono">{Number(w.quantity)}</td>
                  <td className="py-3.5 px-4 text-xs text-slate-600">{w.reason || '-'}</td>
                  <td className="py-3.5 px-4 text-left font-mono font-bold text-slate-900">
                    {Number(w.totalCost ?? 0).toFixed(2)} ر.س
                  </td>
                </tr>
              ))}
              {wasteList.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    لا توجد سجلات هدر مسجلة حالياً
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedCost && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 text-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800">
              تفاصيل تكلفة الوصفة ({selectedCost.recipeCode})
            </span>
            <span className="font-mono font-bold text-indigo-700">
              تكلفة الوحدة: {selectedCost.unitServingCost} ر.س | الإجمالي: {selectedCost.totalBatchCost} ر.س
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
