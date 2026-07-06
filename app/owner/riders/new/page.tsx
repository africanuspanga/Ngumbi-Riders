import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { listAvailableMotorcycles } from '@/lib/motorcycles/queries';
import { ManualRiderForm } from './ManualRiderForm';

export const metadata = { title: 'Add rider' };

export default async function NewRiderPage() {
  await requireOwner();
  const motorcycles = await listAvailableMotorcycles();

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <div>
        <Link href="/owner/riders" className="text-sm font-medium text-muted">
          ← Riders
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-primary-dark">Add rider</h1>
        <p className="text-sm text-muted">
          Create an existing or new rider. A contract can be created later
          (Phase 4).
        </p>
      </div>
      <ManualRiderForm
        motorcycles={motorcycles.map((m) => ({
          id: m.id,
          registration_number: m.registration_number,
          motorcycle_number: m.motorcycle_number,
        }))}
      />
    </div>
  );
}
