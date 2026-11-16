import React, { useState } from 'react';
import { Printer, X, FileText, Receipt, QrCode } from 'lucide-react';
import { triggerPrint } from '../utils/export';

export type ReceiptPrintFormat = '80mm' | 'a4';

export interface ReceiptLineItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  vatAmount?: number;
}

export interface ReceiptPrintData {
  invoiceNumber: string;
  issueDate: string;
  tenantName: string;
  branchName: string;
  branchAddress?: string;
  vatNumber?: string;
  crNumber?: string;
  cashierName?: string;
  orderType?: string;
  tableNumber?: string;
  customerName?: string;
  customerVatNumber?: string;
  invoiceType?: 'SIMPLIFIED' | 'STANDARD';
  items: ReceiptLineItem[];
  subtotal: number;
  discountAmount?: number;
  vatRate?: number;
  vatAmount: number;
  grandTotal: number;
  paymentMethod?: string;
  paidAmount?: number;
  changeAmount?: number;
  zatcaQrBase64?: string;
  zatcaQrImageUrl?: string;
  currency?: string;
}

interface ReceiptPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: ReceiptPrintData | null;
  defaultFormat?: ReceiptPrintFormat;
  locale?: 'ar' | 'en';
}

export const ReceiptPrintModal: React.FC<ReceiptPrintModalProps> = ({
  isOpen,
  onClose,
  receipt,
  defaultFormat = '80mm',
  locale = 'ar',
}) => {
  const [format, setFormat] = useState<ReceiptPrintFormat>(defaultFormat);
  const isEn = locale === 'en';

  if (!isOpen || !receipt) {
    return null;
  }

  const currency = receipt.currency || (isEn ? 'SAR' : 'ر.س');
  const vatRate = receipt.vatRate ?? 15;
  const isStandardInvoice =
    receipt.invoiceType === 'STANDARD' || Boolean(receipt.customerVatNumber);

  const invoiceTitle = isStandardInvoice
    ? isEn
      ? 'Tax Invoice'
      : 'فاتورة ضريبية'
    : isEn
    ? 'Simplified Tax Invoice'
    : 'فاتورة ضريبية مبسطة';

  const qrImageSrc =
    receipt.zatcaQrImageUrl ||
    (receipt.zatcaQrBase64?.startsWith('data:image/')
      ? receipt.zatcaQrBase64
      : undefined);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-4 overflow-y-auto print-only-container"
      dir={isEn ? 'ltr' : 'rtl'}
      role="dialog"
      aria-modal="true"
      aria-label={isEn ? 'Receipt Print Preview' : 'معاينة طباعة الفاتورة'}
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh] print-only-container">
        {/* Modal Toolbar (Hidden on Print) */}
        <div className="no-print px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">
              {isEn ? 'Print Preview' : 'معاينة الطباعة'} — #{receipt.invoiceNumber}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {/* Format Switcher */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setFormat('80mm')}
                aria-label={isEn ? '80mm Thermal Format' : 'تنسيق حراري 80mm'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  format === '80mm'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>80mm</span>
              </button>
              <button
                type="button"
                onClick={() => setFormat('a4')}
                aria-label={isEn ? 'A4 Tax Invoice Format' : 'تنسيق فاتورة A4'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  format === 'a4'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>A4</span>
              </button>
            </div>

            <button
              type="button"
              onClick={triggerPrint}
              aria-label={isEn ? 'Print Invoice' : 'طباعة الفاتورة'}
              className="rc-btn-primary"
            >
              <Printer className="w-4 h-4" />
              <span>{isEn ? 'Print' : 'طباعة'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label={isEn ? 'Close Print Preview' : 'إغلاق معاينة الطباعة'}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Document Canvas */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-100 print-only-container">
          <div
            className={
              format === '80mm'
                ? 'print-receipt-80mm mx-auto w-[302px] bg-white border border-slate-200 rounded-lg p-4 text-slate-900 shadow-sm text-xs'
                : 'print-receipt-a4 mx-auto max-w-[740px] bg-white border border-slate-200 rounded-lg p-8 text-slate-900 shadow-sm text-sm'
            }
          >
            {/* Header */}
            <div
              className={
                format === '80mm'
                  ? 'text-center border-b border-dashed border-slate-300 pb-3 mb-3'
                  : 'flex items-start justify-between border-b border-slate-300 pb-5 mb-5'
              }
            >
              <div>
                <h4 className={format === '80mm' ? 'font-bold text-sm' : 'font-bold text-lg'}>
                  {receipt.tenantName}
                </h4>
                <p className="text-slate-600 mt-0.5">{receipt.branchName}</p>
                {receipt.branchAddress && (
                  <p className="text-slate-500 text-[11px]">{receipt.branchAddress}</p>
                )}
                {receipt.vatNumber && (
                  <p className="text-[11px] font-mono mt-1">
                    {isEn ? 'VAT No:' : 'الرقم الضريبي:'} {receipt.vatNumber}
                  </p>
                )}
                {receipt.crNumber && (
                  <p className="text-[11px] font-mono">
                    {isEn ? 'CR No:' : 'السجل التجاري:'} {receipt.crNumber}
                  </p>
                )}
              </div>

              <div className={format === '80mm' ? 'mt-2 pt-2 border-t border-dashed border-slate-200' : 'text-end'}>
                <p className="font-bold text-slate-900">{invoiceTitle}</p>
                <p className="font-mono text-[11px] mt-1">
                  #{receipt.invoiceNumber}
                </p>
                <p className="font-mono text-[11px] text-slate-600">
                  {receipt.issueDate}
                </p>
              </div>
            </div>

            {/* Metadata */}
            <div
              className={
                format === '80mm'
                  ? 'space-y-1 text-[11px] border-b border-dashed border-slate-300 pb-2.5 mb-2.5'
                  : 'grid grid-cols-2 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5'
              }
            >
              {receipt.cashierName && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{isEn ? 'Cashier:' : 'الكاشير:'}</span>
                  <span className="font-medium">{receipt.cashierName}</span>
                </div>
              )}
              {receipt.orderType && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{isEn ? 'Order Type:' : 'نوع الطلب:'}</span>
                  <span className="font-medium">{receipt.orderType}</span>
                </div>
              )}
              {receipt.tableNumber && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{isEn ? 'Table:' : 'الطاولة:'}</span>
                  <span className="font-medium font-mono">{receipt.tableNumber}</span>
                </div>
              )}
              {receipt.customerName && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{isEn ? 'Customer:' : 'العميل:'}</span>
                  <span className="font-medium">{receipt.customerName}</span>
                </div>
              )}
              {receipt.customerVatNumber && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{isEn ? 'Customer VAT:' : 'ضريبي العميل:'}</span>
                  <span className="font-mono">{receipt.customerVatNumber}</span>
                </div>
              )}
            </div>

            {/* Line Items */}
            <table className="w-full border-collapse mb-3">
              <thead>
                <tr className="border-b border-slate-300 text-slate-600 text-[11px]">
                  <th className="py-1.5 text-start font-semibold">
                    {isEn ? 'Item' : 'الصنف'}
                  </th>
                  <th className="py-1.5 text-center font-semibold">
                    {isEn ? 'Qty' : 'الكمية'}
                  </th>
                  {format === 'a4' && (
                    <th className="py-1.5 text-end font-semibold">
                      {isEn ? 'Unit Price' : 'السعر'}
                    </th>
                  )}
                  <th className="py-1.5 text-end font-semibold">
                    {isEn ? 'Total' : 'الإجمالي'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {receipt.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-1.5 pe-2 font-medium text-slate-900">
                      {item.name}
                    </td>
                    <td className="py-1.5 text-center font-mono">{item.quantity}</td>
                    {format === 'a4' && (
                      <td className="py-1.5 text-end font-mono">
                        {item.unitPrice.toFixed(2)}
                      </td>
                    )}
                    <td className="py-1.5 text-end font-mono font-semibold">
                      {item.total.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="border-t border-dashed border-slate-300 pt-2.5 space-y-1.5 print-avoid-break">
              <div className="flex justify-between text-slate-600">
                <span>{isEn ? 'Subtotal (Excl. VAT)' : 'المجموع قبل الضريبة'}</span>
                <span className="font-mono">
                  {receipt.subtotal.toFixed(2)} {currency}
                </span>
              </div>

              {receipt.discountAmount !== undefined && receipt.discountAmount > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>{isEn ? 'Discount' : 'الخصم'}</span>
                  <span className="font-mono">
                    -{receipt.discountAmount.toFixed(2)} {currency}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-slate-600">
                <span>
                  {isEn ? `VAT (${vatRate}%)` : `ضريبة القيمة المضافة (${vatRate}%)`}
                </span>
                <span className="font-mono">
                  {receipt.vatAmount.toFixed(2)} {currency}
                </span>
              </div>

              <div className="flex justify-between font-bold text-slate-900 pt-1.5 border-t border-slate-300 text-sm">
                <span>{isEn ? 'Grand Total' : 'الإجمالي المستحق'}</span>
                <span className="font-mono">
                  {receipt.grandTotal.toFixed(2)} {currency}
                </span>
              </div>

              {receipt.paymentMethod && (
                <div className="flex justify-between text-[11px] text-slate-600 pt-1">
                  <span>{isEn ? 'Payment Method' : 'طريقة الدفع'}</span>
                  <span className="font-medium">{receipt.paymentMethod}</span>
                </div>
              )}
              {receipt.paidAmount !== undefined && (
                <div className="flex justify-between text-[11px] text-slate-600">
                  <span>{isEn ? 'Paid' : 'المدفوع'}</span>
                  <span className="font-mono">
                    {receipt.paidAmount.toFixed(2)} {currency}
                  </span>
                </div>
              )}
              {receipt.changeAmount !== undefined && receipt.changeAmount > 0 && (
                <div className="flex justify-between text-[11px] text-slate-600">
                  <span>{isEn ? 'Change' : 'المتبقي'}</span>
                  <span className="font-mono">
                    {receipt.changeAmount.toFixed(2)} {currency}
                  </span>
                </div>
              )}
            </div>

            {/* ZATCA QR Section */}
            {(qrImageSrc || receipt.zatcaQrBase64) && (
              <div className="mt-4 pt-3 border-t border-dashed border-slate-300 flex flex-col items-center text-center print-avoid-break">
                {qrImageSrc ? (
                  <img
                    src={qrImageSrc}
                    alt={isEn ? 'ZATCA QR Code' : 'رمز الاستجابة السريعة ZATCA'}
                    className="w-28 h-28 object-contain border border-slate-200 p-1 bg-white"
                  />
                ) : (
                  <div className="w-28 h-28 border border-slate-300 rounded-md flex flex-col items-center justify-center p-2 bg-slate-50">
                    <QrCode className="w-12 h-12 text-slate-800 mb-1" />
                    <span className="text-[9px] font-mono text-slate-600 break-all line-clamp-2">
                      {receipt.zatcaQrBase64?.slice(0, 24)}...
                    </span>
                  </div>
                )}
                <p className="text-[10px] text-slate-500 mt-1.5">
                  {isEn
                    ? 'ZATCA Phase 2 Electronic Invoice QR'
                    : 'رمز الفاتورة الإلكترونية — هيئة الزكاة والضريبة والجمارك'}
                </p>
              </div>
            )}

            {/* Footer */}
            <div className="mt-4 pt-2 border-t border-slate-200 text-center text-[10px] text-slate-500">
              {isEn ? 'Thank you for your business' : 'شكراً لزيارتكم'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
