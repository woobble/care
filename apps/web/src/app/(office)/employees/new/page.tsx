import { NativeSelect } from '@care/ui';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { PageHeader } from '@app/web/components/page-patterns';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button, Input, Label } from '@care/ui';
import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import { createEmployeeAction } from '@app/web/app/(office)/employees/actions';

type SearchParams = Promise<{ error?: string }>;

export default async function NewEmployeePage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const t = await getTranslations();
  const query = await searchParams;
  const api = await getApiClient();
  const get = api.GET;
  const { data: organizations, error } = await get('/api/v1/organizations', {
    params: { query: { status: 'active' }, header: await getTenantHeader() },
  });
  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader
        eyebrow={<Link href="/employees">{t('Employees.title')}</Link>}
        title={t('Employees.createTitle')}
        description={t('Employees.createDescription')}
      />
      <ActionNotice error={query.error} />
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {t('Errors.generic')}
        </p>
      ) : null}
      <RHFActionForm
        action={createEmployeeAction}
        className="grid gap-5 rounded-lg border bg-card p-5"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="organizationId">{t('Employees.form.organization')}</Label>
            <NativeSelect
              id="organizationId"
              name="organizationId"
              selectClassName="h-10 rounded-md border bg-card px-3"
              required
              defaultValue=""
              className="w-full"
            >
              <option value="" disabled>
                {t('Employees.form.selectOrganization')}
              </option>
              {(organizations ?? []).map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Field
            id="firstName"
            name="firstName"
            label={t('Employees.form.firstName')}
            required
            maxLength={120}
          />
          <Field
            id="lastName"
            name="lastName"
            label={t('Employees.form.lastName')}
            required
            maxLength={120}
          />
          <Field
            id="preferredName"
            name="preferredName"
            label={t('Employees.form.preferredName')}
            maxLength={120}
          />
          <Field
            id="personnelNumber"
            name="personnelNumber"
            label={t('Employees.form.personnelNumber')}
            maxLength={64}
          />
          <Field
            id="email"
            name="email"
            label={t('Employees.form.email')}
            type="email"
            maxLength={320}
          />
          <Field
            id="phone"
            name="phone"
            label={t('Employees.form.phone')}
            type="tel"
            maxLength={40}
          />
          <Field
            id="employmentType"
            name="employmentType"
            label={t('Employees.form.employmentType')}
            maxLength={80}
          />
          <Field
            id="startDate"
            name="startDate"
            label={t('Employees.form.startDate')}
            type="date"
          />
          <Field id="endDate" name="endDate" label={t('Employees.form.endDate')} type="date" />
          <Field
            id="weeklyHours"
            name="weeklyHours"
            label={t('Employees.form.weeklyHours')}
            type="number"
            min="0"
            max="168"
            step="0.25"
          />
        </div>
        <div className="flex gap-3">
          <Button type="submit" disabled={!organizations?.length}>
            {t('Employees.create')}
          </Button>
          <Button asChild variant="secondary">
            <Link href="/employees">{t('Common.actions.cancel')}</Link>
          </Button>
        </div>
      </RHFActionForm>
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
  min,
  max,
  step,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}
