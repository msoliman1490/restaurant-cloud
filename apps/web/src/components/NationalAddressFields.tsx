import React from 'react';
import { MapPin } from 'lucide-react';

export interface NationalAddressValue {
  shortAddress: string;
  buildingNumber: string;
  streetName: string;
  district: string;
  city: string;
  postalCode: string;
  additionalNumber: string;
  unitNumber: string;
  country: string;
}

export const EMPTY_NATIONAL_ADDRESS: NationalAddressValue = {
  shortAddress: '',
  buildingNumber: '',
  streetName: '',
  district: '',
  city: '',
  postalCode: '',
  additionalNumber: '',
  unitNumber: '',
  country: 'المملكة العربية السعودية',
};

export function validateNationalAddress(
  addr: NationalAddressValue,
  isEn: boolean
): string | null {
  const sa = addr.shortAddress.trim();
  if (sa && !/^[A-Za-z]{4}\d{4}$/.test(sa)) {
    return isEn
      ? 'Short Address must be 4 English letters followed by 4 digits (e.g. RNAD2323)'
      : 'العنوان المختصر يجب أن يتكون من 4 أحرف إنجليزية متبوعة بـ 4 أرقام (مثال: RNAD2323)';
  }
  const pc = addr.postalCode.trim();
  if (pc && !/^\d{5}$/.test(pc)) {
    return isEn
      ? 'Postal Code must be 5 digits'
      : 'الرمز البريدي يجب أن يتكون من 5 أرقام';
  }
  return null;
}

interface NationalAddressFieldsProps {
  value: NationalAddressValue;
  onChange?: (next: NationalAddressValue) => void;
  isEn: boolean;
  readOnly?: boolean;
}

export const NationalAddressFields: React.FC<NationalAddressFieldsProps> = ({
  value,
  onChange,
  isEn,
  readOnly = false,
}) => {
  const update = (field: keyof NationalAddressValue, val: string) => {
    if (onChange) {
      onChange({ ...value, [field]: val });
    }
  };

  if (readOnly) {
    const hasAny = Boolean(
      value.shortAddress ||
        value.buildingNumber ||
        value.streetName ||
        value.district ||
        value.city ||
        value.postalCode ||
        value.additionalNumber ||
        value.unitNumber
    );
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <MapPin className="w-4 h-4 text-[#0D6E4F]" />
          <span>{isEn ? 'National Address' : 'العنوان الوطني'}</span>
        </div>
        {!hasAny ? (
          <p className="text-xs text-slate-400">
            {isEn ? 'No national address recorded.' : 'لم يتم تسجيل بيانات العنوان الوطني.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-slate-400 block">{isEn ? 'Short Address' : 'العنوان المختصر'}</span>
              <span className="font-mono font-bold text-slate-800">{value.shortAddress || '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{isEn ? 'Building No.' : 'رقم المبنى'}</span>
              <span className="font-mono font-semibold text-slate-800">{value.buildingNumber || '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{isEn ? 'Street Name' : 'اسم الشارع'}</span>
              <span className="font-semibold text-slate-800">{value.streetName || '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{isEn ? 'District' : 'الحي'}</span>
              <span className="font-semibold text-slate-800">{value.district || '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{isEn ? 'City' : 'المدينة'}</span>
              <span className="font-semibold text-slate-800">{value.city || '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{isEn ? 'Postal Code' : 'الرمز البريدي'}</span>
              <span className="font-mono font-semibold text-slate-800">{value.postalCode || '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{isEn ? 'Additional No.' : 'الرقم الإضافي'}</span>
              <span className="font-mono font-semibold text-slate-800">{value.additionalNumber || '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{isEn ? 'Unit No.' : 'رقم الوحدة'}</span>
              <span className="font-mono font-semibold text-slate-800">{value.unitNumber || '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">{isEn ? 'Country' : 'الدولة'}</span>
              <span className="font-semibold text-slate-800">{value.country || 'المملكة العربية السعودية'}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
          <MapPin className="w-4 h-4 text-[#0D6E4F]" />
          <span>{isEn ? 'National Address (Optional)' : 'العنوان الوطني (اختياري)'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">
            {isEn ? 'Short Address' : 'العنوان المختصر'}
          </label>
          <input
            type="text"
            dir="ltr"
            value={value.shortAddress}
            onChange={(e) => update('shortAddress', e.target.value.toUpperCase())}
            placeholder="RNAD2323"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono uppercase"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">
            {isEn ? 'Building Number' : 'رقم المبنى'}
          </label>
          <input
            type="text"
            dir="ltr"
            value={value.buildingNumber}
            onChange={(e) => update('buildingNumber', e.target.value)}
            placeholder="1234"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">
            {isEn ? 'Street Name' : 'اسم الشارع'}
          </label>
          <input
            type="text"
            value={value.streetName}
            onChange={(e) => update('streetName', e.target.value)}
            placeholder={isEn ? 'King Fahd Rd' : 'طريق الملك فهد'}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">
            {isEn ? 'District' : 'الحي'}
          </label>
          <input
            type="text"
            value={value.district}
            onChange={(e) => update('district', e.target.value)}
            placeholder={isEn ? 'Al Olaya' : 'العليا'}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">
            {isEn ? 'City' : 'المدينة'}
          </label>
          <input
            type="text"
            value={value.city}
            onChange={(e) => update('city', e.target.value)}
            placeholder={isEn ? 'Riyadh' : 'الرياض'}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">
            {isEn ? 'Postal Code' : 'الرمز البريدي'}
          </label>
          <input
            type="text"
            dir="ltr"
            value={value.postalCode}
            onChange={(e) => update('postalCode', e.target.value)}
            placeholder="12211"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">
            {isEn ? 'Additional Number' : 'الرقم الإضافي'}
          </label>
          <input
            type="text"
            dir="ltr"
            value={value.additionalNumber}
            onChange={(e) => update('additionalNumber', e.target.value)}
            placeholder="5678"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">
            {isEn ? 'Unit Number' : 'رقم الوحدة'}
          </label>
          <input
            type="text"
            dir="ltr"
            value={value.unitNumber}
            onChange={(e) => update('unitNumber', e.target.value)}
            placeholder="12"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">
            {isEn ? 'Country' : 'الدولة'}
          </label>
          <input
            type="text"
            value={value.country}
            onChange={(e) => update('country', e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white"
          />
        </div>
      </div>
    </div>
  );
};
