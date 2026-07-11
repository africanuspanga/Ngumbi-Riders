'use client';

/*
 * Route-level error boundary: catches render/transition errors (including
 * rejected server actions inside startTransition) that would otherwise show
 * Next's bare production error screen. Swahili-first (spec §36.11) with an
 * English hint; the reset button re-renders the failed segment.
 */
export default function RouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-bold text-primary-dark">Kuna hitilafu imetokea</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Samahani, kitu hakikwenda sawa. Angalia mtandao wako kisha jaribu tena.
        <br />
        (Something went wrong. Check your connection and try again.)
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-[--radius-card] bg-primary px-6 py-3 font-semibold text-white hover:bg-primary-hover"
      >
        Jaribu tena
      </button>
    </div>
  );
}
