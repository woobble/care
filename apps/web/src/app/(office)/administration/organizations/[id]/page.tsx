import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../../lib/api';
import { ActionNotice } from '../../action-notice';
import {
  createFacilityAction,
  setOrganizationStatusAction,
  updateOrganizationAction,
} from '../../actions';
import { ConfirmSubmitButton } from '../../confirm-submit-button';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; updated?: string }>;

export default async function OrganizationDetailPage({
  params,
  searchParams,
}: Readonly<{ params: Params; searchParams: SearchParams }>) {
  const { id } = await params;
  const query = await searchParams;
  const api = await getApiClient();
  const header = await getTenantHeader();
  const get = api.GET;
  const [organizationResult, facilitiesResult, teamsResult] = await Promise.all([
    get('/api/v1/organizations/{id}', { params: { path: { id }, header } }),
    get('/api/v1/facilities', { params: { query: { organizationId: id }, header } }),
    get('/api/v1/teams', { params: { query: { organizationId: id }, header } }),
  ]);
  if (!organizationResult.data) notFound();
  const organization = organizationResult.data;

  return (
    <div className="grid gap-8">
      <header className="grid gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/administration/organizations">Organizations</Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">{organization.name}</h1>
          <StatusBadge status={organization.status} />
        </div>
      </header>
      <ActionNotice error={query.error} updated={query.updated} />

      <section
        aria-labelledby="organization-edit-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <h2 id="organization-edit-title" className="text-xl font-semibold">
          Organization details
        </h2>
        <form action={updateOrganizationAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={organization.id} />
          <Field
            id="name"
            label="Name"
            name="name"
            defaultValue={organization.name}
            required
            maxLength={160}
          />
          <Field
            id="legalName"
            label="Legal name"
            name="legalName"
            defaultValue={organization.legalName ?? ''}
            maxLength={200}
          />
          <Field
            id="code"
            label="Code"
            name="code"
            defaultValue={organization.code ?? ''}
            maxLength={40}
          />
          <Field
            id="email"
            label="Email"
            name="email"
            type="email"
            defaultValue={organization.email ?? ''}
            maxLength={320}
          />
          <Field
            id="phone"
            label="Phone"
            name="phone"
            type="tel"
            defaultValue={organization.phone ?? ''}
            maxLength={40}
          />
          <Field
            id="address"
            label="Address"
            name="address"
            defaultValue={organization.address ?? ''}
            maxLength={500}
          />
          <div className="md:col-span-2">
            <Button type="submit">Save changes</Button>
          </div>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          {organization.status === 'archived' ? (
            <form action={setOrganizationStatusAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="operation" value="activate" />
              <Button variant="secondary" type="submit">
                Activate organization
              </Button>
            </form>
          ) : (
            <form action={setOrganizationStatusAction}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="operation" value="archive" />
              <ConfirmSubmitButton confirmation="Archive this organization?">
                Archive organization
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </section>

      <section
        aria-labelledby="facility-create-title"
        className="grid gap-4 rounded-lg border bg-white p-5"
      >
        <div>
          <h2 id="facility-create-title" className="text-xl font-semibold">
            Facilities
          </h2>
          <p className="text-sm text-slate-600">Facilities belong to this organization.</p>
        </div>
        <form action={createFacilityAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="organizationId" value={organization.id} />
          <Field id="facility-name" label="Name" name="name" required maxLength={160} />
          <Field id="facility-code" label="Code" name="code" maxLength={40} />
          <Field id="facility-email" label="Email" name="email" type="email" maxLength={320} />
          <Field id="facility-phone" label="Phone" name="phone" type="tel" maxLength={40} />
          <Field id="facility-address" label="Address" name="address" maxLength={500} />
          <div className="md:col-span-2">
            <Button type="submit">Create facility</Button>
          </div>
        </form>
        {facilitiesResult.data?.length ? (
          <ul className="grid gap-2">
            {facilitiesResult.data.map((facility) => (
              <li
                key={facility.id}
                className="flex flex-wrap justify-between gap-3 rounded-md border p-3"
              >
                <Link
                  className="font-medium text-blue-900 underline"
                  href={`/administration/facilities/${facility.id}`}
                >
                  {facility.name}
                </Link>
                <StatusBadge status={facility.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">No facilities yet.</p>
        )}
      </section>

      <section aria-labelledby="teams-title" className="grid gap-3">
        <h2 id="teams-title" className="text-xl font-semibold">
          Teams
        </h2>
        {teamsResult.data?.length ? (
          <ul className="grid gap-2">
            {teamsResult.data.map((team) => (
              <li
                key={team.id}
                className="flex flex-wrap justify-between gap-3 rounded-md border bg-white p-3"
              >
                <Link
                  className="font-medium text-blue-900 underline"
                  href={`/administration/teams/${team.id}`}
                >
                  {team.name}
                </Link>
                <span className="text-sm text-slate-600">
                  {team.facilityName ?? 'Organization-wide'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border bg-white p-4 text-slate-700">No teams yet.</p>
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
