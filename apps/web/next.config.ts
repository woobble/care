import '@care/config/load-env';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@care/api-client', '@care/config', '@care/ui'],
};

export default nextConfig;
