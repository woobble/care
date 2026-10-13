import { Textarea } from '@care/ui/components/textarea';
import { NativeSelect } from '@care/ui/components/native-select';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { PageHeader } from '@app/web/components/page-patterns';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@care/ui/components/button';
import { errorMessageKey } from '@app/web/i18n/errors';
import { getApiClient, getPermissionGrants, hasPermission } from '@app/web/lib/api';
import { createAdmissionCaseAction } from '@app/web/app/(office)/admissions/actions';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';

export default async function NewAdmissionPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
  const [t, translate] = await Promise.all([getTranslations('Onboarding'), getTranslations()]);
  const query = await searchParams;
  const api = await getApiClient();
  const permissions = await getPermissionGrants(api);
  if (
    !hasPermission(permissions, 'onboarding.create') ||
    !hasPermission(permissions, 'organization.read')
  ) {
    return (
      <p role="alert" className="rounded-md border bg-card p-5">
        {t('noAccess')}
      </p>
    );
  }
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeader eyebrow={<Link href="/admissions">{t('title')}</Link>} title={t('createTitle')} />
      {query.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive"
        >
          {translate(errorMessageKey(query.error))}
        </p>
      ) : null}
      <RHFActionForm
        action={createAdmissionCaseAction}
        className="grid gap-6 rounded-lg border bg-card p-5"
        warnOnUnsavedChanges
      >
        <fieldset className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
          <legend className="px-1 text-lg font-semibold">{t('prospectIdentity')}</legend>
          <Field name="firstName" label={t('firstName')} required />
          <Field name="lastName" label={t('lastName')} required />
        </fieldset>

        <fieldset className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
          <legend className="px-1 text-lg font-semibold">{t('contactAndRepresentative')}</legend>
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
          <p className="text-sm text-muted-foreground md:col-span-2">{t('optionalContactHelp')}</p>
        </fieldset>

        <fieldset className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
          <legend className="px-1 text-lg font-semibold">{t('serviceNeeds')}</legend>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            {t('requestedServices')}
            <Textarea
              className="min-h-20 rounded-md border p-3 font-normal"
              name="requestedServices"
              maxLength={1600}
            />
          </label>
          <Field name="preferredStartDate" label={t('preferredStartDate')} type="date" />
          <Field name="serviceLocation" label={t('serviceLocation')} />
        </fieldset>

        <fieldset className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
          <legend className="px-1 text-lg font-semibold">{t('organizationContext')}</legend>
          <AsyncEntityCombobox
            name="organizationId"
            label={t('organization')}
            entity="organizations"
            required
            placeholder={t('organization')}
          />
          {hasPermission(permissions, 'facility.read') ? (
            <AsyncEntityCombobox
              name="facilityId"
              label={t('facility')}
              entity="facilities"
              placeholder="—"
            />
          ) : null}
          {hasPermission(permissions, 'employee.read') ? (
            <AsyncEntityCombobox
              name="ownerEmployeeId"
              label={t('owner')}
              entity="employees"
              placeholder="—"
            />
          ) : null}
          <Field name="inquirySource" label={t('inquirySource')} required />
          {hasPermission(permissions, 'client.read') ? (
            <AsyncEntityCombobox
              name="clientId"
              label={t('existingClientOptional')}
              entity="clients"
              placeholder={t('selectExistingClient')}
            />
          ) : null}
          <p className="text-sm text-muted-foreground md:col-span-2">{t('existingClientHelp')}</p>
        </fieldset>

        <fieldset className="grid gap-4 rounded-md border p-4 md:grid-cols-2">
          <legend className="px-1 text-lg font-semibold">{t('initialFollowUp')}</legend>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            {t('initialNotes')}
            <Textarea
              className="min-h-20 rounded-md border p-3 font-normal"
              name="initialNotes"
              maxLength={4000}
            />
          </label>
          <Field name="nextFollowUpAt" label={t('followUp')} type="datetime-local" />
          <input type="hidden" name="timezone" value="Europe/Berlin" />
        </fieldset>

        <details className="rounded-md border p-4">
          <summary className="cursor-pointer font-semibold">{t('optionalFundingDetails')}</summary>
          <p className="mt-2 text-sm text-muted-foreground">{t('fundingCanBeAddedLater')}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <SelectField name="fundingPlan" label={t('fundingPlan')}>
              <option value="">{t('notRecordedYet')}</option>
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
          </div>
        </details>
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
    <label className="grid min-w-0 gap-1 text-sm font-medium">
      {label}
      <input
        className="h-10 w-full min-w-0 rounded-md border px-3 font-normal"
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
    <label className="grid min-w-0 gap-1 text-sm font-medium">
      {label}
      <NativeSelect
        selectClassName="h-10 rounded-md border bg-card px-3 font-normal"
        name={name}
        required={required}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}
