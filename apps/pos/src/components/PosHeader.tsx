import { useState, useEffect } from 'react';
import { Wifi, Clock, User, ShieldCheck } from 'lucide-react';

interface PosHeaderProps {
  branchName: string;
  terminalCode: string;
  cashierName: string;
  shiftNumber: number;
}

export const PosHeader = ({
  branchName,
  terminalCode,
  cashierName,
  shiftNumber,
}: PosHeaderProps) => {
  const [time, setTime] = useState(new Date().toLocaleTimeString('ar-SA'));

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString('ar-SA'));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="h-14 bg-slate-950 border-b border-slate-800 px-6 flex items-center justify-between text-white select-none shrink-0">
      {/* Brand & Branch */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-emerald-500 text-slate-950 font-black flex items-center justify-center text-xs shadow-md shadow-emerald-500/20">
          RC
        </div>
        <div>
          <span className="font-bold text-sm leading-tight block">{branchName}</span>
          <span className="text-[10px] text-slate-400 font-mono">
            جهاز: {terminalCode} | الوردية #{shiftNumber}
          </span>
        </div>
      </div>

      {/* Center Engine Badges */}
      <div className="hidden md:flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
          <Wifi className="w-3.5 h-3.5" />
          <span>متصل بالسحابة (Sync Active)</span>
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-950 text-indigo-300 border border-indigo-800">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>حصة الأوفلاين نشطة (Quota Leased)</span>
        </span>
      </div>

      {/* Cashier & Clock */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5 text-slate-300">
          <User className="w-4 h-4 text-emerald-400" />
          <span>{cashierName}</span>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-slate-400 border-r border-slate-800 pr-3">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span>{time}</span>
        </div>
      </div>
    </header>
  );
};
