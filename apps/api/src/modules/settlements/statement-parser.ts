import { BadRequestException } from '@nestjs/common';
import * as zlib from 'zlib';
import { ImportSettlementRow } from '@restaurant-cloud/shared-contracts';

export interface ParsedStatementResult {
  rows: ImportSettlementRow[];
  rowErrors: Array<{ rowNumber: number; message: string; raw?: unknown }>;
  totalRows: number;
}

const HEADER_ALIASES: Record<string, keyof ImportSettlementRow> = {
  externalref: 'externalRef',
  external_ref: 'externalRef',
  transaction_ref: 'externalRef',
  provider_ref: 'externalRef',
  provider_transaction_ref: 'externalRef',
  rrn: 'externalRef',
  ref: 'externalRef',
  reference: 'externalRef',
  'المرجع': 'externalRef',

  ordernumber: 'orderNumber',
  order_number: 'orderNumber',
  order_no: 'orderNumber',
  invoice_number: 'orderNumber',
  'رقم_الطلب': 'orderNumber',
  'رقم الطلب': 'orderNumber',

  paymentmethod: 'paymentMethod',
  payment_method: 'paymentMethod',
  method: 'paymentMethod',
  card_scheme: 'paymentMethod',
  'طريقة_الدفع': 'paymentMethod',

  transactiondate: 'transactionDate',
  transaction_date: 'transactionDate',
  tx_date: 'transactionDate',
  date: 'transactionDate',
  'التاريخ': 'transactionDate',

  grossamount: 'grossAmount',
  gross_amount: 'grossAmount',
  gross: 'grossAmount',
  amount: 'grossAmount',
  total: 'grossAmount',
  'المبلغ': 'grossAmount',
  'اجمالي_العملية': 'grossAmount',

  discountrestaurant: 'discountRestaurant',
  discount_restaurant: 'discountRestaurant',
  restaurant_discount: 'discountRestaurant',
  'خصم_المطعم': 'discountRestaurant',

  discountplatform: 'discountPlatform',
  discount_platform: 'discountPlatform',
  platform_discount: 'discountPlatform',
  'خصم_المنصة': 'discountPlatform',

  deliveryfee: 'deliveryFee',
  delivery_fee: 'deliveryFee',
  'رسوم_التوصيل': 'deliveryFee',

  feeamount: 'feeAmount',
  fee_amount: 'feeAmount',
  fee: 'feeAmount',
  commission: 'feeAmount',
  mdr: 'feeAmount',
  'العمولة': 'feeAmount',

  feetaxamount: 'feeTaxAmount',
  fee_tax_amount: 'feeTaxAmount',
  fee_vat: 'feeTaxAmount',
  commission_vat: 'feeTaxAmount',
  vat: 'feeTaxAmount',
  'ضريبة_العمولة': 'feeTaxAmount',

  withheldamount: 'withheldAmount',
  withheld_amount: 'withheldAmount',
  withheld: 'withheldAmount',
  hold_amount: 'withheldAmount',
  'المبلغ_المحتجز': 'withheldAmount',

  netamount: 'netAmount',
  net_amount: 'netAmount',
  net: 'netAmount',
  'صافي_المبلغ': 'netAmount',

  status: 'status',
  tx_status: 'status',
  'الحالة': 'status',
};

function normalizeHeader(h: string): keyof ImportSettlementRow | null {
  const cleaned = h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, '_');
  return HEADER_ALIASES[cleaned] || HEADER_ALIASES[h.trim().toLowerCase()] || null;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsvText(csvText: string): string[][] {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  return lines.map(parseCsvLine);
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractZipEntries(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compression = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const fileNameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLen;
    const fileName = buf.subarray(nameStart, nameEnd).toString('utf8');
    const dataStart = nameEnd + extraLen;
    const dataEnd = dataStart + compressedSize;
    const rawData = buf.subarray(dataStart, dataEnd);
    if (compression === 0) {
      entries.set(fileName, rawData);
    } else if (compression === 8) {
      entries.set(fileName, zlib.inflateRawSync(rawData));
    }
    offset = dataEnd;
  }
  return entries;
}

function colRefToIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, '').toUpperCase();
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return Math.max(0, idx - 1);
}

function parseXlsxBuffer(buf: Buffer): string[][] {
  const entries = extractZipEntries(buf);
  const sheetBuf = entries.get('xl/worksheets/sheet1.xml');
  if (!sheetBuf) {
    throw new BadRequestException('ملف Excel غير صالح: لم يتم العثور على xl/worksheets/sheet1.xml');
  }

  const sharedStrings: string[] = [];
  const sstBuf = entries.get('xl/sharedStrings.xml');
  if (sstBuf) {
    const sstXml = sstBuf.toString('utf8');
    const siMatches = sstXml.match(/<si>[\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
      const tMatches = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)];
      sharedStrings.push(decodeXmlEntities(tMatches.map((m) => m[1]).join('')));
    }
  }

  const sheetXml = sheetBuf.toString('utf8');
  const rowMatches = sheetXml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || [];
  const table: string[][] = [];

  for (const rowXml of rowMatches) {
    const rowArr: string[] = [];
    const cellMatches = [...rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)];
    for (const cm of cellMatches) {
      const attrs = cm[1] ?? '';
      const inner = cm[2] ?? '';
      const refMatch = attrs.match(/r="([A-Z]+\d+)"/i);
      const typeMatch = attrs.match(/t="([^"]+)"/);
      const colIdx = refMatch && refMatch[1] ? colRefToIndex(refMatch[1]) : rowArr.length;
      const cellType = typeMatch && typeMatch[1] ? typeMatch[1] : '';

      let val = '';
      if (cellType === 'inlineStr') {
        const tMatch = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        val = tMatch && tMatch[1] ? decodeXmlEntities(tMatch[1]) : '';
      } else {
        const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        const rawV = vMatch && vMatch[1] ? vMatch[1] : '';
        if (cellType === 's') {
          const sIdx = parseInt(rawV, 10);
          val = Number.isFinite(sIdx) && sharedStrings[sIdx] !== undefined ? (sharedStrings[sIdx] ?? '') : '';
        } else {
          val = decodeXmlEntities(rawV);
        }
      }
      rowArr[colIdx] = val.trim();
    }
    if (rowArr.some((c) => c && c.length > 0)) {
      table.push(rowArr.map((c) => c ?? ''));
    }
  }

  return table;
}

function isNumericString(v: string | undefined): boolean {
  if (v === undefined || v === '') return false;
  return /^-?\d+(\.\d{1,6})?$/.test(v.trim());
}

export function parseSettlementStatement(params: {
  format: 'CSV' | 'EXCEL' | 'JSON_API';
  csvContent?: string;
  fileContentBase64?: string;
  rows?: ImportSettlementRow[];
}): ParsedStatementResult {
  if (params.format === 'JSON_API') {
    const rows = params.rows || [];
    if (rows.length === 0) {
      throw new BadRequestException('يجب توفير صفوف التسوية عند الاستيراد بصيغة JSON_API');
    }
    return { rows, rowErrors: [], totalRows: rows.length };
  }

  let matrix: string[][] = [];
  if (params.format === 'CSV') {
    const text =
      params.csvContent ||
      (params.fileContentBase64 ? Buffer.from(params.fileContentBase64, 'base64').toString('utf8') : '');
    if (!text.trim()) {
      throw new BadRequestException('محتوى ملف CSV فارغ');
    }
    matrix = parseCsvText(text);
  } else if (params.format === 'EXCEL') {
    if (!params.fileContentBase64) {
      throw new BadRequestException('محتوى ملف Excel (Base64) مطلوب');
    }
    const buf = Buffer.from(params.fileContentBase64, 'base64');
    matrix = parseXlsxBuffer(buf);
  }

  if (matrix.length < 2) {
    throw new BadRequestException('الملف لا يحتوي على صفوف بيانات بعد صف العناوين');
  }

  const headerRow = matrix[0];
  if (!headerRow) {
    throw new BadRequestException('الملف لا يحتوي على صف عناوين');
  }
  const headers = headerRow.map(normalizeHeader);
  if (!headers.includes('grossAmount')) {
    throw new BadRequestException(
      'الملف يفتقد العمود الإلزامي لمبلغ العملية (grossAmount / gross_amount / amount)'
    );
  }

  const rows: ImportSettlementRow[] = [];
  const rowErrors: Array<{ rowNumber: number; message: string; raw?: unknown }> = [];

  for (let i = 1; i < matrix.length; i++) {
    const rawRow = matrix[i];
    if (!rawRow) continue;
    const obj: Record<string, string> = {};
    headers.forEach((key, idx) => {
      const cell = rawRow[idx];
      if (key && cell !== undefined && cell !== '') {
        obj[key] = cell.trim();
      }
    });

    if (!obj.grossAmount || !isNumericString(obj.grossAmount)) {
      rowErrors.push({
        rowNumber: i + 1,
        message: `قيمة المبلغ الإجمالي غير صالحة في الصف ${i + 1}: "${obj.grossAmount ?? ''}"`,
        raw: rawRow,
      });
      continue;
    }

    const numericFields = [
      'discountRestaurant',
      'discountPlatform',
      'deliveryFee',
      'feeAmount',
      'feeTaxAmount',
      'withheldAmount',
      'netAmount',
    ];
    let invalidNumeric = false;
    for (const nf of numericFields) {
      if (obj[nf] !== undefined && !isNumericString(obj[nf])) {
        rowErrors.push({
          rowNumber: i + 1,
          message: `قيمة رقمية غير صالحة للحقل ${nf} في الصف ${i + 1}: "${obj[nf]}"`,
          raw: rawRow,
        });
        invalidNumeric = true;
        break;
      }
    }
    if (invalidNumeric) continue;

    rows.push({
      externalRef: obj.externalRef,
      orderNumber: obj.orderNumber,
      paymentMethod: obj.paymentMethod,
      transactionDate: obj.transactionDate,
      grossAmount: parseFloat(obj.grossAmount).toFixed(4),
      discountRestaurant: obj.discountRestaurant ? parseFloat(obj.discountRestaurant).toFixed(4) : '0.0000',
      discountPlatform: obj.discountPlatform ? parseFloat(obj.discountPlatform).toFixed(4) : '0.0000',
      deliveryFee: obj.deliveryFee ? parseFloat(obj.deliveryFee).toFixed(4) : '0.0000',
      feeAmount: obj.feeAmount ? parseFloat(obj.feeAmount).toFixed(4) : '0.0000',
      feeTaxAmount: obj.feeTaxAmount ? parseFloat(obj.feeTaxAmount).toFixed(4) : '0.0000',
      withheldAmount: obj.withheldAmount ? parseFloat(obj.withheldAmount).toFixed(4) : '0.0000',
      netAmount: obj.netAmount ? parseFloat(obj.netAmount).toFixed(4) : undefined,
      status: obj.status,
    });
  }

  if (rows.length === 0) {
    throw new BadRequestException(
      `فشل استيراد الملف: لم يتم قبول أي صف صالح (${rowErrors[0]?.message || 'بيانات غير صالحة'})`
    );
  }

  return {
    rows,
    rowErrors,
    totalRows: matrix.length - 1,
  };
}
