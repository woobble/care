import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';

import { ErrorNotice } from '@app/web/components/page-patterns';
import { ResourceReference } from '@app/web/components/resource-reference';
import { formatDate, formatDateTime } from '@app/web/i18n/format';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '@app/web/lib/api';
import { formatVisitDateTime } from '@app/web/lib/care-date';
import { getFacilitiesByIds } from '@app/web/lib/facility-lookup';
import { getOrganizationsByIds } from '@app/web/lib/organization-lookup';
import type { components } from '@care/api-client';
import { Skeleton } from '@care/ui/components/skeleton';
import { StatusBadge } from '@care/ui/components/status-badge';

type Client = components['schemas']['ClientResponseDto'];
type PermissionGrants = Awaited<ReturnType<typeof getPermissionGrants>>;
type Contact = components['schemas']['ClientContactResponseDto'];
type Address = components['schemas']['ClientAddressResponseDto'];

export function ClientProfileOverview({
  client,
  permissions,
  title,
  loadingLabel,
}: Readonly<{
  client: Client;
  permissions: PermissionGrants;
  title: string;
  loadingLabel: string;
}>) {
  return (
    <section
      id="overview"
      aria-labelledby="client-overview-title"
      className="grid scroll-mt-6 gap-3"
    >
      <h2 id="client-overview-title" className="text-xl font-semibold">
        {title}
      </h2>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <Suspense fallback={<OverviewCardSkeleton label={loadingLabel} />}>
          <ClientContactOverview client={client} permissions={permissions} />
        </Suspense>
        <Suspense fallback={<OverviewCardSkeleton label={loadingLabel} />}>
          <ClientWorkOverview client={client} permissions={permissions} />
        </Suspense>
      </div>
    </section>
  );
}

async function ClientContactOverview({
  client,
  permissions,
}: Readonly<{ client: Client; permissions: PermissionGrants }>) {
  const [t, locale, api, header] = await Promise.all([
    getTranslations(),
    getLocale(),
    getApiClient(),
    getTenantHeader(),
  ]);
  const get = api.GET;
  const canReadOrganization = Boolean(
    client.organizationId &&
    hasClientPermission(
      permissions,
      'organization.read',
      header['X-Tenant-Id'],
      client.organizationId,
      null,
    ),
  );
  const canReadFacility = Boolean(
    client.organizationId &&
    client.primaryFacilityId &&
    hasClientPermission(
      permissions,
      'facility.read',
      header['X-Tenant-Id'],
      client.organizationId,
      client.primaryFacilityId,
    ),
  );
  const [addressesResult, contactsResult, gradesResult, organizationLookup, facilityLookup] =
    await Promise.all([
      get('/api/v1/clients/{clientId}/addresses', {
        params: { path: { clientId: client.id }, header },
      }),
      get('/api/v1/clients/{clientId}/contacts', {
        params: { path: { clientId: client.id }, header },
      }),
      get('/api/v1/clients/{clientId}/pflegegrade', {
        params: { path: { clientId: client.id }, header },
      }),
      getOrganizationsByIds(
        canReadOrganization && client.organizationId ? [client.organizationId] : [],
      ),
      getFacilitiesByIds(
        canReadFacility && client.primaryFacilityId ? [client.primaryFacilityId] : [],
      ),
    ]);

  const addresses = addressesResult.data ?? [];
  const contacts = contactsResult.data ?? [];
  const today = currentDateTime().toISOString().slice(0, 10);
  const currentGrade = (gradesResult.data ?? []).find(
    (grade) =>
      grade.status === 'confirmed' &&
      grade.validFrom <= today &&
      (!grade.validUntil || grade.validUntil > today),
  );
  const primaryAddress = addresses.find((address) => address.isPrimary);
  const primaryContact = contacts.find((contact) => contact.roles.includes('primary_contact'));
  const emergencyContact = contacts.find((contact) => contact.roles.includes('emergency_contact'));
  const organizationName = canReadOrganization
    ? (organizationLookup.items.find((item) => item.id === client.organizationId)?.name ??
      t('Resources.unavailableOrganization'))
    : t('Resources.unavailableOrganization');
  const facilityName = canReadFacility
    ? (facilityLookup.items.find((item) => item.id === client.primaryFacilityId)?.name ??
      t('Resources.unavailableFacility'))
    : t('Resources.unavailableFacility');
  const failed = Boolean(addressesResult.error || contactsResult.error || gradesResult.error);

  return (
    <article className="grid min-w-0 content-start gap-3 rounded-lg border bg-card p-4 sm:p-5">
      <h3 className="font-semibold">{t('Clients.detail.primaryContact')}</h3>
      {failed ? <ErrorNotice>{t('Clients.detail.overviewUnavailable')}</ErrorNotice> : null}
      <dl className="grid min-w-0 gap-x-4 gap-y-3 sm:grid-cols-2">
        <div className="grid min-w-0 gap-1">
          <dt className="text-sm text-muted-foreground">{t('Common.fields.organization')}</dt>
          <dd className="font-medium break-words">
            <ResourceReference
              label={organizationName}
              href={
                canReadOrganization && client.organizationId
                  ? `/administration/organizations/${client.organizationId}`
                  : null
              }
            />
          </dd>
        </div>
        <div className="grid min-w-0 gap-1">
          <dt className="text-sm text-muted-foreground">{t('Common.fields.facility')}</dt>
          <dd className="font-medium break-words">
            <ResourceReference
              label={facilityName}
              href={
                canReadFacility && client.primaryFacilityId
                  ? `/administration/facilities/${client.primaryFacilityId}`
                  : null
              }
            />
          </dd>
        </div>
        <OverviewContact label={t('Clients.detail.primaryContact')} contact={primaryContact} />
        <OverviewContact label={t('Clients.detail.emergencyContact')} contact={emergencyContact} />
        <div className="grid min-w-0 gap-1 sm:col-span-2">
          <dt className="text-sm text-muted-foreground">{t('Clients.detail.primaryAddress')}</dt>
          <dd className="font-medium break-words">
            {primaryAddress ? formatAddress(primaryAddress) : '—'}
          </dd>
        </div>
        <div className="grid min-w-0 gap-1">
          <dt className="text-sm text-muted-foreground">{t('Clients.detail.currentCareLevel')}</dt>
          <dd className="font-medium">
            {currentGrade ? t('Clients.careLevelNumber', { grade: currentGrade.grade }) : '—'}
          </dd>
        </div>
        <div className="grid min-w-0 gap-1">
          <dt className="text-sm text-muted-foreground">{t('Clients.form.dateOfBirth')}</dt>
          <dd className="font-medium">{formatDate(client.dateOfBirth, locale) ?? '—'}</dd>
        </div>
      </dl>
    </article>
  );
}

function OverviewContact({
  label,
  contact,
}: Readonly<{
  label: string;
  contact: Contact | undefined;
}>) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="grid min-w-0 gap-1 font-medium">
        {contact ? (
          <>
            <span className="break-words">
              {contact.firstName} {contact.lastName}
            </span>
            {contact.phone ? (
              <a
                className="w-fit text-sm text-primary underline"
                href={`tel:${encodeURIComponent(contact.phone)}`}
              >
                {contact.phone}
              </a>
            ) : null}
            {contact.mobile ? (
              <a
                className="w-fit text-sm text-primary underline"
                href={`tel:${encodeURIComponent(contact.mobile)}`}
              >
                {contact.mobile}
              </a>
            ) : null}
            {contact.email ? (
              <a
                className="w-fit text-sm break-all text-primary underline"
                href={`mailto:${contact.email}`}
              >
                {contact.email}
              </a>
            ) : null}
          </>
        ) : (
          <span>—</span>
        )}
      </dd>
    </div>
  );
}

async function ClientWorkOverview({
  client,
  permissions,
}: Readonly<{ client: Client; permissions: PermissionGrants }>) {
  const [t, locale, api, header] = await Promise.all([
    getTranslations(),
    getLocale(),
    getApiClient(),
    getTenantHeader(),
  ]);
  const get = api.GET;
  const tenantId = header['X-Tenant-Id'];
  const canReadAgreements = hasClientPermission(
    permissions,
    'service_agreement.read',
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
  const now = currentDateTime();
  const visitUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const [agreementsResult, visitsResult, communicationsResult] = await Promise.all([
    canReadAgreements
      ? get('/api/v1/clients/{clientId}/service-agreements', {
          params: {
            path: { clientId: client.id },
            query: {
              status: 'active',
              validAt: now.toISOString().slice(0, 10),
              page: 1,
              pageSize: 1,
              sortBy: 'validFrom',
              sortOrder: 'desc',
            },
            header,
          },
        })
      : Promise.resolve(null),
    canReadSchedule
      ? get('/api/v1/visits', {
          params: {
            query: {
              from: now.toISOString(),
              until: visitUntil.toISOString(),
              clientId: client.id,
              page: 1,
              pageSize: 10,
              sortBy: 'plannedStart',
              sortOrder: 'asc',
            },
            header,
          },
        })
      : Promise.resolve(null),
    canReadCommunications
      ? get('/api/v1/communications/clients/{clientId}/summary', {
          params: { path: { clientId: client.id }, header },
        })
      : Promise.resolve(null),
  ]);
  const agreement = agreementsResult?.data?.items?.[0];
  const visit = visitsResult?.data?.items?.find((item) => item.status !== 'cancelled');
  const communications = communicationsResult?.data;
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
  const canReadOperations = hasClientPermission(
    permissions,
    'operations.read',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const canCreateAgreement =
    client.status !== 'archived' &&
    hasClientPermission(
      permissions,
      'service_agreement.create',
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
    );
  const canScheduleVisit = hasClientPermission(
    permissions,
    'schedule.update',
    tenantId,
    client.organizationId,
    client.primaryFacilityId,
  );
  const communicationsError = Boolean(communicationsResult?.error);

  return (
    <article className="grid min-w-0 content-start gap-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="grid gap-3">
        {canReadAgreements ? (
          <div className="grid min-w-0 gap-1">
            <h3 className="text-sm text-muted-foreground">{t('Clients.detail.activeAgreement')}</h3>
            {agreement ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Link
                  className="font-semibold break-words text-primary underline underline-offset-2"
                  href={`/clients/${client.id}/service-agreements`}
                >
                  {agreement.description?.trim() ||
                    agreement.reference ||
                    t('ServiceAgreements.title')}
                </Link>
                <StatusBadge status="active" label={t('Common.status.active')} />
                <span className="text-sm text-muted-foreground">
                  {t('Clients.detail.validFrom')} {formatDate(agreement.validFrom, locale) ?? '—'}
                  {agreement.validUntil
                    ? ` · ${t('Clients.detail.validUntil')} ${formatDate(agreement.validUntil, locale) ?? '—'}`
                    : ''}
                </span>
              </div>
            ) : agreementsResult?.error ? (
              <p role="alert" className="text-sm text-destructive">
                {t('Clients.detail.overviewUnavailable')}
              </p>
            ) : (
              <p className="text-sm">{t('Clients.detail.noActiveAgreement')}</p>
            )}
          </div>
        ) : null}

        {canReadSchedule ? (
          <div className="grid min-w-0 gap-1">
            <h3 className="text-sm text-muted-foreground">{t('Clients.detail.upcomingVisits')}</h3>
            {visit ? (
              <Link
                className="grid min-w-0 gap-0.5 rounded-md border p-3 hover:border-primary/40"
                href={
                  hasClientPermission(
                    permissions,
                    'schedule.read',
                    tenantId,
                    visit.organizationId,
                    visit.facilityId,
                  )
                    ? `/visits/${visit.id}`
                    : '#visits'
                }
              >
                <time className="font-medium" dateTime={visit.plannedStart}>
                  {formatVisitDateTime(visit.plannedStart, visit.timezone, locale)}
                </time>
                <span className="text-sm break-words">
                  {visit.services.map((service) => service.serviceName).join(' · ')}
                </span>
                <span className="text-sm break-words text-muted-foreground">
                  {visit.assignments.length
                    ? visit.assignments
                        .map((assignment) => assignment.employeeDisplayName)
                        .join(', ')
                    : t('Clients.detail.unassigned')}
                </span>
              </Link>
            ) : visitsResult?.error ? (
              <p role="alert" className="text-sm text-destructive">
                {t('Clients.detail.visitsUnavailable')}
              </p>
            ) : (
              <p className="text-sm">{t('Clients.detail.noUpcomingVisits')}</p>
            )}
          </div>
        ) : null}

        {canReadCommunications ? (
          <div className="grid min-w-0 gap-1">
            <h3 className="text-sm text-muted-foreground">
              {t('Clients.detail.communicationsSummary')}
            </h3>
            {communicationsError ? (
              <p role="alert" className="text-sm text-destructive">
                {t('Clients.detail.overviewUnavailable')}
              </p>
            ) : canReadOperations ? (
              communications?.openFollowUps.length ? (
                <ul className="grid gap-1">
                  {communications.openFollowUps.slice(0, 3).map((task) => (
                    <li key={task.id}>
                      <Link
                        className="text-sm text-primary underline"
                        href={`/operations/tasks/${task.id}`}
                      >
                        {task.title}
                      </Link>
                      {task.dueAt ? (
                        <span className="text-sm text-muted-foreground">
                          {' · '}
                          {formatDateTime(task.dueAt, locale)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm">{t('Clients.detail.noOpenFollowUps')}</p>
              )
            ) : communications?.mostRecentInteraction ? (
              <p className="text-sm">
                {t('Clients.detail.lastInteraction', {
                  lastContact:
                    formatDateTime(communications.mostRecentInteraction.occurredAt, locale) ?? '—',
                })}
              </p>
            ) : (
              <p className="text-sm">{t('Clients.detail.noInteractions')}</p>
            )}
          </div>
        ) : null}
      </div>

      <nav
        aria-label={t('Clients.detail.relatedResources')}
        className="flex flex-wrap gap-2 border-t pt-3"
      >
        {canReadAgreements ? (
          <OverviewLink href={`/clients/${client.id}/service-agreements`}>
            {canCreateAgreement
              ? t('ServiceAgreements.createTitle')
              : t('Clients.detail.servicePlanningTab')}
          </OverviewLink>
        ) : null}
        {canScheduleVisit ? (
          <OverviewLink href={`/planning?clientId=${encodeURIComponent(client.id)}`}>
            {t('Planning.createVisit')}
          </OverviewLink>
        ) : null}
        {canReadBenefits ? (
          <OverviewLink href={`/clients/${client.id}/benefits`}>
            {t('Clients.detail.benefitsTab')}
          </OverviewLink>
        ) : null}
        {canReadBilling ? (
          <OverviewLink href={`/clients/${client.id}/invoices`}>
            {t('Clients.detail.invoicesTab')}
          </OverviewLink>
        ) : null}
        {canReadDocuments ? (
          <OverviewLink href="#documents">{t('Documents.title')}</OverviewLink>
        ) : null}
        {canReadCommunications ? (
          <OverviewLink href={`/clients/${client.id}/communications`}>
            {t('Clients.detail.communicationsTab')}
          </OverviewLink>
        ) : null}
        {canReadOperations ? (
          <OverviewLink href={`/operations/deadlines?clientId=${encodeURIComponent(client.id)}`}>
            {t('Operations.clientDeadlines')}
          </OverviewLink>
        ) : null}
        {hasClientPermission(
          permissions,
          'client.update',
          tenantId,
          client.organizationId,
          client.primaryFacilityId,
        ) ? (
          <OverviewLink href="#contacts">{t('Clients.detail.addContact')}</OverviewLink>
        ) : null}
      </nav>
    </article>
  );
}

function OverviewLink({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Link
      className="inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-medium hover:border-primary/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      href={href}
    >
      {children}
    </Link>
  );
}

function OverviewCardSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className="grid gap-3 rounded-lg border bg-card p-5"
    >
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
  );
}

function formatAddress(address: Address): string {
  return [
    `${address.street}${address.houseNumber ? ` ${address.houseNumber}` : ''}`,
    [address.postalCode, address.city].filter(Boolean).join(' '),
    address.countryCode,
  ]
    .filter(Boolean)
    .join(', ');
}

function currentDateTime(): Date {
  return new Date();
}
