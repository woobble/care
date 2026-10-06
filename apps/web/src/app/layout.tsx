import type { Metadata, Viewport } from 'next';
// oxlint-disable-next-line import/no-unassigned-import -- Next.js loads global CSS through side-effect imports
import './globals.css';
import { ServiceWorkerRegistration } from './service-worker-registration';

export const metadata: Metadata = {
  title: { default: 'Care Platform', template: '%s · Care Platform' },
  description: 'Care platform workspace',
  applicationName: 'Care Platform',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1e40af',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
