import { useState } from 'react';
import { Plus, Search, Check, X } from 'lucide-react';
import { ProductItem, Category } from '../types';

const INITIAL_CATEGORIES: Category[] = [
  { id: 'cat-all', code: 'ALL', nameAr: 'جميع الأصناف', nameEn: 'All Categories', displayOrder: 0, isActive: true },
  { id: 'cat-1', code: 'BURGERS', nameAr: 'برجر وساندوتشات', nameEn: 'Burgers & Sandwiches', displayOrder: 1, isActive: true },
  { id: 'cat-2', code: 'PIZZA', nameAr: 'بيتزا ومعجنات', nameEn: 'Pizza & Bakery', displayOrder: 2, isActive: true },
  { id: 'cat-3', code: 'DRINKS', nameAr: 'مشروبات وعصائر', nameEn: 'Beverages & Juices', displayOrder: 3, isActive: true },
  { id: 'cat-4', code: 'DESSERTS', nameAr: 'حلويات وآيس كريم', nameEn: 'Desserts', displayOrder: 4, isActive: true },
];

const INITIAL_PRODUCTS: ProductItem[] = [
  {
    id: 'prod-1',
    sku: 'BRG-001',
    barcode: '62810001001',
    nameAr: 'برجر أنجوس كلاسيك',
    nameEn: 'Angus Classic Burger',
    categoryId: 'cat-1',
    categoryName: 'برجر وساندوتشات',
    baseUom: 'PCS (حبة)',
    defaultCost: 14.5,
    defaultPrice: 35.0,
    taxRate: 0.15,
    isActive: true,
    onHandQty: 145,
  },
  {
    id: 'prod-2',
    sku: 'BRG-002',
    barcode: '62810001002',
    nameAr: 'برجر دجاج كرسبي مقرمش',
    nameEn: 'Crispy Chicken Burger',
    categoryId: 'cat-1',
    categoryName: 'برجر وساندوتشات',
    baseUom: 'PCS (حبة)',
    defaultCost: 11.0,
    defaultPrice: 28.0,
    taxRate: 0.15,
    isActive: true,
    onHandQty: 82,
  },
  {
    id: 'prod-3',
    sku: 'PIZ-001',
    barcode: '62810002001',
    nameAr: 'بيتزا مارجريتا إيطالية',
    nameEn: 'Margherita Pizza Large',
    categoryId: 'cat-2',
    categoryName: 'بيتزا ومعجنات',
    baseUom: 'PCS (حبة)',
    defaultCost: 12.0,
    defaultPrice: 42.0,
    taxRate: 0.15,
    isActive: true,
    onHandQty: 40,
  },
  {
    id: 'prod-4',
    sku: 'PIZ-002',
    barcode: '62810002002',
    nameAr: 'بيتزا بيبروني فاخرة',
    nameEn: 'Premium Pepperoni Pizza',
    categoryId: 'cat-2',
    categoryName: 'بيتزا ومعجنات',
    baseUom: 'PCS (حبة)',
    defaultCost: 16.0,
    defaultPrice: 48.0,
    taxRate: 0.15,
    isActive: true,
    onHandQty: 35,
  },
  {
    id: 'prod-5',
    sku: 'BEV-001',
    barcode: '62810003001',
    nameAr: 'كوكاكولا بارد 330 مل',
    nameEn: 'Coca Cola Can 330ml',
    categoryId: 'cat-3',
    categoryName: 'مشروبات وعصائر',
    baseUom: 'CAN (علبة)',
    defaultCost: 2.2,
    defaultPrice: 6.0,
    taxRate: 0.15,
    isActive: true,
    onHandQty: 420,
  },
  {
    id: 'prod-6',
    sku: 'BEV-002',
    barcode: '62810003002',
    nameAr: 'عصير برتقال طازج معصور',
    nameEn: 'Fresh Orange Juice 400ml',
    categoryId: 'cat-3',
    categoryName: 'مشروبات وعصائر',
    baseUom: 'CUP (كوب)',
    defaultCost: 4.5,
    defaultPrice: 15.0,
    taxRate: 0.15,
    isActive: true,
    onHandQty: 65,
  },
];

export const CatalogView: React.FC = () => {
  const [products, setProducts] = useState<ProductItem[]>(INITIAL_PRODUCTS);
  const [selectedCategory, setSelectedCategory] = useState<string>('cat-all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form state for new product
  const [newSku, setNewSku] = useState('');
  const [newNameAr, setNewNameAr] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [newCatId, setNewCatId] = useState('cat-1');
  const [newCost, setNewCost] = useState('10.00');
  const [newPrice, setNewPrice] = useState('25.00');

  const filteredProducts = products.filter((p) => {
    const matchesCategory = selectedCategory === 'cat-all' || p.categoryId === selectedCategory;
    const matchesSearch =
      p.nameAr.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode && p.barcode.includes(searchQuery));
    return matchesCategory && matchesSearch;
  });

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSku || !newNameAr || !newNameEn) return;

    const cat = INITIAL_CATEGORIES.find((c) => c.id === newCatId);
    const newProd: ProductItem = {
      id: `prod-${Date.now()}`,
      sku: newSku.toUpperCase(),
      nameAr: newNameAr,
      nameEn: newNameEn,
      categoryId: newCatId,
      categoryName: cat?.nameAr ?? 'عام',
      baseUom: 'PCS (حبة)',
      defaultCost: parseFloat(newCost) || 0,
      defaultPrice: parseFloat(newPrice) || 0,
      taxRate: 0.15,
      isActive: true,
      onHandQty: 0,
    };

    setProducts([newProd, ...products]);
    setIsModalOpen(false);
    // Reset form
    setNewSku('');
    setNewNameAr('');
    setNewNameEn('');
  };

  return (
    <div className="space-y-6">
      {/* Header and Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">كتالوج الأصناف والأسعار</h2>
          <p className="text-sm text-slate-500">إدارة القوائم، تصنيفات المنيو، وسياسات التسعير عبر الفروع</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors shadow-sm shadow-indigo-600/20"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة صنف جديد</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xs">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="البحث بالاسم، رمز SKU، أو الباركود..."
            className="w-full pl-4 pr-10 py-2 rounded-xl border border-slate-200 text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          {INITIAL_CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
                selectedCategory === c.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {c.nameAr}
            </button>
          ))}
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4">رمز الصنف (SKU)</th>
                <th className="py-3 px-4">اسم الصنف (عربي / English)</th>
                <th className="py-3 px-4">التصنيف</th>
                <th className="py-3 px-4">الوحدة الأساسية</th>
                <th className="py-3 px-4 text-left">التكلفة المرجعية</th>
                <th className="py-3 px-4 text-left">السعر الأساسي</th>
                <th className="py-3 px-4 text-left">السعر شامل الضريبة (15%)</th>
                <th className="py-3 px-4 text-center">المخزون المتوفر</th>
                <th className="py-3 px-4 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredProducts.map((p) => {
                const priceWithVat = (p.defaultPrice * 1.15).toFixed(2);
                return (
                  <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-medium text-xs text-slate-700">{p.sku}</td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-800">{p.nameAr}</div>
                      <div className="text-xs text-slate-400 font-sans">{p.nameEn}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                        {p.categoryName}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-500">{p.baseUom}</td>
                    <td className="py-3.5 px-4 text-left font-mono text-slate-600">
                      {p.defaultCost.toFixed(2)} ر.س
                    </td>
                    <td className="py-3.5 px-4 text-left font-mono font-semibold text-slate-900">
                      {p.defaultPrice.toFixed(2)} ر.س
                    </td>
                    <td className="py-3.5 px-4 text-left font-mono font-semibold text-emerald-600">
                      {priceWithVat} ر.س
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                          (p.onHandQty ?? 0) > 20
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {p.onHandQty ?? 0}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                        <Check className="w-3.5 h-3.5" />
                        نشط
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <h3 className="font-bold text-lg text-slate-800">إضافة صنف جديد إلى الكتالوج</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">رمز الصنف (SKU)</label>
                  <input
                    type="text"
                    required
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value)}
                    placeholder="مثال: BRG-010"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">التصنيف</label>
                  <select
                    value={newCatId}
                    onChange={(e) => setNewCatId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  >
                    {INITIAL_CATEGORIES.filter((c) => c.id !== 'cat-all').map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الاسم بالعربية</label>
                <input
                  type="text"
                  required
                  value={newNameAr}
                  onChange={(e) => setNewNameAr(e.target.value)}
                  placeholder="مثال: ساندوتش تونا بالمايونيز"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">الاسم بالإنجليزية (English Name)</label>
                <input
                  type="text"
                  required
                  value={newNameEn}
                  onChange={(e) => setNewNameEn(e.target.value)}
                  placeholder="e.g. Tuna Mayo Sandwich"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-sans"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">سعر التكلفة المرجعي (SAR)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={newCost}
                    onChange={(e) => setNewCost(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">سعر البيع الأساسي (SAR)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-mono"
                  />
                </div>
              </div>

              <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 text-xs text-indigo-700">
                يتم احتساب ضريبة القيمة المضافة 15% تلقائياً وفق معايير هيئة الزكاة والضريبة والجمارك (ZATCA).
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-sm shadow-indigo-600/20"
                >
                  حفظ الصنف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
