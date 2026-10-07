import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button, Input, Label } from '@care/ui';
import { ConfirmSubmitButton } from '../../../administration/confirm-submit-button';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '../../../../../lib/api';
import {
  addAgreementServiceAction,
  changeServiceAgreementStatusAction,
  createServiceAgreementAction,
  endAgreementServiceAction,
  updateAgreementServiceAction,
  updateServiceAgreementAction,
} from './actions';

type SearchParams = Promise<{
  error?: string;
  findServicesFor?: string;
  serviceValidFrom?: string;
  serviceValidUntil?: string;
}>;

const unitLabels = {
  occurrence: 'Einsatz',
  minute: 'Minute',
  hour: 'Stunde',
  day: 'Tag',
} as const;

const weekdayLabels = {
  monday: 'Montag',
  tuesday: 'Dienstag',
  wednesday: 'Mittwoch',
  thursday: 'Donnerstag',
  friday: 'Freitag',
  saturday: 'Samstag',
  sunday: 'Sonntag',
} as const;

export default async function ClientServiceAgreementsPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ id: string }>; searchParams: SearchParams }>) {
  const { id: clientId } = await params;
  const query = await searchParams;
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const [clientResult, agreementsResult, organizationsResult, facilitiesResult, timelineResult] =
    await Promise.all([
      get('/api/v1/clients/{id}', { params: { path: { id: clientId }, header } }),
      get('/api/v1/clients/{clientId}/service-agreements', {
        params: { path: { clientId }, query: { page: 1, pageSize: 50 }, header },
      }),
      get('/api/v1/organizations', { params: { header } }),
      get('/api/v1/facilities', { params: { header } }),
      get('/api/v1/clients/{clientId}/timeline', { params: { path: { clientId }, header } }),
    ]);
  if (clientResult.error?.code === 'CLIENT_NOT_FOUND') notFound();
  const client = clientResult.data;
  if (!client) {
    return (
      <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
        Klient konnte nicht geladen werden.
      </p>
    );
  }

  const agreements = agreementsResult.data?.items ?? [];
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const timeline = (timelineResult.data ?? []).filter((entry) =>
    entry.action.startsWith('service_agreement.'),
  );
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const canCreate =
    client.status !== 'archived' &&
    client.organizationId !== null &&
    client.primaryFacilityId !== null &&
    hasClientPermission(
      permissions,
      'service_agreement.create',
      tenantId,
      client.organizationId,
      client.primaryFacilityId,
    );
  const organizationName = organizations.find((item) => item.id === client.organizationId)?.name;
  const facilityName = facilities.find((item) => item.id === client.primaryFacilityId)?.name;
  const selectedAgreement = agreements.find((item) => item.id === query.findServicesFor);
  const selectedProviderCanManage = selectedAgreement
    ? client.status !== 'archived' &&
      hasClientPermission(
        permissions,
        'service_agreement.manage_services',
        tenantId,
        selectedAgreement.organizationId,
        selectedAgreement.facilityId,
      ) &&
      hasClientPermission(
        permissions,
        'service.read',
        tenantId,
        selectedAgreement.organizationId,
        selectedAgreement.facilityId,
      )
    : false;
  const selectedServiceFrom = selectedAgreement
    ? validLineDate(query.serviceValidFrom, selectedAgreement.validFrom)
    : undefined;
  const selectedServiceUntil = selectedAgreement
    ? validLineEnd(query.serviceValidUntil, selectedAgreement.validUntil ?? null)
    : undefined;
  const servicePeriodValid =
    selectedAgreement !== undefined &&
    selectedServiceFrom !== undefined &&
    selectedServiceUntil !== undefined &&
    selectedServiceFrom >= selectedAgreement.validFrom &&
    (selectedAgreement.validUntil == null ||
      (selectedServiceUntil !== null && selectedServiceUntil <= selectedAgreement.validUntil)) &&
    (selectedServiceUntil === null || selectedServiceUntil >= selectedServiceFrom);
  const serviceOptionsResult =
    selectedAgreement && selectedProviderCanManage && servicePeriodValid
      ? await get('/api/v1/services', {
          params: {
            query: {
              status: 'active',
              organizationId: selectedAgreement.organizationId,
              facilityId: selectedAgreement.facilityId,
              validFrom: selectedServiceFrom,
              ...(selectedServiceUntil === null ? {} : { validUntil: selectedServiceUntil }),
              page: 1,
              pageSize: 100,
            },
            header,
          },
        })
      : undefined;
  const serviceOptions = serviceOptionsResult?.data?.items ?? [];
  const error = query.error ?? agreementsResult.error?.code;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href={`/clients/${client.id}`}>Klientendetails</Link>
          </p>
          <h1 className="text-3xl font-semibold">Leistungsplanung</h1>
          <p className="text-slate-700">
            {client.preferredName || client.firstName} {client.lastName}
          </p>
        </div>
        <Button asChild variant="secondary">
          <Link href={`/clients/${client.id}`}>Zurück zum Klienten</Link>
        </Button>
      </header>

      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Änderung konnte nicht gespeichert werden ({error}). Prüfen Sie Eingaben und Berechtigung.
        </p>
      ) : null}

      <nav
        aria-label="Leistungsplanung Bereiche"
        className="flex flex-wrap gap-2 border-b pb-3 text-sm"
      >
        <a className="rounded-md px-3 py-2 text-blue-900 hover:bg-blue-50" href="#agreements">
          Vereinbarungen
        </a>
        <a className="rounded-md px-3 py-2 text-blue-900 hover:bg-blue-50" href="#history">
          Verlauf
        </a>
        <Link className="rounded-md px-3 py-2 text-blue-900 hover:bg-blue-50" href="#overview">
          Klientenübersicht
        </Link>
      </nav>

      <section id="overview" aria-labelledby="overview-title" className="grid gap-3 scroll-mt-6">
        <h2 id="overview-title" className="text-xl font-semibold">
          Aktueller Versorgerkontext
        </h2>
        <dl className="grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-2">
          <Field label="Organisation" value={organizationName ?? client.organizationId} />
          <Field label="Einrichtung" value={facilityName ?? client.primaryFacilityId} />
        </dl>
      </section>

      {canCreate ? (
        <details className="rounded-lg border bg-white p-5">
          <summary className="cursor-pointer font-semibold">Leistungsplanung anlegen</summary>
          <form action={createServiceAgreementAction} className="mt-4 grid gap-4">
            <input type="hidden" name="clientId" value={client.id} />
            <div className="grid gap-4 md:grid-cols-2">
              <DateField
                id="new-agreement-from"
                name="validFrom"
                label="Gültig ab"
                defaultValue={today()}
                required
              />
              <DateField id="new-agreement-until" name="validUntil" label="Gültig bis (optional)" />
              <TextField
                id="new-agreement-reference"
                name="reference"
                label="Referenz (optional)"
                maxLength={120}
              />
              <TextAreaField
                id="new-agreement-description"
                name="description"
                label="Hinweis zur Planung (optional)"
                maxLength={2000}
              />
            </div>
            <p className="text-sm text-slate-600">
              Die Vereinbarung startet als Entwurf. Fügen Sie anschließend mindestens eine Leistung
              hinzu.
            </p>
            <Button type="submit" className="w-fit">
              Entwurf anlegen
            </Button>
          </form>
        </details>
      ) : null}

      <section
        id="agreements"
        aria-labelledby="agreements-title"
        className="grid gap-4 scroll-mt-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="agreements-title" className="text-xl font-semibold">
            Vereinbarungen
          </h2>
          <p className="text-sm text-slate-600">{agreementsResult.data?.total ?? 0} Einträge</p>
        </div>
        {agreementsResult.error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
            Leistungsplanungen konnten nicht geladen werden ({agreementsResult.error.code}).
          </p>
        ) : agreements.length ? (
          <div className="grid gap-4">
            {await Promise.all(
              agreements.map(async (agreement) => {
                const [serviceResult, providerOrganizationResult, providerFacilityResult] =
                  await Promise.all([
                    get('/api/v1/service-agreements/{id}/services', {
                      params: { path: { id: agreement.id }, header },
                    }),
                    get('/api/v1/organizations/{id}', {
                      params: { path: { id: agreement.organizationId }, header },
                    }),
                    get('/api/v1/facilities/{id}', {
                      params: { path: { id: agreement.facilityId }, header },
                    }),
                  ]);
                const services = serviceResult.data ?? [];
                const canUpdate =
                  client.status !== 'archived' &&
                  hasClientPermission(
                    permissions,
                    'service_agreement.update',
                    tenantId,
                    agreement.organizationId,
                    agreement.facilityId,
                  );
                const canManageServices =
                  client.status !== 'archived' &&
                  hasClientPermission(
                    permissions,
                    'service_agreement.manage_services',
                    tenantId,
                    agreement.organizationId,
                    agreement.facilityId,
                  );
                const canActivate =
                  client.status !== 'archived' &&
                  hasClientPermission(
                    permissions,
                    'service_agreement.activate',
                    tenantId,
                    agreement.organizationId,
                    agreement.facilityId,
                  );
                const canSuspend =
                  client.status !== 'archived' &&
                  hasClientPermission(
                    permissions,
                    'service_agreement.suspend',
                    tenantId,
                    agreement.organizationId,
                    agreement.facilityId,
                  );
                const canEnd =
                  client.status !== 'archived' &&
                  hasClientPermission(
                    permissions,
                    'service_agreement.end',
                    tenantId,
                    agreement.organizationId,
                    agreement.facilityId,
                  );
                const canSearchServices =
                  agreement.id === selectedAgreement?.id &&
                  selectedProviderCanManage &&
                  servicePeriodValid;
                return (
                  <article
                    key={agreement.id}
                    id={`agreement-${agreement.id}`}
                    className="grid gap-4 rounded-lg border bg-white p-5 shadow-sm"
                  >
                    <header className="flex flex-wrap items-start justify-between gap-3">
                      <div className="grid gap-1">
                        <h3 className="text-lg font-semibold">
                          {agreement.reference || `Vereinbarung ${agreement.id.slice(0, 8)}`}
                        </h3>
                        <p className="text-sm text-slate-600">
                          {formatDate(agreement.validFrom)} –{' '}
                          {formatDate(agreement.validUntil ?? null) ?? 'unbegrenzt'}
                        </p>
                        <p className="text-sm text-slate-600">
                          {providerOrganizationResult.data?.name ?? agreement.organizationId}
                          {' · '}
                          {providerFacilityResult.data?.name ?? agreement.facilityId}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <AgreementStatusBadge status={agreement.status} />
                        <Badge variant="outline">{services.length} Leistungen</Badge>
                      </div>
                    </header>

                    {agreement.description ? (
                      <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                        {agreement.description}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {agreement.status === 'draft' && canActivate ? (
                        <StatusAction
                          clientId={client.id}
                          agreementId={agreement.id}
                          operation="activate"
                          label="Aktivieren"
                        />
                      ) : null}
                      {agreement.status === 'active' && canSuspend ? (
                        <StatusAction
                          clientId={client.id}
                          agreementId={agreement.id}
                          operation="suspend"
                          label="Pausieren"
                        />
                      ) : null}
                      {agreement.status === 'suspended' && canActivate ? (
                        <StatusAction
                          clientId={client.id}
                          agreementId={agreement.id}
                          operation="resume"
                          label="Fortsetzen"
                        />
                      ) : null}
                      {agreement.status !== 'ended' && canEnd ? (
                        <form action={changeServiceAgreementStatusAction}>
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="agreementId" value={agreement.id} />
                          <input type="hidden" name="operation" value="end" />
                          <ConfirmSubmitButton confirmation="Die Leistungsplanung wird dauerhaft beendet.">
                            Beenden
                          </ConfirmSubmitButton>
                        </form>
                      ) : null}
                    </div>

                    {agreement.status !== 'ended' && canUpdate ? (
                      <details>
                        <summary className="cursor-pointer text-sm font-semibold text-blue-900">
                          Vereinbarung bearbeiten
                        </summary>
                        <form action={updateServiceAgreementAction} className="mt-3 grid gap-4">
                          <input type="hidden" name="clientId" value={client.id} />
                          <input type="hidden" name="agreementId" value={agreement.id} />
                          <div className="grid gap-4 md:grid-cols-2">
                            <DateField
                              id={`agreement-${agreement.id}-from`}
                              name="validFrom"
                              label="Gültig ab"
                              defaultValue={agreement.validFrom}
                              required
                            />
                            <DateField
                              id={`agreement-${agreement.id}-until`}
                              name="validUntil"
                              label="Gültig bis (optional)"
                              defaultValue={agreement.validUntil ?? ''}
                            />
                            <TextField
                              id={`agreement-${agreement.id}-reference`}
                              name="reference"
                              label="Referenz"
                              defaultValue={agreement.reference ?? ''}
                              maxLength={120}
                            />
                            <TextAreaField
                              id={`agreement-${agreement.id}-description`}
                              name="description"
                              label="Hinweis zur Planung"
                              defaultValue={agreement.description ?? ''}
                              maxLength={2000}
                            />
                          </div>
                          <Button type="submit" variant="secondary" className="w-fit">
                            Änderungen speichern
                          </Button>
                        </form>
                      </details>
                    ) : null}

                    <section aria-labelledby={`services-${agreement.id}`} className="grid gap-3">
                      <h4 id={`services-${agreement.id}`} className="font-semibold">
                        Geplante Leistungen
                      </h4>
                      {serviceResult.error ? (
                        <p role="alert" className="text-sm text-red-800">
                          Leistungen konnten nicht geladen werden ({serviceResult.error.code}).
                        </p>
                      ) : services.length ? (
                        <div className="grid gap-3">
                          {services.map((service) => (
                            <article key={service.id} className="grid gap-3 rounded-md border p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <h5 className="font-medium">{service.serviceName}</h5>
                                  <p className="text-sm text-slate-600">
                                    {service.serviceCode} · {unitLabels[service.serviceUnit]}
                                    {service.quantity
                                      ? ` · ${service.quantity} ${unitLabels[service.serviceUnit]}`
                                      : ''}
                                  </p>
                                  <p className="text-sm text-slate-600">
                                    {cadenceLabel(service.scheduleRule)}
                                    {service.preferredTimeStart && service.preferredTimeEnd
                                      ? ` · bevorzugt ${service.preferredTimeStart}–${service.preferredTimeEnd}`
                                      : ''}
                                  </p>
                                  <p className="text-sm text-slate-600">
                                    {formatDate(service.validFrom ?? agreement.validFrom)} –{' '}
                                    {formatDate(
                                      service.validUntil ?? agreement.validUntil ?? null,
                                    ) ?? 'unbegrenzt'}
                                    {' · '}
                                    {service.status === 'active' ? 'Aktiv' : 'Beendet'}
                                  </p>
                                  {service.note ? (
                                    <p className="mt-1 text-sm">{service.note}</p>
                                  ) : null}
                                </div>
                              </div>
                              {service.status === 'active' &&
                              canManageServices &&
                              agreement.status !== 'ended' ? (
                                <details>
                                  <summary className="cursor-pointer text-sm font-semibold text-blue-900">
                                    Planung bearbeiten
                                  </summary>
                                  <ServiceFields
                                    action={updateAgreementServiceAction}
                                    clientId={client.id}
                                    agreementId={agreement.id}
                                    serviceId={service.id}
                                    validFrom={service.validFrom ?? agreement.validFrom}
                                    validUntil={service.validUntil ?? agreement.validUntil ?? ''}
                                    quantity={service.quantity ?? ''}
                                    note={service.note ?? ''}
                                    scheduleRule={service.scheduleRule ?? null}
                                    preferredTimeStart={service.preferredTimeStart ?? ''}
                                    preferredTimeEnd={service.preferredTimeEnd ?? ''}
                                    idPrefix={`line-${service.id}`}
                                    submitLabel="Planung speichern"
                                  />
                                  {services.filter((item) => item.status === 'active').length >
                                  1 ? (
                                    <form action={endAgreementServiceAction} className="mt-3">
                                      <input type="hidden" name="clientId" value={client.id} />
                                      <input
                                        type="hidden"
                                        name="agreementId"
                                        value={agreement.id}
                                      />
                                      <input type="hidden" name="serviceId" value={service.id} />
                                      <ConfirmSubmitButton confirmation="Diese Leistung wird beendet und bleibt in der Historie erhalten.">
                                        Leistung beenden
                                      </ConfirmSubmitButton>
                                    </form>
                                  ) : null}
                                </details>
                              ) : null}
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                          Noch keine Leistungen hinzugefügt.
                        </p>
                      )}

                      {canManageServices && agreement.status !== 'ended' ? (
                        <div className="grid gap-3 rounded-md border border-dashed p-4">
                          <h5 className="font-medium">Leistung hinzufügen</h5>
                          <form
                            method="get"
                            action={`/clients/${client.id}/service-agreements`}
                            className="grid gap-3 md:grid-cols-3"
                          >
                            <input type="hidden" name="findServicesFor" value={agreement.id} />
                            <DateField
                              id={`search-${agreement.id}-from`}
                              name="serviceValidFrom"
                              label="Leistung gültig ab"
                              defaultValue={
                                selectedAgreement?.id === agreement.id
                                  ? selectedServiceFrom
                                  : agreement.validFrom
                              }
                              required
                            />
                            <DateField
                              id={`search-${agreement.id}-until`}
                              name="serviceValidUntil"
                              label="Leistung gültig bis"
                              defaultValue={
                                selectedAgreement?.id === agreement.id
                                  ? (selectedServiceUntil ?? '')
                                  : (agreement.validUntil ?? '')
                              }
                            />
                            <div className="flex items-end">
                              <Button type="submit" variant="secondary">
                                Verfügbare Leistungen suchen
                              </Button>
                            </div>
                          </form>
                          {canSearchServices ? (
                            serviceOptionsResult?.error ? (
                              <p role="alert" className="text-sm text-red-800">
                                Verfügbare Leistungen konnten nicht geladen werden (
                                {serviceOptionsResult.error.code}).
                              </p>
                            ) : serviceOptions.length ? (
                              <ServiceFields
                                action={addAgreementServiceAction}
                                clientId={client.id}
                                agreementId={agreement.id}
                                serviceOptions={serviceOptions}
                                validFrom={selectedServiceFrom}
                                validUntil={selectedServiceUntil ?? ''}
                                idPrefix={`add-${agreement.id}`}
                                submitLabel="Leistung hinzufügen"
                              />
                            ) : (
                              <p className="text-sm text-slate-600">
                                Für diesen Zeitraum wurden keine passenden aktiven Leistungen
                                gefunden.
                              </p>
                            )
                          ) : selectedAgreement?.id === agreement.id && !servicePeriodValid ? (
                            <p role="alert" className="text-sm text-red-800">
                              Der Leistungszeitraum muss innerhalb der Vereinbarung liegen.
                            </p>
                          ) : selectedAgreement?.id === agreement.id ? (
                            <p className="text-sm text-slate-600">
                              Keine Berechtigung zur Suche oder Verwaltung von Leistungen.
                            </p>
                          ) : (
                            <p className="text-sm text-slate-600">
                              Wählen Sie den Leistungszeitraum, um passende Katalogleistungen zu
                              suchen.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </section>
                  </article>
                );
              }),
            )}
          </div>
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">
            Für diesen Klienten gibt es noch keine Leistungsplanung.
          </p>
        )}
      </section>

      <section id="history" aria-labelledby="history-title" className="grid gap-3 scroll-mt-6">
        <h2 id="history-title" className="text-xl font-semibold">
          Verlauf
        </h2>
        {timeline.length ? (
          <ol className="grid gap-3 border-l-2 border-blue-200 pl-5">
            {timeline.map((entry) => (
              <li key={entry.id} className="rounded-lg border bg-white p-4">
                <p className="font-medium">{entry.summary}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {formatDateTime(entry.occurredAt)} · Bearbeitet von {entry.actorId}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-lg border bg-white p-5 text-slate-700">
            Noch keine Einträge zur Leistungsplanung.
          </p>
        )}
        <p className="text-sm">
          <Link className="text-blue-900 underline" href={`/clients/${client.id}#timeline`}>
            Gesamten Klientenverlauf öffnen
          </Link>
        </p>
      </section>
    </div>
  );
}

function ServiceFields({
  action,
  clientId,
  agreementId,
  serviceId,
  serviceOptions,
  validFrom,
  validUntil,
  quantity,
  note,
  scheduleRule,
  preferredTimeStart,
  preferredTimeEnd,
  idPrefix,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  agreementId: string;
  serviceId?: string;
  serviceOptions?: Array<{
    id: string;
    code: string;
    name: string;
    categoryName: string;
    unit: keyof typeof unitLabels;
    defaultDurationMinutes: number | null;
  }>;
  validFrom: string | null | undefined;
  validUntil: string;
  quantity?: string;
  note?: string;
  scheduleRule?:
    | { type: 'daily' }
    | { type: 'on_demand' }
    | { type: 'weekly'; weekdays: (keyof typeof weekdayLabels)[] }
    | { type: 'occurrences_per_week'; count: number }
    | { type: 'interval_days'; intervalDays: number }
    | null;
  preferredTimeStart?: string;
  preferredTimeEnd?: string;
  idPrefix: string;
  submitLabel: string;
}) {
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="agreementId" value={agreementId} />
      {serviceId ? <input type="hidden" name="serviceId" value={serviceId} /> : null}
      {serviceOptions ? (
        <SelectField
          id={`${idPrefix}-service`}
          name="serviceDefinitionId"
          label="Leistung"
          required
        >
          <option value="">Leistung auswählen</option>
          {serviceOptions.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name} · {service.categoryName} · {unitLabels[service.unit]}
              {service.defaultDurationMinutes ? ` · ${service.defaultDurationMinutes} Min.` : ''}
            </option>
          ))}
        </SelectField>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <DateField
          id={`${idPrefix}-from`}
          name="validFrom"
          label="Leistung gültig ab"
          defaultValue={validFrom ?? ''}
        />
        <DateField
          id={`${idPrefix}-until`}
          name="validUntil"
          label="Leistung gültig bis"
          defaultValue={validUntil}
        />
        <TextField
          id={`${idPrefix}-quantity`}
          name="quantity"
          label="Menge (optional)"
          defaultValue={quantity ?? ''}
          maxLength={13}
          inputMode="decimal"
        />
        <SelectField
          id={`${idPrefix}-cadence`}
          name="cadence"
          label="Häufigkeit"
          defaultValue={scheduleRule?.type ?? 'none'}
        >
          <option value="none">Nicht festgelegt</option>
          <option value="daily">Täglich</option>
          <option value="weekly">Wochentage</option>
          <option value="occurrences_per_week">Anzahl pro Woche</option>
          <option value="interval_days">Alle N Tage</option>
          <option value="on_demand">Bei Bedarf</option>
        </SelectField>
        <TextField
          id={`${idPrefix}-count`}
          name="count"
          label="Vorgänge pro Woche (bei passender Häufigkeit)"
          type="number"
          min={1}
          max={14}
          defaultValue={
            scheduleRule?.type === 'occurrences_per_week' ? String(scheduleRule.count) : ''
          }
        />
        <TextField
          id={`${idPrefix}-interval`}
          name="intervalDays"
          label="Abstand in Tagen (bei passender Häufigkeit)"
          type="number"
          min={1}
          max={365}
          defaultValue={
            scheduleRule?.type === 'interval_days' ? String(scheduleRule.intervalDays) : ''
          }
        />
        <TimeField
          id={`${idPrefix}-preferred-start`}
          name="preferredTimeStart"
          label="Bevorzugte Zeit ab"
          defaultValue={preferredTimeStart ?? ''}
        />
        <TimeField
          id={`${idPrefix}-preferred-end`}
          name="preferredTimeEnd"
          label="Bevorzugte Zeit bis"
          defaultValue={preferredTimeEnd ?? ''}
        />
        <TextAreaField
          id={`${idPrefix}-note`}
          name="note"
          label="Operativer Hinweis (optional)"
          defaultValue={note ?? ''}
          maxLength={1000}
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Wochentage (bei passender Häufigkeit)</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {Object.entries(weekdayLabels).map(([day, label]) => (
            <label key={day} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="weekdays"
                value={day}
                defaultChecked={
                  scheduleRule?.type === 'weekly' &&
                  scheduleRule.weekdays.includes(day as keyof typeof weekdayLabels)
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" className="w-fit">
        {submitLabel}
      </Button>
    </form>
  );
}

function StatusAction({
  clientId,
  agreementId,
  operation,
  label,
}: {
  clientId: string;
  agreementId: string;
  operation: 'activate' | 'suspend' | 'resume';
  label: string;
}) {
  return (
    <form action={changeServiceAgreementStatusAction}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="agreementId" value={agreementId} />
      <input type="hidden" name="operation" value={operation} />
      <Button type="submit" variant="secondary">
        {label}
      </Button>
    </form>
  );
}

function AgreementStatusBadge({ status }: { status: 'draft' | 'active' | 'suspended' | 'ended' }) {
  const variant =
    status === 'active'
      ? 'success'
      : status === 'draft'
        ? 'warning'
        : status === 'ended'
          ? 'secondary'
          : 'outline';
  const label =
    status === 'draft'
      ? 'Entwurf'
      : status === 'active'
        ? 'Aktiv'
        : status === 'suspended'
          ? 'Pausiert'
          : 'Beendet';
  return <Badge variant={variant}>{label}</Badge>;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="break-words font-medium">{value || '—'}</dd>
    </div>
  );
}

function DateField({
  id,
  name,
  label,
  defaultValue,
  required = false,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string | undefined;
  required?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type="date" defaultValue={defaultValue} required={required} />
    </div>
  );
}

function TimeField({
  id,
  name,
  label,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type="time" defaultValue={defaultValue} />
    </div>
  );
}

function TextField({
  id,
  name,
  label,
  defaultValue,
  maxLength,
  inputMode,
  type = 'text',
  min,
  max,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  maxLength?: number;
  inputMode?: 'decimal' | 'numeric';
  type?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={maxLength}
        inputMode={inputMode}
        min={min}
        max={max}
      />
    </div>
  );
}

function TextAreaField({
  id,
  name,
  label,
  defaultValue,
  maxLength,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  maxLength?: number;
}) {
  return (
    <div className="grid gap-2 md:col-span-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        name={name}
        defaultValue={defaultValue}
        maxLength={maxLength}
        className="min-h-20 rounded-md border px-3 py-2"
      />
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  defaultValue,
  required = false,
  children,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="h-10 rounded-md border bg-white px-3"
      >
        {children}
      </select>
    </div>
  );
}

function cadenceLabel(
  rule:
    | { type: 'daily' }
    | { type: 'on_demand' }
    | { type: 'weekly'; weekdays: (keyof typeof weekdayLabels)[] }
    | { type: 'occurrences_per_week'; count: number }
    | { type: 'interval_days'; intervalDays: number }
    | null
    | undefined,
): string {
  if (!rule) return 'Häufigkeit nicht festgelegt';
  if (rule.type === 'daily') return 'Täglich';
  if (rule.type === 'on_demand') return 'Bei Bedarf';
  if (rule.type === 'occurrences_per_week') return `${rule.count}× pro Woche`;
  if (rule.type === 'interval_days') return `Alle ${rule.intervalDays} Tage`;
  return `Wöchentlich: ${rule.weekdays.map((day) => weekdayLabels[day]).join(', ')}`;
}

function validLineDate(value: string | undefined, fallback: string): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function validLineEnd(
  value: string | undefined,
  fallback: string | null,
): string | null | undefined {
  if (value === undefined) return fallback;
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
