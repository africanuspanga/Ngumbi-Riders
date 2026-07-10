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
    </main>
  );
}
