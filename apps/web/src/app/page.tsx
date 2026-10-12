import { headers } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { auth } from '@app/web/auth';
import { getApiClient } from '@app/web/lib/api';
import { Button, Label } from '@care/ui';
import { HeartHandshake, ShieldCheck } from 'lucide-react';
import { LanguageSwitcher } from '@app/web/components/language-switcher';
import { SignOutForm } from '@app/web/components/sign-out-form';
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
      <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-4 py-16">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-[-22rem] size-[42rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute bottom-[-20rem] right-[-13rem] size-[34rem] rounded-full bg-chart-2/10 blur-3xl" />
        </div>
        <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
          <LanguageSwitcher locale={locale} />
        </div>
        <section className="relative w-full max-w-md">
          <div className="mb-6 flex items-center justify-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <HeartHandshake className="size-6" aria-hidden="true" />
            </span>
            <span className="text-xl font-semibold tracking-tight">Care Platform</span>
          </div>
          <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-xl shadow-foreground/5">
            <div className="h-1 bg-primary" />
            <div className="grid gap-7 p-6 sm:p-8">
              <div className="grid gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{authT('signIn')}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {authT('signInDescription')}
                </p>
              </div>
              {params.error === 'auth' ? (
                <p
                  role="alert"
                  className="rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive"
                >
                  {authT('sessionExpired')}
                </p>
              ) : null}
              <SignInButton />
              <div className="flex items-start gap-3 border-t border-border pt-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                  <ShieldCheck className="size-4" aria-hidden="true" />
                </span>
                <p className="pt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {authT('credentialsNote')}
                </p>
              </div>
            </div>
          </div>
        </section>
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
        <SignOutForm action={signOutAction}>
          <Button type="submit">{authT('signInAgain')}</Button>
        </SignOutForm>
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
