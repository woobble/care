import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { AccountMenu } from '@app/web/components/account-menu';
import { SignOutMenuItem } from '@app/web/components/sign-out-menu-item';
import { ThemeSwitcher } from '@app/web/components/theme-switcher';
import { getApiClient, getPermissionGrants, hasPermission } from '@app/web/lib/api';
import { signOutAction } from '@app/web/app/actions/auth';
import { CareDraftScope } from './draft-scope';
import { HeartHandshake } from 'lucide-react';
import { auth } from '@app/web/auth';

export default async function CareLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const api = await getApiClient(false);
  const get = api.GET;
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const [{ data: tenants, error }, { data: user }, session] = await Promise.all([
    get('/api/v1/me/tenants'),
    get('/api/v1/me'),
    auth.api.getSession({ headers: requestHeaders }),
  ]);
  const tenantId = cookieStore.get('care-tenant')?.value;
  if (error || !user || !tenantId || !tenants?.some((tenant) => tenant.id === tenantId))
    redirect('/');
  const permissions = await getPermissionGrants(api);
  const [t, locale] = await Promise.all([getTranslations('Navigation'), getLocale()]);
  const tenantName = tenants.find((tenant) => tenant.id === tenantId)?.name ?? '';
  if (!hasPermission(permissions, 'visit_execution.read')) redirect('/');

  return (
    <CareDraftScope userId={user.id} tenantId={tenantId}>
      <div className="min-h-dvh bg-background text-foreground">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95">
          <nav
            className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-2 px-4 sm:h-16"
            aria-label={t('main')}
          >
            <Link
              className="flex min-h-11 min-w-0 items-center gap-2 font-semibold text-foreground"
              href="/care/today"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <HeartHandshake className="size-4" aria-hidden="true" />
              </span>
              <span className="truncate">{t('today')}</span>
            </Link>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <ThemeSwitcher />
              <AccountMenu
                profileName={session?.user.name}
                email={session?.user.email}
                tenantName={tenantName}
                locale={locale}
                labels={{ account: t('account'), changeTenant: t('changeTenant') }}
                signOut={<SignOutMenuItem action={signOutAction} label={t('signOut')} />}
              />
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-4 pb-8 sm:px-6 sm:py-6">
          {children}
        </main>
      </div>
    </CareDraftScope>
  );
}
