import Link from 'next/link';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { ActionNotice } from '../action-notice';
import { createOrganizationAction } from '../actions';

type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function OrganizationsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [organizationsResult, facilitiesResult, teamsResult] = await Promise.all([
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', { params: { header } }),
    get('/api/v1/teams', { params: { header } }),
  ]);

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration">Administration</Link>
        </p>
        <h1 className="text-3xl font-semibold">Organizations</h1>
        <p className="text-slate-700">Manage the provider structure for this tenant.</p>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />
      {organizationsResult.error || facilitiesResult.error || teamsResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Organization data could not be loaded (
          {organizationsResult.error?.code ||
            facilitiesResult.error?.code ||
            teamsResult.error?.code}
          ).
        </p>
      ) : null}

      <section
        aria-labelledby="organization-create-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="organization-create-title" className="text-xl font-semibold">
            Create organization
          </h2>
          <p className="text-sm text-slate-600">
            An organization is the legal or operational owner of facilities and employees.
          </p>
        </div>
        <form action={createOrganizationAction} className="grid gap-4 md:grid-cols-2">
          <Field id="organization-name" name="name" label="Name" required maxLength={160} />
          <Field id="organization-legal-name" name="legalName" label="Legal name" maxLength={200} />
          <Field id="organization-code" name="code" label="Code" maxLength={40} />
          <Field id="organization-email" name="email" label="Email" type="email" maxLength={320} />
          <Field id="organization-phone" name="phone" label="Phone" type="tel" maxLength={40} />
          <Field id="organization-address" name="address" label="Address" maxLength={500} />
          <div className="md:col-span-2">
            <Button type="submit">Create organization</Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="organization-list-title" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="organization-list-title" className="text-xl font-semibold">
            Organizations
          </h2>
          <div className="flex gap-3 text-sm">
            <Link className="text-blue-900 underline" href="/administration/facilities">
              Facilities
            </Link>
            <Link className="text-blue-900 underline" href="/administration/teams">
              Teams
            </Link>
          </div>
        </div>
        {organizationsResult.data?.length ? (
          organizationsResult.data.map((organization) => {
            const facilities = (facilitiesResult.data ?? []).filter(
              (facility) => facility.organizationId === organization.id,
            );
            const teams = (teamsResult.data ?? []).filter(
              (team) => team.organizationId === organization.id,
            );
            return (
              <article key={organization.id} className="rounded-lg border bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <h3 className="font-semibold">
                      <Link
                        className="text-blue-900 underline-offset-4 hover:underline"
                        href={`/administration/organizations/${organization.id}`}
                      >
                        {organization.name}
                      </Link>
                    </h3>
                    {organization.legalName ? (
                      <p className="text-sm text-slate-600">{organization.legalName}</p>
                    ) : null}
                    <p className="text-sm text-slate-600">
                      {facilities.length} facilities · {teams.length} teams
                    </p>
                  </div>
                  <StatusBadge status={organization.status} />
                </div>
              </article>
            );
          })
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">No visible organizations.</p>
        )}
      </section>
    </div>
  );
}

function Field({
  id,
  name,
  label,
  type = 'text',
  required = false,
  maxLength,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  maxLength: number;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} maxLength={maxLength} required={required} />
    </div>
  );
}
