import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { statusLabelKey } from '@app/web/i18n/status';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import { createTeamAction } from '@app/web/app/(office)/administration/actions';

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
  const t = await getTranslations();
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
          <Link href="/administration/organizations">{t('Teams.section')}</Link>
        </p>
        <h1 className="text-3xl font-semibold">{t('Teams.title')}</h1>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />
      {organizationsResult.error || facilitiesResult.error || teamsResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('Teams.loadFailed')}
        </p>
      ) : null}
      <section
        aria-labelledby="team-create-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <h2 id="team-create-title" className="text-xl font-semibold">
          {t('Teams.createTitle')}
        </h2>
        <form action={createTeamAction} className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="organizationId">{t('Teams.organization')}</Label>
            <select
              id="organizationId"
              name="organizationId"
              className="h-10 rounded-md border bg-white px-3"
              required
              defaultValue={query.organizationId ?? ''}
            >
              <option value="" disabled>
                {t('Teams.selectOrganization')}
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
            <Label htmlFor="facilityId">{t('Teams.facilityOptional')}</Label>
            <select
              id="facilityId"
              name="facilityId"
              className="h-10 rounded-md border bg-white px-3"
              defaultValue={query.facilityId ?? ''}
            >
              <option value="">{t('Teams.organizationWide')}</option>
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
            <Label htmlFor="name">{t('Teams.name')}</Label>
            <Input id="name" name="name" required maxLength={160} />
          </div>
          <div className="md:col-span-3">
            <Button type="submit">{t('Teams.createTitle')}</Button>
          </div>
        </form>
      </section>
      <section aria-labelledby="team-list-title" className="grid gap-3">
        <h2 id="team-list-title" className="text-xl font-semibold">
          {t('Teams.listTitle')}
        </h2>
        {teamsResult.data?.length ? (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">{t('Teams.caption')}</caption>
              <thead className="border-b bg-slate-100 text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    {t('Teams.team')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('Teams.organizationField')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('Teams.facility')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    {t('Common.fields.status')}
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
                    <td className="px-4 py-3">
                      {team.facilityName ?? t('Teams.organizationWide')}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={team.status} label={t(statusLabelKey(team.status))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">{t('Teams.empty')}</p>
        )}
      </section>
    </div>
  );
}
