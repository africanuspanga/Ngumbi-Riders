import Link from 'next/link';
import { RiderAvatar } from '@/components/riders/RiderAvatar';
import { RiderPhotoControls } from '@/components/riders/RiderPhotoControls';
import { identityTypeLabel, type ProfileAudience, type RiderProfile } from '@/lib/riders/profile';
import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TONE,
} from '@/lib/contracts/status';
import { scheduleLabel } from '@/lib/contracts/validation';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';

/*
 * The complete rider profile (build spec #3), rendered for the owner, the
 * accountant and the rider themselves. `audience` decides what is shown:
 *
 *   owner       — everything, plus photo controls and links into the registers.
 *   accountant  — everything except identity/guarantor detail and photo edit.
 *   rider       — their own record; no guarantor block, no risk, no edit.
 *
 * The data layer already withholds what an audience must not receive; this
 * component never re-derives permission from the client.
 */
export function RiderProfileView({
  profile,
  audience,
  motorcycleHref,
  contractHref,
}: {
  profile: RiderProfile;
  audience: ProfileAudience;
  motorcycleHref?: (id: string) => string;
  contractHref?: (id: string) => string;
}) {
  const p = profile;
  const isOwner = audience === 'owner';
  const showGuarantors = audience !== 'rider';
  const progress =
    p.payment.totalContractValue > 0
      ? Math.min(100, Math.round((p.payment.amountPaid / p.payment.totalContractValue) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Identity header */}
      <section className="flex flex-wrap items-start gap-4 rounded-[--radius-card] border border-border bg-white p-4">
        <RiderAvatar photoUrl={p.photoUrl} name={p.fullName} size={88} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-primary-dark">{p.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            {p.riderNumber} · {p.phone}
            {p.email ? ` · ${p.email}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip>{p.status}</Chip>
            {p.contract && (
              <Chip className={CONTRACT_STATUS_TONE[p.contract.displayStatus]}>
                {CONTRACT_STATUS_LABELS[p.contract.displayStatus]}
              </Chip>
            )}
            {audience !== 'rider' && <Chip>risk: {p.riskLevel}</Chip>}
          </div>
        </div>
        {isOwner && <RiderPhotoControls riderId={p.id} hasPhoto={Boolean(p.photoPath)} />}
      </section>

      {/* Money summary */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Amount paid" value={formatTZS(p.payment.amountPaid)} />
        <Kpi
          label="Outstanding"
          value={formatTZS(p.payment.amountOutstanding)}
          tone={p.payment.amountOutstanding > 0 ? 'overdue' : undefined}
        />
        <Kpi label="Next payment" value={formatDate(p.payment.nextPaymentDate)} />
        <Kpi
          label="Overdue days"
          value={String(p.payment.overdueCount)}
          tone={p.payment.overdueCount > 0 ? 'overdue' : undefined}
        />
      </section>

      {p.payment.totalCount > 0 && (
        <section className="rounded-[--radius-card] border border-border bg-white p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-primary-dark">Payment plan progress</span>
            <span className="text-muted-foreground">
              {p.payment.paidCount} of {p.payment.totalCount} payments · {progress}%
            </span>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface">
            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Total plan value {formatTZS(p.payment.totalContractValue)}
          </p>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Personal details */}
        <Section title="Personal details">
          <Grid>
            <Info label="Full name" value={p.fullName} />
            <Info label="Rider code" value={p.riderNumber} />
            <Info label="Phone" value={p.phone} />
            <Info label="Email" value={p.email} />
            <Info label="Date of birth" value={formatDate(p.dateOfBirth)} />
            <Info label="Gender" value={p.gender} />
            <Info label="Identification type" value={identityTypeLabel(p.identityType)} />
            <Info
              label="Identification number"
              value={
                p.hasIdentityNumber
                  ? isOwner
                    ? 'On file — reveal below'
                    : 'On file'
                  : 'Not provided'
              }
            />
            <Info label="Registered" value={formatDate(p.registeredAt)} />
            <Info label="Account status" value={p.status} />
          </Grid>
        </Section>

        {/* Location — personal vs operational (#7) */}
        <Section title="Location">
          <Grid>
            <Info label="Region" value={p.region} />
            <Info label="District" value={p.district} />
            <Info label="Ward" value={p.ward} />
            <Info label="Street" value={p.street} />
          </Grid>
          <Info label="Address" value={p.fullAddress} />
          <p className="text-xs text-muted-foreground">
            {p.locationSource === 'motorcycle'
              ? "Personal location was taken from the assigned motorcycle's operating area."
              : 'Personal location was entered for this rider.'}
            {p.motorcycle?.region && (
              <>
                {' '}
                Motorcycle operates in {[p.motorcycle.district, p.motorcycle.region].filter(Boolean).join(', ')}.
              </>
            )}
          </p>
        </Section>

        {/* Motorcycle */}
        <Section title="Assigned motorcycle">
          {p.motorcycle ? (
            <>
              <Grid>
                <Info label="Code" value={p.motorcycle.code} />
                <Info label="Registration number" value={p.motorcycle.registration ?? 'Not issued yet'} />
                <Info label="Make" value={p.motorcycle.make} />
                <Info label="Model" value={p.motorcycle.model} />
                <Info label="Colour" value={p.motorcycle.colour} />
                <Info label="Assigned since" value={formatDate(p.motorcycle.assignedSince)} />
              </Grid>
              {motorcycleHref && (
                <Link
                  href={motorcycleHref(p.motorcycle.id)}
                  className="text-sm font-semibold text-primary underline"
                >
                  Open motorcycle record
                </Link>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No motorcycle assigned.</p>
          )}
        </Section>

        {/* Contract */}
        <Section title="Contract">
          {p.contract ? (
            <>
              <Grid>
                <Info label="Contract number" value={p.contract.number} />
                <Info
                  label="Status"
                  value={CONTRACT_STATUS_LABELS[p.contract.displayStatus]}
                />
                <Info label="Start date" value={formatDate(p.contract.startDate)} />
                <Info label="End date" value={formatDate(p.contract.endDate)} />
                <Info label="Duration" value={p.contract.durationLabel} />
                <Info
                  label="Payment plan"
                  value={scheduleLabel(
                    p.contract.scheduleType,
                    [],
                    p.contract.dueDayOfMonth,
                  )}
                />
                <Info label="Instalment" value={formatTZS(p.contract.instalmentAmount)} />
                <Info label="Payments made" value={`${p.payment.paidCount} of ${p.payment.totalCount}`} />
              </Grid>
              {p.contract.displayStatus === 'ended_outstanding' && (
                <p className="rounded-[--radius-card] border border-[color:var(--color-overdue)] bg-red-50 p-2 text-xs font-semibold text-[color:var(--color-overdue)]">
                  This contract has ended but {formatTZS(p.payment.amountOutstanding)} is still
                  outstanding across {p.payment.outstandingCount} payment(s).
                </p>
              )}
              {contractHref && (
                <Link href={contractHref(p.contract.id)} className="text-sm font-semibold text-primary underline">
                  Open contract
                </Link>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No contract yet.</p>
          )}
        </Section>

        {/* Guarantor */}
        {showGuarantors && (
          <Section title="Guarantor">
            {p.guarantors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guarantor on file.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {p.guarantors.map((g) => (
                  <li key={g.id} className="border-b border-border pb-2 last:border-0 last:pb-0">
                    <Grid>
                      <Info label="Name" value={g.fullName} />
                      <Info label="Phone" value={g.phone} />
                      <Info label="Relationship" value={g.relationship} />
                      <Info label="Occupation" value={g.occupation} />
                    </Grid>
                    <Info label="Address" value={g.address} />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {/* Documents */}
        <Section title="Uploaded documents">
          {p.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents on file.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {p.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span className="capitalize text-foreground">{d.docType.replace(/_/g, ' ')}</span>
                  {d.url ? (
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-primary underline"
                    >
                      Open
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">Unavailable</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
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
    <div className="flex min-w-0 flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium text-foreground">{value || '—'}</span>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'overdue' }) {
  return (
    <div className="rounded-[--radius-card] border border-border bg-white p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-base font-bold ${tone === 'overdue' ? 'text-[color:var(--color-overdue)]' : 'text-primary-dark'}`}
      >
        {value}
      </p>
    </div>
  );
}

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className ?? 'bg-surface text-muted-foreground'}`}
    >
      {children}
    </span>
  );
}
