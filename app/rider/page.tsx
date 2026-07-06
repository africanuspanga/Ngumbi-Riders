import Link from 'next/link';
import { requireRider } from '@/lib/auth/session';
import { LogoutButton } from '@/components/auth/LogoutButton';

// Phase 1 placeholder rider home — proves phone/PIN auth end-to-end. The full
// dashboard (Lipa Sasa, calendar, arrears) is Phase 6.
export default async function RiderHome() {
  const profile = await requireRider();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-primary-dark">
          Karibu{profile.fullName ? `, ${profile.fullName}` : ''}
        </h1>
        <LogoutButton />
      </header>
      <div className="grid grid-cols-2 gap-3">
        <Link href="/rider/pay" className="rounded-[--radius-card] bg-primary p-5 text-center text-lg font-bold text-white hover:bg-primary-hover">
          Lipa Sasa
        </Link>
        <Link href="/rider/payments" className="rounded-[--radius-card] border border-border bg-white p-5 text-center font-semibold text-primary-dark hover:bg-surface">
          Malipo yangu
        </Link>
      </div>
      <p className="text-sm text-muted">
        Dashibodi kamili (kalenda, salio) itapatikana Awamu ya 6.
      </p>
    </div>
  );
}
