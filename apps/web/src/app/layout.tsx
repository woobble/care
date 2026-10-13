import type { Metadata, Viewport } from 'next';
// oxlint-disable-next-line import/no-unassigned-import -- Next.js loads global CSS through side-effect imports
import './globals.css';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { ServiceWorkerRegistration } from './service-worker-registration';
import { ThemeProvider } from '@app/web/components/theme-provider';
import { PerformanceInstrumentation } from '@app/web/components/performance-instrumentation';
import { getClientMessages } from '@app/web/i18n/client-messages';

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
          {process.env.NODE_ENV === 'development' ? <PerformanceInstrumentation /> : null}
          <NextIntlClientProvider locale={locale} messages={getClientMessages(messages)}>
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
