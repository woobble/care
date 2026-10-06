import Link from 'next/link';
import { Button, StatusBadge } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../lib/api';

export default async function ClientsPage() {
  const api = await getApiClient();
  const { data, error } = await api.GET('/api/v1/clients', {
    params: { query: { page: 1, pageSize: 50 }, header: await getTenantHeader() },
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">Office</p>
          <h1 className="text-3xl font-semibold">Klientinnen und Klienten</h1>
        </div>
        <Button asChild>
          <Link href="/clients/new">Klient anlegen</Link>
        </Button>
      </div>
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Klienten konnten nicht geladen werden ({error.code}).
        </p>
      ) : data?.items.length ? (
        <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Klientenliste</caption>
            <thead className="border-b bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((client) => (
                <tr key={client.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      className="font-medium text-blue-900 underline-offset-4 hover:underline"
                      href={`/clients/${client.id}`}
                    >
                      {client.preferredName || client.firstName} {client.lastName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={client.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border bg-white p-6 text-slate-700">
          Noch keine Klienten vorhanden.
        </p>
      )}
    </div>
  );
}
