'use client';

import { ChevronDown, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LanguageMenu } from '@app/web/components/language-menu';
import type { Locale } from '@app/web/i18n/config';
import { Button } from '@care/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@care/ui/components/dropdown-menu';

export function AccountMenu({
  profileName,
  email,
  tenantName,
  locale,
  labels,
  signOut,
  mobileLanguageOnly = false,
}: Readonly<{
  profileName?: string | null | undefined;
  email?: string | null | undefined;
  tenantName: string;
  locale: Locale;
  labels: { account: string; changeTenant: string };
  signOut: ReactNode;
  mobileLanguageOnly?: boolean;
}>) {
  const t = useTranslations('Navigation');
  const name = profileName?.trim() || undefined;
  const userEmail = email?.trim() || undefined;
  const initials = getInitials(name ?? userEmail);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={name ? `${labels.account}: ${name}` : labels.account}
          title={labels.account}
          className="h-10 min-h-10 shrink-0 gap-2 rounded-full px-1.5 sm:px-2"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
            {initials ?? <UserRound className="size-4" aria-hidden="true" />}
          </span>
          <span className="hidden max-w-32 truncate text-sm sm:block">
            {name ?? labels.account}
          </span>
          <ChevronDown
            className="hidden size-3.5 text-muted-foreground sm:block"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-1.5rem)]">
        <div className="flex min-w-0 items-center gap-3 px-2.5 py-2">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
            {initials ?? <UserRound className="size-5" aria-hidden="true" />}
          </span>
          <div className="grid min-w-0 gap-0.5">
            <p className="truncate text-sm font-semibold">{name ?? labels.account}</p>
            {userEmail ? (
              <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
            ) : null}
          </div>
        </div>
        {tenantName ? (
          <div className="grid gap-0.5 px-2.5 pb-2">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t('currentOrganization')}
            </p>
            <p className="truncate text-sm">{tenantName}</p>
          </div>
        ) : null}
        <div className={mobileLanguageOnly ? 'sm:hidden' : undefined}>
          <DropdownMenuSeparator />
          <LanguageMenu locale={locale} />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/">
            <span>{labels.changeTenant}</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {signOut}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getInitials(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parts = value.includes('@') ? [value.split('@')[0] ?? ''] : value.trim().split(/\s+/);
  const initials = parts
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return initials || undefined;
}
