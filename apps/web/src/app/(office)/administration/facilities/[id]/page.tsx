import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../../lib/api';
import { ActionNotice } from '../../action-notice';
import { createTeamAction, setFacilityStatusAction, updateFacilityAction } from '../../actions';
import { ConfirmSubmitButton } from '../../confirm-submit-button';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function FacilityDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [facilityResult, teamsResult, employeesResult] = await Promise.all([
    get('/api/v1/facilities/{id}', { params: { path: { id }, header } }),
    get('/api/v1/teams', { params: { query: { facilityId: id }, header } }),
    get('/api/v1/employees', {
      params: { query: { facilityId: id, page: 1, pageSize: 50 }, header },
    }),
  ]);
  if (!facilityResult.data) notFound();
  const facility = facilityResult.data;

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration/facilities">Facilities</Link> · {facility.organizationName}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{facility.name}</h1>
          <StatusBadge status={facility.status} />
        </div>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />
      <section
        aria-labelledby="facility-edit-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <h2 id="facility-edit-title" className="text-xl font-semibold">
          Facility details
        </h2>
        <form action={updateFacilityAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={facility.id} />
          <Field
            id="name"
            label="Name"
            name="name"
            defaultValue={facility.name}
            required
            maxLength={160}
          />
          <Field
            id="code"
            label="Code"
            name="code"
            defaultValue={facility.code ?? ''}
            maxLength={40}
          />
          <Field
            id="email"
            label="Email"
            name="email"
            type="email"
            defaultValue={facility.email ?? ''}
            maxLength={320}
          />
          <Field
            id="phone"
            label="Phone"
            name="phone"
            type="tel"
            defaultValue={facility.phone ?? ''}
            maxLength={40}
          />
          <Field
            id="address"
            label="Address"
            name="address"
            defaultValue={facility.address ?? ''}
            maxLength={500}
          />
          <Field
            id="timezone"
            label="Zeitzone (optional überschreiben)"
            name="timezone"
            defaultValue={facility.timezone ?? ''}
            maxLength={100}
          />
          <p className="text-sm text-slate-600 md:col-span-2">
            Leer lassen, um die Zeitzone der Organisation zu übernehmen.
          </p>
          <div className="md:col-span-2">
            <Button type="submit">Save changes</Button>
          </div>
        </form>
        {facility.status === 'archived' ? (
          <StatusForm id={id} operation="activate" />
        ) : (
          <form action={setFacilityStatusAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="operation" value="archive" />
            <ConfirmSubmitButton confirmation="Archive this facility?">
              Archive facility
            </ConfirmSubmitButton>
          </form>
        )}
      </section>

      <section
        aria-labelledby="facility-teams-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="facility-teams-title" className="text-xl font-semibold">
            Teams
          </h2>
          <p className="text-sm text-slate-600">Teams based at this facility.</p>
        </div>
        <form action={createTeamAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="organizationId" value={facility.organizationId} />
          <input type="hidden" name="facilityId" value={facility.id} />
          <div className="grid gap-2">
            <Label htmlFor="team-name">New team</Label>
            <Input id="team-name" name="name" required maxLength={160} />
          </div>
          <Button type="submit">Create team</Button>
        </form>
        {teamsResult.data?.length ? (
          <ul className="grid gap-2">
            {teamsResult.data.map((team) => (
              <li key={team.id} className="flex justify-between gap-3 rounded-md border p-3">
                <Link
                  className="font-medium text-blue-900 underline"
                  href={`/administration/teams/${team.id}`}
                >
                  {team.name}
                </Link>
                <StatusBadge status={team.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">No teams at this facility.</p>
        )}
      </section>

      <section aria-labelledby="facility-employees-title" className="grid gap-3">
        <h2 id="facility-employees-title" className="text-xl font-semibold">
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

function Field({
  id,
  label,
  name,
  defaultValue = '',
  type = 'text',
  required = false,
  maxLength,
}: Readonly<{
  id: string;
  label: string;
  name: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  maxLength: number;
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
      />
    </div>
  );
}

function StatusForm({ id, operation }: Readonly<{ id: string; operation: 'activate' }>) {
  return (
    <form action={setFacilityStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="operation" value={operation} />
      <Button variant="secondary" type="submit">
        Activate facility
      </Button>
    </form>
  );
}
