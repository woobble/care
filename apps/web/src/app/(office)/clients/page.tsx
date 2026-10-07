import Link from 'next/link';
import { Button, StatusBadge } from '@care/ui';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '../../../lib/api';

type SearchParams = Promise<{
  q?: string;
  status?: string;
  organizationId?: string;
  facilityId?: string;
  pflegegrad?: string;
  page?: string;
  sortBy?: string;
  sortOrder?: string;
  error?: string;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ClientsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const status = ['pending', 'active', 'archived'].includes(query.status ?? '')
    ? (query.status as 'pending' | 'active' | 'archived')
    : undefined;
  const organizationId = validUuid(query.organizationId);
  const facilityId = validUuid(query.facilityId);
  const parsedGrade = Number(query.pflegegrad);
  const pflegegrad =
    Number.isInteger(parsedGrade) && parsedGrade >= 1 && parsedGrade <= 5 ? parsedGrade : undefined;
  const sortBy = ['lastName', 'firstName', 'createdAt', 'dateOfBirth'].includes(query.sortBy ?? '')
    ? (query.sortBy as 'lastName' | 'firstName' | 'createdAt' | 'dateOfBirth')
    : 'lastName';
  const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';
  const parsedPage = Number(query.page ?? '1');
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const text = query.q?.trim().slice(0, 120) || undefined;

  const api = await getApiClient();
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  const canCreateClient = hasPermission(permissions, 'client.create');
  const get = api.GET;
  const [clientsResult, organizationsResult, facilitiesResult] = await Promise.all([
    get('/api/v1/clients', {
      params: {
        query: {
          page,
          pageSize: 25,
          sortBy,
          sortOrder,
          ...(text ? { q: text } : {}),
          ...(status ? { status } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(facilityId ? { facilityId } : {}),
          ...(pflegegrad ? { pflegegrad } : {}),
        },
        header,
      },
    }),
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', { params: { header } }),
  ]);
  const clients = clientsResult.data;
  const filters = { q: text, status, organizationId, facilityId, pflegegrad, sortBy, sortOrder };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">Office</p>
          <h1 className="text-3xl font-semibold">Klientinnen und Klienten</h1>
        </div>
        {canCreateClient ? (
          <Button asChild>
            <Link href="/clients/new">Klient anlegen</Link>
          </Button>
        ) : null}
      </div>
      {query.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Aktion fehlgeschlagen. Bitte prüfen Sie die Zuordnung und Eingaben.
        </p>
      ) : null}
      {clientsResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Klienten konnten nicht geladen werden ({clientsResult.error.code}).
        </p>
      ) : null}

      <section aria-labelledby="client-filter-title" className="grid gap-3">
        <h2 id="client-filter-title" className="text-lg font-semibold">
          Suche und Filter
        </h2>
        <form method="get" className="grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-4">
          <label className="grid gap-1 text-sm font-medium md:col-span-2">
            Name suchen
            <input
              className="h-10 rounded-md border px-3 font-normal"
              type="search"
              name="q"
              maxLength={120}
              defaultValue={text}
            />
          </label>
          <SelectFilter label="Status" name="status" value={status ?? ''}>
            <option value="">Alle Status</option>
            <option value="pending">Ausstehend</option>
            <option value="active">Aktiv</option>
            <option value="archived">Archiviert</option>
          </SelectFilter>
          <SelectFilter label="Organisation" name="organizationId" value={organizationId ?? ''}>
            <option value="">Alle Organisationen</option>
            {(organizationsResult.data ?? []).map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </SelectFilter>
          <SelectFilter label="Einrichtung" name="facilityId" value={facilityId ?? ''}>
            <option value="">Alle Einrichtungen</option>
            {(facilitiesResult.data ?? []).map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.name}
              </option>
            ))}
          </SelectFilter>
          <SelectFilter label="Pflegegrad" name="pflegegrad" value={pflegegrad?.toString() ?? ''}>
            <option value="">Alle Pflegegrade</option>
            {[1, 2, 3, 4, 5].map((grade) => (
              <option key={grade} value={grade}>
                Pflegegrad {grade}
              </option>
            ))}
          </SelectFilter>
          <SelectFilter label="Sortieren nach" name="sortBy" value={sortBy}>
            <option value="lastName">Nachname</option>
            <option value="firstName">Vorname</option>
            <option value="createdAt">Erstellt</option>
            <option value="dateOfBirth">Geburtsdatum</option>
          </SelectFilter>
          <SelectFilter label="Reihenfolge" name="sortOrder" value={sortOrder}>
            <option value="asc">Aufsteigend</option>
            <option value="desc">Absteigend</option>
          </SelectFilter>
          <div className="flex items-end gap-2">
            <Button type="submit">Anwenden</Button>
            <Button asChild variant="secondary">
              <Link href="/clients">Zurücksetzen</Link>
            </Button>
          </div>
        </form>
      </section>

      {clients?.items.length ? (
        <section aria-labelledby="client-list-title" className="grid gap-3">
          <h2 id="client-list-title" className="text-lg font-semibold">
            {clients.total} Klientinnen und Klienten
          </h2>
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Klientenliste</caption>
              <thead className="border-b bg-slate-100 text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Geburtsdatum
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Pflegegrad
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Organisation / Einrichtung
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {clients.items.map((client) => (
                  <tr key={client.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium text-blue-900 underline-offset-4 hover:underline"
                        href={`/clients/${client.id}`}
                      >
                        {client.preferredName || client.firstName} {client.lastName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{formatDate(client.dateOfBirth)}</td>
                    <td className="px-4 py-3">
                      {client.currentPflegegrad ? `Pflegegrad ${client.currentPflegegrad}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {client.organizationName && client.facilityName ? (
                        <>
                          {client.organizationName} / {client.facilityName}
                        </>
                      ) : (
                        <span className="font-medium text-amber-800">Nicht zugeordnet</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={client.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Seite {clients.page} von {Math.max(1, Math.ceil(clients.total / clients.pageSize))}
            </p>
            <div className="flex gap-2">
              {clients.page > 1 ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, clients.page - 1)}>Zurück</Link>
                </Button>
              ) : null}
              {clients.page * clients.pageSize < clients.total ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={pageHref(filters, clients.page + 1)}>Weiter</Link>
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : !clientsResult.error ? (
        <p className="rounded-lg border bg-white p-6 text-slate-700">
          Keine Klientinnen oder Klienten für diese Suche gefunden.
        </p>
      ) : null}
    </div>
  );
}

function SelectFilter({
  label,
  name,
  value,
  children,
}: Readonly<{
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}>) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <select
        className="h-10 rounded-md border bg-white px-3 font-normal"
        name={name}
        defaultValue={value}
      >
        {children}
      </select>
    </label>
  );
}

function validUuid(value: string | undefined): string | undefined {
  return value && uuidPattern.test(value) ? value : undefined;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

function pageHref(filters: Record<string, string | number | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page })) {
    if (value !== undefined) params.set(key, String(value));
  }
  return `/clients?${params.toString()}`;
}
