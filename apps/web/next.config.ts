// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before reading Next.js configuration
import '@care/config/load-env';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import { loadWebConfig } from '@care/config';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default function nextConfig(phase: string): NextConfig {
  if (phase !== 'phase-production-build') loadWebConfig();

  return withNextIntl({
    output: 'standalone',
    transpilePackages: ['@care/api-client', '@care/config', '@care/ui', 'pg'],
    logging: { fetches: { fullUrl: false } },
    async headers() {
      const securityHeaders = [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ];
      if (process.env.NODE_ENV === 'production') {
        securityHeaders.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' });
      }
      return [{ source: '/:path*', headers: securityHeaders }];
    },
  });
}
