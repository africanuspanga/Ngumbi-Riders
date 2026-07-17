import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getContract } from '@/lib/contracts/queries';
import { formatTZS } from '@/lib/money/format';
import { scheduleLabel } from '@/lib/contracts/validation';
import {
  SignatureCapture,
  PhysicalUpload,
  ActivateButton,
  LifecycleButtons,
  GeneratePdfButton,
} from './contract-actions';

export const metadata = { title: 'Contract' };

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  const c = await getContract(id);
  if (!c) notFound();

  const hasOwnerSig = c.signatures.some((s) => s.signer_role === 'owner');
  const hasRiderSig = c.signatures.some((s) => s.signer_role === 'rider');
  const canActivate =
    (c.status === 'draft' || c.status === 'awaiting_signatures' || c.status === 'scheduled') &&
    ((hasOwnerSig && hasRiderSig) || c.hasSignedDocument);
  const preActivation = c.status === 'draft' || c.status === 'awaiting_signatures' || c.status === 'scheduled';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/owner/contracts" className="text-sm font-medium text-muted-foreground">
          ← Contracts
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary-dark">{c.contract_number}</h1>
          <p className="text-sm text-muted-foreground">
            {c.rider_name} ({c.rider_number}) · {c.registration}
          </p>
        </div>
        <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
          {c.status}
        </span>
      </header>

      <Section title="Terms">
        <Grid>
          <Info label="Installment" value={formatTZS(c.installment_amount)} />
          <Info label="Deadline" value={c.payment_deadline_time} />
          <Info label="Start" value={c.start_date} />
          <Info label="End" value={c.end_date} />
          <Info label="Duration" value={c.duration_months ? `${c.duration_months} months` : null} />
          <Info
            label="Schedule"
            value={scheduleLabel(c.schedule_type, c.selected_weekdays, c.due_day_of_month)}
          />
          <Info label="Ownership transfers" value={c.ownership_transfers ? 'Yes' : 'No'} />
        </Grid>
        {c.special_terms && <Info label="Special terms" value={c.special_terms} />}
      </Section>

      <Section title="Contract document">
        <GeneratePdfButton contractId={c.id} />
      </Section>

      <Section title="Obligations">
        {c.obligationStats.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No obligations yet — activate the contract to generate the calendar.
          </p>
        ) : (
          <p className="text-sm text-foreground">
            {c.obligationStats.total} obligations · {c.obligationStats.paid} paid · total value {formatTZS(c.obligationStats.value)}
          </p>
        )}
      </Section>

      {preActivation && (
        <>
          <Section title="Signatures">
            <ul className="flex flex-col gap-1 text-sm">
              {c.signatures.map((s) => (
                <li key={s.id} className="flex justify-between border-b border-border py-1">
                  <span className="capitalize">{s.signer_role}{s.signer_name ? ` · ${s.signer_name}` : ''}</span>
                  <span className="text-muted-foreground">{s.method}</span>
                </li>
              ))}
              {c.hasSignedDocument && <li className="text-muted-foreground">Signed physical copy on file ✓</li>}
              {c.signatures.length === 0 && !c.hasSignedDocument && (
                <li className="text-muted-foreground">No signatures yet.</li>
              )}
            </ul>
          </Section>

          {!hasOwnerSig && (
            <Section title="Owner signature">
              <SignatureCapture contractId={c.id} role="owner" defaultName="" />
            </Section>
          )}
          {!hasRiderSig && (
            <Section title="Rider signature">
              <SignatureCapture contractId={c.id} role="rider" defaultName={c.rider_name} />
            </Section>
          )}

          <Section title="Or upload a signed physical copy">
            <PhysicalUpload contractId={c.id} />
          </Section>

          {canActivate && (
            <Section title="Activate">
              <ActivateButton contractId={c.id} />
            </Section>
          )}
        </>
      )}

      {(c.status === 'active' || c.status === 'paused') && (
        <Section title="Lifecycle">
          <LifecycleButtons contractId={c.id} status={c.status} />
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
      <h2 className="font-semibold text-primary-dark">{title}</h2>
      {children}
    </section>
  );
}
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2">{children}</div>;
}
function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value || '—'}</span>
    </div>
  );
}
