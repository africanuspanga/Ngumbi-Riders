import { DownloadIcon } from 'lucide-react';

/*
 * Download this requisition as a PDF (client feedback 2026-09-06).
 *
 * A plain <a>, not a fetch-and-blob button: the route already sets
 * Content-Disposition: attachment, so the browser saves the file itself. That
 * keeps the whole thing a Server Component with no JavaScript, which matters
 * on the low-cost Android phones this app targets — and it still works when
 * the connection drops mid-page.
 */
export function RequisitionPdfLink({ requisitionId }: { requisitionId: string }) {
  return (
    <a
      href={`/api/requisitions/${requisitionId}/pdf`}
      className="text-primary-dark inline-flex min-h-9 items-center gap-1.5 rounded-[--radius-card] border border-border bg-white px-3 text-sm font-semibold hover:bg-surface"
    >
      <DownloadIcon className="size-4 shrink-0" />
      PDF
    </a>
  );
}
