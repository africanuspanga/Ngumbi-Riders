import { IMPORT_DEFS, type ImportType } from './definitions';

/*
 * Pure validation + within-batch duplicate detection (spec §21.2, §21.3).
 * DB-level duplicate detection (against existing rows) is layered on top in
 * actions.ts. Kept pure so the rules are unit tested without a database.
 */
export type RowStatus = 'valid' | 'error' | 'duplicate_in_batch';

export type ValidatedRow = {
  rowNumber: number;
  raw: Record<string, string>;
  status: RowStatus;
  data?: unknown;
  errors: string[];
  dupValue?: string;
};

export type ValidationSummary = {
  total: number;
  valid: number;
  errors: number;
  duplicatesInBatch: number;
};

export function validateRows(
  type: ImportType,
  rows: Record<string, string>[],
): { rows: ValidatedRow[]; summary: ValidationSummary } {
  const def = IMPORT_DEFS[type];
  const seen = new Set<string>();
  const out: ValidatedRow[] = [];

  rows.forEach((raw, i) => {
    const rowNumber = i + 1;
    const result = def.validateRow(raw);
    if (!result.ok) {
      out.push({ rowNumber, raw, status: 'error', errors: result.errors });
      return;
    }
    const dupValue = def.dupValue(result.data);
    if (seen.has(dupValue)) {
      out.push({
        rowNumber,
        raw,
        status: 'duplicate_in_batch',
        data: result.data,
        errors: [`Duplicate ${def.dupField} within file: ${dupValue}`],
        dupValue,
      });
      return;
    }
    seen.add(dupValue);
    out.push({ rowNumber, raw, status: 'valid', data: result.data, errors: [], dupValue });
  });

  return {
    rows: out,
    summary: {
      total: out.length,
      valid: out.filter((r) => r.status === 'valid').length,
      errors: out.filter((r) => r.status === 'error').length,
      duplicatesInBatch: out.filter((r) => r.status === 'duplicate_in_batch').length,
    },
  };
}
