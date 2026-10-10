'use server';

import { cookies } from 'next/headers';
import { loadWebConfig } from '@care/config';
import { localeCookieName, resolveLocale } from '@app/web/i18n/config';

export async function setLocaleAction(value: string): Promise<void> {
  const config = loadWebConfig();
  (await cookies()).set(localeCookieName, resolveLocale(value), {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
