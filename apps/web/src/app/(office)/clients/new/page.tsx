import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button, Input, Label } from '@care/ui';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasPermission,
} from '../../../../lib/api';
import { createClientAction } from '../actions';

export default async function NewClientPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
  const params = await searchParams;
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const permissions = await getPermissionGrants(api);
  if (!hasPermission(permissions, 'client.create'))
    redirect('/clients?error=INSUFFICIENT_PERMISSION');
  const [organizationsResult, facilitiesResult] = await Promise.all([
    get('/api/v1/organizations', { params: { query: { status: 'active' }, header } }),
    get('/api/v1/facilities', { params: { query: { status: 'active' }, header } }),
  ]);
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header className="grid gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
          <Link href="/clients">Klientinnen und Klienten</Link>
        </p>
        <h1 className="text-3xl font-semibold">Klient anlegen</h1>
        <p className="text-slate-700">
          Organisation und primäre Einrichtung ordnen den Klienten dem Versorger zu.
        </p>
      </header>
      {params.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Klient konnte nicht gespeichert werden. Bitte prüfen Sie die Pflichtfelder und Zuordnung.
        </p>
      ) : null}
      {organizationsResult.error || facilitiesResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Organisationen oder Einrichtungen konnten nicht geladen werden.
        </p>
      ) : null}
      <form
        action={createClientAction}
        className="grid gap-6 rounded-lg border bg-white p-5 shadow-sm"
      >
        <fieldset className="grid gap-4">
          <legend className="mb-2 text-lg font-semibold">Persönliche Daten</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="firstName"
              name="firstName"
              label="Vorname"
              autoComplete="given-name"
              required
            />
            <Field
              id="lastName"
              name="lastName"
              label="Nachname"
              autoComplete="family-name"
              required
            />
            <Field
              id="preferredName"
              name="preferredName"
              label="Bevorzugter Name"
              autoComplete="nickname"
            />
            <Field id="dateOfBirth" name="dateOfBirth" label="Geburtsdatum" type="date" />
            <Field id="dateOfDeath" name="dateOfDeath" label="Sterbedatum" type="date" />
            <SelectField id="gender" name="gender" label="Geschlecht">
              <option value="">Nicht angegeben</option>
              <option value="female">Weiblich</option>
              <option value="male">Männlich</option>
              <option value="diverse">Divers</option>
            </SelectField>
            <SelectField id="salutation" name="salutation" label="Anrede">
              <option value="">Nicht angegeben</option>
              <option value="mr">Herr</option>
              <option value="ms">Frau</option>
              <option value="mx">Mx</option>
              <option value="other">Andere</option>
            </SelectField>
          </div>
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="mb-2 text-lg font-semibold">Versorgerkontext</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField id="organizationId" name="organizationId" label="Organisation" required>
              <option value="">Organisation auswählen</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="primaryFacilityId"
              name="primaryFacilityId"
              label="Primäre Einrichtung"
              required
            >
              <option value="">Einrichtung auswählen</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="text-sm text-slate-600">
            Die Einrichtung muss zur ausgewählten Organisation gehören.
          </p>
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="mb-2 text-lg font-semibold">Kontaktinformationen</legend>
          <div className="grid gap-4 md:grid-cols-3">
            <Field id="email" name="email" label="E-Mail" type="email" autoComplete="email" />
            <Field id="phone" name="phone" label="Telefon" type="tel" autoComplete="tel" />
            <Field
              id="mobile"
              name="mobile"
              label="Mobiltelefon"
              type="tel"
              autoComplete="tel-national"
            />
          </div>
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="mb-2 text-lg font-semibold">Primäre Adresse (optional)</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="addressStreet"
              name="addressStreet"
              label="Straße"
              autoComplete="address-line1"
            />
            <Field id="addressHouseNumber" name="addressHouseNumber" label="Hausnummer" />
            <Field
              id="addressAddition"
              name="addressAddition"
              label="Adresszusatz"
              autoComplete="address-line2"
            />
            <Field
              id="addressPostalCode"
              name="addressPostalCode"
              label="Postleitzahl"
              autoComplete="postal-code"
            />
            <Field id="addressCity" name="addressCity" label="Ort" autoComplete="address-level2" />
            <Field
              id="addressCountryCode"
              name="addressCountryCode"
              label="Ländercode"
              defaultValue="DE"
              maxLength={2}
              autoComplete="country"
            />
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!organizations.length || !facilities.length}>
            Klient anlegen
          </Button>
          <Button asChild variant="secondary">
            <Link href="/clients">Abbrechen</Link>
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
  autoComplete,
  required = false,
  maxLength,
  defaultValue,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  maxLength?: number;
  defaultValue?: string;
}>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
      />
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  required = false,
  children,
}: Readonly<{
  id: string;
  name: string;
  label: string;
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
        required={required}
        defaultValue=""
      >
        {children}
      </select>
    </div>
  );
}
