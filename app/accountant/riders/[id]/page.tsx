import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccountant } from '@/lib/auth/session';
import { getRiderProfile } from '@/lib/riders/profile';
import { getRiderPaymentHistory, getRiderStatement } from '@/lib/payments/queries';
import { RiderProfileView } from '@/components/riders/RiderProfileView';
import { PaymentHistory } from '@/components/payments/PaymentHistory';
import { StatementSummary } from '@/components/payments/StatementView';

export const metadata = { title: 'Rider' };

/**
 * Rider profile for the accountant: the same record the owner sees, minus the
 * identity reveal, PIN reset, risk and status controls. Read-only by
 * construction — this page renders no mutating action at all.
 */
export default async function AccountantRiderProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccountant();
  const { id } = await params;
  const [profile, payments, statement] = await Promise.all([
    getRiderProfile(id, 'accountant'),
    getRiderPaymentHistory(id),
    getRiderStatement(id),
  ]);
  if (!profile) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/accountant/riders" className="text-sm font-medium text-muted-foreground">
          ← Riders
        </Link>
      </div>
      <RiderProfileView
        profile={profile}
        audience="accountant"
        motorcycleHref={(mid) => `/accountant/motorcycles/${mid}`}
        contractHref={(cid) => `/accountant/contracts/${cid}`}
      />

      <section className="flex flex-col gap-3 rounded-[--radius-card] border border-border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-primary-dark">Payments</h2>
          <Link
            href={`/accountant/payments/rider/${id}`}
            className="text-sm font-medium text-primary hover:underline"
          >
            Full statement →
          </Link>
        </div>
        {statement && <StatementSummary progress={statement.progress} />}
        <PaymentHistory payments={payments.slice(0, 10)} receiptHref={null} />
      </section>
    </div>
  );
}
