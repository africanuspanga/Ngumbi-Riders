import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth/session';
import { getCompletionRequest, listCompletionEvents } from '@/lib/completion/queries';
import { CompletionDetail } from '@/components/completion/CompletionDetail';

export const metadata = { title: 'Completion request' };

export default async function OwnerCompletionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();
  const { id } = await params;
  const [request, events] = await Promise.all([
    getCompletionRequest(id),
    listCompletionEvents(id),
  ]);
  if (!request) notFound();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Link href="/owner/completions" className="text-sm font-medium text-muted-foreground">
        ← Completions
      </Link>
      <CompletionDetail
        request={request}
        events={events}
        basePath="/owner"
        viewerRole="owner"
      />
    </div>
  );
}
