import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRider } from '@/lib/auth/session';
import { getReceiptView } from '@/lib/payments/queries';
import { formatTZS } from '@/lib/money/format';

export const metadata = { title: 'Risiti' };

export default async function RiderReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRider();
  const { id } = await params;
  const receipt = await getReceiptView(id);
  if (!receipt) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Link href="/rider/payments" className="text-sm font-medium text-muted">← Malipo</Link>

      <div className="flex flex-col gap-4 rounded-[--radius-card] border border-border bg-white p-5">
        <div className="text-center">
          {receipt.status === 'completed' ? (
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-surface text-2xl text-[color:var(--color-paid)]">✓</div>
          ) : null}
          <h1 className="text-2xl font-bold text-primary-dark">{formatTZS(receipt.amount)}</h1>
          <p className="text-sm text-muted">
            {receipt.method === 'cash' ? 'Taslimu' : 'Pesa za simu'} · {receipt.status}
          </p>
        </div>

        <dl className="flex flex-col gap-2 text-sm">
          <Row label="Namba ya risiti" value={receipt.receiptNumber} />
          <Row label="Tarehe" value={receipt.completedAt?.slice(0, 10)} />
          <Row label="Msimbo wa uthibitisho" value={receipt.verificationCode} />
        </dl>

        {receipt.coveredDates.length > 0 && (
          <div>
            <p className="text-xs text-muted">Siku zilizolipiwa</p>
            <p className="text-sm">{receipt.coveredDates.join(', ')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between border-b border-border py-1">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value || '—'}</dd>
    </div>
  );
}
