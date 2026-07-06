import 'server-only';

import Papa from 'papaparse';
import ExcelJS from 'exceljs';

/*
 * Parse an uploaded CSV or XLSX file into header-keyed string rows (spec §21.2).
 * All cell values are coerced to trimmed strings so the per-type schemas do the
 * real normalization/validation. Server-only (exceljs + Buffer).
 */
export type ParsedFile = {
  headers: string[];
  rows: Record<string, string>[];
};

function cellToString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    // exceljs rich text / formula results
    const v = value as { text?: string; result?: unknown };
    if (typeof v.text === 'string') return v.text.trim();
    if (v.result != null) return String(v.result).trim();
  }
  return String(value).trim();
}

async function parseCsv(text: string): Promise<ParsedFile> {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const rows = (result.data ?? []).map((r) => {
    const obj: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) obj[k] = cellToString(v);
    return obj;
  });
  const headers = result.meta.fields?.map((f) => f.trim()) ?? [];
  return { headers, rows };
}

async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    headers[col - 1] = cellToString(cell.value);
  });

  const rows: Record<string, string>[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    let hasValue = false;
    row.eachCell((cell, col) => {
      const header = headers[col - 1];
      if (!header) return;
      const val = cellToString(cell.value);
      if (val) hasValue = true;
      obj[header] = val;
    });
    if (hasValue) rows.push(obj);
  });

  return { headers: headers.filter(Boolean), rows };
}

export async function parseImportFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseXlsx(await file.arrayBuffer());
  }
  // Default to CSV.
  return parseCsv(await file.text());
}
