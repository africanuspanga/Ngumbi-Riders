import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccountant } from '@/lib/auth/session';
import { getCompletionRequest, listCompletionEvents } from '@/lib/completion/queries';
import { CompletionDetail } from '@/components/completion/CompletionDetail';

export const metadata = { title: 'Completion request' };

export default async function AccountantCompletionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireAccountant();
  const { id } = await params;
  const [request, events] = await Promise.all([
    getCompletionRequest(id),
    listCompletionEvents(id),
  ]);
  if (!request) notFound();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Link href="/accountant/completions" className="text-sm font-medium text-muted-foreground">
        ← Completions
      </Link>
      {/* An owner visiting the accountant area keeps their own powers: the
          actions each re-check permissions server-side regardless. */}
      <CompletionDetail
        request={request}
        events={events}
        basePath="/accountant"
        viewerRole={profile.role === 'owner' ? 'owner' : 'accountant'}
      />
    </div>
  );
}
