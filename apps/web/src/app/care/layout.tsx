import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { LanguageSwitcher } from '@app/web/components/language-switcher';
import { SignOutForm } from '@app/web/components/sign-out-form';
import { getApiClient, getPermissionGrants, hasPermission } from '@app/web/lib/api';
import { signOutAction } from '@app/web/app/actions/auth';
import { CareDraftScope } from './draft-scope';

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
      <div className="min-h-screen bg-slate-50">
        <header className="border-b bg-white">
          <nav
            className="mx-auto flex min-h-16 max-w-4xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2"
            aria-label={t('main')}
          >
            <Link
              className="min-h-11 content-center font-semibold text-blue-900"
              href="/care/today"
            >
              {t('today')}
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <SignOutForm action={signOutAction}>
                <Button variant="link" size="sm" className="min-h-11">
                  {t('signOut')}
                </Button>
              </SignOutForm>
              <LanguageSwitcher locale={locale} />
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:py-8">{children}</main>
      </div>
    </CareDraftScope>
  );
}
