import { NativeSelect } from '@care/ui';
import { PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { statusLabelKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import {
  setTeamStatusAction,
  updateTeamAction,
} from '@app/web/app/(office)/administration/actions';
import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function TeamDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const t = await getTranslations();
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [teamResult, facilitiesResult, employeesResult, permissions] = await Promise.all([
    get('/api/v1/teams/{id}', { params: { path: { id }, header } }),
    get('/api/v1/facilities', { params: { header } }),
    get('/api/v1/employees', { params: { query: { teamId: id, page: 1, pageSize: 50 }, header } }),
    getPermissionGrants(api),
  ]);
  if (!teamResult.data) notFound();
  const team = teamResult.data;
  const tenantId = header['X-Tenant-Id'];
  const canReadEmployees = hasClientPermission(
    permissions,
    'employee.read',
    tenantId,
    team.organizationId,
    team.facilityId,
  );
  const facilities = (facilitiesResult.data ?? []).filter(
    (facility) => facility.organizationId === team.organizationId && facility.status === 'active',
  );

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={
          <>
            <Link href="/administration/teams">{t('Teams.title')}</Link> ·{' '}
            <ResourceReference
              label={team.organizationName}
              href={
                hasClientPermission(
                  permissions,
                  'organization.read',
                  tenantId,
                  team.organizationId,
                  null,
                )
                  ? `/administration/organizations/${team.organizationId}`
                  : null
              }
            />
          </>
        }
        title={team.name}
        meta={<StatusBadge status={team.status} label={t(statusLabelKey(team.status))} />}
      />
      <ActionNotice error={query.error} updated={query.updated} />
      <section
        aria-labelledby="team-edit-title"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <h2 id="team-edit-title" className="text-xl font-semibold">
          {t('Teams.detailsTitle')}
        </h2>
        <RHFActionForm action={updateTeamAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={team.id} />
          <div className="grid gap-2">
            <Label htmlFor="name">{t('Common.fields.name')}</Label>
            <Input id="name" name="name" defaultValue={team.name} required maxLength={160} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="facilityId">{t('Teams.facility')}</Label>
            <NativeSelect
              id="facilityId"
              name="facilityId"
              selectClassName="h-10 rounded-md border bg-card px-3"
              defaultValue={team.facilityId ?? ''}
              className="w-full"
            >
              <option value="">{t('Teams.organizationWide')}</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="md:col-span-2">
            <Button type="submit">{t('Common.actions.save')}</Button>
          </div>
        </RHFActionForm>
        {team.status === 'archived' ? (
          <form action={setTeamStatusAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="operation" value="activate" />
            <Button variant="secondary" type="submit">
              {t('Teams.activate')}
            </Button>
          </form>
        ) : (
          <form action={setTeamStatusAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="operation" value="archive" />
            <ConfirmSubmitButton confirmation={t('Teams.archiveConfirmation')}>
              {t('Teams.archive')}
            </ConfirmSubmitButton>
          </form>
        )}
      </section>
      <section aria-labelledby="team-employees-title" className="grid gap-3">
        <h2 id="team-employees-title" className="text-xl font-semibold">
          {t('Teams.employeesTitle')}
        </h2>
        {employeesResult.error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
          >
            {t('Teams.employeeLoadFailed')}
          </p>
        ) : employeesResult.data?.items.length ? (
          <ul className="grid gap-2">
            {employeesResult.data.items.map((employee) => (
              <li
                key={employee.id}
                className="flex justify-between gap-3 rounded-md border bg-card p-3"
              >
                {canReadEmployees ? (
                  <Link
                    className="font-medium text-primary underline"
                    href={`/employees/${employee.id}`}
                  >
                    {employee.firstName} {employee.lastName}
                  </Link>
                ) : (
                  <span className="font-medium">
                    {employee.firstName} {employee.lastName}
                  </span>
                )}
                <StatusBadge status={employee.status} label={t(statusLabelKey(employee.status))} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border bg-card p-4 text-muted-foreground">
            {t('Teams.noEmployees')}
          </p>
        )}
      </section>
    </div>
  );
}
