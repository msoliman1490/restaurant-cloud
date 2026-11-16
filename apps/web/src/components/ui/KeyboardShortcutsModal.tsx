import React from 'react';
import { Keyboard } from 'lucide-react';
import { Modal } from './Modal';
import { useLocale } from '../../context/LocaleContext';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useLocale();

  const globalShortcuts = [
    { keys: 'Ctrl + K', desc: t('فتح الانتقال السريع بين الوحدات', 'Open quick module switcher') },
    { keys: '?', desc: t('عرض / إخفاء قائمة اختصارات لوحة المفاتيح', 'Toggle keyboard shortcuts help') },
    { keys: 'Esc', desc: t('إغلاق النافذة المنبثقة الحالية', 'Close active modal or drawer') },
    { keys: 'Tab / Shift+Tab', desc: t('التنقل بين الحقول والأزرار', 'Navigate fields and controls') },
  ];

  const posShortcuts = [
    { keys: 'F2  /  /', desc: t('التركيز على البحث عن الأصناف', 'Focus POS item search') },
    { keys: '↑  /  ↓  /  Enter', desc: t('اختيار صنف وإضافته للسلة', 'Select product & add to cart') },
    { keys: '+  /  -', desc: t('زيادة أو إنقاص كمية آخر صنف بالسلة', 'Increase / decrease last cart item qty') },
    { keys: 'Delete', desc: t('حذف آخر صنف من السلة', 'Remove last item from cart') },
    { keys: 'F4', desc: t('فتح نافذة إتمام الدفع', 'Open payment checkout modal') },
    { keys: 'F8', desc: t('تنفيذ دفع نقدي (Cash) داخل نافذة الدفع', 'Pay Cash inside payment modal') },
    { keys: 'F9', desc: t('تنفيذ دفع بالبطاقة (Card) داخل نافذة الدفع', 'Pay Card inside payment modal') },
    { keys: 'F10', desc: t('تبديل الدفع المقسّم (Split)', 'Toggle Split payment form') },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('اختصارات لوحة المفاتيح', 'Keyboard Shortcuts')}
      subtitle={t('تنقل وأنجز عملياتك دون الاعتماد على الفأرة', 'Navigate and complete workflows without a mouse')}
      maxWidthClass="max-w-2xl"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
            <Keyboard size={14} />
            {t('اختصارات النظام العامة', 'Global Navigation')}
          </h3>
          <div className="space-y-2">
            {globalShortcuts.map((s) => (
              <div
                key={s.keys}
                className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80"
              >
                <span className="text-xs text-slate-700">{s.desc}</span>
                <kbd className="rc-kbd shrink-0">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#0D6E4F] mb-3 flex items-center gap-1.5">
            <Keyboard size={14} />
            {t('اختصارات نقطة البيع (POS)', 'POS Terminal Shortcuts')}
          </h3>
          <div className="space-y-2">
            {posShortcuts.map((s) => (
              <div
                key={s.keys}
                className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-emerald-50/50 border border-emerald-200/70"
              >
                <span className="text-xs text-slate-800">{s.desc}</span>
                <kbd className="rc-kbd shrink-0">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
