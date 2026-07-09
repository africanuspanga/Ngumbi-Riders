/* CSV serialization for exports (spec §19.3). Pure and RFC-4180-ish. */
export type CsvCell = string | number | null | undefined;

function cell(value: CsvCell): string {
  if (value == null) return '';
  let s = String(value);
  // Neutralize spreadsheet formula injection: names and notes are user input,
  // and Excel/LibreOffice execute cells starting with = + - @ or tab.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return /[",\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(cell).join(',')];
  for (const r of rows) lines.push(r.map(cell).join(','));
  return lines.join('\n') + '\n';
}
