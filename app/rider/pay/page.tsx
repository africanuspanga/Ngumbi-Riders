import { requireRider } from '@/lib/auth/session';
import { getRiderPayView } from '@/lib/payments/queries';
import { formatTZS } from '@/lib/money/format';
import { PayClient } from './PayClient';

export const metadata = { title: 'Lipa' };

export default async function PayPage() {
  await requireRider();
  const view = await getRiderPayView();

  if (!view || !view.hasActiveContract) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-bold text-primary-dark">Lipa</h1>
        <p className="text-muted-foreground">Huna mkataba unaoendelea kwa sasa.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-primary-dark">Lipa Sasa</h1>
        {view.arrearsCount > 0 ? (
          <p className="text-sm text-overdue">
            Una madeni {view.arrearsCount} · {formatTZS(view.arrearsAmount)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Malipo yanayohitajika: {view.outstandingCount}</p>
        )}
      </header>

      <PayClient options={view.options} phone={view.phone} />
    </div>
  );
}
