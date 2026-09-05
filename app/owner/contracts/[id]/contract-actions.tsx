'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SignaturePad } from '@/components/forms/SignaturePad';
import {
  addDrawnSignature,
  uploadPhysicalCopy,
  activateContract,
  contractLifecycle,
  generateContractPdf,
  getContractDocumentUrl,
  reactivateContract,
  extendContractTerm,
} from '@/lib/contracts/actions';
import type { ContractDocument } from '@/lib/contracts/queries';
import { formatLocalDateTime } from '@/lib/dates/tz';

/** Open a URL in a way that reliably triggers a download/preview on mobile. */
function openUrl(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ContractDocuments({
  contractId,
  documents,
}: {
  contractId: string;
  documents: ContractDocument[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function generate() {
    setMsg(null);
    start(async () => {
      try {
        const res = await generateContractPdf(contractId);
        if (res.ok) {
          if (res.data?.url) openUrl(res.data.url);
          setMsg('PDF generated — the download should start now.');
          router.refresh();
        } else {
          setMsg('Could not generate the PDF. Please try again.');
        }
      } catch {
        setMsg('Could not generate the PDF — network error. Please try again.');
      }
    });
  }

  function download(documentId: string) {
    setMsg(null);
    setBusyId(documentId);
    start(async () => {
      try {
        const res = await getContractDocumentUrl(documentId);
        if (res.ok && res.data) openUrl(res.data.url);
        else setMsg('Could not open this document. Please try again.');
      } catch {
        setMsg('Could not open this document — network error.');
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {documents.length > 0 && (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-[--radius-card] border border-border bg-surface px-3 py-2"
            >
              <span className="text-sm text-foreground">
                {doc.is_signed ? 'Signed copy' : 'Contract PDF'} · v{doc.version}
                <span className="block text-xs text-muted-foreground">
                  {formatLocalDateTime(new Date(doc.created_at))}
                </span>
              </span>
              <button
                type="button"
                onClick={() => download(doc.id)}
                disabled={pending}
                className="shrink-0 rounded-[--radius-card] bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
              >
                {busyId === doc.id ? 'Opening…' : 'Download'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={generate}
        className="self-start rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
      >
        {pending && busyId === null
          ? 'Generating…'
          : documents.length > 0
            ? 'Regenerate contract PDF'
            : 'Generate contract PDF'}
      </button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}

export function SignatureCapture({
  contractId,
  role,
  defaultName,
}: {
  contractId: string;
  role: 'owner' | 'rider';
  defaultName: string;
}) {
  const router = useRouter();
  const [sig, setSig] = useState('');
  const [name, setName] = useState(defaultName);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!sig) {
      setError('Please sign first.');
      return;
    }
    setError(null);
    start(async () => {
      const res = await addDrawnSignature(contractId, role, sig, name);
      if (res.ok) {
        setSig('');
        router.refresh();
      } else setError('Could not save signature.');
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={role === 'owner' ? 'Owner name' : 'Rider name'}
      />
      <SignaturePad value={sig} onChange={setSig} clearLabel="Clear" />
      {error && <p className="text-xs text-overdue">{error}</p>}
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="self-start rounded-[--radius-card] bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {pending ? 'Saving…' : `Save ${role} signature`}
      </button>
    </div>
  );
}

export function PhysicalUpload({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.append('contractId', contractId);
      fd.append('file', file);
      const res = await uploadPhysicalCopy(fd);
      if (res.ok) router.refresh();
      else setError('Upload failed.');
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={onChange}
        disabled={pending}
        className="block w-full text-sm text-muted-foreground file:mr-3 file:min-h-11 file:rounded-[--radius-card] file:border-0 file:bg-surface file:px-4 file:py-2 file:font-semibold file:text-primary-dark"
      />
      {error && <p className="text-xs text-overdue">{error}</p>}
    </div>
  );
}

export function ActivateButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  function activate() {
    setError(null);
    start(async () => {
      const res = await activateContract(contractId);
      if (res.ok && res.data) {
        setDone(res.data.generated);
        router.refresh();
      } else {
        setError(
          !res.ok && res.error === 'signatures_required'
            ? 'Owner and rider signatures (or a signed physical copy) are required first.'
            : 'Activation failed.',
        );
      }
    });
  }

  if (done !== null) {
    return (
      <p className="text-sm font-semibold text-[color:var(--color-paid)]">
        Activated — {done} obligations generated.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={activate}
        disabled={pending}
        className="rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {pending ? 'Activating…' : 'Activate & generate obligations'}
      </button>
      {error && <p className="text-xs text-overdue">{error}</p>}
    </div>
  );
}

export function LifecycleButtons({
  contractId,
  status,
}: {
  contractId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const actions: { key: 'pause' | 'resume' | 'complete_early' | 'terminate'; label: string }[] = [];
  if (status === 'active') {
    actions.push({ key: 'pause', label: 'Pause' }, { key: 'complete_early', label: 'Complete early' }, { key: 'terminate', label: 'Terminate' });
  } else if (status === 'paused') {
    actions.push({ key: 'resume', label: 'Resume' }, { key: 'terminate', label: 'Terminate' });
  }
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            disabled={pending}
            onClick={() => start(async () => {
              setError(null);
              try {
                const res = await contractLifecycle(contractId, a.key);
                if (!res.ok) {
                  setError(`Could not ${a.label.toLowerCase()} this contract (${res.error}).`);
                  return;
                }
                router.refresh();
              } catch {
                setError(`Could not ${a.label.toLowerCase()} this contract — network error. Reload and check the contract status before retrying.`);
              }
            })}
            className="rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
          >
            {a.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-overdue">
          {error}
        </p>
      )}
    </div>
  );
}

/*
 * Reactivate a terminated / completed contract (client feedback 2026-09-05).
 *
 * The client's report: "I tried terminating a contract and later activating it
 * again, but the system does not allow the contract to return to Active. This
 * is very important because the rider cannot make payments."
 *
 * Reactivation restores the status AND the obligations termination cancelled —
 * flipping only the status would leave the rider with an empty calendar and
 * still nothing to pay. If the term has already passed, a new end date is
 * required, otherwise the nightly completion job would close it again tonight.
 */
const REACTIVATE_ERRORS: Record<string, string> = {
  invalid_status: 'This contract is not in a state that can be reactivated — reload the page.',
  term_expired:
    'The contract term has already ended. Enter a new end date to extend it as part of reactivating.',
  missing_dates: 'This contract has no start or end date — edit it first.',
  invalid_date: 'That end date is not valid.',
  not_an_extension: 'The new end date must be after the current one.',
  restore_failed: 'The status changed but the payment days could not be restored — retry.',
  update_failed: 'The contract could not be updated. Reload and try again.',
};

export function ReactivateButton({
  contractId,
  currentEndDate,
  termExpired,
}: {
  contractId: string;
  currentEndDate: string | null;
  termExpired: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newEndDate, setNewEndDate] = useState('');
  const [open, setOpen] = useState(false);

  function run() {
    setError(null);
    start(async () => {
      try {
        const res = await reactivateContract(contractId, {
          newEndDate: newEndDate || null,
        });
        if (res.ok) {
          router.refresh();
          setOpen(false);
        } else {
          setError(REACTIVATE_ERRORS[res.error] ?? `Could not reactivate this contract (${res.error}).`);
        }
      } catch {
        setError('Network error — reload the contract before retrying.');
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-[--radius-card] bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-hover"
      >
        Reactivate contract
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Reactivating puts the contract back to <strong>Active</strong> and restores the payment days
        that were cancelled when it ended. Payments already made are untouched.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          New end date{' '}
          <span className="text-muted-foreground font-normal">
            {termExpired ? '(required — the current term has ended)' : '(optional — leave blank to keep the current end date)'}
          </span>
        </span>
        <input
          type="date"
          className="input"
          min={currentEndDate ?? undefined}
          value={newEndDate}
          onChange={(e) => setNewEndDate(e.target.value)}
        />
      </label>
      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="min-h-11 rounded-[--radius-card] bg-primary px-4 font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? 'Reactivating…' : 'Confirm reactivation'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="min-h-11 rounded-[--radius-card] border border-border px-4 font-semibold"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Extend a live contract's term and generate the extra obligations. */
export function ExtendTermButton({
  contractId,
  currentEndDate,
}: {
  contractId: string;
  currentEndDate: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [newEndDate, setNewEndDate] = useState('');

  function run() {
    if (!newEndDate) {
      setError('Choose the new end date.');
      return;
    }
    setError(null);
    setNote(null);
    start(async () => {
      try {
        const res = await extendContractTerm(contractId, newEndDate);
        if (res.ok && res.data) {
          setNote(`Extended to ${res.data.endDate} — ${res.data.generated} extra payment day(s) generated.`);
          setNewEndDate('');
          router.refresh();
        } else if (!res.ok) {
          setError(REACTIVATE_ERRORS[res.error] ?? `Could not extend the contract (${res.error}).`);
        }
      } catch {
        setError('Network error — reload the contract before retrying.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Extend to</span>
          <input
            type="date"
            className="input"
            min={currentEndDate ?? undefined}
            value={newEndDate}
            onChange={(e) => setNewEndDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="min-h-11 rounded-[--radius-card] border border-border bg-white px-4 font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
        >
          {pending ? 'Extending…' : 'Extend term'}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Adds payment days after the current end date using this contract&rsquo;s own schedule and
        instalment. Existing days are never changed.
      </p>
      {note && <p className="text-sm font-medium text-[color:var(--color-paid)]">{note}</p>}
      {error && <p role="alert" className="text-sm font-medium text-overdue">{error}</p>}
    </div>
  );
}
