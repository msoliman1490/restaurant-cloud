import { useState } from 'react';
import { ChefHat, Factory, Trash2, Plus, Sparkles, Scale } from 'lucide-react';

interface RecipeItem {
  id: string;
  recipeCode: string;
  mealNameAr: string;
  mealNameEn: string;
  version: string;
  ingredientsCount: number;
  yieldQuantity: number;
  theoreticalCost: number;
  sellingPrice: number;
  profitMarginPercent: number;
}

const INITIAL_RECIPES: RecipeItem[] = [
  {
    id: 'rec-1',
    recipeCode: 'BOM-BRG-ANGUS',
    mealNameAr: 'برجر أنجوس كلاسيك لحم',
    mealNameEn: 'Classic Angus Burger Meal',
    version: '1.2',
    ingredientsCount: 6,
    yieldQuantity: 1,
    theoreticalCost: 14.5,
    sellingPrice: 35.0,
    profitMarginPercent: 58.57,
  },
  {
    id: 'rec-2',
    recipeCode: 'BOM-BRG-CRISPY',
    mealNameAr: 'برجر دجاج كرسبي مقرمش',
    mealNameEn: 'Crispy Chicken Burger Meal',
    version: '1.0',
    ingredientsCount: 5,
    yieldQuantity: 1,
    theoreticalCost: 11.0,
    sellingPrice: 28.0,
    profitMarginPercent: 60.71,
  },
  {
    id: 'rec-3',
    recipeCode: 'BOM-PIZ-MARG',
    mealNameAr: 'بيتزا مارجريتا نابولي كبيرة',
    mealNameEn: 'Neapolitan Margherita Large',
    version: '2.0',
    ingredientsCount: 7,
    yieldQuantity: 1,
    theoreticalCost: 12.0,
    sellingPrice: 42.0,
    profitMarginPercent: 71.43,
  },
];

export const ProductionView = () => {
  const [recipes] = useState<RecipeItem[]>(INITIAL_RECIPES);
  const [activeTab, setActiveTab] = useState<'recipes' | 'batches' | 'waste'>('recipes');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">الوصفات، جداول التكاليف والإنتاج (Kitchen BOM & Recipes)</h2>
          <p className="text-sm text-slate-500">
            شجرة المكونات (BOM)، دفعات التجهيز والتحضير المركزية، ومتابعة هدر المطابخ والتوالف
          </p>
        </div>
        <button className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm">
          <Plus className="w-4 h-4" />
          <span>تعريف وصفة جديدة (New BOM)</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('recipes')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'recipes' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ChefHat className="w-4 h-4" />
          <span>دليل الوصفات وهوامش الربحية</span>
        </button>
        <button
          onClick={() => setActiveTab('batches')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'batches' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Factory className="w-4 h-4" />
          <span>دفعات التحضير بالمطبخ المركزي (Batches)</span>
        </button>
        <button
          onClick={() => setActiveTab('waste')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'waste' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Trash2 className="w-4 h-4" />
          <span>سجل الهالك والتوالف (Kitchen Waste)</span>
        </button>
      </div>

      {/* Recipes Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <table className="w-full text-right border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
              <th className="py-3 px-4">رمز الوصفة</th>
              <th className="py-3 px-4">الوجبة / الصنف النهائي</th>
              <th className="py-3 px-4 text-center">الإصدار</th>
              <th className="py-3 px-4 text-center">عدد المكونات الخام</th>
              <th className="py-3 px-4 text-left">التكلفة المعيارية (BOM Cost)</th>
              <th className="py-3 px-4 text-left">سعر البيع</th>
              <th className="py-3 px-4 text-center">هامش الربح الإجمالي (Margin)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {recipes.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="py-3.5 px-4 font-mono font-bold text-xs text-indigo-600">{r.recipeCode}</td>
                <td className="py-3.5 px-4">
                  <div className="font-bold text-slate-900">{r.mealNameAr}</div>
                  <div className="text-xs text-slate-400 font-sans">{r.mealNameEn}</div>
                </td>
                <td className="py-3.5 px-4 text-center font-mono text-xs">{r.version}</td>
                <td className="py-3.5 px-4 text-center">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 font-mono text-xs text-slate-700">
                    <Scale className="w-3 h-3 text-slate-400" />
                    {r.ingredientsCount} مكونات
                  </span>
                </td>
                <td className="py-3.5 px-4 text-left font-mono font-bold text-slate-700">
                  {r.theoreticalCost.toFixed(2)} ر.س
                </td>
                <td className="py-3.5 px-4 text-left font-mono font-bold text-slate-900">
                  {r.sellingPrice.toFixed(2)} ر.س
                </td>
                <td className="py-3.5 px-4 text-center">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <Sparkles className="w-3 h-3" />
                    {r.profitMarginPercent.toFixed(1)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
