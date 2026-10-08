import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { formatNumber } from '../../../../i18n/format';
import { statusLabelKey } from '../../../../i18n/status';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { ActionNotice } from '../action-notice';
import { createOrganizationAction } from '../actions';

type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function OrganizationsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
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
          <Link href="/administration">{t('Organizations.section')}</Link>
        </p>
        <h1 className="text-3xl font-semibold">{t('Organizations.title')}</h1>
        <p className="text-slate-700">{t('Organizations.description')}</p>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />
      {organizationsResult.error || facilitiesResult.error || teamsResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('Organizations.loadFailed')}
        </p>
      ) : null}

      <section
        aria-labelledby="organization-create-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="organization-create-title" className="text-xl font-semibold">
            {t('Organizations.createTitle')}
          </h2>
          <p className="text-sm text-slate-600">{t('Organizations.createDescription')}</p>
        </div>
        <form action={createOrganizationAction} className="grid gap-4 md:grid-cols-2">
          <Field
            id="organization-name"
            name="name"
            label={t('Common.fields.name')}
            required
            maxLength={160}
          />
          <Field
            id="organization-legal-name"
            name="legalName"
            label={t('Common.fields.legalName')}
            maxLength={200}
          />
          <Field
            id="organization-code"
            name="code"
            label={t('Common.fields.code')}
            maxLength={40}
          />
          <Field
            id="organization-email"
            name="email"
            label={t('Common.fields.email')}
            type="email"
            maxLength={320}
          />
          <Field
            id="organization-phone"
            name="phone"
            label={t('Common.fields.phone')}
            type="tel"
            maxLength={40}
          />
          <Field
            id="organization-address"
            name="address"
            label={t('Common.fields.address')}
            maxLength={500}
          />
          <Field
            id="organization-timezone"
            name="timezone"
            label={t('Common.fields.timezone')}
            defaultValue="Europe/Berlin"
            required
            maxLength={100}
          />
          <p className="text-sm text-slate-600 md:col-span-2">{t('Organizations.timezoneHint')}</p>
          <div className="md:col-span-2">
            <Button type="submit">{t('Organizations.createTitle')}</Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="organization-list-title" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="organization-list-title" className="text-xl font-semibold">
            {t('Organizations.listTitle')}
          </h2>
          <div className="flex gap-3 text-sm">
            <Link className="text-blue-900 underline" href="/administration/facilities">
              {t('Organizations.facilitiesLink')}
            </Link>
            <Link className="text-blue-900 underline" href="/administration/teams">
              {t('Organizations.teamsLink')}
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
                      {t('Organizations.facilityAndTeamCount', {
                        facilities: formatNumber(facilities.length, locale),
                        teams: formatNumber(teams.length, locale),
                      })}
                    </p>
                  </div>
                  <StatusBadge
                    status={organization.status}
                    label={t(statusLabelKey(organization.status))}
                  />
                </div>
              </article>
            );
          })
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">
            {t('Organizations.empty')}
          </p>
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
  defaultValue = '',
  required = false,
  maxLength,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
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
        maxLength={maxLength}
        required={required}
      />
    </div>
  );
}
