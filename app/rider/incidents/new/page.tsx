import Link from 'next/link';
import { requireRider } from '@/lib/auth/session';
import { IncidentForm } from './IncidentForm';

export const metadata = { title: 'Ripoti tukio' };

export default async function NewIncidentPage() {
  await requireRider();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/rider/incidents" className="text-sm font-medium text-muted">← Matukio</Link>
        <h1 className="mt-1 text-xl font-bold text-primary-dark">Ripoti tukio</h1>
      </div>
      <IncidentForm />
    </div>
  );
}
