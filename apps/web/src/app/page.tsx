import { headers } from 'next/headers';
import { auth } from '../auth';
import { getApiClient } from '../lib/api';
import { Button, Label } from '@care/ui';
import { signOutAction } from './actions/auth';
import { selectTenantAction } from './actions/tenant';
import { SignInButton } from './sign-in-button';

export default async function TenantSelectionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-xl content-center gap-6 px-4 py-10">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            Care Platform
          </p>
          <h1 className="text-3xl font-semibold">Anmelden</h1>
          <p className="text-slate-600">Melden Sie sich mit Ihrem Organisationskonto an.</p>
        </div>
        {params.error === 'auth' ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
            Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.
          </p>
        ) : null}
        <SignInButton />
      </main>
    );
  }
  if (params.error === 'auth') {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-xl content-center gap-6 px-4 py-10">
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.
        </p>
        <form action={signOutAction}>
          <Button type="submit">Erneut anmelden</Button>
        </form>
      </main>
    );
  }
  const api = await getApiClient(false);
  const { data: tenants, error } = await api.GET('/api/v1/me/tenants');

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-xl content-center gap-6 px-4 py-10">
      <div className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">Care Platform</p>
        <h1 className="text-3xl font-semibold">Mandant auswählen</h1>
        <p className="text-slate-600">Wählen Sie den Mandanten für Ihre Arbeitssitzung.</p>
      </div>
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Mandantenzugriff konnte nicht geladen werden.
        </p>
      ) : tenants?.length ? (
        <form
          action={selectTenantAction}
          className="grid gap-3 rounded-lg border bg-white p-5 shadow-sm"
        >
          <Label htmlFor="tenantId">Mandant</Label>
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
              Auswahl ist ungültig.
            </p>
          ) : null}
          <Button type="submit">Weiter</Button>
        </form>
      ) : (
        <p className="rounded-md border bg-white p-5 text-slate-700">
          Ihr Benutzerkonto hat noch keinen aktiven Mandantenzugriff.
        </p>
      )}
    </main>
  );
}
