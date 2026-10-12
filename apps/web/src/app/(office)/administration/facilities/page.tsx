import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
  TableCaption as ShadcnTableCaption,
} from '@care/ui';
import { NativeSelect } from '@care/ui';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { statusLabelKey } from '@app/web/i18n/status';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import { createFacilityAction } from '@app/web/app/(office)/administration/actions';

type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function FacilitiesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const t = await getTranslations();
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
          <Link href="/administration/organizations">{t('Facilities.section')}</Link>
        </p>
        <h1 className="text-3xl font-semibold">{t('Facilities.title')}</h1>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />
      {organizationsResult.error || facilitiesResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('Facilities.loadFailed')}
        </p>
      ) : null}
      <section
        aria-labelledby="facility-create-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <h2 id="facility-create-title" className="text-xl font-semibold">
          {t('Facilities.createTitle')}
        </h2>
        <RHFActionForm action={createFacilityAction} className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="organizationId">{t('Facilities.organization')}</Label>
            <NativeSelect
              id="organizationId"
              name="organizationId"
              selectClassName="h-10 rounded-md border bg-white px-3"
              required
              defaultValue=""
              className="w-full"
            >
              <option value="" disabled>
                {t('Facilities.selectOrganization')}
              </option>
              {organizations
                .filter((organization) => organization.status === 'active')
                .map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
            </NativeSelect>
          </div>
          <Field id="name" name="name" label={t('Common.fields.name')} required maxLength={160} />
          <Field id="code" name="code" label={t('Common.fields.code')} maxLength={40} />
          <Field
            id="email"
            name="email"
            label={t('Common.fields.email')}
            type="email"
            maxLength={320}
          />
          <Field
            id="phone"
            name="phone"
            label={t('Common.fields.phone')}
            type="tel"
            maxLength={40}
          />
          <Field id="address" name="address" label={t('Common.fields.address')} maxLength={500} />
          <Field
            id="timezone"
            name="timezone"
            label={t('Facilities.timezoneLabel')}
            maxLength={100}
          />
          <p className="text-sm text-slate-600 md:col-span-2">{t('Facilities.timezoneHint')}</p>
          <div className="md:col-span-2">
            <Button type="submit">{t('Facilities.createTitle')}</Button>
          </div>
        </RHFActionForm>
      </section>
      <section aria-labelledby="facility-list-title" className="grid gap-3">
        <h2 id="facility-list-title" className="text-xl font-semibold">
          {t('Facilities.listTitle')}
        </h2>
        {facilitiesResult.data?.length ? (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <ShadcnTable className="w-full border-collapse text-left text-sm">
              <ShadcnTableCaption className="sr-only">
                {t('Facilities.listCaption')}
              </ShadcnTableCaption>
              <ShadcnTableHeader className="border-b bg-slate-100 text-slate-700">
                <ShadcnTableRow>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Facilities.facility')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Facilities.organizationField')}
                  </ShadcnTableHead>
                  <ShadcnTableHead scope="col" className="px-4 py-3">
                    {t('Common.fields.status')}
                  </ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {facilitiesResult.data.map((facility) => (
                  <ShadcnTableRow key={facility.id} className="border-b last:border-0">
                    <ShadcnTableCell className="px-4 py-3">
                      <Link
                        className="font-medium text-blue-900 underline"
                        href={`/administration/facilities/${facility.id}`}
                      >
                        {facility.name}
                      </Link>
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      {facility.organizationName}
                    </ShadcnTableCell>
                    <ShadcnTableCell className="px-4 py-3">
                      <StatusBadge
                        status={facility.status}
                        label={t(statusLabelKey(facility.status))}
                      />
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ))}
              </ShadcnTableBody>
            </ShadcnTable>
          </div>
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">{t('Facilities.empty')}</p>
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
