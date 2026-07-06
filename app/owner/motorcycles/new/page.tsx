import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { NewMotorcycleForm } from './NewMotorcycleForm';

export const metadata = { title: 'Add motorcycle' };

export default async function NewMotorcyclePage() {
  await requireOwner();
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <div>
        <Link href="/owner/motorcycles" className="text-sm font-medium text-muted">
          ← Motorcycles
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-primary-dark">Add motorcycle</h1>
      </div>
      <NewMotorcycleForm />
    </div>
  );
}
