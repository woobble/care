import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { statusLabelKey } from '@app/web/i18n/status';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import {
  createFacilityAction,
  setOrganizationStatusAction,
  updateOrganizationAction,
} from '@app/web/app/(office)/administration/actions';
import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function OrganizationDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const t = await getTranslations();
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [organizationResult, facilitiesResult, teamsResult] = await Promise.all([
    get('/api/v1/organizations/{id}', { params: { path: { id }, header } }),
    get('/api/v1/facilities', { params: { query: { organizationId: id }, header } }),
    get('/api/v1/teams', { params: { query: { organizationId: id }, header } }),
  ]);
  if (!organizationResult.data) notFound();
  const organization = organizationResult.data;

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration/organizations">{t('Organizations.title')}</Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{organization.name}</h1>
          <StatusBadge
            status={organization.status}
            label={t(statusLabelKey(organization.status))}
          />
        </div>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />

      <section
        aria-labelledby="organization-edit-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <h2 id="organization-edit-title" className="text-xl font-semibold">
          {t('Organizations.detailsTitle')}
        </h2>
        <form action={updateOrganizationAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={organization.id} />
          <Field
            id="name"
            label={t('Common.fields.name')}
            name="name"
            defaultValue={organization.name}
            required
            maxLength={160}
          />
          <Field
            id="legalName"
            label={t('Common.fields.legalName')}
            name="legalName"
            defaultValue={organization.legalName ?? ''}
            maxLength={200}
          />
          <Field
            id="code"
            label={t('Common.fields.code')}
            name="code"
            defaultValue={organization.code ?? ''}
            maxLength={40}
          />
          <Field
            id="email"
            label={t('Common.fields.email')}
            name="email"
            type="email"
            defaultValue={organization.email ?? ''}
            maxLength={320}
          />
          <Field
            id="phone"
            label={t('Common.fields.phone')}
            name="phone"
            type="tel"
            defaultValue={organization.phone ?? ''}
            maxLength={40}
          />
          <Field
            id="address"
            label={t('Common.fields.address')}
            name="address"
            defaultValue={organization.address ?? ''}
            maxLength={500}
          />
          <Field
            id="timezone"
            label={t('Common.fields.timezone')}
            name="timezone"
            defaultValue={organization.timezone}
            required
            maxLength={100}
          />
          <div className="md:col-span-2">
            <Button type="submit">{t('Common.actions.save')}</Button>
          </div>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          {organization.status === 'archived' ? (
            <form action={setOrganizationStatusAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="operation" value="activate" />
              <Button variant="secondary" type="submit">
                {t('Organizations.activate')}
              </Button>
            </form>
          ) : (
            <form action={setOrganizationStatusAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="operation" value="archive" />
              <ConfirmSubmitButton confirmation={t('Organizations.archiveConfirmation')}>
                {t('Organizations.archive')}
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </section>

      <section
        aria-labelledby="facility-create-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="facility-create-title" className="text-xl font-semibold">
            {t('Organizations.facilitiesTitle')}
          </h2>
          <p className="text-sm text-slate-600">{t('Organizations.facilitiesDescription')}</p>
        </div>
        <form action={createFacilityAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="organizationId" value={organization.id} />
          <Field
            id="facility-name"
            label={t('Common.fields.name')}
            name="name"
            required
            maxLength={160}
          />
          <Field id="facility-code" label={t('Common.fields.code')} name="code" maxLength={40} />
          <Field
            id="facility-email"
            label={t('Common.fields.email')}
            name="email"
            type="email"
            maxLength={320}
          />
          <Field
            id="facility-phone"
            label={t('Common.fields.phone')}
            name="phone"
            type="tel"
            maxLength={40}
          />
          <Field
            id="facility-address"
            label={t('Common.fields.address')}
            name="address"
            maxLength={500}
          />
          <Field
            id="facility-timezone"
            label={t('Organizations.facilityTimezoneLabel')}
            name="timezone"
            maxLength={100}
          />
          <p className="text-sm text-slate-600 md:col-span-2">
            {t('Organizations.facilityTimezoneHint')}
          </p>
          <div className="md:col-span-2">
            <Button type="submit">{t('Organizations.createFacility')}</Button>
          </div>
        </form>
        {facilitiesResult.data?.length ? (
          <ul className="grid gap-2">
            {facilitiesResult.data.map((facility) => (
              <li
                key={facility.id}
                className="flex flex-wrap justify-between gap-3 rounded-md border p-3"
              >
                <Link
                  className="font-medium text-blue-900 underline"
                  href={`/administration/facilities/${facility.id}`}
                >
                  {facility.name}
                </Link>
                <StatusBadge status={facility.status} label={t(statusLabelKey(facility.status))} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">{t('Organizations.noFacilities')}</p>
        )}
      </section>

      <section aria-labelledby="teams-title" className="grid gap-3">
        <h2 id="teams-title" className="text-xl font-semibold">
          {t('Organizations.teamsTitle')}
        </h2>
        {teamsResult.data?.length ? (
          <ul className="grid gap-2">
            {teamsResult.data.map((team) => (
              <li
                key={team.id}
                className="flex flex-wrap justify-between gap-3 rounded-md border bg-white p-3"
              >
                <Link
                  className="font-medium text-blue-900 underline"
                  href={`/administration/teams/${team.id}`}
                >
                  {team.name}
                </Link>
                <span className="text-sm text-slate-600">
                  {team.facilityName ?? t('Organizations.organizationWide')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border bg-white p-4 text-slate-700">
            {t('Organizations.noTeams')}
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
