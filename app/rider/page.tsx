import Link from 'next/link';
import { requireRider } from '@/lib/auth/session';
import { getRiderHome } from '@/lib/dashboard/queries';
import { formatTZS } from '@/lib/money/format';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import {
  BikeIcon,
  CalendarDaysIcon,
  TriangleAlertIcon,
  CalendarOffIcon,
  ChevronRightIcon,
  CheckCircle2Icon,
} from 'lucide-react';

/*
 * Hero card styling per payment state (spec §15.1 colour language):
 *   overdue → red  (rider owes / has arrears — "Una deni")
 *   due     → orange (something is due today, not yet overdue)
 *   paid    → green (fully up to date — no arrears, nothing due today)
 * The green state means "up to date", not necessarily "just paid": a rider
 * with no dues today is up to date even without a payment today.
 */
const STATE_UI: Record<string, { label: string; className: string }> = {
  overdue: { label: 'Una deni la kulipa', className: 'bg-[color:var(--color-overdue)] text-white' },
  due: { label: 'Malipo ya leo yanahitajika', className: 'bg-[color:var(--color-warning)] text-white' },
  paid: { label: 'Uko sawa — hakuna deni', className: 'bg-primary text-white' },
};

export default async function RiderHome() {
  const profile = await requireRider();
  const home = await getRiderHome();
  const firstName = profile.fullName?.split(' ')[0];

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-xl font-bold text-primary-dark">
          Karibu{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">Dashibodi yako ya malipo</p>
      </header>

      {!home || home.dashboard.totalObligations === 0 ? (
        <Card className="shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <BikeIcon className="size-8 text-muted-foreground" />
            <p className="font-medium">Huna mkataba unaoendelea kwa sasa.</p>
            <p className="text-sm text-muted-foreground">
              Wasiliana na mmiliki kuhusu mkataba wako.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Payment state hero — the one thing the rider must see (spec §15.1) */}
          <div
            className={`flex flex-col gap-3 rounded-2xl p-5 shadow-sm ${(STATE_UI[home.dashboard.state] ?? STATE_UI.paid!).className}`}
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              {home.dashboard.state === 'paid' ? (
                <CheckCircle2Icon className="size-4" />
              ) : (
                <TriangleAlertIcon className="size-4" />
              )}
              {(STATE_UI[home.dashboard.state] ?? STATE_UI.paid!).label}
            </div>
            {home.dashboard.amountRequiredNow > 0 && (
              <p className="text-4xl font-bold tabular-nums">
                {formatTZS(home.dashboard.amountRequiredNow)}
              </p>
            )}
            {home.dashboard.arrearsCount > 0 && (
              <p className="text-sm/5 opacity-90">
                Madeni: siku {home.dashboard.arrearsCount} · {formatTZS(home.dashboard.arrearsAmount)}
              </p>
            )}
            {home.dashboard.nextDueDate && home.dashboard.state === 'paid' && (
              <p className="text-sm opacity-90">Malipo yajayo: {home.dashboard.nextDueDate}</p>
            )}
            <Link
              href="/rider/pay"
              className="mt-1 rounded-xl bg-white py-3.5 text-center text-base font-bold text-primary-dark shadow-sm active:scale-[0.99]"
            >
              Lipa Sasa
            </Link>
          </div>

          {/* Contract progress */}
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-sm">Maendeleo ya mkataba</CardTitle>
              <CardAction>
                <span className="text-sm font-semibold text-primary">
                  {home.dashboard.progressPercent}%
                </span>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="h-2.5 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${home.dashboard.progressPercent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Zimelipwa {home.dashboard.paidCount}/{home.dashboard.totalObligations} · zilizobaki{' '}
                {formatTZS(home.dashboard.remainingValue)}
              </p>
            </CardContent>
          </Card>

          {/* Quick actions not covered by the bottom nav */}
          <div className="grid grid-cols-2 gap-3">
            <QuickAction
              href="/rider/incidents/new"
              label="Ripoti tukio"
              icon={<TriangleAlertIcon className="size-5" />}
            />
            <QuickAction
              href="/rider/exemptions"
              label="Misamaha"
              icon={<CalendarOffIcon className="size-5" />}
            />
          </div>

          {home.motorcycle && (
            <Card className="shadow-none">
              <CardContent className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-full bg-surface text-primary">
                  <BikeIcon className="size-5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Pikipiki yako</span>
                  <span className="font-semibold">
                    {home.motorcycle.registration ?? home.motorcycle.code}
                    {home.motorcycle.model ? ` · ${home.motorcycle.model}` : ''}
                  </span>
                  {home.motorcycle.registration && (
                    <span className="text-xs text-muted-foreground">{home.motorcycle.code}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {home.recentPayments.length > 0 && (
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-sm">Malipo ya hivi karibuni</CardTitle>
                <CardAction>
                  <Link
                    href="/rider/payments"
                    className="flex items-center gap-0.5 text-sm font-medium text-primary"
                  >
                    Yote <ChevronRightIcon className="size-4" />
                  </Link>
                </CardAction>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {home.recentPayments.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/rider/payments/${p.id}`}
                        className="flex items-center justify-between py-2.5"
                      >
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <CalendarDaysIcon className="size-4" />
                          {p.date}
                        </span>
                        <span className="font-semibold tabular-nums">{formatTZS(p.amount)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function QuickAction({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-white font-semibold text-primary-dark active:bg-surface"
    >
      {icon}
      <span className="text-sm">{label}</span>
    </Link>
  );
}
