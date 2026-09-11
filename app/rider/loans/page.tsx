import Link from 'next/link';
import { requireRider } from '@/lib/auth/session';
import { getRiderPhoneLoanState } from '@/lib/loans/queries';
import {
  REQUEST_STATUS_LABELS_SW,
  REQUEST_STATUS_HELP_SW,
  isWithdrawable,
} from '@/lib/loans/constants';
import { FOCUS_LABELS_SW } from '@/lib/loans/portfolio';
import { OBLIGATION_STATUS_LABELS_SW } from '@/lib/payments/labels';
import { formatTZS } from '@/lib/money/format';
import { formatDate } from '@/lib/dates/format';
import { PhoneLoanRequestForm } from './PhoneLoanRequestForm';
import { WithdrawRequestButton } from './WithdrawRequestButton';

export const metadata = { title: 'Mkopo wa simu' };

/*
 * The rider's phone-loan page (client feedback 2026-09-11 #11, #13).
 *
 * Swahili, mobile-first, low-bandwidth (spec rule 11). Its most important job
 * is not the request form — it is the top line, which says WHAT THE RIDER IS
 * CURRENTLY PAYING. A rider whose motorcycle days have stopped appearing needs
 * to be told why, in one sentence, before anything else.
 */
export default async function RiderLoansPage() {
  const profile = await requireRider();
  const state = await getRiderPhoneLoanState(profile.riderId!);

  const BLOCKED_SW: Record<string, string> = {
    no_active_contract: 'Unahitaji mkataba unaoendelea wa pikipiki kuomba mkopo wa simu.',
    request_in_progress: 'Una ombi linaendelea. Subiri lijibiwe kabla ya kuomba tena.',
    loan_in_progress: 'Unalipa mkopo wa simu. Utaweza kuomba mwingine ukimaliza.',
    lease_not_started: 'Mkataba wako wa pikipiki bado haujaanza.',
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/rider" className="text-sm font-medium text-muted-foreground">
          ← Mwanzo
        </Link>
        <h1 className="mt-1 text-xl font-bold text-primary-dark">Mkopo wa simu</h1>
      </div>

      {/* What am I paying right now? The question this page exists to answer. */}
      <div className="rounded-[--radius-card] border border-primary/30 bg-primary/5 p-4">
        <p className="text-sm text-muted-foreground">Kwa sasa</p>
        <p className="text-lg font-bold text-primary-dark">{FOCUS_LABELS_SW[state.focus]}</p>
        {state.leasePaused && (
          <p className="mt-1 text-sm">
            Malipo ya pikipiki yamesimama. Siku zako hazipotei — zinaahirishwa hadi mwisho wa
            mkataba, kwa hiyo jumla unayolipa haibadiliki.
          </p>
        )}
      </div>

      {/* The active loan and its instalments. */}
      {state.activeLoan && (
        <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
          <h2 className="font-semibold text-primary-dark">Mkopo wako wa simu</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row label="Jumla ya mkopo" value={formatTZS(state.activeLoan.totalAmount)} />
            <Row label="Umelipa" value={formatTZS(state.activeLoan.repaid)} />
            <Row label="Unadaiwa" value={formatTZS(state.activeLoan.outstanding)} strong />
            <Row label="Miezi" value={String(state.activeLoan.termMonths)} />
          </dl>
          <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border">
            {state.activeLoan.instalments.map((i, idx) => (
              <li key={i.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  Awamu {idx + 1} · {formatDate(i.dueDate)}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{formatTZS(i.amount)}</span>
                  <span className="text-xs text-muted-foreground">
                    {OBLIGATION_STATUS_LABELS_SW[i.status] ?? i.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {state.activeLoan.outstanding > 0 && (
            <Link
              href="/rider/pay"
              className="min-h-12 rounded-[--radius-card] bg-primary px-4 py-3 text-center font-semibold text-white hover:bg-primary-hover"
            >
              Lipa sasa
            </Link>
          )}
        </section>
      )}

      {/* Where an open request has got to. */}
      {state.openRequest && (
        <section className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold text-primary-dark">Ombi lako</h2>
            <span className="shrink-0 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold">
              {REQUEST_STATUS_LABELS_SW[state.openRequest.status]}
            </span>
          </div>
          <p className="text-sm">{REQUEST_STATUS_HELP_SW[state.openRequest.status]}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <Row label="Kiasi" value={formatTZS(state.openRequest.principal)} />
            <Row label="Jumla ya kurejesha" value={formatTZS(state.openRequest.totalAmount)} />
            <Row label="Miezi" value={String(state.openRequest.termMonths)} />
            <Row label="Tarehe" value={formatDate(state.openRequest.createdAt)} />
          </dl>
          {state.openRequest.decisionNote && (
            <p className="text-sm text-muted-foreground">{state.openRequest.decisionNote}</p>
          )}
          {isWithdrawable(state.openRequest.status) && (
            <WithdrawRequestButton requestId={state.openRequest.id} />
          )}
        </section>
      )}

      {/* The request form, or why it is not available. */}
      {state.canRequest ? (
        <PhoneLoanRequestForm
          maxAmount={state.limits.maxAmount}
          maxMonths={state.limits.maxMonths}
          interestBps={state.limits.interestBps}
        />
      ) : (
        !state.openRequest &&
        !state.activeLoan && (
          <p className="rounded-[--radius-card] border border-border bg-surface p-4 text-sm">
            {BLOCKED_SW[state.blockedReason ?? ''] ?? 'Kwa sasa hauwezi kuomba mkopo wa simu.'}
          </p>
        )
      )}

      {/* History: refused and finished requests. */}
      {state.history.filter((r) => r.id !== state.openRequest?.id).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold text-primary-dark">Maombi yaliyopita</h2>
          <ul className="flex flex-col divide-y divide-border rounded-[--radius-card] border border-border bg-white">
            {state.history
              .filter((r) => r.id !== state.openRequest?.id)
              .map((r) => (
                <li key={r.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{formatTZS(r.principal)}</span>
                    <span className="text-xs text-muted-foreground">
                      {REQUEST_STATUS_LABELS_SW[r.status]}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
                  {r.decisionNote && <span className="text-xs">{r.decisionNote}</span>}
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-bold text-primary-dark' : 'font-medium'}>{value}</dd>
    </div>
  );
}
