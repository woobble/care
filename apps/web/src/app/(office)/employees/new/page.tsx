import Link from 'next/link';
import { Button, Input, Label } from '@care/ui';
import { getApiClient, getTenantHeader } from '../../../../lib/api';
import { ActionNotice } from '../../administration/action-notice';
import { createEmployeeAction } from '../actions';

type SearchParams = Promise<{ error?: string }>;

export default async function NewEmployeePage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const query = await searchParams;
  const api = await getApiClient();
  const get = api.GET;
  const { data: organizations, error } = await get('/api/v1/organizations', {
    params: { query: { status: 'active' }, header: await getTenantHeader() },
  });
  return (
    <div className="grid max-w-3xl gap-6">
      <header className="grid gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/employees">Mitarbeitende</Link>
        </p>
        <h1 className="text-3xl font-semibold">Mitarbeiter anlegen</h1>
        <p className="text-slate-700">
          Ein Benutzerkonto ist optional und kann später verknüpft werden.
        </p>
      </header>
      <ActionNotice error={query.error} />
      {error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Organisationen konnten nicht geladen werden ({error.code}).
        </p>
      ) : null}
      <form action={createEmployeeAction} className="grid gap-5 rounded-lg border bg-white p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="organizationId">Organisation</Label>
            <select
              id="organizationId"
              name="organizationId"
              className="h-10 rounded-md border bg-white px-3"
              required
              defaultValue=""
            >
              <option value="" disabled>
                Organisation auswählen
              </option>
              {(organizations ?? []).map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </div>
          <Field id="firstName" name="firstName" label="Vorname" required maxLength={120} />
          <Field id="lastName" name="lastName" label="Nachname" required maxLength={120} />
          <Field id="preferredName" name="preferredName" label="Bevorzugter Name" maxLength={120} />
          <Field
            id="personnelNumber"
            name="personnelNumber"
            label="Personalnummer"
            maxLength={64}
          />
          <Field id="email" name="email" label="E-Mail" type="email" maxLength={320} />
          <Field id="phone" name="phone" label="Telefon" type="tel" maxLength={40} />
          <Field
            id="employmentType"
            name="employmentType"
            label="Beschäftigungsart"
            maxLength={80}
          />
          <Field id="startDate" name="startDate" label="Beginn" type="date" />
          <Field id="endDate" name="endDate" label="Ende" type="date" />
          <Field
            id="weeklyHours"
            name="weeklyHours"
            label="Wochenstunden"
            type="number"
            min="0"
            max="168"
            step="0.25"
          />
        </div>
        <div className="flex gap-3">
          <Button type="submit" disabled={!organizations?.length}>
            Mitarbeiter anlegen
          </Button>
          <Button asChild variant="secondary">
            <Link href="/employees">Abbrechen</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  id,
  name,
  label,
  type = 'text',
  required = false,
  maxLength,
  min,
  max,
  step,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}
