'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { setLocaleAction } from '../app/actions/locale';
import type { Locale } from '../i18n/config';

export function LanguageSwitcher({ locale }: Readonly<{ locale: Locale }>) {
  const t = useTranslations('Common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t('language')}</span>
      <select
        aria-label={t('language')}
        className="min-h-9 rounded-md border border-slate-300 bg-white px-2"
        value={locale}
        disabled={pending}
        onChange={(event) => {
          const selectedLocale = event.currentTarget.value;
          startTransition(async () => {
            await setLocaleAction(selectedLocale);
            router.refresh();
          });
        }}
      >
        <option value="en">{t('languages.en')}</option>
        <option value="de">{t('languages.de')}</option>
      </select>
    </label>
  );
}
