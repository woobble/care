import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { LanguageSwitcher } from '@app/web/components/language-switcher';
import { SignOutForm } from '@app/web/components/sign-out-form';
import { ThemeSwitcher } from '@app/web/components/theme-switcher';
import { getApiClient, getPermissionGrants, hasPermission } from '@app/web/lib/api';
import { signOutAction } from '@app/web/app/actions/auth';
import { CareDraftScope } from './draft-scope';
import { HeartHandshake, LogOut } from 'lucide-react';

export default async function CareLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const api = await getApiClient(false);
  const get = api.GET;
  const [{ data: tenants, error }, { data: user }] = await Promise.all([
    get('/api/v1/me/tenants'),
    get('/api/v1/me'),
  ]);
  const tenantId = (await cookies()).get('care-tenant')?.value;
  if (error || !user || !tenantId || !tenants?.some((tenant) => tenant.id === tenantId))
    redirect('/');
  const permissions = await getPermissionGrants(api);
  const [t, locale] = await Promise.all([getTranslations('Navigation'), getLocale()]);
  if (!hasPermission(permissions, 'visit_execution.read')) redirect('/');

  return (
    <CareDraftScope userId={user.id} tenantId={tenantId}>
      <div className="min-h-dvh bg-background text-foreground">
        <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
          <nav
            className="mx-auto flex min-h-14 w-full max-w-5xl items-center justify-between gap-2 px-4 sm:min-h-16"
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
              <LanguageSwitcher locale={locale} />
              <SignOutForm action={signOutAction}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="sm:hidden"
                  aria-label={t('signOut')}
                  title={t('signOut')}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="sm" className="hidden min-h-10 sm:inline-flex">
                  <LogOut className="size-4" aria-hidden="true" />
                  {t('signOut')}
                </Button>
              </SignOutForm>
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-5 pb-8 sm:px-6 sm:py-7">
          {children}
        </main>
      </div>
    </CareDraftScope>
  );
}
