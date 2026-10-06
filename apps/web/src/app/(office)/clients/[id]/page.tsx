import { notFound } from 'next/navigation';
import { Button, StatusBadge } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { activateClientAction, archiveClientAction } from '../actions';

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const api = await getApiClient();
  const get = api.GET;
  const { data: client, error } = await get('/api/v1/clients/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
  });
  if (error?.code === 'CLIENT_NOT_FOUND') notFound();

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      {error || !client ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Klient konnte nicht geladen werden.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid gap-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
                Klientendetails
              </p>
              <h1 className="text-3xl font-semibold">
                {client.preferredName || client.firstName} {client.lastName}
              </h1>
              <StatusBadge status={client.status} />
            </div>
            <Button asChild variant="secondary">
              <a href="/clients">Zurück zur Liste</a>
            </Button>
          </div>
          {query.error ? (
            <p role="alert" className="rounded-md bg-red-50 p-3 text-red-900">
              Aktion konnte nicht ausgeführt werden.
            </p>
          ) : null}
          <dl className="grid gap-4 rounded-lg border bg-white p-5 sm:grid-cols-2">
            <Field label="Vorname" value={client.firstName} />
            <Field label="Nachname" value={client.lastName} />
            <Field label="Bevorzugter Name" value={client.preferredName} />
            <Field label="Geburtsdatum" value={client.dateOfBirth} />
            <Field label="E-Mail" value={client.email} />
            <Field label="Telefon" value={client.phone} />
          </dl>
          <div className="flex flex-wrap gap-3">
            {client.status === 'pending' ? (
              <form action={activateClientAction}>
                <input type="hidden" name="id" value={client.id} />
                <Button type="submit">Aktivieren</Button>
              </form>
            ) : null}
            {client.status === 'active' ? (
              <form action={archiveClientAction}>
                <input type="hidden" name="id" value={client.id} />
                <Button type="submit" variant="destructive">
                  Archivieren
                </Button>
              </form>
            ) : null}
          </div>
        </>
      )}
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
