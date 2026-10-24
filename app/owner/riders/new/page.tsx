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
        <Link href="/owner/riders" className="text-sm font-medium text-muted-foreground">
          ← Riders
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-primary-dark">Add rider</h1>
        <p className="text-sm text-muted-foreground">
          Register a rider who is already with you or is just joining. You can
          create their contract afterwards.
        </p>
      </div>
      <ManualRiderForm
        motorcycles={motorcycles.map((m) => ({
          id: m.id,
          registration_number: m.registration_number,
          motorcycle_number: m.motorcycle_number,
          // Carried so picking a bike can fill the rider's location (#7).
          region: m.region,
          district: m.district,
        }))}
      />
    </div>
  );
}
