import Link from 'next/link';
import { getApiClient, getTenantHeader } from '../../../../lib/api';

export default async function AuditPage() {
  const api = await getApiClient();
  const get = api.GET;
  const { data, error } = await get('/api/v1/audit', {
    params: { query: { page: 1, pageSize: 50 }, header: await getTenantHeader() },
  });
  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration/users">Administration</Link>
        </p>
        <h1 className="text-3xl font-semibold">Audit Log</h1>
      </header>
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Audit records could not be loaded ({error.code}).
        </p>
      ) : data?.items.length ? (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Recent tenant audit events</caption>
            <thead className="border-b bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">
                  Timestamp
                </th>
                <th scope="col" className="px-4 py-3">
                  Actor
                </th>
                <th scope="col" className="px-4 py-3">
                  Action
                </th>
                <th scope="col" className="px-4 py-3">
                  Resource
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((entry) => (
                <tr key={entry.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-4 py-3">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">{entry.actorId}</td>
                  <td className="px-4 py-3">{entry.action}</td>
                  <td className="px-4 py-3">
                    {entry.resourceType} · {entry.resourceId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border bg-white p-5 text-slate-700">No audit records.</p>
      )}
    </div>
  );
}
