import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import type { components } from '@care/api-client';
import { auditActionKey } from '../../../../i18n/audit';
import { statusLabelKey } from '../../../../i18n/status';
import { errorMessageKey } from '../../../../i18n/errors';
import { formatDate, formatDateTime } from '../../../../i18n/format';
import { formatVisitDateTime } from '../../../../lib/care-date';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
  hasClientPermission,
} from '../../../../lib/api';
import { ClinicalHistorySection, clinicalRange } from './clinical-history';

type ClinicalHistoryPage = components['schemas']['ClinicalRecordHistoryPageDto'];
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
  updateClientAction,
  updateClientAddressAction,
  updateClientContactAction,
  updateClientInsuranceAction,
  updateFuturePflegegradAction,
} from '../actions';

const contactRoleKeys = {
  primary_contact: 'Clients.detail.contactRoles.primaryContact',
  emergency_contact: 'Clients.detail.contactRoles.emergencyContact',
  legal_representative: 'Clients.detail.contactRoles.legalRepresentative',
  authorized_contact: 'Clients.detail.contactRoles.authorizedContact',
  invoice_recipient: 'Clients.detail.contactRoles.invoiceRecipient',
} as const;

export default async function ClientDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    clinicalFrom?: string;
    clinicalUntil?: string;
    clinicalPage?: string;
  }>;
}>) {
  const { id } = await params;
  const query = await searchParams;
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const { visitNow, visitFuture, visitRecent } = clientVisitRange();
  const [
    clientResult,
    addressesResult,
    contactsResult,
    insurancesResult,
    gradesResult,
    timelineResult,
    organizationsResult,
    facilitiesResult,
    upcomingVisitsResult,
    recentVisitsResult,
    recentCancelledVisitsResult,
  ] = await Promise.all([
    get('/api/v1/clients/{id}', { params: { path: { id }, header } }),
    get('/api/v1/clients/{clientId}/addresses', { params: { path: { clientId: id }, header } }),
    get('/api/v1/clients/{clientId}/contacts', { params: { path: { clientId: id }, header } }),
    get('/api/v1/clients/{clientId}/insurances', { params: { path: { clientId: id }, header } }),
    get('/api/v1/clients/{clientId}/pflegegrade', { params: { path: { clientId: id }, header } }),
    get('/api/v1/clients/{clientId}/timeline', { params: { path: { clientId: id }, header } }),
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', { params: { header } }),
    get('/api/v1/visits', {
      params: {
        query: {
          from: visitNow.toISOString(),
          until: visitFuture.toISOString(),
          clientId: id,
          page: 1,
          pageSize: 100,
        },
        header,
      },
    }),
    get('/api/v1/visits', {
      params: {
        query: {
          from: visitRecent.toISOString(),
          until: visitNow.toISOString(),
          clientId: id,
          page: 1,
          pageSize: 100,
        },
        header,
      },
    }),
    get('/api/v1/visits', {
      params: {
        query: {
          from: visitRecent.toISOString(),
          until: visitNow.toISOString(),
          clientId: id,
          status: 'cancelled',
          page: 1,
          pageSize: 100,
        },
        header,
      },
    }),
  ]);
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
  if (clientResult.error?.code === 'CLIENT_NOT_FOUND') notFound();

  const client = clientResult.data;
  const addresses = addressesResult.data ?? [];
  const contacts = contactsResult.data ?? [];
  const insurances = insurancesResult.data ?? [];
  const grades = gradesResult.data ?? [];
  const timeline = timelineResult.data ?? [];
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const permissions = await getPermissionGrants(api);
  const canReviewClinicalHistory = hasPermission(permissions, 'clinical_documentation.review');
  const clinicalPeriod = clinicalRange(query.clinicalFrom, query.clinicalUntil);
  const clinicalPage = parseClinicalPage(query.clinicalPage);
  let clinicalMeasurements: ClinicalHistoryPage | undefined;
  let clinicalObservations: ClinicalHistoryPage | undefined;
  let clinicalAssessments: ClinicalHistoryPage | undefined;
  let clinicalRiskHistory: ClinicalHistoryPage | undefined;
  let clinicalCurrentRisks: ClinicalHistoryPage | undefined;
  let clinicalHistoryLoadFailed = false;
  if (client && canReviewClinicalHistory) {
    const [
      measurementsResult,
      observationsResult,
      assessmentsResult,
      risksResult,
      currentRisksResult,
    ] = await Promise.all([
      get('/api/v1/clients/{clientId}/measurements', {
        params: {
          path: { clientId: client.id },
          query: {
            page: clinicalPage,
            pageSize: 25,
            from: clinicalPeriod.fromInstant,
            until: clinicalPeriod.untilInstant,
          },
          header,
        },
      }),
      get('/api/v1/clients/{clientId}/observations', {
        params: {
          path: { clientId: client.id },
          query: {
            page: clinicalPage,
            pageSize: 25,
            from: clinicalPeriod.fromInstant,
            until: clinicalPeriod.untilInstant,
          },
          header,
        },
      }),
      get('/api/v1/clients/{clientId}/assessments', {
        params: {
          path: { clientId: client.id },
          query: {
            page: clinicalPage,
            pageSize: 25,
            from: clinicalPeriod.fromInstant,
            until: clinicalPeriod.untilInstant,
          },
          header,
        },
      }),
      get('/api/v1/clients/{clientId}/risks', {
        params: {
          path: { clientId: client.id },
          query: {
            page: clinicalPage,
            pageSize: 25,
            from: clinicalPeriod.fromInstant,
            until: clinicalPeriod.untilInstant,
          },
          header,
        },
      }),
      get('/api/v1/clients/{clientId}/risks', {
        params: {
          path: { clientId: client.id },
          query: { page: 1, pageSize: 100, currentOnly: true },
          header,
        },
      }),
    ]);
    clinicalHistoryLoadFailed = [
      measurementsResult,
      observationsResult,
      assessmentsResult,
      risksResult,
      currentRisksResult,
    ].some((result) => result.error !== undefined);
    clinicalMeasurements = measurementsResult.data;
    clinicalObservations = observationsResult.data;
    clinicalAssessments = assessmentsResult.data;
    clinicalRiskHistory = risksResult.data;
    clinicalCurrentRisks = currentRisksResult.data;
  }
  const tenantId = header['X-Tenant-Id'];
  const canReadCarePlan = client
    ? hasClientPermission(
        permissions,
        'care_plan.read',
        tenantId,
        client.organizationId,
        client.primaryFacilityId,
      )
    : false;
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
  const actionError = query.error || clientResult.error?.code;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href="/clients">{t('Clients.title')}</Link>
          </p>
          {client ? (
            <>
              <h1 className="text-3xl font-semibold">
                {client.preferredName || client.firstName} {client.lastName}
              </h1>
              <StatusBadge status={client.status} label={t(statusLabelKey(client.status))} />
            </>
          ) : (
            <h1 className="text-3xl font-semibold">{t('Clients.detail.detailTitle')}</h1>
          )}
        </div>
        <Button asChild variant="secondary">
          <Link href="/clients">{t('Clients.detail.backToList')}</Link>
        </Button>
      </header>

      {actionError ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t(errorMessageKey(actionError))}
        </p>
      ) : null}
      {!client ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          {t('Clients.detail.loadFailed')}
        </p>
      ) : (
        <>
          <nav
            aria-label={t('Clients.detail.navigationLabel')}
            className="flex flex-wrap gap-2 border-b pb-3 text-sm"
          >
            <SectionLink href="#overview">{t('Clients.detail.overviewTab')}</SectionLink>
            <SectionLink href="#contacts">{t('Clients.detail.contactsTab')}</SectionLink>
            <SectionLink href="#insurance">{t('Clients.detail.insuranceTab')}</SectionLink>
            <Link
              className="rounded-md px-3 py-2 text-blue-900 hover:bg-blue-50"
              href={`/clients/${client.id}/service-agreements`}
            >
              {t('Clients.detail.servicePlanningTab')}
            </Link>
            {canReadCarePlan ? (
              <Link
                className="rounded-md px-3 py-2 text-blue-900 hover:bg-blue-50"
                href={`/clients/${client.id}/care-plan`}
              >
                {t('Clients.detail.carePlanTab')}
              </Link>
            ) : null}
            <SectionLink href="#visits">{t('Clients.detail.visitsTab')}</SectionLink>
            {canReviewClinicalHistory ? (
              <SectionLink href="#clinical">{t('Clients.detail.clinicalTab')}</SectionLink>
            ) : null}
            <SectionLink href="#timeline">{t('Clients.detail.timelineTab')}</SectionLink>
          </nav>

          <section
            id="overview"
            aria-labelledby="overview-title"
            className="grid gap-4 scroll-mt-6"
          >
            <h2 id="overview-title" className="text-xl font-semibold">
              {t('Clients.detail.overview')}
            </h2>
            <dl className="grid gap-4 rounded-lg border bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">
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
              <Field label={t('Clients.form.email')} value={client.email} />
              <Field label={t('Clients.form.phone')} value={client.phone} />
              <Field label={t('Clients.form.mobilePhone')} value={client.mobile} />
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
              <details className="rounded-lg border bg-white p-5">
                <summary className="cursor-pointer font-semibold">
                  {t('Clients.detail.editPersonalData')}
                </summary>
                <form action={updateClientAction} className="mt-4 grid gap-4">
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
                </form>
              </details>
            ) : null}

            <details
              className="rounded-lg border bg-white p-5"
              open={!client.organizationId || !client.primaryFacilityId}
            >
              <summary className="cursor-pointer font-semibold">
                {t('Clients.detail.providerContext')}
              </summary>
              <p className="mt-2 text-sm text-slate-700">
                {client.organizationId && client.primaryFacilityId
                  ? `${organizationName(organizations, client.organizationId, t('Clients.detail.unknownOrganization'))} / ${facilityName(facilities, client.primaryFacilityId, t('Clients.detail.unknownFacility'))}`
                  : t('Clients.detail.legacyUnassigned')}
              </p>
              {canUpdateClient ? (
                <form
                  action={changeClientProviderContextAction}
                  className="mt-4 grid gap-4 md:grid-cols-2"
                >
                  <input type="hidden" name="id" value={client.id} />
                  <SelectField
                    id="organizationId"
                    name="organizationId"
                    label={t('Clients.form.organization')}
                    value={client.organizationId ?? ''}
                    required
                  >
                    <option value="">{t('Clients.form.selectOrganization')}</option>
                    {organizations
                      .filter((organization) => organization.status === 'active')
                      .map((organization) => (
                        <option key={organization.id} value={organization.id}>
                          {organization.name}
                        </option>
                      ))}
                  </SelectField>
                  <SelectField
                    id="primaryFacilityId"
                    name="primaryFacilityId"
                    label={t('Clients.form.primaryFacility')}
                    value={client.primaryFacilityId ?? ''}
                    required
                  >
                    <option value="">{t('Clients.form.selectFacility')}</option>
                    {facilities
                      .filter((facility) => facility.status === 'active')
                      .map((facility) => (
                        <option key={facility.id} value={facility.id}>
                          {facility.name}
                        </option>
                      ))}
                  </SelectField>
                  <Button type="submit" className="w-fit md:col-span-2">
                    {t('Clients.detail.saveAssignment')}
                  </Button>
                </form>
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
            className="grid gap-4 scroll-mt-6"
          >
            <h2 id="contacts-title" className="text-xl font-semibold">
              {t('Clients.detail.addressesAndContacts')}
            </h2>
            <div className="grid gap-4">
              {addresses.map((address) => (
                <article key={address.id} className="grid gap-3 rounded-lg border bg-white p-5">
                  <h3 className="font-semibold">
                    {t(addressTypeKey(address.addressType))}
                    {address.isPrimary ? ` · ${t('Clients.detail.primary')}` : ''}
                  </h3>
                  {canUpdateClient ? (
                    <form action={updateClientAddressAction} className="grid gap-4">
                      <input type="hidden" name="id" value={client.id} />
                      <input type="hidden" name="addressId" value={address.id} />
                      <div className="grid gap-4 md:grid-cols-3">
                        <SelectField
                          id={`address-type-${address.id}`}
                          name="addressType"
                          label={t('Clients.detail.addressType')}
                          value={address.addressType}
                        >
                          <option value="home">{t('Clients.detail.addressTypes.home')}</option>
                          <option value="billing">
                            {t('Clients.detail.addressTypes.billing')}
                          </option>
                          <option value="other">{t('Clients.detail.addressTypes.other')}</option>
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
                        <input
                          type="checkbox"
                          name="isPrimary"
                          defaultChecked={address.isPrimary}
                        />{' '}
                        {t('Clients.detail.primaryAddressCheckbox')}
                      </label>
                      <div className="flex gap-2">
                        <Button type="submit" variant="secondary">
                          {t('Clients.detail.saveAddress')}
                        </Button>
                        <Button formAction={removeClientAddressAction} variant="destructive">
                          {t('Clients.detail.removeAddress')}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <p className="text-sm text-slate-700">{formatAddress(address)}</p>
                  )}
                </article>
              ))}
            </div>
            {canUpdateClient ? (
              <details className="rounded-lg border bg-white p-5">
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

            <div className="grid gap-4">
              {contacts.map((contact) => (
                <article key={contact.id} className="rounded-lg border bg-white p-5">
                  <h3 className="font-semibold">
                    {contact.firstName} {contact.lastName}
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    {t(relationshipKey(contact.relationshipType))} ·{' '}
                    {contact.roles.map((role) => t(contactRoleKeys[role])).join(', ') ||
                      t('Clients.detail.noContactRole')}
                  </p>
                  {!canUpdateClient ? (
                    <p className="mt-2 text-sm text-slate-700">
                      {[contact.phone, contact.mobile, contact.email].filter(Boolean).join(' · ') ||
                        t('Clients.detail.noContactDetails')}
                    </p>
                  ) : null}
                  {canUpdateClient ? (
                    <form action={updateClientContactAction} className="mt-4 grid gap-4">
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
                      <Button type="submit" variant="secondary" className="w-fit">
                        {t('Clients.detail.saveContact')}
                      </Button>
                      <Button
                        formAction={removeClientContactAction}
                        variant="destructive"
                        className="w-fit"
                      >
                        {t('Clients.detail.removeContact')}
                      </Button>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
            {canUpdateClient ? (
              <details className="rounded-lg border bg-white p-5">
                <summary className="cursor-pointer font-semibold">
                  {t('Clients.detail.addContact')}
                </summary>
                <form action={addClientContactAction} className="mt-4 grid gap-4">
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
                  <p className="text-sm text-slate-600">
                    {t('Clients.detail.medicalInformationWarning')}
                  </p>
                  <Button type="submit" className="w-fit">
                    {t('Clients.detail.addContact')}
                  </Button>
                </form>
              </details>
            ) : null}
          </section>

          <section
            id="insurance"
            aria-labelledby="insurance-title"
            className="grid gap-4 scroll-mt-6"
          >
            <h2 id="insurance-title" className="text-xl font-semibold">
              {t('Clients.detail.insuranceAndCareLevel')}
            </h2>
            <div className="grid gap-4">
              {insurances.map((insurance) => (
                <article key={insurance.id} className="rounded-lg border bg-white p-5">
                  <h3 className="font-semibold">
                    {insurance.insurerName}
                    {insurance.isPrimary ? ` · ${t('Clients.detail.primary')}` : ''}
                  </h3>
                  {canUpdateClient ? (
                    <form action={updateClientInsuranceAction} className="mt-4 grid gap-4">
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
                        <input
                          type="checkbox"
                          name="isPrimary"
                          defaultChecked={insurance.isPrimary}
                        />{' '}
                        {t('Clients.detail.primaryInsurance')}
                      </label>
                      <p className="text-sm text-slate-600">
                        {t('Clients.detail.protectedInsuranceNumber')}
                      </p>
                      <Button type="submit" variant="secondary" className="w-fit">
                        {t('Clients.detail.saveInsurance')}
                      </Button>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
            {canUpdateClient ? (
              <details className="rounded-lg border bg-white p-5">
                <summary className="cursor-pointer font-semibold">
                  {t('Clients.detail.addInsurance')}
                </summary>
                <form action={addClientInsuranceAction} className="mt-4 grid gap-4">
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
                    <input type="checkbox" name="isPrimary" />{' '}
                    {t('Clients.detail.primaryInsurance')}
                  </label>
                  <Button type="submit" className="w-fit">
                    {t('Clients.detail.addInsurance')}
                  </Button>
                </form>
              </details>
            ) : null}

            <div className="grid gap-3">
              <h3 className="text-lg font-semibold">{t('Clients.detail.careLevelHistory')}</h3>
              {grades.length ? (
                grades.map((grade) => {
                  const editableFuture = grade.status === 'pending' && grade.validFrom > today;
                  return (
                    <article key={grade.id} className="grid gap-3 rounded-lg border bg-white p-5">
                      <h4 className="font-semibold">
                        {t('Clients.careLevelNumber', { grade: grade.grade })} ·{' '}
                        {t(statusLabelKey(grade.status))}
                      </h4>
                      <p className="text-sm text-slate-700">
                        {t('Clients.detail.validFrom')} {formatDate(grade.validFrom, locale)}{' '}
                        {t('Clients.detail.validUntil').toLowerCase()}{' '}
                        {formatDate(grade.validUntil, locale)}
                        {grade.decisionDate
                          ? ` · ${t('Clients.detail.decisionDate')} ${formatDate(grade.decisionDate, locale)}`
                          : ''}
                      </p>
                      {editableFuture && canUpdateClient ? (
                        <form
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
                        </form>
                      ) : (
                        <p className="text-sm text-slate-600">
                          {t('Clients.detail.gradeHistoryPolicy')}
                        </p>
                      )}
                    </article>
                  );
                })
              ) : (
                <p className="rounded-lg border bg-white p-5 text-slate-700">
                  {t('Clients.detail.noCareLevelHistory')}
                </p>
              )}
              {canUpdateClient ? (
                <details className="rounded-lg border bg-white p-5">
                  <summary className="cursor-pointer font-semibold">
                    {t('Clients.detail.addCareLevel')}
                  </summary>
                  <form
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
                  </form>
                </details>
              ) : null}
            </div>
          </section>

          <section id="visits" aria-labelledby="visits-title" className="grid gap-4 scroll-mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="visits-title" className="text-xl font-semibold">
                {t('Clients.detail.upcomingVisits')}
              </h2>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/planning?clientId=${client.id}`}>
                  {t('Clients.detail.openCalendar')}
                </Link>
              </Button>
            </div>
            {upcomingVisitsResult.error ? (
              <p className="rounded-lg border bg-white p-4 text-sm text-slate-600">
                {t('Clients.detail.visitsUnavailable')}
              </p>
            ) : visitItems.length ? (
              <ol className="grid gap-2">
                {visitItems.map((visit) => {
                  const execution = executionByVisitId.get(visit.id);
                  return (
                    <li key={visit.id}>
                      <Link
                        className="grid gap-1 rounded-lg border bg-white p-4 hover:border-blue-400 sm:grid-cols-[12rem_1fr_auto]"
                        href={`/visits/${visit.id}`}
                      >
                        <time dateTime={visit.plannedStart}>
                          {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)}
                        </time>
                        <span>
                          <strong>
                            {visit.services.map((service) => service.serviceName).join(' · ')}
                          </strong>
                          <span className="block text-sm text-slate-600">
                            {visit.assignments.length
                              ? visit.assignments
                                  .map((assignment) => assignment.employeeDisplayName)
                                  .join(', ')
                              : t('Clients.detail.unassigned')}
                          </span>
                          {execution ? (
                            <span className="block text-sm text-slate-600">
                              {t('Clients.detail.execution')}{' '}
                              {execution.executionStatus === 'completed'
                                ? t('Common.status.completed')
                                : execution.executionStatus === 'in_progress'
                                  ? t('Common.status.inProgress')
                                  : t('VisitExecution.executionStatus.notStarted')}
                              {execution.actualStart ? (
                                <>
                                  {` · ${t('Clients.detail.actual')} `}
                                  {formatVisitDateTime(
                                    execution.actualStart,
                                    visit.timezone,
                                    locale,
                                  )}
                                  {execution.actualEnd
                                    ? ` – ${formatVisitDateTime(execution.actualEnd, visit.timezone, locale)}`
                                    : ''}
                                </>
                              ) : null}
                            </span>
                          ) : executionSummariesResult.error ? (
                            <span className="block text-sm text-slate-600">
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
                      </Link>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="rounded-lg border bg-white p-4 text-slate-600">
                {t('Clients.detail.noUpcomingVisits')}
              </p>
            )}
            {recentVisitsResult.error ? (
              <p className="text-sm text-slate-600">
                {t('Clients.detail.pastExecutionsUnavailable')}
              </p>
            ) : recentExecutionSummariesResult.error ? (
              <p className="text-sm text-slate-600">
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
                        <Link
                          className="grid gap-1 rounded-lg border bg-white p-4 hover:border-blue-400"
                          href={`/visits/${visit.id}`}
                        >
                          <time dateTime={visit.plannedStart}>
                            {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)}
                          </time>
                          <strong>
                            {visit.services.map((service) => service.serviceName).join(' · ')}
                          </strong>
                          <span className="text-sm text-slate-600">
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
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}
            {recentCancelledVisitsResult.data?.items.length ? (
              <details className="rounded-lg border bg-white p-4">
                <summary className="cursor-pointer font-semibold">
                  {t('Clients.detail.recentlyCancelledVisits', {
                    count: recentCancelledVisitsResult.data.items.length,
                  })}
                </summary>
                <ul className="mt-3 grid gap-2">
                  {recentCancelledVisitsResult.data.items.map((visit) => (
                    <li key={visit.id}>
                      <Link className="text-blue-900 underline" href={`/visits/${visit.id}`}>
                        {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)} ·{' '}
                        {visit.services.map((service) => service.serviceName).join(', ')}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          {canReviewClinicalHistory ? (
            <ClinicalHistorySection
              clientId={client.id}
              locale={locale}
              from={clinicalPeriod.from}
              until={clinicalPeriod.until}
              page={clinicalPage}
              measurements={clinicalMeasurements}
              observations={clinicalObservations}
              assessments={clinicalAssessments}
              riskHistory={clinicalRiskHistory}
              currentRisksPage={clinicalCurrentRisks}
              loadFailed={clinicalHistoryLoadFailed}
            />
          ) : null}
          <section
            id="timeline"
            aria-labelledby="timeline-title"
            className="grid gap-4 scroll-mt-6"
          >
            <h2 id="timeline-title" className="text-xl font-semibold">
              {t('Clients.detail.timeline')}
            </h2>
            {timeline.length ? (
              <ol className="grid gap-3 border-l-2 border-blue-200 pl-5">
                {timeline.map((entry) => (
                  <li key={entry.id} className="rounded-lg border bg-white p-4">
                    <p className="font-medium">{t(auditActionKey(entry.action))}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatDateTime(entry.occurredAt, locale)} ·{' '}
                      {t('Clients.detail.editedBy', { actor: entry.actorId })}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border bg-white p-5 text-slate-700">
                {t('Clients.detail.noTimeline')}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

async function AddressForm({
  action,
  clientId,
  idPrefix,
}: {
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  idPrefix: string;
}) {
  const t = await getTranslations();
  return (
    <form action={action} className="mt-4 grid gap-4">
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
        <input type="checkbox" name="isPrimary" /> {t('Clients.detail.primaryAddressCheckbox')}
      </label>
      <Button type="submit" className="w-fit">
        {t('Clients.detail.addAddress')}
      </Button>
    </form>
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
            <input
              type="checkbox"
              name="roles"
              value={role}
              defaultChecked={selected.includes(role)}
            />{' '}
            {t(key)}
          </label>
        ))}
      </div>
      <span className="text-sm text-slate-600">{t('Clients.detail.roleUniqueness')}</span>
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
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
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
        min={min}
        max={max}
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
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        className="h-10 rounded-md border bg-white px-3"
        defaultValue={value}
        required={required}
      >
        {children}
      </select>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="break-words font-medium">{value || '—'}</dd>
    </div>
  );
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link className="rounded-md px-3 py-2 text-blue-900 hover:bg-blue-50" href={href}>
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

function parseClinicalPage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 && page <= 10_000 ? page : 1;
}
