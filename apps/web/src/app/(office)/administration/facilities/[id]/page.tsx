import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { PageHeader } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
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
  createTeamAction,
  setFacilityStatusAction,
  updateFacilityAction,
} from '@app/web/app/(office)/administration/actions';
import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function FacilityDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const t = await getTranslations();
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [facilityResult, teamsResult, employeesResult, permissions] = await Promise.all([
    get('/api/v1/facilities/{id}', { params: { path: { id }, header } }),
    get('/api/v1/teams', { params: { query: { facilityId: id }, header } }),
    get('/api/v1/employees', {
      params: { query: { facilityId: id, page: 1, pageSize: 50 }, header },
    }),
    getPermissionGrants(api),
  ]);
  if (!facilityResult.data) notFound();
  const facility = facilityResult.data;
  const tenantId = header['X-Tenant-Id'];
  const canReadTeams = hasClientPermission(
    permissions,
    'team.read',
    tenantId,
    facility.organizationId,
    facility.id,
  );
  const canReadEmployees = hasClientPermission(
    permissions,
    'employee.read',
    tenantId,
    facility.organizationId,
    facility.id,
  );

  return (
    <div className="grid gap-8">
      <PageHeader
        eyebrow={
          <>
            <Link href="/administration/facilities">{t('Facilities.title')}</Link> ·{' '}
            <ResourceReference
              label={facility.organizationName}
              href={
                hasClientPermission(
                  permissions,
                  'organization.read',
                  tenantId,
                  facility.organizationId,
                  null,
                )
                  ? `/administration/organizations/${facility.organizationId}`
                  : null
              }
            />
          </>
        }
        title={facility.name}
        meta={<StatusBadge status={facility.status} label={t(statusLabelKey(facility.status))} />}
      />
      <ActionNotice error={query.error} updated={query.updated} />
      <section
        aria-labelledby="facility-edit-title"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <h2 id="facility-edit-title" className="text-xl font-semibold">
          {t('Facilities.detailsTitle')}
        </h2>
        <RHFActionForm action={updateFacilityAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={facility.id} />
          <Field
            id="name"
            label={t('Common.fields.name')}
            name="name"
            defaultValue={facility.name}
            required
            maxLength={160}
          />
          <Field
            id="code"
            label={t('Common.fields.code')}
            name="code"
            defaultValue={facility.code ?? ''}
            maxLength={40}
          />
          <Field
            id="email"
            label={t('Common.fields.email')}
            name="email"
            type="email"
            defaultValue={facility.email ?? ''}
            maxLength={320}
          />
          <Field
            id="phone"
            label={t('Common.fields.phone')}
            name="phone"
            type="tel"
            defaultValue={facility.phone ?? ''}
            maxLength={40}
          />
          <Field
            id="address"
            label={t('Common.fields.address')}
            name="address"
            defaultValue={facility.address ?? ''}
            maxLength={500}
          />
          <Field
            id="timezone"
            label={t('Facilities.timezoneLabel')}
            name="timezone"
            defaultValue={facility.timezone ?? ''}
            maxLength={100}
          />
          <p className="text-sm text-muted-foreground md:col-span-2">
            {t('Facilities.timezoneHint')}
          </p>
          <div className="md:col-span-2">
            <Button type="submit">{t('Common.actions.save')}</Button>
          </div>
        </RHFActionForm>
        {facility.status === 'archived' ? (
          <StatusForm id={id} operation="activate" />
        ) : (
          <form action={setFacilityStatusAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="operation" value="archive" />
            <ConfirmSubmitButton confirmation={t('Facilities.archiveConfirmation')}>
              {t('Facilities.archive')}
            </ConfirmSubmitButton>
          </form>
        )}
      </section>

      <section
        aria-labelledby="facility-teams-title"
        className="grid gap-4 rounded-lg border bg-card p-5"
      >
        <div>
          <h2 id="facility-teams-title" className="text-xl font-semibold">
            {t('Facilities.teamsTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('Facilities.teamsDescription')}</p>
        </div>
        <RHFActionForm action={createTeamAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="organizationId" value={facility.organizationId} />
          <input type="hidden" name="facilityId" value={facility.id} />
          <div className="grid gap-2">
            <Label htmlFor="team-name">{t('Facilities.newTeam')}</Label>
            <Input id="team-name" name="name" required maxLength={160} />
          </div>
          <Button type="submit">{t('Facilities.createTeam')}</Button>
        </RHFActionForm>
        {teamsResult.data?.length ? (
          <ul className="grid gap-2">
            {teamsResult.data.map((team) => (
              <li key={team.id} className="flex justify-between gap-3 rounded-md border p-3">
                {canReadTeams ? (
                  <Link
                    className="font-medium text-primary underline"
                    href={`/administration/teams/${team.id}`}
                  >
                    {team.name}
                  </Link>
                ) : (
                  <span className="font-medium">{team.name}</span>
                )}
                <StatusBadge status={team.status} label={t(statusLabelKey(team.status))} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Facilities.noTeams')}</p>
        )}
      </section>

      <section aria-labelledby="facility-employees-title" className="grid gap-3">
        <h2 id="facility-employees-title" className="text-xl font-semibold">
          {t('Facilities.employeesTitle')}
        </h2>
        {employeesResult.error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
          >
            {t('Facilities.employeeLoadFailed')}
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
            {t('Facilities.noEmployees')}
          </p>
        )}
      </section>
    </div>
  );
}

function Field({
  id,
  label,
  name,
  defaultValue = '',
  type = 'text',
  required = false,
  maxLength,
}: Readonly<{
  id: string;
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  maxLength: number;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
      />
    </div>
  );
}

async function StatusForm({ id, operation }: Readonly<{ id: string; operation: 'activate' }>) {
  const t = await getTranslations();
  return (
    <form action={setFacilityStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="operation" value={operation} />
      <Button variant="secondary" type="submit">
        {t('Facilities.activate')}
      </Button>
    </form>
  );
}
