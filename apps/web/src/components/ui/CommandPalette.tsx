import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

export interface CommandItem {
  id: string;
  labelAr: string;
  labelEn: string;
  groupAr: string;
  groupEn: string;
  shortcut?: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  items: CommandItem[];
  onSelect: (id: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  items,
  onSelect,
}) => {
  const { locale, t } = useLocale();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.labelAr.toLowerCase().includes(q) ||
        i.labelEn.toLowerCase().includes(q) ||
        i.groupAr.toLowerCase().includes(q) ||
        i.groupEn.toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [isOpen]);

  useEffect(() => {
    if (activeIdx >= filtered.length) {
      setActiveIdx(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIdx]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && filtered[activeIdx]) {
      e.preventDefault();
      onSelect(filtered[activeIdx].id);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-slate-950/50 backdrop-blur-[2px] animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-label={t('الانتقال السريع بين الشاشات', 'Quick Navigation')}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            placeholder={t('ابحث للانتقال السريع إلى أي شاشة (مثال: POS، المحاسبة، الشركات)...', 'Jump to any module (e.g. POS, Accounting, Entities)...')}
            className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="rc-kbd">Esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              {t('لا توجد نتائج مطابقة', 'No matching modules')}
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === activeIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => {
                    onSelect(item.id);
                    onClose();
                  }}
                  className={`w-full px-4 py-3 flex items-center justify-between text-start transition-colors ${
                    isSelected ? 'bg-emerald-50 text-emerald-950' : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div>
                    <div className="text-sm font-semibold">
                      {locale === 'ar' ? item.labelAr : item.labelEn}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {locale === 'ar' ? item.groupAr : item.groupEn}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.shortcut && <kbd className="rc-kbd">{item.shortcut}</kbd>}
                    {isSelected && <CornerDownLeft size={14} className="text-[#0D6E4F]" />}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
