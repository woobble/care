import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../../lib/api';
import { ActionNotice } from '../../action-notice';
import { setTeamStatusAction, updateTeamAction } from '../../actions';
import { ConfirmSubmitButton } from '../../confirm-submit-button';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function TeamDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [teamResult, facilitiesResult, employeesResult] = await Promise.all([
    get('/api/v1/teams/{id}', { params: { path: { id }, header } }),
    get('/api/v1/facilities', { params: { header } }),
    get('/api/v1/employees', { params: { query: { teamId: id, page: 1, pageSize: 50 }, header } }),
  ]);
  if (!teamResult.data) notFound();
  const team = teamResult.data;
  const facilities = (facilitiesResult.data ?? []).filter(
    (facility) => facility.organizationId === team.organizationId && facility.status === 'active',
  );

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration/teams">Teams</Link> · {team.organizationName}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{team.name}</h1>
          <StatusBadge status={team.status} />
        </div>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />
      <section
        aria-labelledby="team-edit-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <h2 id="team-edit-title" className="text-xl font-semibold">
          Team details
        </h2>
        <form action={updateTeamAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={team.id} />
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={team.name} required maxLength={160} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="facilityId">Facility</Label>
            <select
              id="facilityId"
              name="facilityId"
              className="h-10 rounded-md border bg-white px-3"
              defaultValue={team.facilityId ?? ''}
            >
              <option value="">Organization-wide</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <Button type="submit">Save changes</Button>
          </div>
        </form>
        {team.status === 'archived' ? (
          <form action={setTeamStatusAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="operation" value="activate" />
            <Button variant="secondary" type="submit">
              Activate team
            </Button>
          </form>
        ) : (
          <form action={setTeamStatusAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="operation" value="archive" />
            <ConfirmSubmitButton confirmation="Archive this team?">
              Archive team
            </ConfirmSubmitButton>
          </form>
        )}
      </section>
      <section aria-labelledby="team-employees-title" className="grid gap-3">
        <h2 id="team-employees-title" className="text-xl font-semibold">
          Assigned employees
        </h2>
        {employeesResult.error ? (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
            Employee list unavailable ({employeesResult.error.code}).
          </p>
        ) : employeesResult.data?.items.length ? (
          <ul className="grid gap-2">
            {employeesResult.data.items.map((employee) => (
              <li
                key={employee.id}
                className="flex justify-between gap-3 rounded-md border bg-white p-3"
              >
                <Link
                  className="font-medium text-blue-900 underline"
                  href={`/employees/${employee.id}`}
                >
                  {employee.firstName} {employee.lastName}
                </Link>
                <StatusBadge status={employee.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border bg-white p-4 text-slate-700">No employees assigned.</p>
        )}
      </section>
    </div>
  );
}
