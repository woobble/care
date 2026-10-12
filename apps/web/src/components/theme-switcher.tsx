'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

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

  return (
    <details className="group relative">
      <summary
        className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md border border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
        aria-label={t('appearance')}
        title={t('appearance')}
      >
        <Icon className="size-4" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 z-40 mt-2 grid min-w-40 gap-1 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
        {options.map(({ value, icon: OptionIcon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={mounted && theme === value}
            onClick={(event) => {
              setTheme(value);
              event.currentTarget.closest('details')?.removeAttribute('open');
            }}
            className="flex min-h-10 items-center gap-2 rounded-md px-2.5 text-left text-sm hover:bg-accent aria-pressed:bg-accent aria-pressed:font-medium"
          >
            <OptionIcon className="size-4" aria-hidden="true" />
            {t(value)}
          </button>
        ))}
      </div>
    </details>
  );
}
