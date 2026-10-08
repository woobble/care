// oxlint-disable-next-line import/no-unassigned-import -- load dotenv before reading Next.js configuration
import '@care/config/load-env';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@care/api-client', '@care/config', '@care/ui'],
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
