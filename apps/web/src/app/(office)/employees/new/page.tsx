import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { ActionNotice } from '@app/web/app/(office)/administration/action-notice';
import { createEmployeeAction } from '@app/web/app/(office)/employees/actions';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { PageHeader } from '@app/web/components/page-patterns';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { Button } from '@care/ui/components/button';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';

type SearchParams = Promise<{ error?: string }>;

export default async function NewEmployeePage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const t = await getTranslations();
  const query = await searchParams;
  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader
        eyebrow={<Link href="/employees">{t('Employees.title')}</Link>}
        title={t('Employees.createTitle')}
        description={t('Employees.createDescription')}
      />
      <ActionNotice error={query.error} />
      <RHFActionForm
        action={createEmployeeAction}
        errorMessage={t('Employees.createFailed')}
        warnOnUnsavedChanges
        className="grid gap-5 rounded-lg border bg-card p-5"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <AsyncEntityCombobox
            name="organizationId"
            entity="organizations"
            label={t('Employees.form.organization')}
            placeholder={t('Employees.form.selectOrganization')}
            required
          />
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
          <Button type="submit">{t('Employees.create')}</Button>
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
