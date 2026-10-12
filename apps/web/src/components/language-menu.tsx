'use client';

import { Languages } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@care/ui';
import { setLocaleAction } from '@app/web/app/actions/locale';
import { isLocale, type Locale } from '@app/web/i18n/config';

export function LanguageMenu({ locale }: Readonly<{ locale: Locale }>) {
  const t = useTranslations('Common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={pending}>
        <Languages className="size-4 text-muted-foreground" aria-hidden="true" />
        <span>{t('language')}</span>
        <span className="ml-auto pr-2 text-xs uppercase text-muted-foreground">{locale}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(value) => {
            if (!isLocale(value)) return;
            startTransition(async () => {
              await setLocaleAction(value);
              router.refresh();
            });
          }}
        >
          <DropdownMenuRadioItem value="en">{t('languages.en')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="de">{t('languages.de')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
