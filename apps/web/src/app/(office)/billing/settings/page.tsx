import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { saveBillingProfileAction } from '@app/web/app/(office)/billing/actions';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { ErrorNotice as Alert, SuccessNotice as Status } from '@app/web/components/page-patterns';
import { PageHeader } from '@app/web/components/page-patterns';
import { ClearableSuccessNotice, RHFActionForm } from '@app/web/components/rhf-action-form';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { Button } from '@care/ui/components/button';
import { Checkbox as ShadcnCheckbox } from '@care/ui/components/checkbox';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';

type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function BillingSettingsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const [t, translate, locale] = await Promise.all([
    getTranslations('Billing'),
    getTranslations(),
    getLocale(),
  ]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const [{ data, error }, permissions] = await Promise.all([
    api.GET('/api/v1/billing/settings', { params: { header } }),
    getPermissionGrants(api),
  ]);
  const canManage = hasPermission(permissions, 'billing.settings.manage');
  const organizations = data?.items ?? [];

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageHeader
        eyebrow={t('section')}
        title={t('settings')}
        description={t('settingsDescription')}
      />
      <BillingNavigation permissions={permissions} />
      {(query.error ?? error?.code) ? (
        <Alert>{translate(errorMessageKey(query.error ?? error?.code ?? ''))}</Alert>
      ) : null}
      {query.updated === 'saved' ? (
        <ClearableSuccessNotice>
          <Status>{t('billingProfileSaved')}</Status>
        </ClearableSuccessNotice>
      ) : null}
      <p className="rounded-md border border-primary/20 bg-accent p-3 text-sm text-primary">
        {t('organizationAddressNote')}{' '}
        <Link className="font-medium underline" href="/administration/organizations">
          {t('manageOrganizations')}
        </Link>
      </p>
      {organizations.length ? (
        organizations.map((organization) => {
          const profile = organization.profile;
          return (
            <section
              key={organization.organizationId}
              aria-labelledby={`profile-${organization.organizationId}`}
              className="grid gap-4 rounded-lg border bg-card p-5"
            >
              <div className="grid gap-1">
                <h2 id={`profile-${organization.organizationId}`} className="text-xl font-semibold">
                  {organization.organizationName}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {organization.legalName ?? organization.organizationName} ·{' '}
                  {organization.organizationAddress ?? t('addressMissing')}
                </p>
              </div>
              {canManage ? (
                <RHFActionForm
                  action={saveBillingProfileAction}
                  className="grid gap-4 md:grid-cols-2"
                >
                  <input type="hidden" name="organizationId" value={organization.organizationId} />
                  {profile ? (
                    <input type="hidden" name="expectedVersion" value={profile.version} />
                  ) : null}
                  <Field
                    id={`tax-number-${organization.organizationId}`}
                    name="taxNumber"
                    label={t('taxNumber')}
                    defaultValue={profile?.taxNumber ?? ''}
                  />
                  <Field
                    id={`vat-id-${organization.organizationId}`}
                    name="vatId"
                    label={t('vatId')}
                    defaultValue={profile?.vatId ?? ''}
                  />
                  <Field
                    id={`creditor-id-${organization.organizationId}`}
                    name="creditorIdentifier"
                    label={t('creditorIdentifier')}
                    defaultValue={profile?.creditorIdentifier ?? ''}
                  />
                  <Field
                    id={`account-holder-${organization.organizationId}`}
                    name="bankAccountHolder"
                    label={t('bankAccountHolder')}
                    defaultValue={profile?.bankAccountHolder ?? ''}
                  />
                  <Field
                    id={`iban-${organization.organizationId}`}
                    name="iban"
                    label={t('iban')}
                    defaultValue={profile?.iban ?? ''}
                    autoComplete="off"
                  />
                  <Field
                    id={`bic-${organization.organizationId}`}
                    name="bic"
                    label={t('bic')}
                    defaultValue={profile?.bic ?? ''}
                    autoComplete="off"
                  />
                  <Field
                    id={`payment-terms-${organization.organizationId}`}
                    name="paymentTermsDays"
                    label={t('paymentTermsDays')}
                    type="number"
                    min="0"
                    max="180"
                    step="1"
                    defaultValue={String(profile?.paymentTermsDays ?? 14)}
                    required
                  />
                  <Field
                    id={`invoice-prefix-${organization.organizationId}`}
                    name="invoiceNumberPrefix"
                    label={t('invoiceNumberPrefix')}
                    defaultValue={profile?.invoiceNumberPrefix ?? ''}
                    maxLength={24}
                  />
                  <SelectField
                    id={`tax-treatment-${organization.organizationId}`}
                    name="taxTreatment"
                    label={t('taxTreatment')}
                    defaultValue={profile?.taxTreatment ?? ''}
                    required
                  >
                    <option value="">{t('selectTaxTreatment')}</option>
                    <option value="taxable">{t('taxTreatments.taxable')}</option>
                    <option value="tax_exempt">{t('taxTreatments.tax_exempt')}</option>
                    <option value="small_business">{t('taxTreatments.small_business')}</option>
                  </SelectField>
                  <Field
                    id={`tax-rate-${organization.organizationId}`}
                    name="taxRatePercent"
                    label={t('taxRatePercent')}
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    defaultValue={
                      profile?.taxRateBasisPoints === null ||
                      profile?.taxRateBasisPoints === undefined
                        ? ''
                        : String(profile.taxRateBasisPoints / 100)
                    }
                  />
                  <Field
                    id={`tax-basis-${organization.organizationId}`}
                    name="taxExemptionBasis"
                    label={t('taxExemptionBasis')}
                    defaultValue={profile?.taxExemptionBasis ?? ''}
                    maxLength={300}
                  />
                  <SelectField
                    id={`format-${organization.organizationId}`}
                    name="requiredInvoiceFormat"
                    label={t('requiredInvoiceFormat')}
                    defaultValue={profile?.requiredInvoiceFormat ?? 'pdf'}
                    required
                  >
                    <option value="pdf">{t('pdfFormat')}</option>
                    <option value="structured">{t('structuredInvoice')}</option>
                  </SelectField>
                  <label className="flex items-center gap-2 text-sm md:col-span-2">
                    <ShadcnCheckbox
                      name="requireAcknowledgement"
                      value="true"
                      defaultChecked={profile?.requireAcknowledgement ?? false}
                    />
                    {t('requireAcknowledgement')}
                  </label>
                  <p className="text-sm text-muted-foreground md:col-span-2">
                    {t('taxConfigurationNote')}
                  </p>
                  <Button type="submit" className="w-fit">
                    {t('saveBillingProfile')}
                  </Button>
                </RHFActionForm>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noSettingsPermission')}</p>
              )}
            </section>
          );
        })
      ) : (
        <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
          {t('noOrganizations')}
        </p>
      )}
      <p className="rounded-md border border-warning/40 bg-warning-muted p-3 text-sm text-warning-foreground">
        {t('structuredFormatWarning')}
      </p>
      <p className="text-xs text-muted-foreground">
        {locale === 'de' ? t('taxSourceNoteDe') : t('taxSourceNoteEn')}
      </p>
    </div>
  );
}

function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  min,
  max,
  step,
  maxLength,
  autoComplete,
  required,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  step?: string;
  maxLength?: number;
  autoComplete?: string;
  required?: boolean;
}>) {
  return (
    <label className="grid gap-2 text-sm">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        autoComplete={autoComplete}
        required={required}
      />
    </label>
  );
}

function SelectField({
  id,
  name,
  label,
  defaultValue,
  required,
  children,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-2 text-sm">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        selectClassName="min-h-10 rounded-md border border-input bg-card px-3 py-2"
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}
