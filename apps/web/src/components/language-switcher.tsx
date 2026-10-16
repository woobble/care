'use client';

import { Languages } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { setLocaleAction } from '@app/web/app/actions/locale';
import { isLocale, type Locale } from '@app/web/i18n/config';
import { Button } from '@care/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@care/ui/components/dropdown-menu';

export function LanguageSwitcher({ locale }: Readonly<{ locale: Locale }>) {
  const t = useTranslations('Common');
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('language')}
          title={t('language')}
          disabled={pending}
          className="h-10 min-h-10 shrink-0 gap-1.5 rounded-full px-2 sm:px-2.5"
        >
          <Languages className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-xs font-medium text-muted-foreground uppercase">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => {
            if (!isLocale(value)) return;
            startTransition(async () => {
              await setLocaleAction(value);
              window.location.reload();
            });
          }}
        >
          <DropdownMenuRadioItem value="en">{t('languages.en')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="de">{t('languages.de')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
