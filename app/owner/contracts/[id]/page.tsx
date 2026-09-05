import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getContract } from '@/lib/contracts/queries';
import { formatTZS } from '@/lib/money/format';
import { scheduleLabel } from '@/lib/contracts/validation';
import { formatDate } from '@/lib/dates/format';
import { localDateString } from '@/lib/dates/tz';
import {
  deriveContractDisplayStatus,
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONE,
} from '@/lib/contracts/status';
import { formatDuration, normalizeDuration } from '@/lib/contracts/duration';
import {
  SignatureCapture,
  PhysicalUpload,
  ActivateButton,
  LifecycleButtons,
  ContractDocuments,
  ReactivateButton,
  ExtendTermButton,
} from './contract-actions';
import { formatLongDate } from '@/lib/dates/format';
import { describePhoneLoan } from '@/lib/loans/phone';
import { ENDED_DISPLAY_STATUSES } from '@/lib/contracts/status';

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

  // Derived status (#8): a term that has ended reads as completed here without
  // waiting for the nightly job, and a finished contract with unpaid days is
  // never shown as settled.
  const outstandingCount = c.obligationStats.outstanding;
  const displayStatus = deriveContractDisplayStatus({
    status: c.status,
    startDate: c.start_date,
    endDate: c.end_date,
    outstandingCount,
    today: localDateString(),
  });
  const durationLabel = formatDuration(
    normalizeDuration({
      years: c.duration_years,
      months: c.duration_months,
      weeks: c.duration_weeks,
      days: c.duration_days,
    }),
  );

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
        <div className="flex items-center gap-2">
          <Link
            href={`/owner/contracts/${c.id}/edit`}
            className="flex min-h-9 items-center rounded-[--radius-card] border border-border bg-white px-3 text-sm font-semibold text-primary-dark hover:bg-surface"
          >
            Edit
          </Link>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CONTRACT_STATUS_TONE[displayStatus]}`}
          >
            {CONTRACT_STATUS_LABELS[displayStatus]}
          </span>
        </div>
      </header>

      {/* Money position + expected completion (client feedback 2026-09-05) */}
      {c.obligationStats.total > 0 && (
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[--radius-card] border border-[color:var(--color-paid)]/40 bg-[color:var(--color-paid)]/5 p-4">
            <p className="text-xs text-muted-foreground">Outstanding now</p>
            <p className="text-xl font-bold tabular-nums text-[color:var(--color-paid)]">
              {formatTZS(c.progress.outstandingNow)}
            </p>
            <p className="text-xs text-muted-foreground">
              {c.progress.outstandingCount} payment(s) due or overdue
            </p>
          </div>
          <div className="rounded-[--radius-card] border border-[color:var(--color-overdue)]/40 bg-[color:var(--color-overdue)]/5 p-4">
            <p className="text-xs text-muted-foreground">Remaining to finish the contract</p>
            <p className="text-xl font-bold tabular-nums text-[color:var(--color-overdue)]">
              {formatTZS(c.progress.totalRemaining)}
            </p>
            <p className="text-xs text-muted-foreground">
              {c.progress.remainingCount} of {c.progress.totalCount} payments left
            </p>
          </div>
          <div className="rounded-[--radius-card] border border-border bg-white p-4">
            <p className="text-xs text-muted-foreground">Expected completion</p>
            <p className="text-base font-semibold">
              {c.progress.projectedEndDate
                ? formatLongDate(c.progress.projectedEndDate)
                : 'Not enough payments yet'}
            </p>
            <p className="text-xs text-muted-foreground">
              {c.progress.projectionBasis === 'pace' && c.progress.daysBehindSchedule > 0
                ? `${c.progress.daysBehindSchedule} day(s) later than scheduled at the current pace`
                : `Scheduled end ${formatDate(c.progress.scheduledEndDate)}`}
            </p>
          </div>
        </section>
      )}

      {displayStatus === 'ended_outstanding' && (
        <p className="rounded-[--radius-card] border border-[color:var(--color-overdue)] bg-red-50 p-3 text-sm font-semibold text-[color:var(--color-overdue)]">
          This contract has reached its end date but {outstandingCount} payment(s) are still unpaid.
          It is not settled.
        </p>
      )}

      <Section title="Terms">
        <Grid>
          <Info label="Installment" value={formatTZS(c.installment_amount)} />
          <Info
            label="Daily rate"
            value={c.daily_rate ? formatTZS(c.daily_rate) : 'not recorded'}
          />
          <Info label="Deadline" value={c.payment_deadline_time} />
          <Info label="Start" value={formatDate(c.start_date)} />
          <Info label="End" value={formatDate(c.end_date)} />
          <Info label="Duration" value={durationLabel} />
          <Info
            label="End date set by"
            value={
              c.end_date_source === 'exact'
                ? 'Exact date'
                : c.end_date_source === 'payment_days'
                  ? `${c.payment_days_target ?? '—'} payment days`
                  : 'Duration'
            }
          />
          {c.lease_start_date && c.lease_start_date !== c.start_date && (
            <Info label="Motorcycle payments start" value={formatDate(c.lease_start_date)} />
          )}
          <Info
            label="Schedule"
            value={scheduleLabel(c.schedule_type, c.selected_weekdays, c.due_day_of_month)}
          />
          <Info label="Ownership transfers" value={c.ownership_transfers ? 'Yes' : 'No'} />
        </Grid>
        {c.special_terms && <Info label="Special terms" value={c.special_terms} />}
      </Section>

      {c.phone_loan && (
        <Section title="Phone loan">
          <p className="text-sm font-semibold text-primary-dark">
            {describePhoneLoan({
              principal: c.phone_loan.principal,
              interestBps: c.phone_loan.interestBps,
              interestAmount: c.phone_loan.interestAmount,
              totalAmount: c.phone_loan.totalAmount,
              termMonths: c.phone_loan.termMonths,
              instalments: [],
            })}
          </p>
          <Grid>
            <Info label="Status" value={c.phone_loan.status} />
            <Info label="Device" value={c.phone_loan.deviceDescription} />
            <Info
              label="Instalments paid"
              value={`${c.phone_loan.paidCount} of ${c.phone_loan.termMonths}`}
            />
            <Info
              label="Still owed on the phone"
              value={formatTZS(c.phone_loan.outstandingAmount)}
            />
          </Grid>
          <p className="text-xs text-muted-foreground">
            Phone instalments are collected before the motorcycle lease starts — they sit at the
            front of the payment calendar, so oldest-first allocation clears them first.
          </p>
        </Section>
      )}

      <Section title="Contract document">
        <ContractDocuments contractId={c.id} documents={c.documents} />
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
          <div className="flex flex-col gap-4">
            <LifecycleButtons contractId={c.id} status={c.status} />
            <ExtendTermButton contractId={c.id} currentEndDate={c.end_date} />
          </div>
        </Section>
      )}

      {/* A terminated/completed contract can come back — the client's report
          was that a terminated rider could no longer pay at all. */}
      {ENDED_DISPLAY_STATUSES.includes(displayStatus) && c.obligationStats.total > 0 && (
        <Section title="Reactivate">
          <ReactivateButton
            contractId={c.id}
            currentEndDate={c.end_date}
            termExpired={Boolean(c.end_date && c.end_date < localDateString())}
          />
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
