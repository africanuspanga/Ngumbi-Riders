import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Maombi yamepokelewa' };

export default async function ApplySuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface text-3xl">
        ✓
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-primary-dark">
          Maombi yamepokelewa
        </h1>
        <p className="text-muted">
          Asante. Maombi yako yamepokelewa na yatakaguliwa. Tunza namba yako ya
          kumbukumbu.
        </p>
      </div>
      {ref && (
        <div className="w-full rounded-[--radius-card] border border-border bg-white p-4">
          <p className="text-xs text-muted">Namba ya kumbukumbu</p>
          <p className="text-lg font-bold tracking-wide text-primary-dark">
            {ref}
          </p>
        </div>
      )}
      <Link
        href="/"
        className="rounded-[--radius-card] bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-hover"
      >
        Rudi mwanzo
      </Link>
    </main>
  );
}
