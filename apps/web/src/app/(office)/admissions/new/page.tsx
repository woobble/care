import { Textarea } from '@care/ui';
import { NativeSelect } from '@care/ui';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@care/ui';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { createAdmissionCaseAction } from '@app/web/app/(office)/admissions/actions';

export default async function NewAdmissionPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
  const [t, translate] = await Promise.all([getTranslations('Onboarding'), getTranslations()]);
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'onboarding.create')) {
    return (
      <p role="alert" className="rounded-md border bg-white p-5">
        {t('noAccess')}
      </p>
    );
  }
  const [organizationsResult, facilitiesResult, employeesResult] = await Promise.all([
    hasPermission(permissions, 'organization.read')
      ? api.GET('/api/v1/organizations', { params: { query: { status: 'active' }, header } })
      : Promise.resolve({ data: undefined }),
    hasPermission(permissions, 'facility.read')
      ? api.GET('/api/v1/facilities', { params: { query: { status: 'active' }, header } })
      : Promise.resolve({ data: undefined }),
    hasPermission(permissions, 'employee.read')
      ? api.GET('/api/v1/employees', {
          params: {
            query: {
              status: 'active',
              page: 1,
              pageSize: 100,
              sortBy: 'lastName',
              sortOrder: 'asc',
            },
            header,
          },
        })
      : Promise.resolve({ data: undefined }),
  ]);
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const employees = employeesResult.data?.items ?? [];

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/admissions">{t('title')}</Link>
        </p>
        <h1 className="text-3xl font-semibold">{t('createTitle')}</h1>
      </header>
      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {translate(errorMessageKey(query.error))}
        </p>
      ) : null}
      <RHFActionForm
        action={createAdmissionCaseAction}
        className="grid gap-6 rounded-lg border bg-white p-5"
      >
        <fieldset className="grid gap-4 md:grid-cols-2">
          <legend className="mb-2 text-lg font-semibold">{t('caseDetails')}</legend>
          <Field name="firstName" label={t('firstName')} required />
          <Field name="lastName" label={t('lastName')} required />
          <SelectField name="organizationId" label={t('organization')} required>
            <option value="">{t('organization')}</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </SelectField>
          <SelectField name="facilityId" label={t('facility')}>
            <option value="">—</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </SelectField>
          <SelectField name="ownerEmployeeId" label={t('owner')}>
            <option value="">—</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.firstName} {employee.lastName}
              </option>
            ))}
          </SelectField>
          <SelectField name="contactMethod" label={t('contactMethod')} required>
            {(['phone', 'email', 'in_person', 'letter', 'other'] as const).map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </SelectField>
          <Field name="requesterName" label={t('requesterName')} />
          <Field name="requesterRelationship" label={t('requesterRelationship')} />
          <Field name="contactEmail" label={t('contactEmail')} type="email" />
          <Field name="contactPhone" label={t('contactPhone')} type="tel" />
          <Field name="inquirySource" label={t('inquirySource')} required />
          <SelectField name="fundingPlan" label={t('fundingPlan')}>
            {(['unknown', 'private_pay', 'benefits', 'other'] as const).map((value) => (
              <option key={value} value={value}>
                {t(value === 'other' ? 'fundingOther' : value)}
              </option>
            ))}
          </SelectField>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            {t('fundingPlanDetails')}
            <Textarea
              className="min-h-20 rounded-md border p-3 font-normal"
              name="fundingPlanDetails"
              maxLength={1000}
            />
          </label>
          <Field name="preferredStartDate" label={t('preferredStartDate')} type="date" />
          <Field name="nextFollowUpAt" label={t('followUp')} type="datetime-local" />
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            {t('requestedServices')}
            <Textarea
              className="min-h-24 rounded-md border p-3 font-normal"
              name="requestedServices"
              maxLength={1600}
            />
          </label>
          <Field name="serviceLocation" label={t('serviceLocation')} />
          <input
            type="hidden"
            name="timezone"
            value={organizations[0]?.timezone ?? 'Europe/Berlin'}
          />
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            {t('initialNotes')}
            <Textarea
              className="min-h-24 rounded-md border p-3 font-normal"
              name="initialNotes"
              maxLength={4000}
            />
          </label>
        </fieldset>
        <div className="flex gap-2">
          <Button type="submit">{t('newCase')}</Button>
          <Button asChild variant="secondary">
            <Link href="/admissions">{translate('Common.actions.cancel')}</Link>
          </Button>
        </div>
      </RHFActionForm>
    </div>
  );
}

function Field({
  name,
  label,
  type = 'text',
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input
        className="h-10 rounded-md border px-3 font-normal"
        name={name}
        type={type}
        maxLength={254}
        required={required}
      />
    </label>
  );
}

function SelectField({
  name,
  label,
  children,
  required = false,
}: {
  name: string;
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <NativeSelect
        selectClassName="h-10 rounded-md border bg-white px-3 font-normal"
        name={name}
        required={required}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}
