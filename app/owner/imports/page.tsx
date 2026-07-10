import Link from 'next/link';
import { requireOwner } from '@/lib/auth/session';
import { ImportWizard } from './ImportWizard';

export const metadata = { title: 'Imports' };

export default async function ImportsPage() {
  await requireOwner();
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <Link href="/owner" className="text-sm font-medium text-muted-foreground">
          ← Owner
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-primary-dark">Imports</h1>
        <p className="text-sm text-muted-foreground">
          Load existing riders and motorcycles from CSV or Excel. Download a
          template, upload, review, then confirm.
        </p>
      </div>
      <ImportWizard />
    </div>
  );
}
