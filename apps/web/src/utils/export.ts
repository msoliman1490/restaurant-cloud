/**
 * Enterprise CSV / Excel-compatible export & print utilities.
 */

export interface CsvColumn<T> {
  key: keyof T;
  header: string;
  format?: (value: T[keyof T], row: T) => string | number | boolean | null | undefined;
}

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function sanitizeCsvCell(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return '';
  }

  let str =
    raw instanceof Date
      ? raw.toISOString()
      : typeof raw === 'object'
      ? JSON.stringify(raw)
      : String(raw);

  if (FORMULA_PREFIX_RE.test(str)) {
    str = `'${str}`;
  }

  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Exports an array of records to a UTF-8 BOM CSV file (Excel-safe for Arabic & English).
 */
export function exportToCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns?: CsvColumn<T>[]
): void {
  if (typeof window === 'undefined' || rows.length === 0) {
    return;
  }

  const resolvedColumns: CsvColumn<T>[] =
    columns && columns.length > 0
      ? columns
      : (Object.keys(rows[0]) as Array<keyof T>).map((key) => ({
          key,
          header: String(key),
        }));

  const headerLine = resolvedColumns.map((col) => sanitizeCsvCell(col.header)).join(',');
  const dataLines = rows.map((row) =>
    resolvedColumns
      .map((col) => {
        const val = col.format ? col.format(row[col.key], row) : row[col.key];
        return sanitizeCsvCell(val);
      })
      .join(',')
  );

  const csvContent = `\uFEFF${[headerLine, ...dataLines].join('\r\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const safeName = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', safeName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Triggers the browser print dialog cleanly.
 */
export function triggerPrint(): void {
  if (typeof window !== 'undefined') {
    window.print();
  }
}
