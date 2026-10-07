import Link from 'next/link';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { ActionNotice } from '../action-notice';
import { createTeamAction } from '../actions';

type SearchParams = Promise<{
  error?: string;
  updated?: string;
  organizationId?: string;
  facilityId?: string;
}>;

export default async function TeamsPage({
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
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration/organizations">Organization structure</Link>
        </p>
        <h1 className="text-3xl font-semibold">Teams</h1>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />
      {organizationsResult.error || facilitiesResult.error || teamsResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Team data could not be loaded (
          {organizationsResult.error?.code ||
            facilitiesResult.error?.code ||
            teamsResult.error?.code}
          ).
        </p>
      ) : null}
      <section
        aria-labelledby="team-create-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <h2 id="team-create-title" className="text-xl font-semibold">
          Create team
        </h2>
        <form action={createTeamAction} className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="organizationId">Organization</Label>
            <select
              id="organizationId"
              name="organizationId"
              className="h-10 rounded-md border bg-white px-3"
              required
              defaultValue={query.organizationId ?? ''}
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
          <div className="grid gap-2">
            <Label htmlFor="facilityId">Facility (optional)</Label>
            <select
              id="facilityId"
              name="facilityId"
              className="h-10 rounded-md border bg-white px-3"
              defaultValue={query.facilityId ?? ''}
            >
              <option value="">Organization-wide</option>
              {facilities
                .filter((facility) => facility.status === 'active')
                .map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.organizationName} — {facility.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={160} />
          </div>
          <div className="md:col-span-3">
            <Button type="submit">Create team</Button>
          </div>
        </form>
      </section>
      <section aria-labelledby="team-list-title" className="grid gap-3">
        <h2 id="team-list-title" className="text-xl font-semibold">
          All teams
        </h2>
        {teamsResult.data?.length ? (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Teams</caption>
              <thead className="border-b bg-slate-100 text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Team
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Organization
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Facility
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {teamsResult.data.map((team) => (
                  <tr key={team.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium text-blue-900 underline"
                        href={`/administration/teams/${team.id}`}
                      >
                        {team.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{team.organizationName}</td>
                    <td className="px-4 py-3">{team.facilityName ?? 'Organization-wide'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={team.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">No visible teams.</p>
        )}
      </section>
    </div>
  );
}
