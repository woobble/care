import { ErrorNotice as Alert, SuccessNotice as Status } from '@app/web/components/page-patterns';
import { Checkbox as ShadcnCheckbox } from '@care/ui';
import { NativeSelect } from '@care/ui';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { PageHeader } from '@app/web/components/page-patterns';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button, Input } from '@care/ui';
import { errorMessageKey } from '@app/web/i18n/errors';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '@app/web/lib/api';
import { BillingNavigation } from '@app/web/app/(office)/billing/billing-nav';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { EmptyState } from '@app/web/components/page-patterns';
import { DataPagination } from '@app/web/components/data-pagination';
import { redirectToValidPage } from '@app/web/lib/pagination';
import {
  createPayerDirectoryEntryAction,
  savePayerRequirementsAction,
  updatePayerDirectoryEntryAction,
} from '@app/web/app/(office)/billing/actions';

type Organization = { id: string; name: string };
type Payer = {
  id: string;
  organizationId: string;
  payerType: string;
  name: string;
  payerIdentifier: string | null;
  addressText: string | null;
  billingContactName: string | null;
  billingContactEmail: string | null;
  billingContactPhone: string | null;
  submissionInstructions: string | null;
  status: 'active' | 'inactive';
  validFrom: string;
  validUntil: string | null;
  version: number;
};
type PayerProfile = {
  id: string;
  channel: string;
  fundingSourceType: string;
  validFrom: string;
  validUntil: string | null;
  sourceName: string;
  sourceVersion: string;
  sourceEffectiveDate: string;
  sourceUrl: string | null;
  version: number;
  requiresClientInsuranceNumber: boolean;
  requiresPayerIdentifier: boolean;
  requiresAcknowledgement: boolean;
  requiresMandate: boolean;
  requiresInvoicePdf: boolean;
  requiresEvidencePdf: boolean;
  requiresMandateDocument: boolean;
  requiresExternalReference: boolean;
  requiresProviderRecognition: boolean;
};
type SearchParams = Promise<{
  error?: string;
  updated?: string;
  organizationId?: string;
  q?: string;
  page?: string;
  pageSize?: string;
}>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ClaimsSettingsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const [t, translate] = await Promise.all([getTranslations('Billing'), getTranslations()]);
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const canRead = hasPermission(permissions, 'claims.read');
  const canManage = hasPermission(permissions, 'claims.settings.manage');
  const organizationId =
    query.organizationId && uuidPattern.test(query.organizationId)
      ? query.organizationId
      : undefined;
  const search = query.q?.trim().slice(0, 120) || undefined;
  const page = positiveInteger(query.page, 1, 100_000);
  const pageSize = positiveInteger(query.pageSize, 20, 100);
  const organizationResult =
    canRead && organizationId
      ? await api.GET('/api/v1/organizations/{id}', {
          params: { path: { id: organizationId }, header },
        })
      : null;
  const organization = organizationResult?.data as Organization | undefined;
  const organizationError = organizationResult?.error as { code?: string } | undefined;
  const payerResult =
    canRead && organization
      ? await api.GET('/api/v1/billing/payers', {
          params: {
            query: {
              organizationId: organization.id,
              page,
              pageSize,
              ...(search ? { q: search } : {}),
            },
            header,
          },
        })
      : null;
  const payerPage = payerResult?.data as
    | { items?: Payer[]; page: number; pageSize: number; totalItems: number }
    | undefined;
  const payers = payerPage?.items ?? [];
  const profileResult =
    organization && payers.length
      ? await api.GET('/api/v1/billing/payer-directory/profiles', {
          params: {
            query: {
              organizationId: organization.id,
              payerIds: payers.map((payer) => payer.id).join(','),
            },
            header,
          },
        })
      : null;
  const profilesByPayerId = new Map<string, PayerProfile[]>();
  for (const profile of (profileResult?.data ?? []) as Array<PayerProfile & { payerId: string }>) {
    const profiles = profilesByPayerId.get(profile.payerId) ?? [];
    profiles.push(profile);
    profilesByPayerId.set(profile.payerId, profiles);
  }
  const profileError = (profileResult?.error as { code?: string } | undefined)?.code;
  const payerError = (payerResult?.error as { code?: string } | undefined)?.code;
  if (payerPage && organization) {
    redirectToValidPage(
      '/billing/claims/settings',
      { organizationId: organization.id, ...(search ? { q: search } : {}) },
      page,
      pageSize,
      payerPage.totalItems,
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageHeader
        eyebrow={<Link href="/billing/claims">{t('claims')}</Link>}
        title={t('claimsSettings')}
        description={t('claimsSettingsDescription')}
      />
      <BillingNavigation permissions={permissions} />
      {query.error || organizationError?.code || (query.organizationId && !organizationId) ? (
        <Alert>
          {translate(errorMessageKey(query.error ?? organizationError?.code ?? 'INVALID_REQUEST'))}
        </Alert>
      ) : null}
      {query.updated === 'payer-saved' ? <Status>{t('payerDirectorySaved')}</Status> : null}
      {query.updated === 'profile-saved' ? <Status>{t('payerProfileSaved')}</Status> : null}
      {!canRead ? <Alert>{t('noClaimsPermission')}</Alert> : null}
      {!canManage ? <Alert>{t('noClaimsSettingsPermission')}</Alert> : null}
      <form
        method="get"
        className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(16rem,1fr)_auto] sm:items-end"
      >
        <AsyncEntityCombobox
          name="organizationId"
          entity="organizations"
          label={translate('Common.fields.organization')}
          initialOption={
            organization ? { id: organization.id, label: organization.name } : undefined
          }
        />
        <Button type="submit" variant="secondary">
          {t('openClaimsSettings')}
        </Button>
      </form>
      {canRead && organization ? (
        <section
          key={organization.id}
          aria-labelledby={'payers-' + organization.id}
          className="grid gap-4 rounded-lg border bg-card p-5"
        >
          <div className="grid gap-1">
            <h2 id={'payers-' + organization.id} className="text-xl font-semibold">
              {organization.name}
            </h2>
            <p className="text-sm text-muted-foreground">{t('payerDirectoryDescription')}</p>
          </div>
          <form action="/billing/claims/settings" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="organizationId" value={organization.id} />
            <input type="hidden" name="pageSize" value={pageSize} />
            <label className="grid gap-1 text-sm" htmlFor="payer-search">
              {t('payer')}
              <input
                id="payer-search"
                name="q"
                type="search"
                defaultValue={search ?? ''}
                maxLength={120}
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>
            <Button type="submit" variant="secondary">
              {t('applyClaimFilter')}
            </Button>
          </form>
          {payerError || profileError ? (
            <Alert>{translate(errorMessageKey(payerError ?? profileError ?? ''))}</Alert>
          ) : null}
          {payers.map((payer) => {
            const profiles = profilesByPayerId.get(payer.id) ?? [];
            return (
              <article key={payer.id} className="grid gap-4 rounded-md border p-4">
                <div className="grid gap-1">
                  <h3 className="font-semibold">{payer.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {payerTypeLabel(t, payer.payerType)} · {payerStatusLabel(t, payer.status)} ·{' '}
                    {t('payerVersion')}: {payer.version}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('payerIdentifier')}: {payer.payerIdentifier ?? t('identifierNotConfigured')}
                  </p>
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {payer.addressText ?? '—'}
                  </p>
                </div>
                {canManage ? (
                  <form
                    action={updatePayerDirectoryEntryAction}
                    className="grid gap-3 border-t pt-3 md:grid-cols-2"
                  >
                    <input type="hidden" name="payerId" value={payer.id} />
                    <input type="hidden" name="organizationId" value={organization.id} />
                    <input type="hidden" name="expectedVersion" value={payer.version} />
                    <PayerFields t={t} payer={payer} />
                    <Button type="submit" className="w-fit md:col-span-2">
                      {t('savePayer')}
                    </Button>
                  </form>
                ) : null}
                <div className="grid gap-2 border-t pt-3">
                  <h4 className="font-semibold">{t('payerRequirementProfiles')}</h4>
                  {profiles.length ? (
                    <ul className="grid gap-2">
                      {profiles.map((profile) => (
                        <li key={profile.id} className="rounded-md border p-3 text-sm">
                          <p className="font-medium">
                            {t('payerProfileSummary', {
                              channel: channelLabel(t, profile.channel),
                              fundingType: fundingTypeLabel(t, profile.fundingSourceType),
                              version: profile.version,
                            })}
                          </p>
                          <p>
                            {t('payerProfileSource', {
                              sourceName: profile.sourceName,
                              sourceVersion: profile.sourceVersion,
                              effectiveDate: profile.sourceEffectiveDate,
                            })}{' '}
                            {profile.validUntil
                              ? t('payerProfileValidity', {
                                  validFrom: profile.validFrom,
                                  validUntil: profile.validUntil,
                                })
                              : t('payerProfileValidityOpen', { validFrom: profile.validFrom })}
                          </p>
                          {profile.sourceUrl ? (
                            <a
                              className="break-all text-primary underline"
                              href={profile.sourceUrl}
                              rel="noreferrer"
                            >
                              {profile.sourceUrl}
                            </a>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : !profileError ? (
                    <p className="text-sm text-muted-foreground">{t('payerProfilesEmpty')}</p>
                  ) : null}
                </div>
                {canManage ? (
                  <RHFActionForm
                    action={savePayerRequirementsAction}
                    className="grid gap-3 border-t pt-3 md:grid-cols-2"
                  >
                    <input type="hidden" name="payerId" value={payer.id} />
                    <input type="hidden" name="organizationId" value={organization.id} />
                    <SelectField
                      id={'channel-' + payer.id}
                      name="channel"
                      label={t('claimChannel')}
                      defaultValue="manual_portal"
                    >
                      <option value="manual_portal">{channelLabel(t, 'manual_portal')}</option>
                      <option value="manual_email">{channelLabel(t, 'manual_email')}</option>
                      <option value="postal">{channelLabel(t, 'postal')}</option>
                      <option value="customer_reimbursement">
                        {channelLabel(t, 'customer_reimbursement')}
                      </option>
                    </SelectField>
                    <SelectField
                      id={'funding-' + payer.id}
                      name="fundingSourceType"
                      label={t('fundingSource')}
                      defaultValue={
                        payer.payerType === 'private_pflegeversicherung'
                          ? 'private_long_term_care_insurance'
                          : payer.payerType === 'self_pay'
                            ? 'self_pay'
                            : payer.payerType === 'other'
                              ? 'other'
                              : 'statutory_long_term_care_insurance'
                      }
                    >
                      <option value="statutory_long_term_care_insurance">
                        {fundingTypeLabel(t, 'statutory_long_term_care_insurance')}
                      </option>
                      <option value="private_long_term_care_insurance">
                        {fundingTypeLabel(t, 'private_long_term_care_insurance')}
                      </option>
                      <option value="self_pay">{fundingTypeLabel(t, 'self_pay')}</option>
                      <option value="other">{fundingTypeLabel(t, 'other')}</option>
                    </SelectField>
                    <Field
                      id={'profile-valid-from-' + payer.id}
                      name="validFrom"
                      label={t('validFrom')}
                      type="date"
                      defaultValue={today()}
                      required
                    />
                    <Field
                      id={'profile-valid-until-' + payer.id}
                      name="validUntil"
                      label={t('validUntil')}
                      type="date"
                    />
                    <Field
                      id={'source-name-' + payer.id}
                      name="sourceName"
                      label={t('requirementsSourceName')}
                      required
                    />
                    <Field
                      id={'source-version-' + payer.id}
                      name="sourceVersion"
                      label={t('requirementsSourceVersion')}
                      required
                    />
                    <Field
                      id={'source-effective-date-' + payer.id}
                      name="sourceEffectiveDate"
                      label={t('sourceEffectiveDate')}
                      type="date"
                      defaultValue={today()}
                      required
                    />
                    <Field
                      id={'source-url-' + payer.id}
                      name="sourceUrl"
                      label={t('requirementsSourceUrl')}
                      type="url"
                    />
                    <div className="grid gap-2 md:col-span-2 md:grid-cols-2">
                      <Checkbox
                        id={'req-insurance-' + payer.id}
                        name="requiresClientInsuranceNumber"
                        label={t('requiresClientInsuranceNumber')}
                      />
                      <Checkbox
                        id={'req-payer-id-' + payer.id}
                        name="requiresPayerIdentifier"
                        label={t('requiresPayerIdentifier')}
                      />
                      <Checkbox
                        id={'req-ack-' + payer.id}
                        name="requiresAcknowledgement"
                        label={t('requiresAcknowledgement')}
                      />
                      <Checkbox
                        id={'req-mandate-' + payer.id}
                        name="requiresMandate"
                        label={t('requiresMandate')}
                      />
                      <Checkbox
                        id={'req-invoice-' + payer.id}
                        name="requiresInvoicePdf"
                        label={t('requiresInvoicePdf')}
                        defaultChecked
                      />
                      <Checkbox
                        id={'req-evidence-' + payer.id}
                        name="requiresEvidencePdf"
                        label={t('requiresEvidencePdf')}
                        defaultChecked
                      />
                      <Checkbox
                        id={'req-mandate-doc-' + payer.id}
                        name="requiresMandateDocument"
                        label={t('requiresMandateDocument')}
                      />
                      <Checkbox
                        id={'req-reference-' + payer.id}
                        name="requiresExternalReference"
                        label={t('requiresExternalReference')}
                      />
                      <Checkbox
                        id={'req-recognition-' + payer.id}
                        name="requiresProviderRecognition"
                        label={t('requiresProviderRecognition')}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground md:col-span-2">
                      {t('requirementsSourceNote')}
                    </p>
                    <Button type="submit" className="w-fit md:col-span-2">
                      {t('savePayerRequirements')}
                    </Button>
                  </RHFActionForm>
                ) : null}
              </article>
            );
          })}
          {payerPage ? (
            <DataPagination
              pathname="/billing/claims/settings"
              page={payerPage.page}
              pageSize={payerPage.pageSize}
              totalItems={payerPage.totalItems}
              filters={{ organizationId: organization.id, ...(search ? { q: search } : {}) }}
            />
          ) : null}
          {!payerError && payerPage?.totalItems === 0 ? (
            <p className="text-sm text-muted-foreground">{t('payersEmpty')}</p>
          ) : null}
          {canManage ? (
            <form
              action={createPayerDirectoryEntryAction}
              className="grid gap-3 border-t pt-4 md:grid-cols-2"
            >
              <input type="hidden" name="organizationId" value={organization.id} />
              <h3 className="text-lg font-semibold md:col-span-2">{t('addPayer')}</h3>
              <PayerFields t={t} />
              <Button type="submit" className="w-fit md:col-span-2">
                {t('createPayer')}
              </Button>
            </form>
          ) : null}
        </section>
      ) : canRead && !query.organizationId ? (
        <EmptyState title={t('chooseClaimsSettingsOrganization')} />
      ) : null}
      <p className="rounded-md border border-warning/40 bg-warning-muted p-3 text-sm text-warning-foreground">
        {t('payerRequirementsDisclaimer')}
      </p>
    </div>
  );
}

function PayerFields({
  t,
  payer,
}: Readonly<{
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>;
  payer?: Payer;
}>) {
  return (
    <>
      <SelectField
        id={'payer-type-' + (payer?.id ?? 'new')}
        name="payerType"
        label={t('payerType')}
        defaultValue={payer?.payerType ?? 'statutory_pflegekasse'}
      >
        <option value="statutory_pflegekasse">{payerTypeLabel(t, 'statutory_pflegekasse')}</option>
        <option value="private_pflegeversicherung">
          {payerTypeLabel(t, 'private_pflegeversicherung')}
        </option>
        <option value="self_pay">{payerTypeLabel(t, 'self_pay')}</option>
        <option value="other">{payerTypeLabel(t, 'other')}</option>
      </SelectField>
      {payer ? (
        <SelectField
          id={'payer-status-' + payer.id}
          name="status"
          label={t('payerStatus')}
          defaultValue={payer.status}
        >
          <option value="active">{payerStatusLabel(t, 'active')}</option>
          <option value="inactive">{payerStatusLabel(t, 'inactive')}</option>
        </SelectField>
      ) : null}
      <Field
        id={'payer-name-' + (payer?.id ?? 'new')}
        name="name"
        label={t('payerName')}
        defaultValue={payer?.name ?? ''}
        required
      />
      <Field
        id={'payer-identifier-' + (payer?.id ?? 'new')}
        name="payerIdentifier"
        label={t('payerIdentifier')}
        defaultValue={payer?.payerIdentifier ?? ''}
      />
      <Field
        id={'payer-address-' + (payer?.id ?? 'new')}
        name="addressText"
        label={t('payerAddress')}
        defaultValue={payer?.addressText ?? ''}
      />
      <Field
        id={'payer-contact-' + (payer?.id ?? 'new')}
        name="billingContactName"
        label={t('payerBillingContact')}
        defaultValue={payer?.billingContactName ?? ''}
      />
      <Field
        id={'payer-email-' + (payer?.id ?? 'new')}
        name="billingContactEmail"
        label={t('payerBillingEmail')}
        type="email"
        defaultValue={payer?.billingContactEmail ?? ''}
      />
      <Field
        id={'payer-phone-' + (payer?.id ?? 'new')}
        name="billingContactPhone"
        label={t('payerBillingPhone')}
        defaultValue={payer?.billingContactPhone ?? ''}
      />
      <Field
        id={'payer-valid-from-' + (payer?.id ?? 'new')}
        name="validFrom"
        label={t('validFrom')}
        type="date"
        defaultValue={payer?.validFrom ?? today()}
        required
      />
      <Field
        id={'payer-valid-until-' + (payer?.id ?? 'new')}
        name="validUntil"
        label={t('validUntil')}
        type="date"
        defaultValue={payer?.validUntil ?? ''}
      />
      <Field
        id={'payer-instructions-' + (payer?.id ?? 'new')}
        name="submissionInstructions"
        label={t('submissionInstructions')}
        defaultValue={payer?.submissionInstructions ?? ''}
      />
    </>
  );
}

function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  required = false,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}>) {
  return (
    <label className="grid gap-1 text-sm" htmlFor={id}>
      {label}
      <Input id={id} name={name} type={type} defaultValue={defaultValue} required={required} />
    </label>
  );
}

function SelectField({
  id,
  name,
  label,
  defaultValue,
  children,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-1 text-sm" htmlFor={id}>
      {label}
      <NativeSelect
        id={id}
        name={name}
        defaultValue={defaultValue}
        selectClassName="h-10 rounded-md border px-3"
        className="w-full"
      >
        {children}
      </NativeSelect>
    </label>
  );
}

function Checkbox({
  id,
  name,
  label,
  defaultChecked = false,
}: Readonly<{ id: string; name: string; label: string; defaultChecked?: boolean }>) {
  return (
    <label className="flex items-center gap-2 text-sm" htmlFor={id}>
      <ShadcnCheckbox id={id} name={name} value="true" defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}

function payerTypeLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  type: string,
): string {
  switch (type) {
    case 'statutory_pflegekasse':
      return t('payerDirectoryTypes.statutory_pflegekasse');
    case 'private_pflegeversicherung':
      return t('payerDirectoryTypes.private_pflegeversicherung');
    case 'self_pay':
      return t('payerDirectoryTypes.self_pay');
    default:
      return t('payerDirectoryTypes.other');
  }
}

function payerStatusLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  status: string,
): string {
  return status === 'active'
    ? t('payerDirectoryStatus.active')
    : t('payerDirectoryStatus.inactive');
}

function channelLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  channel: string,
): string {
  switch (channel) {
    case 'manual_portal':
      return t('claimChannels.manual_portal');
    case 'manual_email':
      return t('claimChannels.manual_email');
    case 'postal':
      return t('claimChannels.postal');
    default:
      return t('claimChannels.customer_reimbursement');
  }
}

function fundingTypeLabel(
  t: Awaited<ReturnType<typeof getTranslations<'Billing'>>>,
  type: string,
): string {
  switch (type) {
    case 'statutory_long_term_care_insurance':
      return t('fundingSourceTypes.statutory_long_term_care_insurance');
    case 'private_long_term_care_insurance':
      return t('fundingSourceTypes.private_long_term_care_insurance');
    case 'self_pay':
      return t('fundingSourceTypes.self_pay');
    default:
      return t('fundingSourceTypes.other');
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function positiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : fallback;
}
