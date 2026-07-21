'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildTemplateCsv } from '@/lib/imports/template';
import { IMPORT_DEFS, type ImportType } from '@/lib/imports/definitions';
import {
  dryRunImport,
  commitImport,
  type DryRunResult,
  type CommitResult,
} from '@/lib/imports/actions';

type Phase = 'select' | 'preview' | 'report';

function download(filename: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportWizard() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('select');
  const [type, setType] = useState<ImportType>('motorcycles');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const IMPORT_ERRORS: Record<string, string> = {
    bad_type: 'Unknown import type — reload the page.',
    no_file: 'Choose a CSV or XLSX file first.',
    parse_failed: 'The file could not be read. Save it as CSV or XLSX and try again.',
    batch_failed: 'Could not start the import. Try again.',
    not_found: 'This import batch no longer exists — start again.',
    already_committed: 'This batch was already committed — check the registers.',
  };
  const importError = (code: string) => IMPORT_ERRORS[code] ?? 'Import failed. Try again.';
  const [dry, setDry] = useState<Extract<DryRunResult, { ok: true }> | null>(null);
  const [report, setReport] = useState<Extract<CommitResult, { ok: true }> | null>(null);

  async function runDryRun() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('type', type);
      fd.append('file', file);
      const res = await dryRunImport(fd);
      if (res.ok) {
        setDry(res);
        setPhase('preview');
      } else {
        setError(importError(res.error));
      }
    } catch {
      setError('Upload failed — network error or the file is too large. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!dry) return;
    setBusy(true);
    setError(null);
    try {
      const res = await commitImport(dry.batchId);
      if (res.ok) {
        setReport(res);
        setPhase('report');
        router.refresh();
      } else {
        setError(importError(res.error));
      }
    } catch {
      setError('Commit failed to reach the server. Re-run the dry run and check the registers before retrying.');
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'select') {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">Import type</span>
          <div className="flex gap-2">
            {(Object.keys(IMPORT_DEFS) as ImportType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 rounded-[--radius-card] border px-4 py-2.5 text-sm font-semibold ${
                  type === t ? 'border-primary bg-primary text-white' : 'border-border bg-white text-muted-foreground'
                }`}
              >
                {IMPORT_DEFS[t].label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => download(`${type}-template.csv`, buildTemplateCsv(type))}
          className="self-start text-sm font-medium text-primary underline"
        >
          Download {IMPORT_DEFS[type].label} template
        </button>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">Upload CSV or XLSX</span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:min-h-11 file:rounded-[--radius-card] file:border-0 file:bg-surface file:px-4 file:py-2 file:font-semibold file:text-primary-dark"
          />
        </div>

        {error && <p className="text-sm text-overdue">{error}</p>}
        <button
          type="button"
          disabled={!file || busy}
          onClick={runDryRun}
          className="rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? 'Checking…' : 'Validate (dry run)'}
        </button>
      </div>
    );
  }

  if (phase === 'preview' && dry) {
    const canCommit = dry.summary.valid > 0;
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat label="Valid" value={dry.summary.valid} tone="text-[color:var(--color-paid)]" />
          <Stat label="Errors" value={dry.summary.errors} tone="text-[color:var(--color-overdue)]" />
          <Stat label="Duplicates" value={dry.summary.duplicates} tone="text-[color:var(--color-warning)]" />
        </div>

        <div className="overflow-hidden rounded-[--radius-card] border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {dry.preview.map((r) => (
                <tr key={r.rowNumber} className="border-t border-border">
                  <td className="px-3 py-2">{r.rowNumber}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.errors.join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dry.totalRows > dry.preview.length && (
          <p className="text-xs text-muted-foreground">
            Showing {dry.preview.length} of {dry.totalRows} rows (problem rows first). All{' '}
            {dry.summary.valid} valid rows will still be imported.
          </p>
        )}

        {error && <p className="text-sm text-overdue">{error}</p>}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setPhase('select')}
            className="flex-1 rounded-[--radius-card] border border-border bg-white px-4 py-3 font-semibold text-primary-dark"
          >
            Back
          </button>
          <button
            type="button"
            disabled={!canCommit || busy}
            onClick={runCommit}
            className="flex-1 rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {busy ? 'Importing…' : `Import ${dry.summary.valid} valid`}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'report' && report) {
    return (
      <div className="flex flex-col gap-5">
        <div className="rounded-[--radius-card] border border-primary bg-surface p-4">
          <p className="font-semibold text-primary-dark">Import complete</p>
          <p className="text-sm text-foreground">
            {report.inserted} inserted · {report.skipped} skipped
          </p>
        </div>

        {report.riderPins.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Temporary PINs (share once; riders change on first login):
            </p>
            <button
              type="button"
              onClick={() =>
                download(
                  'rider-temp-pins.csv',
                  'rider_number,phone,temp_pin\n' +
                    report.riderPins.map((p) => `${p.riderNumber},${p.phone},${p.tempPin}`).join('\n') +
                    '\n',
                )
              }
              className="self-start rounded-[--radius-card] border border-border px-3 py-2 text-sm font-medium text-primary-dark hover:bg-surface"
            >
              Download temp PIN list
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setPhase('select');
            setFile(null);
            setDry(null);
            setReport(null);
          }}
          className="self-start text-sm font-medium text-primary underline"
        >
          Import another file
        </button>
      </div>
    );
  }

  return null;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-[--radius-card] border border-border bg-white p-3">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
