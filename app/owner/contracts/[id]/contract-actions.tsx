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
} from '@/lib/contracts/actions';

export function GeneratePdfButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          const res = await generateContractPdf(contractId);
          setMsg(res.ok ? 'PDF generated and stored.' : 'Generation failed.');
          if (res.ok) router.refresh();
        })}
        className="self-start rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
      >
        {pending ? 'Generating…' : 'Generate contract PDF'}
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

  const actions: { key: 'pause' | 'resume' | 'complete_early' | 'terminate'; label: string }[] = [];
  if (status === 'active') {
    actions.push({ key: 'pause', label: 'Pause' }, { key: 'complete_early', label: 'Complete early' }, { key: 'terminate', label: 'Terminate' });
  } else if (status === 'paused') {
    actions.push({ key: 'resume', label: 'Resume' }, { key: 'terminate', label: 'Terminate' });
  }
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          disabled={pending}
          onClick={() => start(async () => {
            await contractLifecycle(contractId, a.key);
            router.refresh();
          })}
          className="rounded-[--radius-card] border border-border bg-white px-3 py-2 text-sm font-semibold text-primary-dark hover:bg-surface disabled:opacity-60"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
