'use client';

import { NativeSelect } from '@care/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { setLocaleAction } from '@app/web/app/actions/locale';
import type { Locale } from '@app/web/i18n/config';

export function LanguageSwitcher({ locale }: Readonly<{ locale: Locale }>) {
  const t = useTranslations('Common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex w-28 shrink-0 items-center gap-2 text-sm">
      <span className="sr-only">{t('language')}</span>
      <NativeSelect
        aria-label={t('language')}
        selectClassName="min-h-10 w-full rounded-md border border-input bg-background pl-2 pr-8 text-sm text-foreground"
        value={locale}
        disabled={pending}
        onChange={(event) => {
          const selectedLocale = event.currentTarget.value;
          startTransition(async () => {
            await setLocaleAction(selectedLocale);
            router.refresh();
          });
        }}
        className="w-full"
      >
        <option value="en">{t('languages.en')}</option>
        <option value="de">{t('languages.de')}</option>
      </NativeSelect>
    </label>
  );
}
