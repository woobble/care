import type { MetadataRoute } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('Metadata')]);
  return {
    name: t('title'),
    short_name: 'Care',
    description: t('manifestDescription'),
    start_url: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#1e40af',
    lang: locale,
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
