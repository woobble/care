import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { ActionNotice } from '../../administration/action-notice';
import {
  archiveServiceAction,
  setServiceAvailabilityAction,
  updateServiceAction,
} from '../actions';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasTenantPermission,
} from '../../../../lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unitLabels: Record<'occurrence' | 'minute' | 'hour' | 'day', string> = {
  occurrence: 'Einsatz',
  minute: 'Minute',
  hour: 'Stunde',
  day: 'Tag',
};

export default async function ServiceDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; updated?: string }>;
}>) {
  const { id } = await params;
  if (!uuidPattern.test(id)) notFound();
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const canUpdate = hasTenantPermission(permissions, 'service.update', tenantId);
  const canArchive = hasTenantPermission(permissions, 'service.archive', tenantId);
  const canManageAvailability = hasTenantPermission(
    permissions,
    'service.manage_availability',
    tenantId,
  );
  const get = api.GET;
  const [
    serviceResult,
    categoriesResult,
    availabilityResult,
    organizationsResult,
    facilitiesResult,
  ] = await Promise.all([
    get('/api/v1/services/{id}', { params: { path: { id }, header } }),
    get('/api/v1/service-categories', { params: { query: { includeArchived: true }, header } }),
    get('/api/v1/services/{id}/availability', { params: { path: { id }, header } }),
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', { params: { header } }),
  ]);
  if (serviceResult.error || !serviceResult.data) notFound();
  const service = serviceResult.data;
  const categories = categoriesResult.data ?? [];
  const availability = availabilityResult.data ?? [];
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const activeAvailability = availability.filter((item) => item.active);
  const selectedOrganizations = new Set(
    activeAvailability
      .filter((item) => item.facilityId === null)
      .map((item) => item.organizationId),
  );
  const selectedFacilities = new Set(
    activeAvailability.flatMap((item) => (item.facilityId ? [item.facilityId] : [])),
  );

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href="/services">Leistungskatalog</Link>
          </p>
          <h1 className="text-3xl font-semibold">{service.name}</h1>
          <p className="font-mono text-sm text-slate-600">{service.code}</p>
        </div>
        <StatusBadge status={service.status} />
      </header>

      <ActionNotice error={query.error} updated={query.updated} />
      {categoriesResult.error || organizationsResult.error || facilitiesResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Kategorien oder Verfügbarkeit konnten nicht vollständig geladen werden.
        </p>
      ) : null}

      <section className="grid gap-5 rounded-lg border bg-white p-5 shadow-sm">
        {canUpdate ? (
          <form action={updateServiceAction} className="grid gap-5">
            <input type="hidden" name="id" value={service.id} />
            <h2 className="text-xl font-semibold">Leistungsdefinition</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                id="code"
                name="code"
                label="Code"
                defaultValue={service.code}
                required
                maxLength={64}
              />
              <Field
                id="name"
                name="name"
                label="Name"
                defaultValue={service.name}
                required
                maxLength={160}
              />
              <SelectField
                id="categoryId"
                name="categoryId"
                label="Kategorie"
                defaultValue={service.categoryId}
                required
              >
                {categories.map((category) => (
                  <option
                    key={category.id}
                    value={category.id}
                    disabled={category.status === 'archived' && category.id !== service.categoryId}
                  >
                    {category.name}
                    {category.status === 'archived' ? ' (archiviert)' : ''}
                  </option>
                ))}
              </SelectField>
              <SelectField
                id="unit"
                name="unit"
                label="Einheit"
                defaultValue={service.unit}
                required
              >
                <option value="occurrence">Einsatz</option>
                <option value="minute">Minute</option>
                <option value="hour">Stunde</option>
                <option value="day">Tag</option>
              </SelectField>
              <Field
                id="defaultDurationMinutes"
                name="defaultDurationMinutes"
                label="Standarddauer in Minuten (optional)"
                type="number"
                min={1}
                max={1440}
                defaultValue={service.defaultDurationMinutes?.toString() ?? ''}
              />
              <Field
                id="validFrom"
                name="validFrom"
                label="Gültig ab"
                type="date"
                defaultValue={service.validFrom}
                required
              />
              <Field
                id="validUntil"
                name="validUntil"
                label="Gültig bis (optional)"
                type="date"
                defaultValue={service.validUntil ?? ''}
              />
              <label className="grid gap-2 md:col-span-2">
                <Label htmlFor="description">Beschreibung (optional)</Label>
                <textarea
                  id="description"
                  name="description"
                  className="min-h-24 rounded-md border px-3 py-2"
                  maxLength={2000}
                  defaultValue={service.description ?? ''}
                />
              </label>
            </div>
            <Button type="submit">Änderungen speichern</Button>
          </form>
        ) : (
          <div className="grid gap-3">
            <h2 className="text-xl font-semibold">Leistungsdefinition</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <ReadOnlyField label="Name" value={service.name} />
              <ReadOnlyField
                label="Kategorie"
                value={
                  categories.find((category) => category.id === service.categoryId)?.name ?? '—'
                }
              />
              <ReadOnlyField label="Einheit" value={unitLabels[service.unit]} />
              <ReadOnlyField
                label="Standarddauer"
                value={
                  service.defaultDurationMinutes ? `${service.defaultDurationMinutes} Minuten` : '—'
                }
              />
              <ReadOnlyField
                label="Gültigkeit"
                value={`${service.validFrom} – ${service.validUntil ?? 'offen'}`}
              />
              <ReadOnlyField label="Beschreibung" value={service.description ?? '—'} />
            </dl>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {canArchive && service.status === 'active' ? (
            <form action={archiveServiceAction}>
              <input type="hidden" name="id" value={service.id} />
              <Button type="submit" variant="secondary">
                Leistung archivieren
              </Button>
            </form>
          ) : null}
          <span className="text-sm text-slate-600">
            Archivierte Leistungen bleiben historisch abrufbar.
          </span>
        </div>
      </section>

      <section
        aria-labelledby="availability-title"
        className="grid gap-4 rounded-lg border bg-white p-5 shadow-sm"
      >
        <div>
          <h2 id="availability-title" className="text-xl font-semibold">
            Organisatorische Verfügbarkeit
          </h2>
          <p className="text-sm text-slate-600">
            Wählen Sie ganze Organisationen oder einzelne Einrichtungen aus.
          </p>
        </div>
        {availabilityResult.error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
            Verfügbarkeit konnte nicht geladen werden ({availabilityResult.error.code}).
          </p>
        ) : null}
        {canManageAvailability ? (
          <form action={setServiceAvailabilityAction} className="grid gap-4">
            <input type="hidden" name="id" value={service.id} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                id="availabilityValidFrom"
                name="validFrom"
                label="Gültig ab (optional)"
                type="date"
              />
              <Field
                id="availabilityValidUntil"
                name="validUntil"
                label="Gültig bis (optional)"
                type="date"
              />
            </div>
            <fieldset className="grid gap-3">
              <legend className="font-medium">Organisationen</legend>
              {organizations.length ? (
                organizations.map((organization) => (
                  <label key={organization.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="organizationIds"
                      value={organization.id}
                      defaultChecked={selectedOrganizations.has(organization.id)}
                    />
                    {organization.name}
                  </label>
                ))
              ) : (
                <p className="text-sm text-slate-600">Keine Organisationen verfügbar.</p>
              )}
            </fieldset>
            <fieldset className="grid gap-3">
              <legend className="font-medium">Einrichtungen</legend>
              {facilities.length ? (
                facilities.map((facility) => (
                  <label key={facility.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="facilityIds"
                      value={facility.id}
                      defaultChecked={selectedFacilities.has(facility.id)}
                    />
                    {facility.organizationName} — {facility.name}
                  </label>
                ))
              ) : (
                <p className="text-sm text-slate-600">Keine Einrichtungen verfügbar.</p>
              )}
            </fieldset>
            <div>
              <Button type="submit" disabled={service.status === 'archived'}>
                Verfügbarkeit speichern
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-slate-600">
            Sie haben Leseberechtigung für diese Verfügbarkeit.
          </p>
        )}
        {activeAvailability.length ? (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Aktuelle Verfügbarkeitszuordnungen</caption>
              <thead className="border-b bg-slate-100">
                <tr>
                  <th className="px-3 py-2">Bereich</th>
                  <th className="px-3 py-2">Gültig ab</th>
                  <th className="px-3 py-2">Gültig bis</th>
                </tr>
              </thead>
              <tbody>
                {activeAvailability.map((item) => {
                  const facility = facilities.find((candidate) => candidate.id === item.facilityId);
                  const organization = organizations.find(
                    (candidate) => candidate.id === item.organizationId,
                  );
                  return (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        {item.facilityId
                          ? (facility?.name ?? 'Einrichtung')
                          : (organization?.name ?? 'Organisation')}
                        {item.facilityId
                          ? ` (${organization?.name ?? ''})`
                          : ' — alle Einrichtungen'}
                      </td>
                      <td className="px-3 py-2">{item.validFrom ?? '—'}</td>
                      <td className="px-3 py-2">{item.validUntil ?? 'offen'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Noch keine Verfügbarkeit definiert.</p>
        )}
      </section>
    </div>
  );
}

function Field({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  maxLength,
  required = false,
  min,
  max,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  maxLength?: number;
  required?: boolean;
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
        maxLength={maxLength}
        required={required}
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
  defaultValue,
  required = false,
  children,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  defaultValue: string;
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
        defaultValue={defaultValue}
        required={required}
      >
        {children}
      </select>
    </div>
  );
}

function ReadOnlyField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
