import type { Metadata } from 'next';
import Link from 'next/link';
import { ApplicationForm } from './ApplicationForm';

export const metadata: Metadata = {
  title: 'Omba kuwa mwendeshaji',
  description: 'Fomu ya maombi ya kuwa mwendeshaji wa Ng’umbi Riders.',
};

export default function ApplyPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm font-medium text-muted">
          ← Ng’umbi Riders
        </Link>
        <h1 className="text-2xl font-bold text-primary-dark">
          Maombi ya mwendeshaji
        </h1>
        <p className="text-sm text-muted">
          Jaza fomu hii kwa hatua. Taarifa zako huhifadhiwa kwenye kifaa hiki
          hadi utakapotuma.
        </p>
      </header>
      <ApplicationForm />
    </main>
  );
}
