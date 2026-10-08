import type { Metadata, Viewport } from 'next';
// oxlint-disable-next-line import/no-unassigned-import -- Next.js loads global CSS through side-effect imports
import './globals.css';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { ServiceWorkerRegistration } from './service-worker-registration';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Metadata');
  return {
    title: { default: t('title'), template: `%s · ${t('title')}` },
    description: t('description'),
    applicationName: 'Care Platform',
    manifest: '/manifest.webmanifest',
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1e40af',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <ServiceWorkerRegistration />
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
