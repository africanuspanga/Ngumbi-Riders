import { getTranslations } from 'next-intl/server';

// PWA offline fallback (spec §5.1, §26.2). Financial actions are never allowed
// offline; this is only a friendly shell.
export default async function OfflinePage() {
  const c = await getTranslations('common');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-bold text-primary-dark">{c('offline')}</h1>
      <p className="text-muted-foreground">
        Hakuna mtandao kwa sasa. Malipo hayawezi kufanyika bila mtandao.
      </p>
      {/* Plain HTML on purpose: the service worker serves this page from its
          cache WITHOUT its JavaScript, so a client-side button would never
          work. A GET form with no action re-requests the address the person
          was on, which the service worker tries on the network first. */}
      <form method="get" className="mt-3">
        <button
          type="submit"
          className="min-h-12 rounded-(--radius-card) bg-primary px-6 font-semibold text-white"
        >
          Jaribu tena
        </button>
      </form>
    </main>
  );
}
