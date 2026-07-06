import Link from 'next/link';
import { requireRider } from '@/lib/auth/session';
import { getRiderHome } from '@/lib/dashboard/queries';
import { formatTZS } from '@/lib/money/format';
import { LogoutButton } from '@/components/auth/LogoutButton';

const STATE_UI: Record<string, { label: string; className: string }> = {
  overdue: { label: 'Una deni', className: 'bg-red-50 text-[color:var(--color-overdue)]' },
  due: { label: 'Malipo ya leo yanahitajika', className: 'bg-amber-50 text-[color:var(--color-warning)]' },
  paid: { label: 'Umelipa — hongera!', className: 'bg-surface text-[color:var(--color-paid)]' },
};

export default async function RiderHome() {
  const profile = await requireRider();
  const home = await getRiderHome();

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary-dark">
          Karibu{profile.fullName ? `, ${profile.fullName}` : ''}
        </h1>
        <LogoutButton />
      </header>

      {!home || home.dashboard.totalObligations === 0 ? (
        <p className="text-muted">Huna mkataba unaoendelea kwa sasa.</p>
      ) : (
        <>
          <div className={`rounded-[--radius-card] p-4 text-center ${(STATE_UI[home.dashboard.state] ?? STATE_UI.paid!).className}`}>
            <p className="text-sm font-semibold">{(STATE_UI[home.dashboard.state] ?? STATE_UI.paid!).label}</p>
            {home.dashboard.amountRequiredNow > 0 && (
              <p className="mt-1 text-3xl font-bold">{formatTZS(home.dashboard.amountRequiredNow)}</p>
            )}
            {home.dashboard.arrearsCount > 0 && (
              <p className="mt-1 text-sm">Madeni: {home.dashboard.arrearsCount} · {formatTZS(home.dashboard.arrearsAmount)}</p>
            )}
            {home.dashboard.nextDueDate && home.dashboard.state === 'paid' && (
              <p className="mt-1 text-sm">Malipo yajayo: {home.dashboard.nextDueDate}</p>
            )}
          </div>

          <Link href="/rider/pay" className="rounded-[--radius-card] bg-primary py-4 text-center text-lg font-bold text-white hover:bg-primary-hover">
            Lipa Sasa
          </Link>

          {/* Contract progress */}
          <div className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
            <div className="flex justify-between text-sm">
              <span className="font-semibold text-primary-dark">Maendeleo ya mkataba</span>
              <span className="text-muted">{home.dashboard.progressPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface">
              <div className="h-full bg-primary" style={{ width: `${home.dashboard.progressPercent}%` }} />
            </div>
            <p className="text-xs text-muted">
              Zimelipwa {home.dashboard.paidCount}/{home.dashboard.totalObligations} · zilizobaki {formatTZS(home.dashboard.remainingValue)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Link href="/rider/calendar" className="rounded-[--radius-card] border border-border bg-white p-4 text-center font-semibold text-primary-dark hover:bg-surface">
              Kalenda
            </Link>
            <Link href="/rider/payments" className="rounded-[--radius-card] border border-border bg-white p-4 text-center font-semibold text-primary-dark hover:bg-surface">
              Malipo yangu
            </Link>
            <Link href="/rider/incidents/new" className="rounded-[--radius-card] border border-border bg-white p-4 text-center font-semibold text-primary-dark hover:bg-surface">
              Ripoti tukio
            </Link>
            <Link href="/rider/exemptions" className="rounded-[--radius-card] border border-border bg-white p-4 text-center font-semibold text-primary-dark hover:bg-surface">
              Misamaha
            </Link>
            <Link href="/rider/notifications" className="rounded-[--radius-card] border border-border bg-white p-4 text-center font-semibold text-primary-dark hover:bg-surface">
              Arifa
              {home.unreadNotifications > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-overdue px-1 text-xs text-white">
                  {home.unreadNotifications}
                </span>
              )}
            </Link>
          </div>

          {home.motorcycle && (
            <div className="rounded-[--radius-card] border border-border bg-white p-4">
              <p className="text-xs text-muted">Pikipiki yako</p>
              <p className="font-semibold text-foreground">
                {home.motorcycle.registration}{home.motorcycle.model ? ` · ${home.motorcycle.model}` : ''}
              </p>
            </div>
          )}

          {home.recentPayments.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[--radius-card] border border-border bg-white p-4">
              <p className="text-sm font-semibold text-primary-dark">Malipo ya hivi karibuni</p>
              <ul className="flex flex-col divide-y divide-border text-sm">
                {home.recentPayments.map((p) => (
                  <li key={p.id} className="flex justify-between py-1.5">
                    <Link href={`/rider/payments/${p.id}`} className="text-primary-dark">{p.date}</Link>
                    <span className="font-medium">{formatTZS(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
