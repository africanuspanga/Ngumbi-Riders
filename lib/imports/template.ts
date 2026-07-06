import { IMPORT_DEFS, type ImportType } from './definitions';

/*
 * Downloadable CSV template per import type (spec §21.2 step 2). Header row +
 * one example row. Values containing commas/quotes are escaped.
 */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildTemplateCsv(type: ImportType): string {
  const def = IMPORT_DEFS[type];
  const headers = def.columns.map((c) => c.header);
  const example = def.columns.map((c) => c.example);
  return [headers.map(csvCell).join(','), example.map(csvCell).join(',')].join('\n') + '\n';
}
