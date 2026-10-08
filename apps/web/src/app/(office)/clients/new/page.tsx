import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
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
  const t = await getTranslations();
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
          <Link href="/clients">{t('Clients.title')}</Link>
        </p>
        <h1 className="text-3xl font-semibold">{t('Clients.create')}</h1>
        <p className="text-slate-700">{t('Clients.newDescription')}</p>
      </header>
      {params.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('Clients.saveFailed')}
        </p>
      ) : null}
      {organizationsResult.error || facilitiesResult.error ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          {t('Errors.generic')}
        </p>
      ) : null}
      <form
        action={createClientAction}
        className="grid gap-6 rounded-lg border bg-white p-5 shadow-sm"
      >
        <fieldset className="grid gap-4">
          <legend className="mb-2 text-lg font-semibold">{t('Clients.form.personalData')}</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="firstName"
              name="firstName"
              label={t('Clients.form.firstName')}
              autoComplete="given-name"
              required
            />
            <Field
              id="lastName"
              name="lastName"
              label={t('Clients.form.lastName')}
              autoComplete="family-name"
              required
            />
            <Field
              id="preferredName"
              name="preferredName"
              label={t('Clients.form.preferredName')}
              autoComplete="nickname"
            />
            <Field
              id="dateOfBirth"
              name="dateOfBirth"
              label={t('Clients.form.dateOfBirth')}
              type="date"
            />
            <Field
              id="dateOfDeath"
              name="dateOfDeath"
              label={t('Clients.form.dateOfDeath')}
              type="date"
            />
            <SelectField id="gender" name="gender" label={t('Clients.form.gender')}>
              <option value="">{t('Clients.form.notSpecified')}</option>
              <option value="female">{t('Clients.form.female')}</option>
              <option value="male">{t('Clients.form.male')}</option>
              <option value="diverse">{t('Clients.form.diverse')}</option>
            </SelectField>
            <SelectField id="salutation" name="salutation" label={t('Clients.form.salutation')}>
              <option value="">{t('Clients.form.notSpecified')}</option>
              <option value="mr">{t('Clients.form.mr')}</option>
              <option value="ms">{t('Clients.form.ms')}</option>
              <option value="mx">{t('Clients.form.mx')}</option>
              <option value="other">{t('Clients.form.other')}</option>
            </SelectField>
          </div>
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="mb-2 text-lg font-semibold">{t('Clients.form.careContext')}</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              id="organizationId"
              name="organizationId"
              label={t('Clients.form.organization')}
              required
            >
              <option value="">{t('Clients.form.selectOrganization')}</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="primaryFacilityId"
              name="primaryFacilityId"
              label={t('Clients.form.primaryFacility')}
              required
            >
              <option value="">{t('Clients.form.selectFacility')}</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </SelectField>
          </div>
          <p className="text-sm text-slate-600">{t('Clients.form.facilityMustMatch')}</p>
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="mb-2 text-lg font-semibold">
            {t('Clients.form.contactInformation')}
          </legend>
          <div className="grid gap-4 md:grid-cols-3">
            <Field
              id="email"
              name="email"
              label={t('Clients.form.email')}
              type="email"
              autoComplete="email"
            />
            <Field
              id="phone"
              name="phone"
              label={t('Clients.form.phone')}
              type="tel"
              autoComplete="tel"
            />
            <Field
              id="mobile"
              name="mobile"
              label={t('Clients.form.mobilePhone')}
              type="tel"
              autoComplete="tel-national"
            />
          </div>
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="mb-2 text-lg font-semibold">
            {t('Clients.form.primaryAddressOptional')}
          </legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="addressStreet"
              name="addressStreet"
              label={t('Clients.form.street')}
              autoComplete="address-line1"
            />
            <Field
              id="addressHouseNumber"
              name="addressHouseNumber"
              label={t('Clients.form.houseNumber')}
            />
            <Field
              id="addressAddition"
              name="addressAddition"
              label={t('Clients.form.addressAddition')}
              autoComplete="address-line2"
            />
            <Field
              id="addressPostalCode"
              name="addressPostalCode"
              label={t('Clients.form.postalCode')}
              autoComplete="postal-code"
            />
            <Field
              id="addressCity"
              name="addressCity"
              label={t('Clients.form.city')}
              autoComplete="address-level2"
            />
            <Field
              id="addressCountryCode"
              name="addressCountryCode"
              label={t('Clients.form.countryCode')}
              defaultValue="DE"
              maxLength={2}
              autoComplete="country"
            />
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!organizations.length || !facilities.length}>
            {t('Clients.create')}
          </Button>
          <Button asChild variant="secondary">
            <Link href="/clients">{t('Common.actions.cancel')}</Link>
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
