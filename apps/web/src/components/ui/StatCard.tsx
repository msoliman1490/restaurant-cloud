import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'emerald' | 'amber' | 'rose' | 'indigo';
  onClick?: () => void;
}

const TONE_CLASSES: Record<NonNullable<StatCardProps['tone']>, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  emerald: 'bg-emerald-50 text-[#0D6E4F] border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  onClick,
}) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rc-card p-4 sm:p-5 text-start flex items-start justify-between gap-3 transition-all ${
        onClick ? 'hover:border-emerald-600/40 hover:shadow-md cursor-pointer w-full' : ''
      }`}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 truncate">{label}</p>
        <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1.5 font-mono" data-numeric="true">
          {value}
        </p>
        {hint && <p className="text-[11px] text-slate-500 mt-1.5 truncate">{hint}</p>}
      </div>
      {icon && (
        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${TONE_CLASSES[tone]}`}>
          {icon}
        </div>
      )}
    </Tag>
  );
};
