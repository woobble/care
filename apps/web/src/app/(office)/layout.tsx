import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { LanguageSwitcher } from '../../components/language-switcher';
import { getApiClient, getPermissionGrants, hasPermission } from '../../lib/api';
import { signOutAction } from '../actions/auth';

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
          <div className="flex items-center gap-2">
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
            {hasPermission(permissions, 'care_plan.read') ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/care-plans">{t('carePlans')}</Link>
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
