import Link from 'next/link';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { ActionNotice } from '../action-notice';
import { createFacilityAction } from '../actions';

type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function FacilitiesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [organizationsResult, facilitiesResult] = await Promise.all([
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', { params: { header } }),
  ]);
  const organizations = organizationsResult.data ?? [];

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration/organizations">Organization structure</Link>
        </p>
        <h1 className="text-3xl font-semibold">Facilities</h1>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />
      {organizationsResult.error || facilitiesResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Facility data could not be loaded (
          {organizationsResult.error?.code || facilitiesResult.error?.code}).
        </p>
      ) : null}
      <section
        aria-labelledby="facility-create-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <h2 id="facility-create-title" className="text-xl font-semibold">
          Create facility
        </h2>
        <form action={createFacilityAction} className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="organizationId">Organization</Label>
            <select
              id="organizationId"
              name="organizationId"
              className="h-10 rounded-md border bg-white px-3"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Select organization
              </option>
              {organizations
                .filter((organization) => organization.status === 'active')
                .map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
            </select>
          </div>
          <Field id="name" name="name" label="Name" required maxLength={160} />
          <Field id="code" name="code" label="Code" maxLength={40} />
          <Field id="email" name="email" label="Email" type="email" maxLength={320} />
          <Field id="phone" name="phone" label="Phone" type="tel" maxLength={40} />
          <Field id="address" name="address" label="Address" maxLength={500} />
          <Field
            id="timezone"
            name="timezone"
            label="Zeitzone (optional überschreiben)"
            maxLength={100}
          />
          <p className="text-sm text-slate-600 md:col-span-2">
            Leer lassen, um die Zeitzone der Organisation zu übernehmen.
          </p>
          <div className="md:col-span-2">
            <Button type="submit">Create facility</Button>
          </div>
        </form>
      </section>
      <section aria-labelledby="facility-list-title" className="grid gap-3">
        <h2 id="facility-list-title" className="text-xl font-semibold">
          All facilities
        </h2>
        {facilitiesResult.data?.length ? (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Facilities in visible organizations</caption>
              <thead className="border-b bg-slate-100 text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Facility
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Organization
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {facilitiesResult.data.map((facility) => (
                  <tr key={facility.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium text-blue-900 underline"
                        href={`/administration/facilities/${facility.id}`}
                      >
                        {facility.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{facility.organizationName}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={facility.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">No visible facilities.</p>
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
