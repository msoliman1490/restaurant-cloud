import { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { PosProduct, PosCategory } from '../types';

interface ProductGridProps {
  categories: PosCategory[];
  products: PosProduct[];
  onAddToCart: (product: PosProduct) => void;
}

export const ProductGrid = ({
  categories,
  products,
  onAddToCart,
}: ProductGridProps) => {
  const [selectedCat, setSelectedCat] = useState('ALL');
  const [search, setSearch] = useState('');

  const filtered = products.filter((p) => {
    const matchesCat = selectedCat === 'ALL' || p.categoryId === selectedCat;
    const matchesSearch =
      p.nameAr.includes(search) ||
      p.nameEn.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-900 overflow-hidden">
      {/* Search & Category Filter */}
      <div className="p-4 bg-slate-950 border-b border-slate-800 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث عن وجبة أو مسح باركود..."
            className="w-full bg-slate-900 border border-slate-700 rounded-xl pr-10 pl-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Categories Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => setSelectedCat('ALL')}
            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
              selectedCat === 'ALL'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            جميع الأصناف
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCat(c.id)}
              className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors ${
                selectedCat === c.id
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {c.nameAr}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Products */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {filtered.map((prod) => {
            const priceWithTax = (prod.price * (1 + prod.taxRate)).toFixed(2);
            return (
              <button
                key={prod.id}
                onClick={() => onAddToCart(prod)}
                disabled={!prod.isAvailable}
                className="bg-slate-800/80 hover:bg-slate-750 border border-slate-700/80 rounded-2xl p-4 text-right flex flex-col justify-between h-36 transition-all hover:scale-[1.02] active:scale-[0.98] focus:outline-hidden group relative overflow-hidden"
              >
                <div>
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <span className="font-bold text-sm text-white group-hover:text-emerald-400 transition-colors leading-snug">
                      {prod.nameAr}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 shrink-0">
                      {prod.stockQty} متوفر
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 font-sans block">{prod.nameEn}</span>
                </div>

                <div className="flex items-end justify-between mt-2 pt-2 border-t border-slate-700/50 w-full">
                  <div>
                    <span className="text-base font-extrabold text-emerald-400 font-mono">
                      {priceWithTax}
                    </span>
                    <span className="text-[11px] text-slate-400 mr-1">ر.س</span>
                    <span className="text-[10px] text-slate-500 block leading-none">شامل 15% ضريبة</span>
                  </div>
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:bg-emerald-500 group-hover:text-slate-950 transition-colors">
                    <Plus className="w-4 h-4" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
