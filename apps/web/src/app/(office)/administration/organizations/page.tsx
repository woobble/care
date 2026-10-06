import Link from 'next/link';
import { getApiClient, getTenantHeader } from '../../../../lib/api';

export default async function OrganizationsPage() {
  const api = await getApiClient();
  const get = api.GET;
  const [organizationsResult, facilitiesResult] = await Promise.all([
    get('/api/v1/organizations', { params: { header: await getTenantHeader() } }),
    get('/api/v1/facilities', { params: { header: await getTenantHeader() } }),
  ]);
  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration/users">Administration</Link>
        </p>
        <h1 className="text-3xl font-semibold">Organizations</h1>
        <p className="text-slate-700">Read-only tenant structure used for scoped access.</p>
      </header>
      {organizationsResult.error || facilitiesResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Organization data could not be loaded (
          {organizationsResult.error?.code || facilitiesResult.error?.code}).
        </p>
      ) : null}
      <section aria-labelledby="organization-list-title" className="grid gap-3">
        <h2 id="organization-list-title" className="text-xl font-semibold">
          Organizations
        </h2>
        {organizationsResult.data?.length ? (
          organizationsResult.data.map((organization) => (
            <article key={organization.id} className="rounded-lg border bg-white p-5">
              <h3 className="font-semibold">{organization.name}</h3>
            </article>
          ))
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">No visible organizations.</p>
        )}
      </section>
      <section aria-labelledby="facility-list-title" className="grid gap-3">
        <h2 id="facility-list-title" className="text-xl font-semibold">
          Facilities
        </h2>
        {facilitiesResult.data?.length ? (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Visible facilities</caption>
              <thead className="border-b bg-slate-100 text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Facility
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Organization
                  </th>
                </tr>
              </thead>
              <tbody>
                {facilitiesResult.data.map((facility) => (
                  <tr key={facility.id} className="border-b last:border-0">
                    <td className="px-4 py-3">{facility.name}</td>
                    <td className="px-4 py-3">{facility.organizationName}</td>
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
