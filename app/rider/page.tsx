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
      <p className="text-muted">
        Dashibodi kamili itapatikana Awamu ya 6. Umeingia kama mwendeshaji.
      </p>
    </div>
  );
}
