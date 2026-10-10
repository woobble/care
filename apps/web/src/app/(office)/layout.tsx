import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { LanguageSwitcher } from '@app/web/components/language-switcher';
import { getApiClient, getPermissionGrants, hasPermission } from '@app/web/lib/api';
import { signOutAction } from '@app/web/app/actions/auth';

export default async function OfficeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const api = await getApiClient(false);
  const get = api.GET;
  const { data: tenants, error } = await get('/api/v1/me/tenants');
  const tenantId = (await cookies()).get('care-tenant')?.value;
  if (error || !tenantId || !tenants?.some((tenant) => tenant.id === tenantId)) redirect('/');
  const permissions = await getPermissionGrants(api);
  const [t, locale] = await Promise.all([getTranslations('Navigation'), getLocale()]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <nav
          className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4"
          aria-label={t('main')}
        >
          <Link className="font-semibold text-blue-900" href="/clients">
            Care Platform
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasPermission(permissions, 'service.read') ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/services">{t('services')}</Link>
              </Button>
            ) : null}
            {hasPermission(permissions, 'schedule.read') ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/planning">{t('planning')}</Link>
              </Button>
            ) : null}
            {hasPermission(permissions, 'operations.read') ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/operations">{t('operations')}</Link>
              </Button>
            ) : null}
            {hasPermission(permissions, 'onboarding.read') ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/admissions">{t('admissions')}</Link>
              </Button>
            ) : null}
            {hasPermission(permissions, 'communications.read') &&
            hasPermission(permissions, 'client.read') ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/communications">{t('communications')}</Link>
              </Button>
            ) : null}
            {hasPermission(permissions, 'benefits.review') ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/benefits">{t('benefits')}</Link>
              </Button>
            ) : null}
            {hasPermission(permissions, 'billing.read') ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/billing">{t('billing')}</Link>
              </Button>
            ) : null}
            {hasPermission(permissions, 'care_documentation.review') ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/documentation">{t('documentation')}</Link>
              </Button>
            ) : null}
            {hasPermission(permissions, 'service_evidence.read') ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/service-evidence">{t('serviceEvidence')}</Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary" size="sm">
              <Link href="/employees">{t('employees')}</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/administration/users">{t('administration')}</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/">{t('changeTenant')}</Link>
            </Button>
            <form action={signOutAction}>
              <Button variant="link" size="sm">
                {t('signOut')}
              </Button>
            </form>
            <LanguageSwitcher locale={locale} />
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
