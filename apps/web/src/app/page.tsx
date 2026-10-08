import { headers } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '../auth';
import { getApiClient } from '../lib/api';
import { Button, Label } from '@care/ui';
import { LanguageSwitcher } from '../components/language-switcher';
import { signOutAction } from './actions/auth';
import { selectTenantAction } from './actions/tenant';
import { SignInButton } from './sign-in-button';

export default async function TenantSelectionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const locale = await getLocale();
  const [authT, tenantT] = await Promise.all([getTranslations('Auth'), getTranslations('Tenant')]);
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-xl content-center gap-6 px-4 py-10">
        <div className="flex justify-end">
          <LanguageSwitcher locale={locale} />
        </div>
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            Care Platform
          </p>
          <h1 className="text-3xl font-semibold">{authT('signIn')}</h1>
          <p className="text-slate-600">{authT('signInDescription')}</p>
        </div>
        {params.error === 'auth' ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
            {authT('sessionExpired')}
          </p>
        ) : null}
        <SignInButton />
      </main>
    );
  }
  if (params.error === 'auth') {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-xl content-center gap-6 px-4 py-10">
        <div className="flex justify-end">
          <LanguageSwitcher locale={locale} />
        </div>
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {authT('sessionExpired')}
        </p>
        <form action={signOutAction}>
          <Button type="submit">{authT('signInAgain')}</Button>
        </form>
      </main>
    );
  }
  const api = await getApiClient(false);
  const get = api.GET;
  const { data: tenants, error } = await get('/api/v1/me/tenants');

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-xl content-center gap-6 px-4 py-10">
      <div className="flex justify-end">
        <LanguageSwitcher locale={locale} />
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">Care Platform</p>
        <h1 className="text-3xl font-semibold">{tenantT('selectTitle')}</h1>
        <p className="text-slate-600">{tenantT('selectDescription')}</p>
      </div>
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {tenantT('loadFailed')}
        </p>
      ) : tenants?.length ? (
        <form
          action={selectTenantAction}
          className="grid gap-3 rounded-lg border bg-white p-5 shadow-sm"
        >
          <Label htmlFor="tenantId">{tenantT('label')}</Label>
          <select
            id="tenantId"
            name="tenantId"
            required
            className="min-h-11 rounded-md border border-slate-300 bg-white px-3"
          >
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
          {params.error ? (
            <p role="alert" className="text-sm text-red-800">
              {tenantT('invalidSelection')}
            </p>
          ) : null}
          <Button type="submit">{tenantT('continue')}</Button>
        </form>
      ) : (
        <p className="rounded-md border bg-white p-5 text-slate-700">{tenantT('noAccess')}</p>
      )}
    </main>
  );
}
