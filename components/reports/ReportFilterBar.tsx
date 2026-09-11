import { PAYMENT_METHOD_FILTERS } from '@/lib/reports/filter-labels';
import {
  REQUISITION_TYPES,
  REQUISITION_TYPE_LABELS,
} from '@/lib/requisitions/constants';
import type { ReportFilters } from '@/lib/reports/cashflow';

/*
 * The filter set from the brief: start date, end date, department, rider,
 * motorcycle, payment type, requisition type.
 *
 * A PLAIN GET FORM, and a SERVER component. No client JavaScript at all:
 * submitting navigates, the URL carries the filters, and the URL is therefore
 * shareable, bookmarkable and — the point — identical to the one the CSV/XLSX
 * export reads. An interactive client filter would have to keep its state in
 * sync with the export links by hand, which is exactly how a report comes to
 * show one thing on screen and export another.
 *
 * Every control is named for the query key `parseFilters()` reads, so there is
 * one vocabulary end to end.
 */
export function ReportFilterBar({
  filters,
  departments,
  riders,
  motorcycles,
  /** Filters that make no sense on this page are simply not rendered. */
  show = ['dates', 'department', 'rider', 'motorcycle', 'method', 'reqtype'],
}: {
  filters: ReportFilters;
  departments: { id: string; name: string }[];
  riders: { id: string; label: string }[];
  motorcycles: { id: string; label: string }[];
  show?: readonly ('dates' | 'department' | 'rider' | 'motorcycle' | 'method' | 'reqtype')[];
}) {
  const has = (k: (typeof show)[number]) => show.includes(k);

  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3 rounded-[--radius-card] border border-border bg-white p-4"
    >
      {has('dates') && (
        <>
          <Field label="From">
            <input type="date" name="from" defaultValue={filters.from} className="input" />
          </Field>
          <Field label="To">
            <input type="date" name="to" defaultValue={filters.to} className="input" />
          </Field>
        </>
      )}

      {has('department') && departments.length > 0 && (
        <Field label="Department">
          <select name="department" defaultValue={filters.departmentId ?? ''} className="input bg-white">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {has('rider') && riders.length > 0 && (
        <Field label="Rider">
          <select name="rider" defaultValue={filters.riderId ?? ''} className="input bg-white">
            <option value="">All riders</option>
            {riders.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {has('motorcycle') && motorcycles.length > 0 && (
        <Field label="Motorcycle">
          <select
            name="motorcycle"
            defaultValue={filters.motorcycleId ?? ''}
            className="input bg-white"
          >
            <option value="">All motorcycles</option>
            {motorcycles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {has('method') && (
        <Field label="Payment type">
          <select name="method" defaultValue={filters.paymentMethod ?? ''} className="input bg-white">
            {PAYMENT_METHOD_FILTERS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {has('reqtype') && (
        <Field label="Requisition type">
          <select
            name="reqtype"
            defaultValue={filters.requisitionType ?? ''}
            className="input bg-white"
          >
            <option value="">All types</option>
            {REQUISITION_TYPES.map((t) => (
              <option key={t} value={t}>
                {REQUISITION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
      )}

      <button
        type="submit"
        className="min-h-11 rounded-[--radius-card] bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-hover"
      >
        Apply
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
