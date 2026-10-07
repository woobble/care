import Link from 'next/link';
import { Button, StatusBadge } from '@care/ui';
import { ActionNotice } from '../administration/action-notice';
import {
  archiveServiceCategoryAction,
  createServiceCategoryAction,
  updateServiceCategoryAction,
} from './actions';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasTenantPermission,
} from '../../../lib/api';

type SearchParams = Promise<{
  q?: string;
  status?: string;
  categoryId?: string;
  organizationId?: string;
  facilityId?: string;
  validAt?: string;
  page?: string;
  error?: string;
  updated?: string;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const units: Record<string, string> = {
  occurrence: 'Einsatz',
  minute: 'Minute',
  hour: 'Stunde',
  day: 'Tag',
};

export default async function ServicesPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const q = query.q?.trim().slice(0, 120) || undefined;
  const status = query.status === 'archived' ? 'archived' : 'active';
  const categoryId = validUuid(query.categoryId);
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const validAt = query.validAt && datePattern.test(query.validAt) ? query.validAt : today();
  const pageNumber = Number(query.page);
  const page = Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;

  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const canCreateService = hasTenantPermission(permissions, 'service.create', tenantId);
  const canManageCategories = hasTenantPermission(
    permissions,
    'service.manage_categories',
    tenantId,
  );
  const get = api.GET;
  const [servicesResult, categoriesResult, organizationsResult, facilitiesResult] =
    await Promise.all([
      get('/api/v1/services', {
        params: {
          query: {
            page,
            pageSize: 25,
            status,
            validAt,
            ...(q ? { q } : {}),
            ...(categoryId ? { categoryId } : {}),
            ...(organizationId ? { organizationId } : {}),
            ...(facilityId ? { facilityId } : {}),
          },
          header,
        },
      }),
      get('/api/v1/service-categories', { params: { query: { includeArchived: true }, header } }),
      get('/api/v1/organizations', { params: { header } }),
      get('/api/v1/facilities', { params: { header } }),
    ]);
  const services = servicesResult.data;
  const categories = categoriesResult.data ?? [];
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const filters = { q, status, categoryId, organizationId, facilityId, validAt };

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">Office</p>
          <h1 className="text-3xl font-semibold">Leistungskatalog</h1>
          <p className="max-w-2xl text-slate-700">
            Leistungen und ihre organisatorische Verfügbarkeit verwalten. Preise und Abrechnung sind
            hier nicht hinterlegt.
          </p>
        </div>
        {canCreateService ? (
          <Button asChild>
            <Link href="/services/new">Leistung anlegen</Link>
          </Button>
        ) : null}
      </header>

      <ActionNotice error={query.error} updated={query.updated} />
      {servicesResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Leistungen konnten nicht geladen werden ({servicesResult.error.code}).
        </p>
      ) : null}

      <section aria-labelledby="service-search-title" className="grid gap-3">
        <h2 id="service-search-title" className="text-lg font-semibold">
          Suche und Filter
        </h2>
        <form
          method="get"
          className="grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-3 lg:grid-cols-4"
        >
          <Field label="Name oder Code" name="q" defaultValue={q ?? ''} maxLength={120} />
          <SelectField label="Status" name="status" defaultValue={status}>
            <option value="active">Aktiv</option>
            <option value="archived">Archiviert</option>
          </SelectField>
          <SelectField label="Kategorie" name="categoryId" defaultValue={categoryId ?? ''}>
            <option value="">Alle Kategorien</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Organisation"
            name="organizationId"
            defaultValue={organizationId ?? ''}
          >
            <option value="">Alle Organisationen</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Einrichtung" name="facilityId" defaultValue={facilityId ?? ''}>
            <option value="">Alle Einrichtungen</option>
            {facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.organizationName} — {facility.name}
              </option>
            ))}
          </SelectField>
          <Field label="Gültig am" name="validAt" type="date" defaultValue={validAt} />
          <div className="flex items-end gap-2">
            <Button type="submit">Anwenden</Button>
            <Button asChild variant="secondary">
              <Link href="/services">Zurücksetzen</Link>
            </Button>
          </div>
        </form>
      </section>

      {services?.items.length ? (
        <section aria-labelledby="service-list-title" className="grid gap-3">
          <h2 id="service-list-title" className="text-lg font-semibold">
            {services.total} Leistungen
          </h2>
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Leistungskatalog</caption>
              <thead className="border-b bg-slate-100 text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Code
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Kategorie
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Einheit
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Dauer
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Verfügbarkeit
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Gültigkeit
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {services.items.map((service) => (
                  <tr key={service.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{service.code}</td>
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium text-blue-900 underline-offset-4 hover:underline"
                        href={`/services/${service.id}`}
                      >
                        {service.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{service.categoryName}</td>
                    <td className="px-4 py-3">{units[service.unit]}</td>
                    <td className="px-4 py-3">
                      {service.defaultDurationMinutes
                        ? `${service.defaultDurationMinutes} Min.`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">{service.availabilityCount}</td>
                    <td className="px-4 py-3">
                      {service.validFrom} – {service.validUntil ?? 'offen'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={service.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Seite {services.page} von {Math.max(1, Math.ceil(services.total / services.pageSize))}
            </p>
            <div className="flex gap-2">
              {services.page > 1 ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, services.page - 1)}>Zurück</Link>
                </Button>
              ) : null}
              {services.page * services.pageSize < services.total ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, services.page + 1)}>Weiter</Link>
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : !servicesResult.error ? (
        <p className="rounded-lg border bg-white p-6 text-slate-700">
          Keine Leistungen für diese Suche gefunden.
        </p>
      ) : null}

      <section
        aria-labelledby="service-categories-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="service-categories-title" className="text-xl font-semibold">
            Kategorien
          </h2>
          <p className="text-sm text-slate-600">
            Kategorien ordnen den Leistungskatalog und können archiviert werden.
          </p>
        </div>
        {canManageCategories ? (
          <form
            action={createServiceCategoryAction}
            className="grid gap-3 rounded-md bg-slate-50 p-4 md:grid-cols-4"
          >
            <Field label="Name" name="name" required maxLength={120} />
            <Field label="Code (optional)" name="code" maxLength={40} />
            <Field
              label="Sortierung (optional)"
              name="sortOrder"
              type="number"
              min={0}
              max={10000}
            />
            <Field label="Beschreibung (optional)" name="description" maxLength={1000} />
            <div className="md:col-span-4">
              <Button type="submit">Kategorie anlegen</Button>
            </div>
          </form>
        ) : null}
        {categories.length ? (
          <ul className="grid gap-3">
            {categories.map((category) => (
              <li key={category.id} className="grid gap-3 rounded-md border p-4">
                {canManageCategories ? (
                  <>
                    <form
                      action={updateServiceCategoryAction}
                      className="grid gap-3 md:grid-cols-4"
                    >
                      <input type="hidden" name="categoryId" value={category.id} />
                      <Field
                        label="Name"
                        name="name"
                        defaultValue={category.name}
                        required
                        maxLength={120}
                      />
                      <Field
                        label="Code"
                        name="code"
                        defaultValue={category.code ?? ''}
                        maxLength={40}
                      />
                      <Field
                        label="Sortierung"
                        name="sortOrder"
                        type="number"
                        min={0}
                        max={10000}
                        defaultValue={category.sortOrder?.toString() ?? ''}
                      />
                      <Field
                        label="Beschreibung"
                        name="description"
                        defaultValue={category.description ?? ''}
                        maxLength={1000}
                      />
                      <div className="flex items-center gap-3 md:col-span-4">
                        <StatusBadge status={category.status} />
                        <Button type="submit" size="sm" variant="secondary">
                          Kategorie speichern
                        </Button>
                      </div>
                    </form>
                    {category.status === 'active' ? (
                      <form action={archiveServiceCategoryAction}>
                        <input type="hidden" name="categoryId" value={category.id} />
                        <Button type="submit" size="sm" variant="link">
                          Kategorie archivieren
                        </Button>
                      </form>
                    ) : null}
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{category.name}</h3>
                      {category.description ? (
                        <p className="text-sm text-slate-600">{category.description}</p>
                      ) : null}
                    </div>
                    <StatusBadge status={category.status} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : categoriesResult.error ? (
          <p role="alert" className="text-sm text-red-800">
            Kategorien konnten nicht geladen werden ({categoriesResult.error.code}).
          </p>
        ) : (
          <p className="text-sm text-slate-600">Noch keine Kategorien angelegt.</p>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  maxLength,
  required,
  min,
  max,
}: Readonly<{
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  maxLength?: number;
  required?: boolean;
  min?: number;
  max?: number;
}>) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input
        className="h-10 rounded-md border bg-white px-3 font-normal"
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={maxLength}
        required={required}
        min={min}
        max={max}
      />
    </label>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  children,
}: Readonly<{ label: string; name: string; defaultValue: string; children: React.ReactNode }>) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <select
        className="h-10 rounded-md border bg-white px-3 font-normal"
        name={name}
        defaultValue={defaultValue}
      >
        {children}
      </select>
    </label>
  );
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function pageHref(filters: Record<string, string | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page: String(page) })) {
    if (value) params.set(key, value);
  }
  return `/services?${params.toString()}`;
}
