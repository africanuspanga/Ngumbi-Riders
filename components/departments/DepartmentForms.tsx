'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createDepartment,
  createBudget,
  recordDepartmentExpense,
} from '@/lib/departments/actions';
import { suggestDepartmentCode } from '@/lib/departments/compute';
import {
  REQUISITION_ITEM_CATEGORIES,
  ITEM_CATEGORY_LABELS,
} from '@/lib/requisitions/constants';

/*
 * The three department forms (client feedback #2), in one client module so the
 * page that hosts them stays a server component.
 *
 * Each one checks its result and shows the failure. These actions fail for real
 * reasons — a duplicate code, a requisition that was rejected, a permission the
 * viewer does not hold — and a form that silently does nothing was the exact
 * class of bug the 2026-07-11 sweep went hunting for.
 */

const ERRORS: Record<string, string> = {
  code_taken: 'That code is already used by another department. Choose a different one.',
  validation: 'Check the highlighted fields.',
  forbidden: 'Only the Managing Director can do that.',
  not_found: 'That record no longer exists — reload the page.',
  requisition_not_found: 'That purchase request could not be found.',
  requisition_not_approved:
    'That purchase request has not been approved, so spend cannot be filed against it.',
  server_error: 'A server error occurred. Reload the page and try again.',
};

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, reset?: () => void) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res.ok) {
        setDone(true);
        reset?.();
        router.refresh();
      } else {
        setError(ERRORS[res.error ?? ''] ?? 'That did not work. Reload the page and try again.');
      }
    } catch {
      setError('Network error — reload the page to see whether it went through.');
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, done, setDone, run };
}

/* ---------------------------------------------------------------- department */

export function NewDepartmentForm() {
  const { busy, error, done, setDone, run } = useAction();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  // Suggested only while untouched: once the owner edits the code it is theirs,
  // and a suggestion that keeps overwriting their typing is maddening.
  const [codeTouched, setCodeTouched] = useState(false);
  const effectiveCode = codeTouched ? code : suggestDepartmentCode(name);

  return (
    <Panel title="New department" done={done} doneLabel="Department created" onDismiss={() => setDone(false)}>
      <Field label="Name">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Maintenance"
        />
      </Field>
      <Field
        label="Code"
        hint="Used in exports and report filters. Fixed once created — codes are append-only."
      >
        <input
          className="input font-mono"
          value={effectiveCode}
          onChange={(e) => {
            setCodeTouched(true);
            setCode(e.target.value.toUpperCase());
          }}
        />
      </Field>
      <Field label="Description (optional)">
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Submit
        busy={busy}
        disabled={name.trim().length < 2 || effectiveCode.length < 2}
        onClick={() =>
          run(
            () => createDepartment({ name, code: effectiveCode, description }),
            () => {
              setName('');
              setCode('');
              setDescription('');
              setCodeTouched(false);
            },
          )
        }
      >
        Create department
      </Submit>
    </Panel>
  );
}

/* -------------------------------------------------------------------- budget */

export function NewBudgetForm({
  departments,
  defaultFrom,
  defaultTo,
}: {
  departments: { id: string; name: string }[];
  defaultFrom: string;
  defaultTo: string;
}) {
  const { busy, error, done, setDone, run } = useAction();
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [periodStart, setPeriodStart] = useState(defaultFrom);
  const [periodEnd, setPeriodEnd] = useState(defaultTo);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const reversed = periodEnd < periodStart;

  return (
    <Panel title="Assign a budget" done={done} doneLabel="Budget assigned" onDismiss={() => setDone(false)}>
      <Field label="Department">
        <select
          className="input bg-white"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="What this allocation is called">
        <input
          className="input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. 2026 annual, or Q1 fuel"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Period starts">
          <input
            type="date"
            className="input"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </Field>
        <Field label="Period ends">
          <input
            type="date"
            className="input"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        </Field>
      </div>
      {reversed && <Alert>The end date cannot be before the start date.</Alert>}
      <Field label="Amount (TZS)">
        <input
          className="input"
          type="number"
          inputMode="numeric"
          min={0}
          step={1000}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label="Note (optional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <Alert>{error}</Alert>}
      <Submit
        busy={busy}
        disabled={!departmentId || label.trim().length < 2 || !(Number(amount) > 0) || reversed}
        onClick={() =>
          run(
            () =>
              createBudget({ departmentId, label, periodStart, periodEnd, amount, note }),
            () => {
              setLabel('');
              setAmount('');
              setNote('');
            },
          )
        }
      >
        Assign budget
      </Submit>
    </Panel>
  );
}

/* ------------------------------------------------------------------- expense */

export function NewExpenseForm({
  departments,
  today,
  approvedRequisitions,
}: {
  departments: { id: string; name: string }[];
  today: string;
  approvedRequisitions: { id: string; label: string }[];
}) {
  const { busy, error, done, setDone, run } = useAction();
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? '');
  const [expenseDate, setExpenseDate] = useState(today);
  const [category, setCategory] = useState<string>('other');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [reference, setReference] = useState('');
  const [requisitionId, setRequisitionId] = useState('');

  return (
    <Panel title="Record an expense" done={done} doneLabel="Expense recorded" onDismiss={() => setDone(false)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Department">
          <select
            className="input bg-white"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input
            type="date"
            className="input"
            max={today}
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
          />
        </Field>
        <Field label="Category">
          <select
            className="input bg-white"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {REQUISITION_ITEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {ITEM_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (TZS)">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            step={500}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
      </div>
      <Field label="What it was for">
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Office rent, September"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier (optional)">
          <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <Field label="Invoice / receipt number (optional)">
          <input
            className="input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
      </div>
      {approvedRequisitions.length > 0 && (
        <Field
          label="Against an approved purchase request (optional)"
          hint="Linking it lets the request be retired with this spend."
        >
          <select
            className="input bg-white"
            value={requisitionId}
            onChange={(e) => setRequisitionId(e.target.value)}
          >
            <option value="">Not linked</option>
            {approvedRequisitions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {error && <Alert>{error}</Alert>}
      <Submit
        busy={busy}
        disabled={!departmentId || !(Number(amount) > 0) || description.trim().length < 1}
        onClick={() =>
          run(
            () =>
              recordDepartmentExpense({
                departmentId,
                expenseDate,
                category,
                amount,
                description,
                supplier,
                reference,
                requisitionId,
              }),
            () => {
              setAmount('');
              setDescription('');
              setSupplier('');
              setReference('');
              setRequisitionId('');
            },
          )
        }
      >
        Record expense
      </Submit>
    </Panel>
  );
}

/* -------------------------------------------------------------------- shared */

function Panel({
  title,
  children,
  done,
  doneLabel,
  onDismiss,
}: {
  title: string;
  children: React.ReactNode;
  done: boolean;
  doneLabel: string;
  onDismiss: () => void;
}) {
  return (
    <details className="rounded-[--radius-card] border border-border bg-white">
      <summary className="cursor-pointer px-4 py-3 font-semibold text-primary-dark">
        {title}
      </summary>
      <div className="flex flex-col gap-3 border-t border-border p-4">
        {done && (
          <p
            role="status"
            className="flex items-center justify-between gap-2 rounded-[--radius-card] border border-[color:var(--color-paid)] bg-[color:var(--color-paid)]/5 px-3 py-2 text-sm font-semibold text-[color:var(--color-paid)]"
          >
            ✓ {doneLabel}
            <button type="button" onClick={onDismiss} className="text-xs font-medium underline">
              Dismiss
            </button>
          </p>
        )}
        {children}
      </div>
    </details>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm font-medium text-overdue">
      {children}
    </p>
  );
}

function Submit({
  busy,
  disabled,
  onClick,
  children,
}: {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onClick}
      className="min-h-12 self-start rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
    >
      {busy ? 'Saving…' : children}
    </button>
  );
}
