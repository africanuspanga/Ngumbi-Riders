import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import './globals.css';

export const metadata: Metadata = {
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
    <html lang={locale}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
