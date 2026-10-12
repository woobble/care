import type { Metadata, Viewport } from 'next';
// oxlint-disable-next-line import/no-unassigned-import -- Next.js loads global CSS through side-effect imports
import './globals.css';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { ServiceWorkerRegistration } from './service-worker-registration';
import { ThemeProvider } from '@app/web/components/theme-provider';

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
  themeColor: '#173a2d',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <ServiceWorkerRegistration />
          <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
