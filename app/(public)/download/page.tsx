import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

/*
 * Download page for the Android app (mobile/, 2026-10-30) — the link the owner
 * sends to riders. The APK itself is a GitHub Release asset; the
 * "latest/download" URL always serves the newest release, so this page never
 * needs editing when a new version ships.
 */
export const metadata: Metadata = { title: 'Pakua programu · Download the app' };

const APK_URL =
  'https://github.com/africanuspanga/Ngumbi-Riders/releases/latest/download/ngumbi-riders.apk';

export default function DownloadPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-8">
      <Link href="/" className="flex items-center gap-2.5">
        <Image src="/icons/icon-192.png" alt="" width={44} height={44} className="rounded-xl" />
        <span className="text-lg font-semibold text-primary-dark">Ng’umbi Riders</span>
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-primary-dark">Pakua programu ya Android</h1>
        <p className="mt-1 text-sm text-muted-foreground">Download the Android app</p>
      </div>

      <a
        href={APK_URL}
        className="flex min-h-14 items-center justify-center rounded-(--radius-card) bg-primary px-6 text-lg font-semibold text-white hover:bg-primary-hover"
      >
        Pakua sasa · Download (16 MB)
      </a>

      <section className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-white p-4 text-sm">
        <h2 className="font-semibold text-primary-dark">Jinsi ya kusakinisha</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>Bonyeza <strong>Pakua sasa</strong> hapo juu.</li>
          <li>Upakuaji ukiisha, fungua faili <strong>ngumbi-riders.apk</strong>.</li>
          <li>
            Simu ikiuliza ruhusa ya “Install unknown apps”, bonyeza <strong>Settings</strong>, washa
            ruhusa, kisha rudi nyuma.
          </li>
          <li>
            Bonyeza <strong>Install</strong>, kisha <strong>Open</strong>.
          </li>
          <li>
            Ingia kwa namba yako ya simu na PIN — kama unavyoingia kwenye tovuti. Mmiliki na
            mhasibu wanaingia kupitia “Wewe ni mmiliki au mhasibu? Ingia hapa”.
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Install: tap Download, open the file, allow “Install unknown apps” if asked, then Install
          and Open. Sign in exactly as on the website. Android 7.0 or newer.
        </p>
      </section>

      <p className="text-center text-sm text-muted-foreground">
        Huna Android?{' '}
        <Link href="/app" className="font-semibold text-primary underline-offset-2 hover:underline">
          Tumia tovuti
        </Link>
      </p>
    </main>
  );
}
