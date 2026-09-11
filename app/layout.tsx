import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import './globals.css';
import { Geist, Space_Grotesk } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

/*
 * The display face, used with restraint: money figures, the dashboard hero and
 * section eyebrows. Space Grotesk's numerals are squared-off and mechanical —
 * they read like an instrument panel, which is what a fleet-operations desk
 * actually is, and they set the figures apart from Geist's UI text so an amount
 * never reads as a label.
 *
 * Only the back office references --font-display, and a browser downloads a
 * font only when something uses it, so the rider PWA (low-cost Android, low
 * bandwidth — spec §6.2) pays nothing for it.
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '700'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: {
    default: "Ng'umbi Riders",
    template: "%s · Ng'umbi Riders",
  },
  description:
    'Mfumo wa malipo na mikataba kwa waendesha pikipiki wa Ng’umbi Riders.',
  applicationName: "Ng'umbi Riders",
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#2F8F46',
  width: 'device-width',
  initialScale: 1,
  // Allow zoom for accessibility on low-cost devices.
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={cn("font-sans", geist.variable, spaceGrotesk.variable)}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
