import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { ConfirmSubmitButton } from '@app/web/app/(office)/administration/confirm-submit-button';
import {
  activateClientAction,
  addClientAddressAction,
  addClientContactAction,
  addClientInsuranceAction,
  addClientPflegegradAction,
  archiveClientAction,
  changeClientProviderContextAction,
  removeClientAddressAction,
  removeClientContactAction,
  saveClientRoutingLocationAction,
  saveClientSchedulingPreferencesAction,
  updateClientAction,
  updateClientAddressAction,
  updateClientContactAction,
  updateClientInsuranceAction,
  updateFuturePflegegradAction,
} from '@app/web/app/(office)/clients/actions';
import { AsyncEntityCombobox } from '@app/web/components/async-entity-combobox';
import { ClientProfileSectionNav } from '@app/web/components/client-profile-section-nav';
import { ClientProfileOverview } from '@app/web/components/client-profile-overview';
import { DataPagination } from '@app/web/components/data-pagination';
import { PageLoadingSkeleton } from '@app/web/components/page-loading-skeleton';
import { PageHeader } from '@app/web/components/page-patterns';
import { ResourceCardLink, ResourceReference } from '@app/web/components/resource-reference';
import { RHFActionForm } from '@app/web/components/rhf-action-form';
import { auditActionKey } from '@app/web/i18n/audit';
import { errorMessageKey } from '@app/web/i18n/errors';
import { formatDate, formatDateTime } from '@app/web/i18n/format';
import { statusLabelKey } from '@app/web/i18n/status';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
  hasPermission,
} from '@app/web/lib/api';
import { formatVisitDateTime } from '@app/web/lib/care-date';
import { getEmployeesByIds } from '@app/web/lib/employee-lookup';
import { getFacilitiesByIds } from '@app/web/lib/facility-lookup';
import { getOrganizationsByIds } from '@app/web/lib/organization-lookup';
import { redirectToValidPage } from '@app/web/lib/pagination';
import type { components } from '@care/api-client';
import { Button } from '@care/ui/components/button';
import { Checkbox as ShadcnCheckbox } from '@care/ui/components/checkbox';
import { Input } from '@care/ui/components/input';
import { Label } from '@care/ui/components/label';
import { NativeSelect } from '@care/ui/components/native-select';
import { Skeleton } from '@care/ui/components/skeleton';
import { StatusBadge } from '@care/ui/components/status-badge';

const contactRoleKeys = {
  primary_contact: 'Clients.detail.contactRoles.primaryContact',
  emergency_contact: 'Clients.detail.contactRoles.emergencyContact',
  legal_representative: 'Clients.detail.contactRoles.legalRepresentative',
  authorized_contact: 'Clients.detail.contactRoles.authorizedContact',
  invoice_recipient: 'Clients.detail.contactRoles.invoiceRecipient',
} as const;

const clientDocumentTypes = [
  'service_evidence',
  'service_agreement',
  'invoice',
  'invoice_correction',
  'benefit_overview',
  'claim_summary',
] as const;
type ClientDocumentType = (typeof clientDocumentTypes)[number];
type ClientDocument = {
  id: string;
  title?: string | null;
  documentType: ClientDocumentType;
  status: 'pending' | 'ready' | 'failed' | 'superseded';
  locale: 'de' | 'en';
  generatedAt: string | null;
  createdAt: string;
};

type ClientDetailQuery = {
  error?: string;
  updated?: string;
  documentType?: string;
  documentPage?: string;
  documentPageSize?: string;
};

type ClientDetailClient = components['schemas']['ClientResponseDto'];

export default async function ClientDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<ClientDetailQuery>;
}>) {
  const [{ id }, query, t] = await Promise.all([params, searchParams, getTranslations()]);
  const [api, header] = await Promise.all([getApiClient(), getTenantHeader()]);
  const [clientResult, permissions] = await Promise.all([
    api.GET('/api/v1/clients/{id}', { params: { path: { id }, header } }),
    getPermissionGrants(api),
  ]);
  if ((clientResult.error as { code?: string } | undefined)?.code === 'CLIENT_NOT_FOUND')
    notFound();
  const client = clientResult.data as ClientDetailClient | undefined;
  if (!client) {
    return (
      <div className="mx-auto grid max-w-6xl gap-5">
        <PageHeader
          eyebrow={<Link href="/clients">{t('Clients.title')}</Link>}
          title={t('Clients.detail.detailTitle')}
        />
        <p role="alert" className="rounded-md border bg-card p-5">
          {(clientResult.error as { code?: string } | undefined)?.code === 'INSUFFICIENT_PERMISSION'
            ? t('Errors.insufficientPermission')
            : t('Clients.detail.loadFailed')}
        </p>
      </div>
    );
  }
  const tenantId = header['X-Tenant-Id'];
  const canUpdateClient = hasClientPermission(
    permissions,
    'client.update',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canCreateVisit = hasClientPermission(
    permissions,
    'schedule.update',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadSchedule = hasClientPermission(
    permissions,
    'schedule.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadServiceAgreements = hasClientPermission(
    permissions,
    'service_agreement.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadBenefits = hasClientPermission(
    permissions,
    'benefits.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadBilling = hasClientPermission(
    permissions,
    'billing.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadDocuments = hasClientPermission(
    permissions,
    'documents.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadCommunications =
    hasClientPermission(
      permissions,
      'communications.read',
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
    ) &&
    hasClientPermission(
      permissions,
      'client.read',
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
    );
  const canReadAdmissions = hasClientPermission(
    permissions,
    'onboarding.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <PageHeader
        eyebrow={<Link href="/clients">{t('Clients.title')}</Link>}
        title={`${client.preferredName || client.firstName} ${client.lastName}`}
        meta={<StatusBadge status={client.status} label={t(statusLabelKey(client.status))} />}
        actions={
          <>
            {canUpdateClient ? (
              <Button asChild variant="outline" className="min-h-11">
                <Link href="#personal-information">{t('Clients.detail.editPersonalData')}</Link>
              </Button>
            ) : null}
            {canCreateVisit ? (
              <Button asChild className="min-h-11">
                <Link href={`/planning?clientId=${encodeURIComponent(client.id)}`}>
                  {t('Planning.createVisit')}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/clients">{t('Clients.detail.backToList')}</Link>
            </Button>
          </>
        }
      />
      <ClientProfileSectionNav
        ariaLabel={t('Clients.detail.navigationLabel')}
        className="flex min-w-0 [scrollbar-width:thin] items-center gap-1 overflow-x-auto border-b border-border px-1 py-1 text-sm [&>a]:scroll-mx-1"
      >
        <SectionLink href="#overview">{t('Clients.detail.overviewTab')}</SectionLink>
        <SectionLink href="#personal-information">{t('Clients.form.personalData')}</SectionLink>
        <SectionLink href="#contacts">{t('Clients.detail.contactsTab')}</SectionLink>
        <SectionLink href="#insurance">{t('Clients.detail.insuranceTab')}</SectionLink>
        {canReadDocuments ? (
          <SectionLink href="#documents">{t('Documents.title')}</SectionLink>
        ) : null}
        {canReadServiceAgreements ? (
          <Link
            className="flex min-h-10 shrink-0 items-center rounded-lg px-3 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            href={`/clients/${client.id}/service-agreements`}
          >
            {t('Clients.detail.servicePlanningTab')}
          </Link>
        ) : null}
        {hasClientPermission(
          permissions,
          'operations.read',
          tenantId,
          client.organizationId,
          client.primaryFacilityId,
        ) ? (
          <Link
            className="flex min-h-10 shrink-0 items-center rounded-lg px-3 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            href={`/operations/deadlines?clientId=${encodeURIComponent(client.id)}`}
          >
            {t('Operations.clientDeadlines')}
          </Link>
        ) : null}
        {canReadBenefits ? (
          <Link
            className="flex min-h-10 shrink-0 items-center rounded-lg px-3 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            href={`/clients/${client.id}/benefits`}
          >
            {t('Clients.detail.benefitsTab')}
          </Link>
        ) : null}
        {canReadBilling ? (
          <Link
            className="flex min-h-10 shrink-0 items-center rounded-lg px-3 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            href={`/clients/${client.id}/invoices`}
          >
            {t('Clients.detail.invoicesTab')}
          </Link>
        ) : null}
        {canReadSchedule ? (
          <SectionLink href="#visits">{t('Clients.detail.visitsTab')}</SectionLink>
        ) : null}
        {canReadCommunications ? (
          <Link
            className="flex min-h-10 shrink-0 items-center rounded-lg px-3 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            href={`/clients/${client.id}/communications`}
          >
            {t('Clients.detail.communicationsTab')}
          </Link>
        ) : null}
        {canReadAdmissions ? (
          <SectionLink href="#admissions">{t('Onboarding.title')}</SectionLink>
        ) : null}
        <SectionLink href="#timeline">{t('Clients.detail.timelineTab')}</SectionLink>
      </ClientProfileSectionNav>
      <ClientProfileOverview
        client={client}
        permissions={permissions}
        title={t('Clients.detail.overview')}
        loadingLabel={t('Common.loadingPage')}
      />
      <Suspense fallback={<PageLoadingSkeleton />}>
        <ClientDetailContent
          id={id}
          query={query}
          initialClient={client}
          permissions={permissions}
        />
      </Suspense>
    </div>
  );
}

async function ClientDetailContent({
  id,
  query,
  initialClient,
  permissions,
}: Readonly<{
  id: string;
  query: ClientDetailQuery;
  initialClient: ClientDetailClient;
  permissions: Awaited<ReturnType<typeof getPermissionGrants>>;
}>) {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const [api, header] = await Promise.all([getApiClient(), getTenantHeader()]);
  const get = api.GET;
  const client = initialClient;
  const tenantId = header['X-Tenant-Id'];
  const canReadSchedule = hasClientPermission(
    permissions,
    'schedule.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canManageSchedule = hasClientPermission(
    permissions,
    'schedule.update',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const [addressesResult, contactsResult, insurancesResult, gradesResult] = await Promise.all([
    get('/api/v1/clients/{clientId}/addresses', { params: { path: { clientId: id }, header } }),
    get('/api/v1/clients/{clientId}/contacts', { params: { path: { clientId: id }, header } }),
    get('/api/v1/clients/{clientId}/insurances', { params: { path: { clientId: id }, header } }),
    get('/api/v1/clients/{clientId}/pflegegrade', { params: { path: { clientId: id }, header } }),
  ]);
  const addresses = addressesResult.data ?? [];
  const contacts = contactsResult.data ?? [];
  const insurances = insurancesResult.data ?? [];
  const grades = gradesResult.data ?? [];
  const [organizationLookup, facilityLookup] = await Promise.all([
    getOrganizationsByIds(
      client.organizationId &&
        hasClientPermission(permissions, 'organization.read', tenantId, client.organizationId, null)
        ? [client.organizationId]
        : [],
    ),
    getFacilitiesByIds(
      client.organizationId &&
        client.primaryFacilityId &&
        hasClientPermission(
          permissions,
          'facility.read',
          tenantId,
          client.organizationId,
          client.primaryFacilityId,
        )
        ? [client.primaryFacilityId]
        : [],
    ),
  ]);
  const organizations = organizationLookup.items;
  const facilities = facilityLookup.items;
  const canReadDocuments = hasClientPermission(
    permissions,
    'documents.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadAdmissions = hasClientPermission(
    permissions,
    'onboarding.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const [schedulingPreferencesResult, routingLocationResult] =
    client && canReadSchedule
      ? await Promise.all([
          canManageSchedule
            ? get('/api/v1/clients/{clientId}/scheduling-preferences', {
                params: { path: { clientId: client.id }, header },
              })
            : Promise.resolve({ data: undefined, error: undefined }),
          canManageSchedule
            ? get('/api/v1/clients/{clientId}/routing-location', {
                params: { path: { clientId: client.id }, header },
              })
            : Promise.resolve({ data: undefined, error: undefined }),
        ])
      : [null, null];
  const canUpdateClient = client
    ? hasClientPermission(
        permissions,
        'client.update',
        tenantId,
        client.organizationId,
        client.primaryFacilityId,
      )
    : false;
  const canArchiveClient = client
    ? hasClientPermission(
        permissions,
        'client.archive',
        tenantId,
        client.organizationId,
        client.primaryFacilityId,
      )
    : false;
  const primaryAddress = addresses.find((address) => address.isPrimary);
  const primaryContact = contacts.find((contact) => contact.roles.includes('primary_contact'));
  const emergencyContact = contacts.find((contact) => contact.roles.includes('emergency_contact'));
  const today = currentDate();
  const currentPflegegrad = grades.find(
    (grade) =>
      grade.status === 'confirmed' &&
      grade.validFrom <= today &&
      (!grade.validUntil || grade.validUntil > today),
  );
  const actionError = query.error;
  const schedulingPreferences = schedulingPreferencesResult?.data as
    | components['schemas']['ClientSchedulingPreferencesDto']
    | null
    | undefined;
  const routingLocation = routingLocationResult?.data ?? null;
  const schedulingEmployeeIds = [
    ...new Set([
      ...(schedulingPreferences?.preferredEmployeeId
        ? [schedulingPreferences.preferredEmployeeId]
        : []),
      ...(schedulingPreferences?.avoidedEmployeeIds ?? []),
    ]),
  ];
  const schedulingEmployeeLookup =
    canManageSchedule && hasPermission(permissions, 'employee.read')
      ? await getEmployeesByIds(schedulingEmployeeIds)
      : { items: [], failed: false };
  const schedulingEmployeeOptions = schedulingEmployeeIds.map((employeeId) => {
    const employee = schedulingEmployeeLookup.items.find((item) => item.id === employeeId);
    return {
      id: employeeId,
      label: employee
        ? `${employee.preferredName || employee.firstName} ${employee.lastName}`
        : t('Resources.unavailableEmployee'),
    };
  });
  const schedulingEmployeeOptionById = new Map(
    schedulingEmployeeOptions.map((option) => [option.id, option]),
  );
  const planningWeekdays = [
    { weekday: 1, label: t('Employees.detail.weekdays.monday') },
    { weekday: 2, label: t('Employees.detail.weekdays.tuesday') },
    { weekday: 3, label: t('Employees.detail.weekdays.wednesday') },
    { weekday: 4, label: t('Employees.detail.weekdays.thursday') },
    { weekday: 5, label: t('Employees.detail.weekdays.friday') },
    { weekday: 6, label: t('Employees.detail.weekdays.saturday') },
    { weekday: 7, label: t('Employees.detail.weekdays.sunday') },
  ];

  return (
    <div className="grid gap-5">
      {actionError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive"
        >
          {t(errorMessageKey(actionError))}
        </p>
      ) : null}
      {query.updated === 'scheduling_preferences' || query.updated === 'routing_location' ? (
        <p
          role="status"
          className="rounded-md border border-success/30 bg-success-muted p-3 text-success-foreground"
        >
          {query.updated === 'scheduling_preferences'
            ? t('Clients.detail.schedulingPreferencesSaved')
            : t('Clients.detail.routingLocationSaved')}
        </p>
      ) : null}
      {!client ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-destructive"
        >
          {t('Clients.detail.loadFailed')}
        </p>
      ) : (
        <>
          <section
            id="personal-information"
            aria-labelledby="personal-information-title"
            className="grid scroll-mt-6 gap-4"
          >
            <h2 id="personal-information-title" className="text-xl font-semibold">
              {t('Clients.form.personalData')}
            </h2>
            <dl className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="grid gap-1">
                <dt className="text-sm text-muted-foreground">{t('Common.fields.organization')}</dt>
                <dd className="font-medium break-words">
                  <ResourceReference
                    label={
                      client.organizationId
                        ? organizationName(
                            organizations,
                            client.organizationId,
                            t('Clients.detail.unknownOrganization'),
                          )
                        : t('Clients.detail.legacyUnassigned')
                    }
                    href={
                      client.organizationId &&
                      organizations.some((item) => item.id === client.organizationId) &&
                      hasClientPermission(
                        permissions,
                        'organization.read',
                        tenantId,
                        client.organizationId,
                        null,
                      )
                        ? `/administration/organizations/${client.organizationId}`
                        : null
                    }
                  />
                </dd>
              </div>
              {client.primaryFacilityId ? (
                <div className="grid gap-1">
                  <dt className="text-sm text-muted-foreground">{t('Common.fields.facility')}</dt>
                  <dd className="font-medium break-words">
                    <ResourceReference
                      label={facilityName(
                        facilities,
                        client.primaryFacilityId,
                        t('Clients.detail.unknownFacility'),
                      )}
                      href={
                        client.organizationId &&
                        facilities.some((item) => item.id === client.primaryFacilityId) &&
                        hasClientPermission(
                          permissions,
                          'facility.read',
                          tenantId,
                          client.organizationId,
                          client.primaryFacilityId,
                        )
                          ? `/administration/facilities/${client.primaryFacilityId}`
                          : null
                      }
                    />
                  </dd>
                </div>
              ) : null}
              <Field label={t('Clients.form.firstName')} value={client.firstName} />
              <Field label={t('Clients.form.lastName')} value={client.lastName} />
              <Field label={t('Clients.form.preferredName')} value={client.preferredName} />
              <Field
                label={t('Clients.form.dateOfBirth')}
                value={formatDate(client.dateOfBirth, locale)}
              />
              <Field
                label={t('Clients.form.dateOfDeath')}
                value={formatDate(client.dateOfDeath, locale)}
              />
              <Field
                label={t('Clients.form.gender')}
                value={client.gender ? t(genderKey(client.gender)) : null}
              />
              <Field
                label={t('Clients.form.salutation')}
                value={client.salutation ? t(salutationKey(client.salutation)) : null}
              />
              <Field
                label={t('Clients.form.email')}
                value={
                  client.email ? (
                    <a className="text-primary underline" href={`mailto:${client.email}`}>
                      {client.email}
                    </a>
                  ) : null
                }
              />
              <Field
                label={t('Clients.form.phone')}
                value={
                  client.phone ? (
                    <a
                      className="text-primary underline"
                      href={`tel:${encodeURIComponent(client.phone)}`}
                    >
                      {client.phone}
                    </a>
                  ) : null
                }
              />
              <Field
                label={t('Clients.form.mobilePhone')}
                value={
                  client.mobile ? (
                    <a
                      className="text-primary underline"
                      href={`tel:${encodeURIComponent(client.mobile)}`}
                    >
                      {client.mobile}
                    </a>
                  ) : null
                }
              />
              <Field
                label={t('Clients.detail.primaryAddress')}
                value={primaryAddress ? formatAddress(primaryAddress) : null}
              />
              <Field
                label={t('Clients.detail.currentCareLevel')}
                value={
                  currentPflegegrad
                    ? t('Clients.careLevelNumber', { grade: currentPflegegrad.grade })
                    : null
                }
              />
              <Field
                label={t('Clients.detail.primaryContact')}
                value={
                  primaryContact ? `${primaryContact.firstName} ${primaryContact.lastName}` : null
                }
              />
              <Field
                label={t('Clients.detail.emergencyContact')}
                value={
                  emergencyContact
                    ? `${emergencyContact.firstName} ${emergencyContact.lastName}`
                    : null
                }
              />
            </dl>

            {canUpdateClient ? (
              <details className="rounded-lg border bg-card p-5">
                <summary className="cursor-pointer font-semibold">
                  {t('Clients.detail.editPersonalData')}
                </summary>
                <RHFActionForm
                  action={updateClientAction}
                  errorMessage={t('Clients.detail.saveFailed')}
                  warnOnUnsavedChanges
                  className="mt-4 grid gap-4"
                >
                  <input type="hidden" name="id" value={client.id} />
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                      id="edit-firstName"
                      name="firstName"
                      label={t('Clients.form.firstName')}
                      defaultValue={client.firstName}
                      required
                    />
                    <TextField
                      id="edit-lastName"
                      name="lastName"
                      label={t('Clients.form.lastName')}
                      defaultValue={client.lastName}
                      required
                    />
                    <TextField
                      id="edit-preferredName"
                      name="preferredName"
                      label={t('Clients.form.preferredName')}
                      defaultValue={client.preferredName ?? ''}
                    />
                    <TextField
                      id="edit-dateOfBirth"
                      name="dateOfBirth"
                      label={t('Clients.form.dateOfBirth')}
                      type="date"
                      defaultValue={client.dateOfBirth ?? ''}
                    />
                    <TextField
                      id="edit-dateOfDeath"
                      name="dateOfDeath"
                      label={t('Clients.form.dateOfDeath')}
                      type="date"
                      defaultValue={client.dateOfDeath ?? ''}
                    />
                    <SelectField
                      id="edit-gender"
                      name="gender"
                      label={t('Clients.form.gender')}
                      value={client.gender ?? ''}
                    >
                      <option value="">{t('Clients.form.notSpecified')}</option>
                      <option value="female">{t('Clients.form.female')}</option>
                      <option value="male">{t('Clients.form.male')}</option>
                      <option value="diverse">{t('Clients.form.diverse')}</option>
                    </SelectField>
                    <SelectField
                      id="edit-salutation"
                      name="salutation"
                      label={t('Clients.form.salutation')}
                      value={client.salutation ?? ''}
                    >
                      <option value="">{t('Clients.form.notSpecified')}</option>
                      <option value="mr">{t('Clients.form.mr')}</option>
                      <option value="ms">{t('Clients.form.ms')}</option>
                      <option value="mx">{t('Clients.form.mx')}</option>
                      <option value="other">{t('Clients.form.other')}</option>
                    </SelectField>
                    <TextField
                      id="edit-email"
                      name="email"
                      label={t('Clients.form.email')}
                      type="email"
                      defaultValue={client.email ?? ''}
                    />
                    <TextField
                      id="edit-phone"
                      name="phone"
                      label={t('Clients.form.phone')}
                      type="tel"
                      defaultValue={client.phone ?? ''}
                    />
                    <TextField
                      id="edit-mobile"
                      name="mobile"
                      label={t('Clients.form.mobilePhone')}
                      type="tel"
                      defaultValue={client.mobile ?? ''}
                    />
                  </div>
                  <Button type="submit" className="w-fit">
                    {t('Clients.detail.savePersonalData')}
                  </Button>
                </RHFActionForm>
              </details>
            ) : null}

            <details
              className="rounded-lg border bg-card p-5"
              open={!client.organizationId || !client.primaryFacilityId}
            >
              <summary className="cursor-pointer font-semibold">
                {t('Clients.detail.providerContext')}
              </summary>
              <p className="mt-2 text-sm text-muted-foreground">
                {client.organizationId && client.primaryFacilityId
                  ? `${organizationName(organizations, client.organizationId, t('Clients.detail.unknownOrganization'))} / ${facilityName(facilities, client.primaryFacilityId, t('Clients.detail.unknownFacility'))}`
                  : t('Clients.detail.legacyUnassigned')}
              </p>
              {canUpdateClient ? (
                <RHFActionForm
                  warnOnUnsavedChanges
                  action={changeClientProviderContextAction}
                  className="mt-4 grid gap-4 md:grid-cols-2"
                >
                  <input type="hidden" name="id" value={client.id} />
                  <AsyncEntityCombobox
                    name="organizationId"
                    entity="organizations"
                    label={t('Clients.form.organization')}
                    placeholder={t('Clients.form.selectOrganization')}
                    required
                    {...(client.organizationId
                      ? {
                          initialOption: {
                            id: client.organizationId,
                            label: organizationName(
                              organizations,
                              client.organizationId,
                              t('Clients.detail.unknownOrganization'),
                            ),
                          },
                        }
                      : {})}
                  />
                  <AsyncEntityCombobox
                    name="primaryFacilityId"
                    entity="facilities"
                    label={t('Clients.form.primaryFacility')}
                    placeholder={t('Clients.form.selectFacility')}
                    required
                    {...(client.primaryFacilityId
                      ? {
                          initialOption: {
                            id: client.primaryFacilityId,
                            label: facilityName(
                              facilities,
                              client.primaryFacilityId,
                              t('Clients.detail.unknownFacility'),
                            ),
                          },
                        }
                      : {})}
                  />
                  <Button type="submit" className="w-fit md:col-span-2">
                    {t('Clients.detail.saveAssignment')}
                  </Button>
                </RHFActionForm>
              ) : null}
            </details>

            <div className="flex flex-wrap gap-3">
              {canUpdateClient && client.status === 'pending' ? (
                <form action={activateClientAction}>
                  <input type="hidden" name="id" value={client.id} />
                  <Button type="submit">{t('Common.actions.activate')}</Button>
                </form>
              ) : null}
              {canArchiveClient && client.status === 'active' ? (
                <form action={archiveClientAction}>
                  <input type="hidden" name="id" value={client.id} />
                  <Button type="submit" variant="destructive">
                    {t('Common.actions.archive')}
                  </Button>
                </form>
              ) : null}
            </div>
          </section>

          <section
            id="contacts"
            aria-labelledby="contacts-title"
            className="grid scroll-mt-6 gap-4"
          >
            <h2 id="contacts-title" className="text-xl font-semibold">
              {t('Clients.detail.addressesAndContacts')}
            </h2>
            {addresses.length ? (
              <div className="grid gap-3">
                {addresses.map((address) => (
                  <article key={address.id} className="grid gap-3 rounded-lg border bg-card p-4">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                      <div className="grid min-w-0 gap-1">
                        <h3 className="font-semibold">
                          {t(addressTypeKey(address.addressType))}
                          {address.isPrimary ? ` · ${t('Clients.detail.primary')}` : ''}
                        </h3>
                        <p className="text-sm text-muted-foreground">{formatAddress(address)}</p>
                      </div>
                      {canUpdateClient ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={removeClientAddressAction}>
                            <input type="hidden" name="id" value={client.id} />
                            <input type="hidden" name="addressId" value={address.id} />
                            <ConfirmSubmitButton
                              confirmation={t('Clients.detail.confirmRemoveAddress')}
                            >
                              {t('Clients.detail.removeAddress')}
                            </ConfirmSubmitButton>
                          </form>
                          <details>
                            <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-md border px-3 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                              {t('Common.actions.edit')}
                            </summary>
                            <RHFActionForm
                              warnOnUnsavedChanges
                              action={updateClientAddressAction}
                              className="mt-4 grid gap-4 rounded-lg border p-4"
                            >
                              <input type="hidden" name="id" value={client.id} />
                              <input type="hidden" name="addressId" value={address.id} />
                              <div className="grid gap-4 md:grid-cols-3">
                                <SelectField
                                  id={`address-type-${address.id}`}
                                  name="addressType"
                                  label={t('Clients.detail.addressType')}
                                  value={address.addressType}
                                >
                                  <option value="home">
                                    {t('Clients.detail.addressTypes.home')}
                                  </option>
                                  <option value="billing">
                                    {t('Clients.detail.addressTypes.billing')}
                                  </option>
                                  <option value="other">
                                    {t('Clients.detail.addressTypes.other')}
                                  </option>
                                </SelectField>
                                <TextField
                                  id={`address-street-${address.id}`}
                                  name="street"
                                  label={t('Clients.form.street')}
                                  defaultValue={address.street}
                                  required
                                />
                                <TextField
                                  id={`address-house-${address.id}`}
                                  name="houseNumber"
                                  label={t('Clients.form.houseNumber')}
                                  defaultValue={address.houseNumber ?? ''}
                                />
                                <TextField
                                  id={`address-addition-${address.id}`}
                                  name="addressAddition"
                                  label={t('Clients.form.addressAddition')}
                                  defaultValue={address.addressAddition ?? ''}
                                />
                                <TextField
                                  id={`address-postal-${address.id}`}
                                  name="postalCode"
                                  label={t('Clients.form.postalCode')}
                                  defaultValue={address.postalCode ?? ''}
                                />
                                <TextField
                                  id={`address-city-${address.id}`}
                                  name="city"
                                  label={t('Clients.form.city')}
                                  defaultValue={address.city}
                                  required
                                />
                                <TextField
                                  id={`address-country-${address.id}`}
                                  name="countryCode"
                                  label={t('Clients.form.countryCode')}
                                  defaultValue={address.countryCode}
                                  maxLength={2}
                                />
                                <TextField
                                  id={`address-from-${address.id}`}
                                  name="validFrom"
                                  label={t('Clients.detail.validFrom')}
                                  type="date"
                                  defaultValue={address.validFrom ?? ''}
                                />
                                <TextField
                                  id={`address-until-${address.id}`}
                                  name="validUntil"
                                  label={t('Clients.detail.validUntil')}
                                  type="date"
                                  defaultValue={address.validUntil ?? ''}
                                />
                              </div>
                              <label className="flex items-center gap-2 text-sm">
                                <ShadcnCheckbox
                                  name="isPrimary"
                                  defaultChecked={address.isPrimary}
                                />{' '}
                                {t('Clients.detail.primaryAddressCheckbox')}
                              </label>
                              <Button type="submit" variant="secondary" className="w-fit">
                                {t('Clients.detail.saveAddress')}
                              </Button>
                            </RHFActionForm>
                          </details>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed bg-card p-5 text-sm text-muted-foreground">
                {t('Clients.detail.noAddresses')}
              </p>
            )}
            {canUpdateClient ? (
              <details className="rounded-lg border bg-card p-5">
                <summary className="cursor-pointer font-semibold">
                  {t('Clients.detail.addAddress')}
                </summary>
                <AddressForm
                  action={addClientAddressAction}
                  clientId={client.id}
                  idPrefix="new-address"
                />
              </details>
            ) : null}

            {contacts.length ? (
              <div className="grid gap-3">
                {contacts.map((contact) => (
                  <article key={contact.id} className="grid gap-3 rounded-lg border bg-card p-4">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                      <div className="grid min-w-0 gap-1">
                        <h3 className="font-semibold">
                          {contact.firstName} {contact.lastName}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {t(relationshipKey(contact.relationshipType))} ·{' '}
                          {contact.roles.map((role) => t(contactRoleKeys[role])).join(', ') ||
                            t('Clients.detail.noContactRole')}
                        </p>
                        <ContactMethods
                          phone={contact.phone}
                          mobile={contact.mobile}
                          email={contact.email}
                          phoneLabel={t('Clients.form.phone')}
                          mobileLabel={t('Clients.form.mobilePhone')}
                          emailLabel={t('Clients.form.email')}
                          emptyLabel={t('Clients.detail.noContactDetails')}
                        />
                      </div>
                      {canUpdateClient ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={removeClientContactAction}>
                            <input type="hidden" name="id" value={client.id} />
                            <input type="hidden" name="contactId" value={contact.id} />
                            <ConfirmSubmitButton
                              confirmation={t('Clients.detail.confirmRemoveContact')}
                            >
                              {t('Clients.detail.removeContact')}
                            </ConfirmSubmitButton>
                          </form>
                          <details className="min-w-0">
                            <summary className="flex min-h-10 cursor-pointer list-none items-center rounded-md border px-3 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                              {t('Common.actions.edit')}
                            </summary>
                            <RHFActionForm
                              warnOnUnsavedChanges
                              action={updateClientContactAction}
                              className="mt-4 grid gap-4 rounded-lg border p-4"
                            >
                              <input type="hidden" name="id" value={client.id} />
                              <input type="hidden" name="contactId" value={contact.id} />
                              <div className="grid gap-4 md:grid-cols-2">
                                <TextField
                                  id={`contact-first-${contact.id}`}
                                  name="firstName"
                                  label={t('Clients.form.firstName')}
                                  defaultValue={contact.firstName}
                                  required
                                />
                                <TextField
                                  id={`contact-last-${contact.id}`}
                                  name="lastName"
                                  label={t('Clients.form.lastName')}
                                  defaultValue={contact.lastName}
                                  required
                                />
                                <SelectField
                                  id={`contact-relation-${contact.id}`}
                                  name="relationshipType"
                                  label={t('Clients.detail.relationship')}
                                  value={contact.relationshipType}
                                >
                                  <RelationshipOptions />
                                </SelectField>
                                <TextField
                                  id={`contact-phone-${contact.id}`}
                                  name="phone"
                                  label={t('Clients.form.phone')}
                                  type="tel"
                                  defaultValue={contact.phone ?? ''}
                                />
                                <TextField
                                  id={`contact-mobile-${contact.id}`}
                                  name="mobile"
                                  label={t('Clients.form.mobilePhone')}
                                  type="tel"
                                  defaultValue={contact.mobile ?? ''}
                                />
                                <TextField
                                  id={`contact-email-${contact.id}`}
                                  name="email"
                                  label={t('Clients.form.email')}
                                  type="email"
                                  defaultValue={contact.email ?? ''}
                                />
                                <TextField
                                  id={`contact-notes-${contact.id}`}
                                  name="notes"
                                  label={t('Clients.detail.contactNotes')}
                                  defaultValue={contact.notes ?? ''}
                                  maxLength={500}
                                />
                              </div>
                              <RoleChecks selected={contact.roles} />
                              <details className="grid gap-3 rounded-md border p-3">
                                <summary className="cursor-pointer font-medium">
                                  {t('Clients.detail.contactAddressAndRepresentation')}
                                </summary>
                                <div className="grid gap-4 pt-2 md:grid-cols-2">
                                  <TextField
                                    id={`contact-address-street-${contact.id}`}
                                    name="addressStreet"
                                    label={t('Clients.form.street')}
                                    defaultValue={contact.addressStreet ?? ''}
                                  />
                                  <TextField
                                    id={`contact-address-house-${contact.id}`}
                                    name="addressHouseNumber"
                                    label={t('Clients.form.houseNumber')}
                                    defaultValue={contact.addressHouseNumber ?? ''}
                                  />
                                  <TextField
                                    id={`contact-address-addition-${contact.id}`}
                                    name="addressAddition"
                                    label={t('Clients.form.addressAddition')}
                                    defaultValue={contact.addressAddition ?? ''}
                                  />
                                  <TextField
                                    id={`contact-address-postal-${contact.id}`}
                                    name="addressPostalCode"
                                    label={t('Clients.form.postalCode')}
                                    defaultValue={contact.addressPostalCode ?? ''}
                                  />
                                  <TextField
                                    id={`contact-address-city-${contact.id}`}
                                    name="addressCity"
                                    label={t('Clients.form.city')}
                                    defaultValue={contact.addressCity ?? ''}
                                  />
                                  <TextField
                                    id={`contact-address-country-${contact.id}`}
                                    name="addressCountryCode"
                                    label={t('Clients.form.countryCode')}
                                    defaultValue={contact.addressCountryCode ?? ''}
                                    maxLength={2}
                                  />
                                  <SelectField
                                    id={`contact-representation-type-${contact.id}`}
                                    name="representationType"
                                    label={t('Clients.detail.representationType')}
                                    value={contact.representationType ?? ''}
                                  >
                                    <option value="">{t('Clients.detail.noRepresentation')}</option>
                                    <option value="power_of_attorney">
                                      {t('Clients.detail.powerOfAttorney')}
                                    </option>
                                    <option value="legal_guardianship">
                                      {t('Clients.detail.legalGuardianship')}
                                    </option>
                                    <option value="authorized_representative">
                                      {t('Clients.detail.authorizedRepresentative')}
                                    </option>
                                  </SelectField>
                                  <TextField
                                    id={`contact-representation-from-${contact.id}`}
                                    name="representationValidFrom"
                                    label={t('Clients.detail.representationValidFrom')}
                                    type="date"
                                    defaultValue={contact.representationValidFrom ?? ''}
                                  />
                                  <TextField
                                    id={`contact-representation-until-${contact.id}`}
                                    name="representationValidUntil"
                                    label={t('Clients.detail.representationValidUntil')}
                                    type="date"
                                    defaultValue={contact.representationValidUntil ?? ''}
                                  />
                                  <TextField
                                    id={`contact-representation-reference-${contact.id}`}
                                    name="representationReference"
                                    label={t('Clients.detail.representationReference')}
                                    defaultValue={contact.representationReference ?? ''}
                                    maxLength={120}
                                  />
                                </div>
                              </details>
                              <Button type="submit" variant="secondary" className="w-fit">
                                {t('Clients.detail.saveContact')}
                              </Button>
                            </RHFActionForm>
                          </details>
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed bg-card p-5 text-sm text-muted-foreground">
                {t('Clients.detail.noContacts')}
              </p>
            )}
            {canUpdateClient ? (
              <details className="rounded-lg border bg-card p-5">
                <summary className="cursor-pointer font-semibold">
                  {t('Clients.detail.addContact')}
                </summary>
                <RHFActionForm
                  warnOnUnsavedChanges
                  action={addClientContactAction}
                  className="mt-4 grid gap-4"
                >
                  <input type="hidden" name="id" value={client.id} />
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                      id="new-contact-first"
                      name="firstName"
                      label={t('Clients.form.firstName')}
                      required
                    />
                    <TextField
                      id="new-contact-last"
                      name="lastName"
                      label={t('Clients.form.lastName')}
                      required
                    />
                    <SelectField
                      id="new-contact-relation"
                      name="relationshipType"
                      label={t('Clients.detail.relationship')}
                      value="relative"
                      required
                    >
                      <RelationshipOptions />
                    </SelectField>
                    <TextField
                      id="new-contact-phone"
                      name="phone"
                      label={t('Clients.form.phone')}
                      type="tel"
                    />
                    <TextField
                      id="new-contact-mobile"
                      name="mobile"
                      label={t('Clients.form.mobilePhone')}
                      type="tel"
                    />
                    <TextField
                      id="new-contact-email"
                      name="email"
                      label={t('Clients.form.email')}
                      type="email"
                    />
                    <TextField
                      id="new-contact-representation-reference"
                      name="representationReference"
                      label={t('Clients.detail.representationReference')}
                      maxLength={120}
                    />
                    <TextField
                      id="new-contact-representation-from"
                      name="representationValidFrom"
                      label={t('Clients.detail.representationValidFrom')}
                      type="date"
                    />
                    <TextField
                      id="new-contact-representation-until"
                      name="representationValidUntil"
                      label={t('Clients.detail.representationValidUntil')}
                      type="date"
                    />
                    <SelectField
                      id="new-contact-representation-type"
                      name="representationType"
                      label={t('Clients.detail.representationType')}
                      value=""
                    >
                      <option value="">{t('Clients.detail.noRepresentation')}</option>
                      <option value="power_of_attorney">
                        {t('Clients.detail.powerOfAttorney')}
                      </option>
                      <option value="legal_guardianship">
                        {t('Clients.detail.legalGuardianship')}
                      </option>
                      <option value="authorized_representative">
                        {t('Clients.detail.authorizedRepresentative')}
                      </option>
                    </SelectField>
                  </div>
                  <RoleChecks selected={[]} />
                  <TextField
                    id="new-contact-notes"
                    name="notes"
                    label={t('Clients.detail.contactNotes')}
                    maxLength={500}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t('Clients.detail.medicalInformationWarning')}
                  </p>
                  <Button type="submit" className="w-fit">
                    {t('Clients.detail.addContact')}
                  </Button>
                </RHFActionForm>
              </details>
            ) : null}
          </section>

          <section
            id="insurance"
            aria-labelledby="insurance-title"
            className="grid scroll-mt-6 gap-4"
          >
            <h2 id="insurance-title" className="text-xl font-semibold">
              {t('Clients.detail.insuranceAndCareLevel')}
            </h2>
            <div className="grid gap-3">
              {insurances.length ? (
                insurances.map((insurance) => (
                  <article key={insurance.id} className="rounded-lg border bg-card p-5">
                    <h3 className="font-semibold">
                      {insurance.insurerName}
                      {insurance.isPrimary ? ` · ${t('Clients.detail.primary')}` : ''}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(insuranceTypeKey(insurance.insuranceType))} ·{' '}
                      {t('Clients.detail.validFrom')}{' '}
                      {formatDate(insurance.validFrom, locale) ?? '—'}
                      {' · '}
                      {t('Clients.detail.validUntil')}{' '}
                      {formatDate(insurance.validUntil, locale) ?? '—'}
                    </p>
                    {canUpdateClient ? (
                      <details className="mt-3">
                        <summary className="flex min-h-10 w-fit cursor-pointer list-none items-center rounded-md border px-3 text-sm font-medium hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                          {t('Common.actions.edit')}
                        </summary>
                        <RHFActionForm
                          warnOnUnsavedChanges
                          action={updateClientInsuranceAction}
                          className="mt-4 grid gap-4 rounded-lg border p-4"
                        >
                          <input type="hidden" name="id" value={client.id} />
                          <input type="hidden" name="insuranceId" value={insurance.id} />
                          <div className="grid gap-4 md:grid-cols-3">
                            <SelectField
                              id={`insurance-type-${insurance.id}`}
                              name="insuranceType"
                              label={t('Clients.detail.insuranceType')}
                              value={insurance.insuranceType}
                            >
                              <InsuranceOptions />
                            </SelectField>
                            <TextField
                              id={`insurer-name-${insurance.id}`}
                              name="insurerName"
                              label={t('Clients.detail.insurer')}
                              defaultValue={insurance.insurerName}
                              required
                            />
                            <TextField
                              id={`insurance-number-${insurance.id}`}
                              name="insuranceNumber"
                              label={t('Clients.detail.insuranceNumber')}
                              defaultValue={insurance.insuranceNumber ?? ''}
                            />
                            <TextField
                              id={`member-number-${insurance.id}`}
                              name="memberNumber"
                              label={t('Clients.detail.memberNumber')}
                              defaultValue={insurance.memberNumber ?? ''}
                            />
                            <TextField
                              id={`insurance-from-${insurance.id}`}
                              name="validFrom"
                              label={t('Clients.detail.validFrom')}
                              type="date"
                              defaultValue={insurance.validFrom ?? ''}
                            />
                            <TextField
                              id={`insurance-until-${insurance.id}`}
                              name="validUntil"
                              label={t('Clients.detail.validUntil')}
                              type="date"
                              defaultValue={insurance.validUntil ?? ''}
                            />
                          </div>
                          <label className="flex items-center gap-2 text-sm">
                            <ShadcnCheckbox name="isPrimary" defaultChecked={insurance.isPrimary} />{' '}
                            {t('Clients.detail.primaryInsurance')}
                          </label>
                          <p className="text-sm text-muted-foreground">
                            {t('Clients.detail.protectedInsuranceNumber')}
                          </p>
                          <Button type="submit" variant="secondary" className="w-fit">
                            {t('Clients.detail.saveInsurance')}
                          </Button>
                        </RHFActionForm>
                      </details>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="rounded-lg border border-dashed bg-card p-5 text-sm text-muted-foreground">
                  {t('Clients.detail.noInsurance')}
                </p>
              )}
            </div>
            {canUpdateClient ? (
              <details className="rounded-lg border bg-card p-5">
                <summary className="cursor-pointer font-semibold">
                  {t('Clients.detail.addInsurance')}
                </summary>
                <RHFActionForm
                  warnOnUnsavedChanges
                  action={addClientInsuranceAction}
                  className="mt-4 grid gap-4"
                >
                  <input type="hidden" name="id" value={client.id} />
                  <div className="grid gap-4 md:grid-cols-3">
                    <SelectField
                      id="new-insurance-type"
                      name="insuranceType"
                      label={t('Clients.detail.insuranceType')}
                      value="pflegeversicherung"
                      required
                    >
                      <InsuranceOptions />
                    </SelectField>
                    <TextField
                      id="new-insurer-name"
                      name="insurerName"
                      label={t('Clients.detail.insurer')}
                      required
                    />
                    <TextField
                      id="new-insurance-number"
                      name="insuranceNumber"
                      label={t('Clients.detail.insuranceNumber')}
                    />
                    <TextField
                      id="new-member-number"
                      name="memberNumber"
                      label={t('Clients.detail.memberNumber')}
                    />
                    <TextField
                      id="new-insurance-from"
                      name="validFrom"
                      label={t('Clients.detail.validFrom')}
                      type="date"
                    />
                    <TextField
                      id="new-insurance-until"
                      name="validUntil"
                      label={t('Clients.detail.validUntil')}
                      type="date"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <ShadcnCheckbox name="isPrimary" /> {t('Clients.detail.primaryInsurance')}
                  </label>
                  <Button type="submit" className="w-fit">
                    {t('Clients.detail.addInsurance')}
                  </Button>
                </RHFActionForm>
              </details>
            ) : null}

            <div className="grid gap-3">
              <h3 className="text-lg font-semibold">{t('Clients.detail.careLevelHistory')}</h3>
              {grades.length ? (
                grades.map((grade) => {
                  const isCurrent =
                    grade.status === 'confirmed' &&
                    grade.validFrom <= today &&
                    (!grade.validUntil || grade.validUntil > today);
                  const editableFuture = grade.status === 'pending' && grade.validFrom > today;
                  return (
                    <article key={grade.id} className="grid gap-3 rounded-lg border bg-card p-5">
                      <h4 className="font-semibold">
                        {t('Clients.careLevelNumber', { grade: grade.grade })} ·{' '}
                        {t(statusLabelKey(grade.status))}{' '}
                        {grade.status === 'confirmed' ? (
                          <span className="text-sm font-normal text-muted-foreground">
                            (
                            {isCurrent
                              ? t('Clients.detail.currentCareLevel')
                              : t('Clients.detail.historicalCareLevel')}
                            )
                          </span>
                        ) : null}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {t('Clients.detail.validFrom')} {formatDate(grade.validFrom, locale)}{' '}
                        {t('Clients.detail.validUntil').toLowerCase()}{' '}
                        {formatDate(grade.validUntil, locale)}
                        {grade.decisionDate
                          ? ` · ${t('Clients.detail.decisionDate')} ${formatDate(grade.decisionDate, locale)}`
                          : ''}
                      </p>
                      {editableFuture && canUpdateClient ? (
                        <RHFActionForm
                          warnOnUnsavedChanges
                          action={updateFuturePflegegradAction}
                          className="grid gap-4 md:grid-cols-4"
                        >
                          <input type="hidden" name="id" value={client.id} />
                          <input type="hidden" name="recordId" value={grade.id} />
                          <TextField
                            id={`grade-${grade.id}`}
                            name="grade"
                            label={t('Clients.detail.careLevel')}
                            type="number"
                            min={1}
                            max={5}
                            defaultValue={String(grade.grade)}
                            required
                          />
                          <TextField
                            id={`grade-from-${grade.id}`}
                            name="validFrom"
                            label={t('Clients.detail.validFrom')}
                            type="date"
                            defaultValue={grade.validFrom}
                            required
                          />
                          <SelectField
                            id={`grade-status-${grade.id}`}
                            name="status"
                            label={t('Common.fields.status')}
                            value={grade.status}
                          >
                            <option value="pending">{t('Common.status.pending')}</option>
                            <option value="confirmed">{t('Common.status.confirmed')}</option>
                            <option value="revoked">{t('Common.status.revoked')}</option>
                          </SelectField>
                          <div className="flex items-end">
                            <Button type="submit" variant="secondary">
                              {t('Clients.detail.gradePlanSave')}
                            </Button>
                          </div>
                        </RHFActionForm>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t('Clients.detail.gradeHistoryPolicy')}
                        </p>
                      )}
                    </article>
                  );
                })
              ) : (
                <p className="rounded-lg border bg-card p-5 text-muted-foreground">
                  {t('Clients.detail.noCareLevelHistory')}
                </p>
              )}
              {canUpdateClient ? (
                <details className="rounded-lg border bg-card p-5">
                  <summary className="cursor-pointer font-semibold">
                    {t('Clients.detail.addCareLevel')}
                  </summary>
                  <RHFActionForm
                    warnOnUnsavedChanges
                    action={addClientPflegegradAction}
                    className="mt-4 grid gap-4 md:grid-cols-3"
                  >
                    <input type="hidden" name="id" value={client.id} />
                    <TextField
                      id="new-grade"
                      name="grade"
                      label={t('Clients.detail.careLevel')}
                      type="number"
                      min={1}
                      max={5}
                      required
                    />
                    <TextField
                      id="new-grade-from"
                      name="validFrom"
                      label={t('Clients.detail.validFrom')}
                      type="date"
                      required
                    />
                    <SelectField
                      id="new-grade-status"
                      name="status"
                      label={t('Common.fields.status')}
                      value="pending"
                    >
                      <option value="pending">{t('Common.status.pending')}</option>
                      <option value="confirmed">{t('Common.status.confirmed')}</option>
                      <option value="revoked">{t('Common.status.revoked')}</option>
                    </SelectField>
                    <TextField
                      id="new-grade-until"
                      name="validUntil"
                      label={t('Clients.detail.validUntil')}
                      type="date"
                    />
                    <TextField
                      id="new-grade-decision"
                      name="decisionDate"
                      label={t('Clients.detail.decisionDate')}
                      type="date"
                    />
                    <TextField
                      id="new-grade-reference"
                      name="insurerReference"
                      label={t('Clients.detail.insurerReference')}
                      maxLength={120}
                    />
                    <Button type="submit" className="w-fit md:col-span-3">
                      {t('Clients.detail.saveCareLevel')}
                    </Button>
                  </RHFActionForm>
                </details>
              ) : null}
            </div>
          </section>

          {canReadSchedule ? (
            <section
              id="scheduling"
              aria-labelledby="scheduling-title"
              className="grid scroll-mt-6 gap-4 rounded-lg border bg-card p-5"
            >
              <div>
                <h2 id="scheduling-title" className="text-xl font-semibold">
                  {t('Clients.detail.schedulingPreferences')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('Clients.detail.schedulingPreferencesDescription')}
                </p>
              </div>
              {schedulingPreferencesResult?.error || routingLocationResult?.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(
                    errorMessageKey(
                      schedulingPreferencesResult?.error?.code ??
                        routingLocationResult?.error?.code ??
                        'REQUEST_FAILED',
                    ),
                  )}
                </p>
              ) : null}
              {canManageSchedule ? (
                <RHFActionForm
                  warnOnUnsavedChanges
                  action={saveClientSchedulingPreferencesAction}
                  className="grid gap-4"
                >
                  <input type="hidden" name="id" value={client.id} />
                  <fieldset className="grid gap-2">
                    <legend className="font-medium">{t('Clients.detail.preferredWeekdays')}</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {planningWeekdays.map(({ weekday, label }) => (
                        <label key={weekday} className="flex items-center gap-2 text-sm">
                          <ShadcnCheckbox
                            name="preferredWeekdays"
                            value={weekday}
                            defaultChecked={schedulingPreferences?.preferredWeekdays.includes(
                              weekday,
                            )}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="grid gap-3">
                    <p className="font-medium">{t('Clients.detail.preferredTimeWindows')}</p>
                    {[1, 2, 3, 4].map((slot) => {
                      const window = schedulingPreferences?.preferredTimeWindows[slot - 1];
                      return (
                        <div key={slot} className="grid gap-3 sm:grid-cols-2">
                          <TextField
                            id={`client-preferred-window-${slot}-start`}
                            name={`preferredWindow${slot}Start`}
                            label={t('Employees.detail.windowStart')}
                            type="time"
                            defaultValue={window?.startsAt ?? ''}
                          />
                          <TextField
                            id={`client-preferred-window-${slot}-end`}
                            name={`preferredWindow${slot}End`}
                            label={t('Employees.detail.windowEnd')}
                            type="time"
                            defaultValue={window?.endsAt ?? ''}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <AsyncEntityCombobox
                      name="preferredEmployeeId"
                      entity="employees"
                      label={t('Clients.detail.preferredEmployee')}
                      placeholder={t('Clients.detail.noPreferredEmployee')}
                      organizationId={client.organizationId ?? undefined}
                      facilityId={client.primaryFacilityId ?? undefined}
                      {...(schedulingPreferences?.preferredEmployeeId
                        ? {
                            initialOption: schedulingEmployeeOptionById.get(
                              schedulingPreferences.preferredEmployeeId,
                            ) ?? {
                              id: schedulingPreferences.preferredEmployeeId,
                              label: t('Resources.unavailableEmployee'),
                            },
                          }
                        : {})}
                    />
                    <AsyncEntityCombobox
                      name="avoidedEmployeeIds"
                      entity="employees"
                      label={t('Clients.detail.avoidedEmployees')}
                      organizationId={client.organizationId ?? undefined}
                      facilityId={client.primaryFacilityId ?? undefined}
                      multiple
                      initialOptions={
                        schedulingPreferences?.avoidedEmployeeIds.map(
                          (employeeId) =>
                            schedulingEmployeeOptionById.get(employeeId) ?? {
                              id: employeeId,
                              label: t('Resources.unavailableEmployee'),
                            },
                        ) ?? []
                      }
                    />
                  </div>
                  {schedulingEmployeeLookup.failed ? (
                    <p className="text-sm text-muted-foreground">
                      {t('Clients.detail.employeeChoicesUnavailable')}
                    </p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {t('Clients.detail.preferencesAreAdvisory')}
                  </p>
                  <Button type="submit" className="w-fit">
                    {t('Clients.detail.saveSchedulingPreferences')}
                  </Button>
                </RHFActionForm>
              ) : null}

              {canManageSchedule ? (
                <div className="grid gap-3 border-t pt-4">
                  <div>
                    <h3 className="font-semibold">{t('Clients.detail.routingLocation')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t('Clients.detail.routingPrivacy')}
                    </p>
                  </div>
                  {canManageSchedule ? (
                    <RHFActionForm
                      action={saveClientRoutingLocationAction}
                      warnOnUnsavedChanges
                      className="grid gap-3 md:grid-cols-2"
                    >
                      <input type="hidden" name="id" value={client.id} />
                      <TextField
                        id="client-routing-latitude"
                        name="latitude"
                        label={t('Employees.detail.latitude')}
                        type="number"
                        min="-90"
                        max="90"
                        step="0.000001"
                        defaultValue={routingLocation?.latitude?.toString() ?? ''}
                        required
                      />
                      <TextField
                        id="client-routing-longitude"
                        name="longitude"
                        label={t('Employees.detail.longitude')}
                        type="number"
                        min="-180"
                        max="180"
                        step="0.000001"
                        defaultValue={routingLocation?.longitude?.toString() ?? ''}
                        required
                      />
                      <Button type="submit" className="w-fit md:col-span-2">
                        {t('Clients.detail.saveRoutingLocation')}
                      </Button>
                    </RHFActionForm>
                  ) : routingLocation ? (
                    <p className="text-sm text-muted-foreground">
                      {routingLocation.latitude}, {routingLocation.longitude}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t('Clients.detail.routingLocationUnavailable')}
                    </p>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          {canReadSchedule ? (
            <Suspense
              fallback={<ClientSectionLoading label={t('Clients.detail.upcomingVisits')} />}
            >
              <ClientVisitsSection client={client} permissions={permissions} />
            </Suspense>
          ) : null}

          {canReadDocuments ? (
            <Suspense fallback={<ClientSectionLoading label={t('Documents.title')} />}>
              <ClientDocumentsSection clientId={client.id} query={query} />
            </Suspense>
          ) : null}

          {canReadAdmissions ? (
            <Suspense fallback={<ClientSectionLoading label={t('Onboarding.title')} />}>
              <ClientAdmissionHistorySection
                clientId={client.id}
                client={client}
                permissions={permissions}
                canReadSchedule={canReadSchedule}
              />
            </Suspense>
          ) : null}
          <Suspense fallback={<ClientSectionLoading label={t('Clients.detail.timeline')} />}>
            <ClientTimelineSection clientId={client.id} />
          </Suspense>
        </>
      )}
    </div>
  );
}

async function ClientDocumentsSection({
  clientId,
  query,
}: Readonly<{ clientId: string; query: ClientDetailQuery }>) {
  const [t, locale, api, header] = await Promise.all([
    getTranslations(),
    getLocale(),
    getApiClient(),
    getTenantHeader(),
  ]);
  const selectedDocumentType = clientDocumentTypes.includes(
    query.documentType as ClientDocumentType,
  )
    ? (query.documentType as ClientDocumentType)
    : null;
  const page = positivePage(query.documentPage);
  const pageSize = positivePageSize(query.documentPageSize);
  const documentsResult = await api.GET('/api/v1/documents', {
    params: {
      query: {
        clientId,
        page,
        pageSize,
        ...(selectedDocumentType ? { documentType: selectedDocumentType } : {}),
      },
      header,
    },
  });
  const documentList = documentsResult.data as
    | {
        items?: ClientDocument[];
        page: number;
        pageSize: number;
        totalItems: number;
      }
    | undefined;
  if (documentList) {
    redirectToValidPage(
      `/clients/${clientId}`,
      query,
      page,
      documentList.pageSize,
      documentList.totalItems,
      'documentPage',
      'documentPageSize',
    );
  }
  const documents = documentList?.items ?? [];
  const errorCode = (documentsResult.error as { code?: string } | undefined)?.code;

  return (
    <section
      id="documents"
      aria-labelledby="documents-title"
      className="grid scroll-mt-6 gap-3 rounded-lg border bg-card p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="documents-title" className="text-xl font-semibold">
          {t('Documents.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('Documents.historyCount', { count: documents.length })}
        </p>
      </div>
      <form method="get" action={`/clients/${clientId}`} className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="document-type-filter">{t('Documents.filterType')}</Label>
          <NativeSelect
            id="document-type-filter"
            name="documentType"
            defaultValue={selectedDocumentType ?? ''}
            selectClassName="h-10 rounded-md border bg-card px-3"
            className="w-full"
          >
            <option value="">{t('Documents.allDocumentTypes')}</option>
            {clientDocumentTypes.map((type) => (
              <option key={type} value={type}>
                {t(`Documents.documentTypes.${type}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <input type="hidden" name="documentPage" value="1" />
        <input type="hidden" name="documentPageSize" value={pageSize} />
        <Button type="submit" variant="secondary">
          {t('Documents.applyFilter')}
        </Button>
      </form>
      {documents.length ? (
        <ul className="grid gap-2">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
            >
              <div>
                <h3 className="font-medium">
                  {document.title || t(`Documents.documentTypes.${document.documentType}`)}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t(`Documents.documentTypes.${document.documentType}`)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(document.generatedAt ?? document.createdAt, locale)} ·{' '}
                  {t(`Documents.status.${document.status}`)} · {document.locale.toUpperCase()}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary">
                  <Link href={`/documents/${document.id}`}>{t('Documents.workspace.open')}</Link>
                </Button>
                {document.status === 'ready' || document.status === 'superseded' ? (
                  <Button asChild>
                    <Link href={`/documents/${document.id}/pdf`}>{t('Documents.download')}</Link>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : errorCode ? (
        <p role="alert" className="rounded-md border bg-card p-4 text-destructive">
          {t(errorMessageKey(errorCode))}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {selectedDocumentType ? t('Documents.historyFilterEmpty') : t('Documents.historyEmpty')}
        </p>
      )}
      {documentList ? (
        <DataPagination
          pathname={`/clients/${clientId}`}
          page={documentList.page}
          pageSize={documentList.pageSize}
          totalItems={documentList.totalItems}
          pageParam="documentPage"
          pageSizeParam="documentPageSize"
          controlId="client-document-page-size"
          filters={{
            documentType: selectedDocumentType ?? undefined,
            error: query.error,
            updated: query.updated,
          }}
        />
      ) : null}
    </section>
  );
}

async function ClientVisitsSection({
  client,
  permissions,
}: Readonly<{
  client: ClientDetailClient;
  permissions: Awaited<ReturnType<typeof getPermissionGrants>>;
}>) {
  const [t, locale, api, header] = await Promise.all([
    getTranslations(),
    getLocale(),
    getApiClient(),
    getTenantHeader(),
  ]);
  const get = api.GET;
  const { visitNow, visitFuture, visitRecent } = clientVisitRange();
  const [upcomingVisitsResult, recentVisitsResult, recentCancelledVisitsResult] = await Promise.all(
    [
      get('/api/v1/visits', {
        params: {
          query: {
            from: visitNow.toISOString(),
            until: visitFuture.toISOString(),
            clientId: client.id,
            page: 1,
            pageSize: 10,
          },
          header,
        },
      }),
      get('/api/v1/visits', {
        params: {
          query: {
            from: visitRecent.toISOString(),
            until: visitNow.toISOString(),
            clientId: client.id,
            page: 1,
            pageSize: 10,
          },
          header,
        },
      }),
      get('/api/v1/visits', {
        params: {
          query: {
            from: visitRecent.toISOString(),
            until: visitNow.toISOString(),
            clientId: client.id,
            status: 'cancelled',
            page: 1,
            pageSize: 10,
          },
          header,
        },
      }),
    ],
  );
  const visitItems = upcomingVisitsResult.data?.items ?? [];
  const recentVisitItems = recentVisitsResult.data?.items ?? [];
  const fetchExecutionSummaries = (items: typeof visitItems) =>
    items.length
      ? get('/api/v1/visit-executions/summaries', {
          params: {
            query: { visitIds: items.map((visit) => visit.id).join(',') },
            header,
          },
        })
      : Promise.resolve({ data: [], error: undefined });
  const [executionSummariesResult, recentExecutionSummariesResult] = await Promise.all([
    fetchExecutionSummaries(visitItems),
    fetchExecutionSummaries(recentVisitItems),
  ]);
  const executionByVisitId = new Map(
    (executionSummariesResult.data ?? []).map((summary) => [summary.visitId, summary]),
  );
  const recentExecutionByVisitId = new Map(
    (recentExecutionSummariesResult.data ?? []).map((summary) => [summary.visitId, summary]),
  );
  const recentExecutionItems = recentVisitItems.filter(
    (visit) =>
      recentExecutionByVisitId.get(visit.id)?.executionStatus !== undefined &&
      recentExecutionByVisitId.get(visit.id)?.executionStatus !== 'not_started',
  );
  const tenantId = header['X-Tenant-Id'];
  const visitHref = (visit: (typeof visitItems)[number]) =>
    hasClientPermission(
      permissions,
      'schedule.read',
      tenantId,
      visit.organizationId,
      visit.facilityId,
    )
      ? `/visits/${visit.id}`
      : null;

  return (
    <section id="visits" aria-labelledby="visits-title" className="grid scroll-mt-6 gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="visits-title" className="text-xl font-semibold">
          {t('Clients.detail.upcomingVisits')}
        </h2>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/planning?clientId=${encodeURIComponent(client.id)}`}>
            {t('Clients.detail.openCalendar')}
          </Link>
        </Button>
      </div>
      {upcomingVisitsResult.error ? (
        <p role="alert" className="rounded-lg border bg-card p-4 text-sm text-destructive">
          {t('Clients.detail.visitsUnavailable')}
        </p>
      ) : visitItems.length ? (
        <ol className="grid gap-2">
          {visitItems.map((visit) => {
            const execution = executionByVisitId.get(visit.id);
            return (
              <li key={visit.id}>
                <ResourceCardLink
                  className="grid gap-1 rounded-lg border bg-card p-4 hover:border-primary/40 sm:grid-cols-[12rem_1fr_auto]"
                  href={visitHref(visit)}
                >
                  <time dateTime={visit.plannedStart}>
                    {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)}
                  </time>
                  <span>
                    <strong>
                      {visit.services.map((service) => service.serviceName).join(' · ')}
                    </strong>
                    <span className="block text-sm text-muted-foreground">
                      {visit.assignments.length
                        ? visit.assignments
                            .map((assignment) => assignment.employeeDisplayName)
                            .join(', ')
                        : t('Clients.detail.unassigned')}
                    </span>
                    {execution ? (
                      <span className="block text-sm text-muted-foreground">
                        {t('Clients.detail.execution')}{' '}
                        {execution.executionStatus === 'completed'
                          ? t('Common.status.completed')
                          : execution.executionStatus === 'in_progress'
                            ? t('Common.status.inProgress')
                            : t('VisitExecution.executionStatus.notStarted')}
                        {execution.actualStart ? (
                          <>
                            {` · ${t('Clients.detail.actual')} `}
                            {formatVisitDateTime(execution.actualStart, visit.timezone, locale)}
                            {execution.actualEnd
                              ? ` – ${formatVisitDateTime(execution.actualEnd, visit.timezone, locale)}`
                              : ''}
                          </>
                        ) : null}
                      </span>
                    ) : executionSummariesResult.error ? (
                      <span className="block text-sm text-muted-foreground">
                        {t('Clients.detail.executionStatusUnavailable')}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm">
                    {visit.status === 'cancelled'
                      ? t('Common.status.cancelled')
                      : visit.status === 'confirmed'
                        ? t('Common.status.confirmed')
                        : t('Common.status.planned')}
                  </span>
                </ResourceCardLink>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-lg border bg-card p-4 text-muted-foreground">
          {t('Clients.detail.noUpcomingVisits')}
        </p>
      )}
      {recentVisitsResult.error ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {t('Clients.detail.pastExecutionsUnavailable')}
        </p>
      ) : recentExecutionSummariesResult.error ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {t('Clients.detail.pastExecutionStatusUnavailable')}
        </p>
      ) : recentExecutionItems.length ? (
        <div className="grid gap-3">
          <h3 className="font-semibold">{t('Clients.detail.recentVisits')}</h3>
          <ol className="grid gap-2">
            {recentExecutionItems.map((visit) => {
              const execution = recentExecutionByVisitId.get(visit.id);
              if (!execution) return null;
              return (
                <li key={visit.id}>
                  <ResourceCardLink
                    className="grid gap-1 rounded-lg border bg-card p-4 hover:border-primary/40"
                    href={visitHref(visit)}
                  >
                    <time dateTime={visit.plannedStart}>
                      {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)}
                    </time>
                    <strong>
                      {visit.services.map((service) => service.serviceName).join(' · ')}
                    </strong>
                    <span className="text-sm text-muted-foreground">
                      {t('Clients.detail.execution')}{' '}
                      {execution.executionStatus === 'completed'
                        ? t('Common.status.completed')
                        : t('Common.status.inProgress')}
                      {execution.actualStart
                        ? ` · ${t('Clients.detail.actual')} ${formatVisitDateTime(execution.actualStart, visit.timezone, locale)}`
                        : ''}
                      {execution.actualEnd
                        ? ` – ${formatVisitDateTime(execution.actualEnd, visit.timezone, locale)}`
                        : ''}
                    </span>
                  </ResourceCardLink>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
      {recentCancelledVisitsResult.data?.items.length ? (
        <details className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer font-semibold">
            {t('Clients.detail.recentlyCancelledVisits', {
              count: recentCancelledVisitsResult.data.items.length,
            })}
          </summary>
          <ul className="mt-3 grid gap-2">
            {recentCancelledVisitsResult.data.items.map((visit) => (
              <li key={visit.id}>
                <ResourceCardLink href={visitHref(visit)} className="text-primary underline">
                  {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)} ·{' '}
                  {visit.services.map((service) => service.serviceName).join(', ')}
                </ResourceCardLink>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

async function ClientAdmissionHistorySection({
  clientId,
  client,
  permissions,
  canReadSchedule,
}: Readonly<{
  clientId: string;
  client: ClientDetailClient;
  permissions: Awaited<ReturnType<typeof getPermissionGrants>>;
  canReadSchedule: boolean;
}>) {
  const [t, locale, api, header] = await Promise.all([
    getTranslations(),
    getLocale(),
    getApiClient(),
    getTenantHeader(),
  ]);
  const result = await api.GET('/api/v1/onboarding/clients/{clientId}/history', {
    params: { path: { clientId }, header },
  });
  const history = (result.data ?? []) as unknown as Array<{
    id: string;
    stage: string;
    admittedAt: string | null;
    ownerEmployeeId: string | null;
    ownerEmployeeName?: string | null;
    createdAt: string;
    firstVisitId: string | null;
    firstVisitStartsAt?: string | null;
    history: Array<{
      version: number;
      toStage: string;
      occurredAt: string;
      actorName?: string | null;
    }>;
    documents: Array<{ id: string; requirementCode: string; status: string }>;
    tasks: Array<{ id: string; title: string; status: string; dueAt: string | null }>;
    communications: Array<{
      id: string;
      subject: string;
      summary: string | null;
      occurredAt: string;
    }>;
  }>;
  const tenantId = header['X-Tenant-Id'];
  const canReadEmployee = hasClientPermission(
    permissions,
    'employee.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canReadOperations = hasClientPermission(
    permissions,
    'operations.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );

  return (
    <section id="admissions" aria-labelledby="admissions-title" className="grid scroll-mt-6 gap-3">
      <h2 id="admissions-title" className="text-xl font-semibold">
        {t('Onboarding.title')}
      </h2>
      {result.error ? (
        <p role="alert" className="rounded-lg border bg-card p-5">
          {t('Onboarding.loadFailed')}
        </p>
      ) : history.length ? (
        <ul className="grid gap-3">
          {history.map((entry) => (
            <li key={entry.id} className="rounded-lg border bg-card p-4">
              <Link
                className="font-semibold text-primary underline"
                href={`/admissions/${entry.id}`}
              >
                {t('Onboarding.stage')}:{' '}
                {t(
                  `Onboarding.${entry.stage === 'assessment' ? 'assessmentStage' : entry.stage}` as 'Onboarding.inquiry',
                )}
              </Link>
              <p className="mt-1 text-sm text-muted-foreground">
                {entry.admittedAt
                  ? `${t('Onboarding.admitted')} · ${formatDateTime(entry.admittedAt, locale)}`
                  : formatDate(entry.createdAt, locale)}
              </p>
              {entry.ownerEmployeeId ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('Onboarding.ownerEmployee')}:{' '}
                  <ResourceReference
                    label={
                      canReadEmployee && entry.ownerEmployeeName
                        ? entry.ownerEmployeeName
                        : t('Resources.unavailableEmployee')
                    }
                    href={
                      canReadEmployee && entry.ownerEmployeeName
                        ? `/employees/${entry.ownerEmployeeId}`
                        : null
                    }
                  />
                </p>
              ) : null}
              {entry.firstVisitId && entry.firstVisitStartsAt ? (
                <p className="mt-1 text-sm">
                  {t('Onboarding.firstScheduledVisit')}:{' '}
                  <ResourceReference
                    label={
                      formatDateTime(entry.firstVisitStartsAt, locale) ??
                      t('Resources.unavailableVisit')
                    }
                    href={canReadSchedule ? `/visits/${entry.firstVisitId}` : null}
                  />
                </p>
              ) : null}
              {entry.history.length ? (
                <div className="mt-3 border-t pt-3">
                  <h3 className="font-medium">{t('Onboarding.admissionHistory')}</h3>
                  <ol className="mt-2 grid gap-1 text-sm text-muted-foreground">
                    {entry.history.map((transition) => (
                      <li key={`${entry.id}-${transition.version}`}>
                        {t(
                          `Onboarding.${transition.toStage === 'assessment' ? 'assessmentStage' : transition.toStage}` as 'Onboarding.inquiry',
                        )}{' '}
                        · {formatDateTime(transition.occurredAt, locale)} ·{' '}
                        {transition.actorName ?? t('Resources.unavailableUser')}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {entry.documents.length ? (
                <div className="mt-3 border-t pt-3">
                  <h3 className="font-medium">{t('Onboarding.admissionDocuments')}</h3>
                  <ul className="mt-2 grid gap-1 text-sm text-muted-foreground">
                    {entry.documents.map((document) => (
                      <li key={document.id}>
                        {document.requirementCode} · {document.status}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {canReadOperations &&
              entry.tasks.some((task) => !['completed', 'cancelled'].includes(task.status)) ? (
                <div className="mt-3 border-t pt-3">
                  <h3 className="font-medium">{t('Onboarding.admissionTasks')}</h3>
                  <ul className="mt-2 grid gap-1 text-sm">
                    {entry.tasks
                      .filter((task) => !['completed', 'cancelled'].includes(task.status))
                      .map((task) => (
                        <li key={task.id}>
                          <Link
                            className="text-primary underline"
                            href={`/operations/tasks/${task.id}`}
                          >
                            {task.title}
                          </Link>
                          {' · '}
                          {task.status}
                          {task.dueAt ? ` · ${formatDateTime(task.dueAt, locale)}` : ''}
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
              {entry.communications.length ? (
                <ul className="mt-3 grid gap-2 border-t pt-3 text-sm">
                  {entry.communications.map((interaction) => (
                    <li key={interaction.id}>
                      <p className="font-medium">
                        {interaction.subject} · {formatDateTime(interaction.occurredAt, locale)}
                      </p>
                      {interaction.summary ? (
                        <p className="whitespace-pre-wrap text-muted-foreground">
                          {interaction.summary}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border bg-card p-5 text-muted-foreground">
          {t('Onboarding.noHistory')}
        </p>
      )}
    </section>
  );
}

async function ClientTimelineSection({ clientId }: Readonly<{ clientId: string }>) {
  const [t, locale, api, header] = await Promise.all([
    getTranslations(),
    getLocale(),
    getApiClient(),
    getTenantHeader(),
  ]);
  const result = await api.GET('/api/v1/clients/{clientId}/timeline', {
    params: { path: { clientId }, header },
  });
  const timeline = result.data ?? [];
  return (
    <section id="timeline" aria-labelledby="timeline-title" className="grid scroll-mt-6 gap-4">
      <h2 id="timeline-title" className="text-xl font-semibold">
        {t('Clients.detail.timeline')}
      </h2>
      {result.error ? (
        <p role="alert" className="rounded-lg border bg-card p-5 text-destructive">
          {t('Clients.detail.loadFailed')}
        </p>
      ) : timeline.length ? (
        <ol className="grid gap-3 border-l-2 border-primary/30 pl-5">
          {timeline.map((entry) => (
            <li key={entry.id} className="rounded-lg border bg-card p-4">
              <p className="font-medium">{t(auditActionKey(entry.action))}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDateTime(entry.occurredAt, locale)} ·{' '}
                {t('Clients.detail.editedBy', { actor: t('Resources.unavailableUser') })}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border bg-card p-5 text-muted-foreground">
          {t('Clients.detail.noTimeline')}
        </p>
      )}
    </section>
  );
}

function ClientSectionLoading({ label }: Readonly<{ label: string }>) {
  return (
    <section
      aria-label={label}
      aria-busy="true"
      className="grid gap-3 rounded-lg border bg-card p-5"
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-12" />
    </section>
  );
}

async function AddressForm({
  action,
  clientId,
  idPrefix,
}: {
  action: (formData: FormData) => Promise<boolean | void>;
  clientId: string;
  idPrefix: string;
}) {
  const t = await getTranslations();
  return (
    <RHFActionForm warnOnUnsavedChanges action={action} className="mt-4 grid gap-4">
      <input type="hidden" name="id" value={clientId} />
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          id={`${idPrefix}-type`}
          name="addressType"
          label={t('Clients.detail.addressType')}
          value="home"
        >
          <option value="home">{t('Clients.detail.addressTypes.home')}</option>
          <option value="billing">{t('Clients.detail.addressTypes.billing')}</option>
          <option value="other">{t('Clients.detail.addressTypes.other')}</option>
        </SelectField>
        <TextField
          id={`${idPrefix}-street`}
          name="street"
          label={t('Clients.form.street')}
          required
        />
        <TextField
          id={`${idPrefix}-house`}
          name="houseNumber"
          label={t('Clients.form.houseNumber')}
        />
        <TextField
          id={`${idPrefix}-addition`}
          name="addressAddition"
          label={t('Clients.form.addressAddition')}
        />
        <TextField
          id={`${idPrefix}-postal`}
          name="postalCode"
          label={t('Clients.form.postalCode')}
        />
        <TextField id={`${idPrefix}-city`} name="city" label={t('Clients.form.city')} required />
        <TextField
          id={`${idPrefix}-country`}
          name="countryCode"
          label={t('Clients.form.countryCode')}
          defaultValue="DE"
          maxLength={2}
        />
        <TextField
          id={`${idPrefix}-from`}
          name="validFrom"
          label={t('Clients.detail.validFrom')}
          type="date"
        />
        <TextField
          id={`${idPrefix}-until`}
          name="validUntil"
          label={t('Clients.detail.validUntil')}
          type="date"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <ShadcnCheckbox name="isPrimary" /> {t('Clients.detail.primaryAddressCheckbox')}
      </label>
      <Button type="submit" className="w-fit">
        {t('Clients.detail.addAddress')}
      </Button>
    </RHFActionForm>
  );
}

async function RoleChecks({ selected }: { selected: readonly string[] }) {
  const t = await getTranslations();
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{t('Clients.detail.contactRolesTitle')}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {(
          Object.entries(contactRoleKeys) as Array<
            [keyof typeof contactRoleKeys, (typeof contactRoleKeys)[keyof typeof contactRoleKeys]]
          >
        ).map(([role, key]) => (
          <label key={role} className="flex items-center gap-2 text-sm">
            <ShadcnCheckbox name="roles" value={role} defaultChecked={selected.includes(role)} />{' '}
            {t(key)}
          </label>
        ))}
      </div>
      <span className="text-sm text-muted-foreground">{t('Clients.detail.roleUniqueness')}</span>
    </fieldset>
  );
}

async function RelationshipOptions() {
  const t = await getTranslations();
  return (
    <>
      <option value="daughter">{t('Clients.detail.relationships.daughter')}</option>
      <option value="son">{t('Clients.detail.relationships.son')}</option>
      <option value="spouse">{t('Clients.detail.relationships.spouse')}</option>
      <option value="relative">{t('Clients.detail.relationships.relative')}</option>
      <option value="legal_representative">
        {t('Clients.detail.relationships.legalRepresentative')}
      </option>
      <option value="guardian">{t('Clients.detail.relationships.guardian')}</option>
      <option value="other">{t('Clients.detail.relationships.other')}</option>
    </>
  );
}

async function InsuranceOptions() {
  const t = await getTranslations();
  return (
    <>
      <option value="pflegeversicherung">{t('Clients.detail.insuranceTypes.care')}</option>
      <option value="krankenversicherung">{t('Clients.detail.insuranceTypes.health')}</option>
      <option value="private">{t('Clients.detail.insuranceTypes.private')}</option>
      <option value="other">{t('Clients.detail.insuranceTypes.other')}</option>
    </>
  );
}

function TextField({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
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
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
  min?: number | string;
  max?: number | string;
  step?: number | string;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        maxLength={maxLength}
        min={min === undefined ? undefined : Number(min)}
        max={max === undefined ? undefined : Number(max)}
        step={step}
      />
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  value,
  required = false,
  children,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  value: string;
  required?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </Label>
      <NativeSelect
        id={id}
        name={name}
        selectClassName="h-10 rounded-md border bg-card px-3"
        defaultValue={value}
        required={required}
        className="w-full"
      >
        {children}
      </NativeSelect>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{value ?? '—'}</dd>
    </div>
  );
}

function ContactMethods({
  phone,
  mobile,
  email,
  phoneLabel,
  mobileLabel,
  emailLabel,
  emptyLabel,
}: Readonly<{
  phone: string | null;
  mobile: string | null;
  email: string | null;
  phoneLabel: string;
  mobileLabel: string;
  emailLabel: string;
  emptyLabel: string;
}>) {
  const methods = [
    phone
      ? {
          href: `tel:${encodeURIComponent(phone)}`,
          label: phoneLabel,
          value: phone,
        }
      : null,
    mobile
      ? {
          href: `tel:${encodeURIComponent(mobile)}`,
          label: mobileLabel,
          value: mobile,
        }
      : null,
    email ? { href: `mailto:${email}`, label: emailLabel, value: email } : null,
  ].filter((method) => method !== null);

  return methods.length ? (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {methods.map((method) => (
        <li key={`${method.label}-${method.value}`}>
          <a className="text-primary underline underline-offset-2" href={method.href}>
            {method.label}: {method.value}
          </a>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  );
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      className="flex min-h-10 shrink-0 items-center rounded-lg px-3 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
      href={href}
    >
      {children}
    </Link>
  );
}

function formatAddress(address: {
  street: string;
  houseNumber: string | null;
  postalCode: string | null;
  city: string;
  countryCode: string;
}): string {
  return [
    `${address.street}${address.houseNumber ? ` ${address.houseNumber}` : ''}`,
    [address.postalCode, address.city].filter(Boolean).join(' '),
    address.countryCode,
  ]
    .filter(Boolean)
    .join(', ');
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function positivePage(value: string | undefined): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function positivePageSize(value: string | undefined): number {
  const pageSize = Number(value);
  return [10, 20, 50, 100].includes(pageSize) ? pageSize : 20;
}

function clientVisitRange(): { visitNow: Date; visitFuture: Date; visitRecent: Date } {
  const visitNow = new Date();
  return {
    visitNow,
    visitFuture: new Date(visitNow.getTime() + 30 * 24 * 60 * 60 * 1000),
    visitRecent: new Date(visitNow.getTime() - 30 * 24 * 60 * 60 * 1000),
  };
}

function genderKey(
  value: string,
):
  | 'Clients.form.female'
  | 'Clients.form.male'
  | 'Clients.form.diverse'
  | 'Clients.form.notSpecified' {
  return value === 'female'
    ? 'Clients.form.female'
    : value === 'male'
      ? 'Clients.form.male'
      : value === 'diverse'
        ? 'Clients.form.diverse'
        : 'Clients.form.notSpecified';
}

function salutationKey(
  value: string,
):
  | 'Clients.form.mr'
  | 'Clients.form.ms'
  | 'Clients.form.mx'
  | 'Clients.form.other'
  | 'Clients.form.notSpecified' {
  return value === 'mr'
    ? 'Clients.form.mr'
    : value === 'ms'
      ? 'Clients.form.ms'
      : value === 'mx'
        ? 'Clients.form.mx'
        : value === 'other'
          ? 'Clients.form.other'
          : 'Clients.form.notSpecified';
}

function addressTypeKey(
  value: string,
):
  | 'Clients.detail.addressTypes.home'
  | 'Clients.detail.addressTypes.billing'
  | 'Clients.detail.addressTypes.other' {
  return value === 'home'
    ? 'Clients.detail.addressTypes.home'
    : value === 'billing'
      ? 'Clients.detail.addressTypes.billing'
      : 'Clients.detail.addressTypes.other';
}

function insuranceTypeKey(
  value: string,
):
  | 'Clients.detail.insuranceTypes.care'
  | 'Clients.detail.insuranceTypes.health'
  | 'Clients.detail.insuranceTypes.private'
  | 'Clients.detail.insuranceTypes.other' {
  return value === 'pflegeversicherung'
    ? 'Clients.detail.insuranceTypes.care'
    : value === 'krankenversicherung'
      ? 'Clients.detail.insuranceTypes.health'
      : value === 'private'
        ? 'Clients.detail.insuranceTypes.private'
        : 'Clients.detail.insuranceTypes.other';
}

function relationshipKey(
  value: string,
):
  | 'Clients.detail.relationships.daughter'
  | 'Clients.detail.relationships.son'
  | 'Clients.detail.relationships.spouse'
  | 'Clients.detail.relationships.relative'
  | 'Clients.detail.relationships.legalRepresentative'
  | 'Clients.detail.relationships.guardian'
  | 'Clients.detail.relationships.other' {
  return value === 'daughter'
    ? 'Clients.detail.relationships.daughter'
    : value === 'son'
      ? 'Clients.detail.relationships.son'
      : value === 'spouse'
        ? 'Clients.detail.relationships.spouse'
        : value === 'relative'
          ? 'Clients.detail.relationships.relative'
          : value === 'legal_representative'
            ? 'Clients.detail.relationships.legalRepresentative'
            : value === 'guardian'
              ? 'Clients.detail.relationships.guardian'
              : 'Clients.detail.relationships.other';
}

function organizationName(
  items: Array<{ id: string; name: string }>,
  id: string,
  fallback: string,
): string {
  return items.find((item) => item.id === id)?.name ?? fallback;
}

function facilityName(
  items: Array<{ id: string; name: string }>,
  id: string,
  fallback: string,
): string {
  return items.find((item) => item.id === id)?.name ?? fallback;
}
