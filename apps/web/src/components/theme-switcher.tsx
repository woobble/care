'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

import { Button } from '@care/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@care/ui/components/dropdown-menu';

const options = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
] as const;

function subscribeToHydration() {
  return () => undefined;
}

export function ThemeSwitcher() {
  const t = useTranslations('Navigation');
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const Icon = mounted
    ? (options.find((option) => option.value === theme)?.icon ?? Monitor)
    : Monitor;
  const selectedTheme = options.find((option) => option.value === theme)?.value ?? 'system';

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('appearance')}
          title={t('appearance')}
          className="shrink-0 rounded-full text-muted-foreground"
        >
          <Icon className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup
          value={mounted ? selectedTheme : 'system'}
          onValueChange={(value) => {
            if (options.some((option) => option.value === value)) setTheme(value);
          }}
        >
          {options.map(({ value, icon: OptionIcon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="gap-2">
              <OptionIcon className="size-4" aria-hidden="true" />
              {t(value)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
