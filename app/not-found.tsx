import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-bold text-primary-dark">404</h1>
      <p className="text-muted-foreground">Ukurasa haukupatikana.</p>
      <Link
        href="/"
        className="rounded-[--radius-card] bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-hover"
      >
        Rudi mwanzo
      </Link>
    </main>
  );
}
