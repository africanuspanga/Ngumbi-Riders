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
