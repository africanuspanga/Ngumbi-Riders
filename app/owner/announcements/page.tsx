import { requireOwner } from '@/lib/auth/session';
import { AnnouncementForm } from './AnnouncementForm';

export const metadata = { title: 'Announcements' };

export default async function AnnouncementsPage() {
  await requireOwner();
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-primary-dark">Announcements</h1>
        <p className="text-sm text-muted">
          Broadcast an in-app notification (and push) to riders.
        </p>
      </header>
      <AnnouncementForm />
    </div>
  );
}
