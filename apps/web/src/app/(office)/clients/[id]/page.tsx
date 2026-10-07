import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, Input, Label, StatusBadge } from '@care/ui';
import {
  getApiClient,
  getPermissionGrants,
  getTenantHeader,
  hasClientPermission,
} from '../../../../lib/api';
import {
  activateClientAction,
  addClientAddressAction,
  addClientContactAction,
  addClientInsuranceAction,
  addClientPflegegradAction,
  archiveClientAction,
  changeClientProviderContextAction,
  removeClientAddressAction,
  removeClientContactAction,
  updateClientAction,
  updateClientAddressAction,
  updateClientContactAction,
  updateClientInsuranceAction,
  updateFuturePflegegradAction,
} from '../actions';

const contactRoleLabels = {
  primary_contact: 'Hauptkontakt',
  emergency_contact: 'Notfallkontakt',
  legal_representative: 'Gesetzliche Vertretung',
  authorized_contact: 'Bevollmächtigter Kontakt',
  invoice_recipient: 'Rechnungsempfänger',
} as const;

export default async function ClientDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}>) {
  const { id } = await params;
  const query = await searchParams;
  const api = await getApiClient();
  const get = api.GET;
  const header = await getTenantHeader();
  const [
    clientResult,
    addressesResult,
    contactsResult,
    insurancesResult,
    gradesResult,
    timelineResult,
    organizationsResult,
    facilitiesResult,
  ] = await Promise.all([
    get('/api/v1/clients/{id}', { params: { path: { id }, header } }),
    get('/api/v1/clients/{clientId}/addresses', { params: { path: { clientId: id }, header } }),
    get('/api/v1/clients/{clientId}/contacts', { params: { path: { clientId: id }, header } }),
    get('/api/v1/clients/{clientId}/insurances', { params: { path: { clientId: id }, header } }),
    get('/api/v1/clients/{clientId}/pflegegrade', { params: { path: { clientId: id }, header } }),
    get('/api/v1/clients/{clientId}/timeline', { params: { path: { clientId: id }, header } }),
    get('/api/v1/organizations', { params: { header } }),
    get('/api/v1/facilities', { params: { header } }),
  ]);
  if (clientResult.error?.code === 'CLIENT_NOT_FOUND') notFound();

  const client = clientResult.data;
  const addresses = addressesResult.data ?? [];
  const contacts = contactsResult.data ?? [];
  const insurances = insurancesResult.data ?? [];
  const grades = gradesResult.data ?? [];
  const timeline = timelineResult.data ?? [];
  const organizations = organizationsResult.data ?? [];
  const facilities = facilitiesResult.data ?? [];
  const permissions = await getPermissionGrants(api);
  const tenantId = header['X-Tenant-Id'];
  const canUpdateClient = client
    ? hasClientPermission(
        permissions,
        'client.update',
        tenantId,
        client.organizationId,
        client.primaryFacilityId,
      )
    : false;
  const canArchiveClient = client
    ? hasClientPermission(
        permissions,
        'client.archive',
        tenantId,
        client.organizationId,
        client.primaryFacilityId,
      )
    : false;
  const primaryAddress = addresses.find((address) => address.isPrimary);
  const primaryContact = contacts.find((contact) => contact.roles.includes('primary_contact'));
  const emergencyContact = contacts.find((contact) => contact.roles.includes('emergency_contact'));
  const today = currentDate();
  const currentPflegegrad = grades.find(
    (grade) =>
      grade.status === 'confirmed' &&
      grade.validFrom <= today &&
      (!grade.validUntil || grade.validUntil > today),
  );
  const actionError = query.error || clientResult.error?.code;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-800">
            <Link href="/clients">Klientinnen und Klienten</Link>
          </p>
          {client ? (
            <>
              <h1 className="text-3xl font-semibold">
                {client.preferredName || client.firstName} {client.lastName}
              </h1>
              <StatusBadge status={client.status} />
            </>
          ) : (
            <h1 className="text-3xl font-semibold">Klientendetails</h1>
          )}
        </div>
        <Button asChild variant="secondary">
          <Link href="/clients">Zurück zur Liste</Link>
        </Button>
      </header>

      {actionError ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-900">
          Änderung konnte nicht gespeichert werden. Prüfen Sie die Eingaben und Ihre Berechtigung.
        </p>
      ) : null}
      {!client ? (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-red-900">
          Klient konnte nicht geladen werden.
        </p>
      ) : (
        <>
          <nav aria-label="Klientenbereiche" className="flex flex-wrap gap-2 border-b pb-3 text-sm">
            <SectionLink href="#overview">Übersicht</SectionLink>
            <SectionLink href="#contacts">Kontakte</SectionLink>
            <SectionLink href="#insurance">Versicherung & Pflegegrad</SectionLink>
            <Link
              className="rounded-md px-3 py-2 text-blue-900 hover:bg-blue-50"
              href={`/clients/${client.id}/service-agreements`}
            >
              Leistungsplanung
            </Link>
            <SectionLink href="#timeline">Verlauf</SectionLink>
          </nav>

          <section
            id="overview"
            aria-labelledby="overview-title"
            className="grid gap-4 scroll-mt-6"
          >
            <h2 id="overview-title" className="text-xl font-semibold">
              Übersicht
            </h2>
            <dl className="grid gap-4 rounded-lg border bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Vorname" value={client.firstName} />
              <Field label="Nachname" value={client.lastName} />
              <Field label="Bevorzugter Name" value={client.preferredName} />
              <Field label="Geburtsdatum" value={formatDate(client.dateOfBirth)} />
              <Field label="Sterbedatum" value={formatDate(client.dateOfDeath)} />
              <Field label="Geschlecht" value={genderLabel(client.gender)} />
              <Field label="Anrede" value={salutationLabel(client.salutation)} />
              <Field label="E-Mail" value={client.email} />
              <Field label="Telefon" value={client.phone} />
              <Field label="Mobiltelefon" value={client.mobile} />
              <Field
                label="Primäre Adresse"
                value={primaryAddress ? formatAddress(primaryAddress) : null}
              />
              <Field
                label="Aktueller Pflegegrad"
                value={currentPflegegrad ? `Pflegegrad ${currentPflegegrad.grade}` : null}
              />
              <Field
                label="Hauptkontakt"
                value={
                  primaryContact ? `${primaryContact.firstName} ${primaryContact.lastName}` : null
                }
              />
              <Field
                label="Notfallkontakt"
                value={
                  emergencyContact
                    ? `${emergencyContact.firstName} ${emergencyContact.lastName}`
                    : null
                }
              />
            </dl>

            {canUpdateClient ? (
              <details className="rounded-lg border bg-white p-5">
                <summary className="cursor-pointer font-semibold">
                  Persönliche Daten bearbeiten
                </summary>
                <form action={updateClientAction} className="mt-4 grid gap-4">
                  <input type="hidden" name="id" value={client.id} />
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField
                      id="edit-firstName"
                      name="firstName"
                      label="Vorname"
                      defaultValue={client.firstName}
                      required
                    />
                    <TextField
                      id="edit-lastName"
                      name="lastName"
                      label="Nachname"
                      defaultValue={client.lastName}
                      required
                    />
                    <TextField
                      id="edit-preferredName"
                      name="preferredName"
                      label="Bevorzugter Name"
                      defaultValue={client.preferredName ?? ''}
                    />
                    <TextField
                      id="edit-dateOfBirth"
                      name="dateOfBirth"
                      label="Geburtsdatum"
                      type="date"
                      defaultValue={client.dateOfBirth ?? ''}
                    />
                    <TextField
                      id="edit-dateOfDeath"
                      name="dateOfDeath"
                      label="Sterbedatum"
                      type="date"
                      defaultValue={client.dateOfDeath ?? ''}
                    />
                    <SelectField
                      id="edit-gender"
                      name="gender"
                      label="Geschlecht"
                      value={client.gender ?? ''}
                    >
                      <option value="">Nicht angegeben</option>
                      <option value="female">Weiblich</option>
                      <option value="male">Männlich</option>
                      <option value="diverse">Divers</option>
                    </SelectField>
                    <SelectField
                      id="edit-salutation"
                      name="salutation"
                      label="Anrede"
                      value={client.salutation ?? ''}
                    >
                      <option value="">Nicht angegeben</option>
                      <option value="mr">Herr</option>
                      <option value="ms">Frau</option>
                      <option value="mx">Mx</option>
                      <option value="other">Andere</option>
                    </SelectField>
                    <TextField
                      id="edit-email"
                      name="email"
                      label="E-Mail"
                      type="email"
                      defaultValue={client.email ?? ''}
                    />
                    <TextField
                      id="edit-phone"
                      name="phone"
                      label="Telefon"
                      type="tel"
                      defaultValue={client.phone ?? ''}
                    />
                    <TextField
                      id="edit-mobile"
                      name="mobile"
                      label="Mobiltelefon"
                      type="tel"
                      defaultValue={client.mobile ?? ''}
                    />
                  </div>
                  <Button type="submit" className="w-fit">
                    Stammdaten speichern
                  </Button>
                </form>
              </details>
            ) : null}

            <details
              className="rounded-lg border bg-white p-5"
              open={!client.organizationId || !client.primaryFacilityId}
            >
              <summary className="cursor-pointer font-semibold">Versorgerkontext</summary>
              <p className="mt-2 text-sm text-slate-700">
                {client.organizationId && client.primaryFacilityId
                  ? `${organizationName(organizations, client.organizationId)} / ${facilityName(facilities, client.primaryFacilityId)}`
                  : 'Dieser ältere Datensatz ist noch nicht zugeordnet.'}
              </p>
              {canUpdateClient ? (
                <form
                  action={changeClientProviderContextAction}
                  className="mt-4 grid gap-4 md:grid-cols-2"
                >
                  <input type="hidden" name="id" value={client.id} />
                  <SelectField
                    id="organizationId"
                    name="organizationId"
                    label="Organisation"
                    value={client.organizationId ?? ''}
                    required
                  >
                    <option value="">Organisation auswählen</option>
                    {organizations
                      .filter((organization) => organization.status === 'active')
                      .map((organization) => (
                        <option key={organization.id} value={organization.id}>
                          {organization.name}
                        </option>
                      ))}
                  </SelectField>
                  <SelectField
                    id="primaryFacilityId"
                    name="primaryFacilityId"
                    label="Primäre Einrichtung"
                    value={client.primaryFacilityId ?? ''}
                    required
                  >
                    <option value="">Einrichtung auswählen</option>
                    {facilities
                      .filter((facility) => facility.status === 'active')
                      .map((facility) => (
                        <option key={facility.id} value={facility.id}>
                          {facility.name}
                        </option>
                      ))}
                  </SelectField>
                  <Button type="submit" className="w-fit md:col-span-2">
                    Zuordnung speichern
                  </Button>
                </form>
              ) : null}
            </details>

            <div className="flex flex-wrap gap-3">
              {canUpdateClient && client.status === 'pending' ? (
                <form action={activateClientAction}>
                  <input type="hidden" name="id" value={client.id} />
                  <Button type="submit">Aktivieren</Button>
                </form>
              ) : null}
              {canArchiveClient && client.status === 'active' ? (
                <form action={archiveClientAction}>
                  <input type="hidden" name="id" value={client.id} />
                  <Button type="submit" variant="destructive">
                    Archivieren
                  </Button>
                </form>
              ) : null}
            </div>
          </section>

          <section
            id="contacts"
            aria-labelledby="contacts-title"
            className="grid gap-4 scroll-mt-6"
          >
            <h2 id="contacts-title" className="text-xl font-semibold">
              Adressen und Kontakte
            </h2>
            <div className="grid gap-4">
              {addresses.map((address) => (
                <article key={address.id} className="grid gap-3 rounded-lg border bg-white p-5">
                  <h3 className="font-semibold">
                    {addressTypeLabel(address.addressType)}
                    {address.isPrimary ? ' · Primär' : ''}
                  </h3>
                  {canUpdateClient ? (
                    <form action={updateClientAddressAction} className="grid gap-4">
                      <input type="hidden" name="id" value={client.id} />
                      <input type="hidden" name="addressId" value={address.id} />
                      <div className="grid gap-4 md:grid-cols-3">
                        <SelectField
                          id={`address-type-${address.id}`}
                          name="addressType"
                          label="Art"
                          value={address.addressType}
                        >
                          <option value="home">Wohnadresse</option>
                          <option value="billing">Rechnungsadresse</option>
                          <option value="other">Weitere Adresse</option>
                        </SelectField>
                        <TextField
                          id={`address-street-${address.id}`}
                          name="street"
                          label="Straße"
                          defaultValue={address.street}
                          required
                        />
                        <TextField
                          id={`address-house-${address.id}`}
                          name="houseNumber"
                          label="Hausnummer"
                          defaultValue={address.houseNumber ?? ''}
                        />
                        <TextField
                          id={`address-addition-${address.id}`}
                          name="addressAddition"
                          label="Adresszusatz"
                          defaultValue={address.addressAddition ?? ''}
                        />
                        <TextField
                          id={`address-postal-${address.id}`}
                          name="postalCode"
                          label="Postleitzahl"
                          defaultValue={address.postalCode ?? ''}
                        />
                        <TextField
                          id={`address-city-${address.id}`}
                          name="city"
                          label="Ort"
                          defaultValue={address.city}
                          required
                        />
                        <TextField
                          id={`address-country-${address.id}`}
                          name="countryCode"
                          label="Ländercode"
                          defaultValue={address.countryCode}
                          maxLength={2}
                        />
                        <TextField
                          id={`address-from-${address.id}`}
                          name="validFrom"
                          label="Gültig ab"
                          type="date"
                          defaultValue={address.validFrom ?? ''}
                        />
                        <TextField
                          id={`address-until-${address.id}`}
                          name="validUntil"
                          label="Gültig bis"
                          type="date"
                          defaultValue={address.validUntil ?? ''}
                        />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="isPrimary"
                          defaultChecked={address.isPrimary}
                        />{' '}
                        Als primäre Adresse verwenden
                      </label>
                      <div className="flex gap-2">
                        <Button type="submit" variant="secondary">
                          Adresse speichern
                        </Button>
                        <Button formAction={removeClientAddressAction} variant="destructive">
                          Adresse entfernen
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <p className="text-sm text-slate-700">{formatAddress(address)}</p>
                  )}
                </article>
              ))}
            </div>
            {canUpdateClient ? (
              <details className="rounded-lg border bg-white p-5">
                <summary className="cursor-pointer font-semibold">Adresse hinzufügen</summary>
                <AddressForm
                  action={addClientAddressAction}
                  clientId={client.id}
                  idPrefix="new-address"
                />
              </details>
            ) : null}

            <div className="grid gap-4">
              {contacts.map((contact) => (
                <article key={contact.id} className="rounded-lg border bg-white p-5">
                  <h3 className="font-semibold">
                    {contact.firstName} {contact.lastName}
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    {relationshipLabel(contact.relationshipType)} ·{' '}
                    {contact.roles.map((role) => contactRoleLabels[role]).join(', ') ||
                      'Keine Rolle'}
                  </p>
                  {!canUpdateClient ? (
                    <p className="mt-2 text-sm text-slate-700">
                      {[contact.phone, contact.mobile, contact.email].filter(Boolean).join(' · ') ||
                        'Keine Kontaktdaten'}
                    </p>
                  ) : null}
                  {canUpdateClient ? (
                    <form action={updateClientContactAction} className="mt-4 grid gap-4">
                      <input type="hidden" name="id" value={client.id} />
                      <input type="hidden" name="contactId" value={contact.id} />
                      <div className="grid gap-4 md:grid-cols-2">
                        <TextField
                          id={`contact-first-${contact.id}`}
                          name="firstName"
                          label="Vorname"
                          defaultValue={contact.firstName}
                          required
                        />
                        <TextField
                          id={`contact-last-${contact.id}`}
                          name="lastName"
                          label="Nachname"
                          defaultValue={contact.lastName}
                          required
                        />
                        <SelectField
                          id={`contact-relation-${contact.id}`}
                          name="relationshipType"
                          label="Beziehung"
                          value={contact.relationshipType}
                        >
                          <RelationshipOptions />
                        </SelectField>
                        <TextField
                          id={`contact-phone-${contact.id}`}
                          name="phone"
                          label="Telefon"
                          type="tel"
                          defaultValue={contact.phone ?? ''}
                        />
                        <TextField
                          id={`contact-mobile-${contact.id}`}
                          name="mobile"
                          label="Mobiltelefon"
                          type="tel"
                          defaultValue={contact.mobile ?? ''}
                        />
                        <TextField
                          id={`contact-email-${contact.id}`}
                          name="email"
                          label="E-Mail"
                          type="email"
                          defaultValue={contact.email ?? ''}
                        />
                        <TextField
                          id={`contact-notes-${contact.id}`}
                          name="notes"
                          label="Kontaktbezogene Hinweise"
                          defaultValue={contact.notes ?? ''}
                          maxLength={500}
                        />
                      </div>
                      <RoleChecks selected={contact.roles} />
                      <Button type="submit" variant="secondary" className="w-fit">
                        Kontakt speichern
                      </Button>
                      <Button
                        formAction={removeClientContactAction}
                        variant="destructive"
                        className="w-fit"
                      >
                        Kontakt entfernen
                      </Button>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
            {canUpdateClient ? (
              <details className="rounded-lg border bg-white p-5">
                <summary className="cursor-pointer font-semibold">Kontakt hinzufügen</summary>
                <form action={addClientContactAction} className="mt-4 grid gap-4">
                  <input type="hidden" name="id" value={client.id} />
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextField id="new-contact-first" name="firstName" label="Vorname" required />
                    <TextField id="new-contact-last" name="lastName" label="Nachname" required />
                    <SelectField
                      id="new-contact-relation"
                      name="relationshipType"
                      label="Beziehung"
                      value="relative"
                      required
                    >
                      <RelationshipOptions />
                    </SelectField>
                    <TextField id="new-contact-phone" name="phone" label="Telefon" type="tel" />
                    <TextField
                      id="new-contact-mobile"
                      name="mobile"
                      label="Mobiltelefon"
                      type="tel"
                    />
                    <TextField id="new-contact-email" name="email" label="E-Mail" type="email" />
                    <TextField
                      id="new-contact-representation-reference"
                      name="representationReference"
                      label="Referenz zur Vertretung"
                      maxLength={120}
                    />
                    <TextField
                      id="new-contact-representation-from"
                      name="representationValidFrom"
                      label="Vertretung gültig ab"
                      type="date"
                    />
                    <TextField
                      id="new-contact-representation-until"
                      name="representationValidUntil"
                      label="Vertretung gültig bis"
                      type="date"
                    />
                    <SelectField
                      id="new-contact-representation-type"
                      name="representationType"
                      label="Vertretungsart"
                      value=""
                    >
                      <option value="">Keine Vertretung</option>
                      <option value="power_of_attorney">Vollmacht</option>
                      <option value="legal_guardianship">Gesetzliche Betreuung</option>
                      <option value="authorized_representative">Bevollmächtigte Person</option>
                    </SelectField>
                  </div>
                  <RoleChecks selected={[]} />
                  <TextField
                    id="new-contact-notes"
                    name="notes"
                    label="Kontaktbezogene Hinweise"
                    maxLength={500}
                  />
                  <p className="text-sm text-slate-600">
                    Bitte hier keine medizinischen Informationen eintragen.
                  </p>
                  <Button type="submit" className="w-fit">
                    Kontakt hinzufügen
                  </Button>
                </form>
              </details>
            ) : null}
          </section>

          <section
            id="insurance"
            aria-labelledby="insurance-title"
            className="grid gap-4 scroll-mt-6"
          >
            <h2 id="insurance-title" className="text-xl font-semibold">
              Versicherung und Pflegegrad
            </h2>
            <div className="grid gap-4">
              {insurances.map((insurance) => (
                <article key={insurance.id} className="rounded-lg border bg-white p-5">
                  <h3 className="font-semibold">
                    {insurance.insurerName}
                    {insurance.isPrimary ? ' · Primär' : ''}
                  </h3>
                  {canUpdateClient ? (
                    <form action={updateClientInsuranceAction} className="mt-4 grid gap-4">
                      <input type="hidden" name="id" value={client.id} />
                      <input type="hidden" name="insuranceId" value={insurance.id} />
                      <div className="grid gap-4 md:grid-cols-3">
                        <SelectField
                          id={`insurance-type-${insurance.id}`}
                          name="insuranceType"
                          label="Versicherungsart"
                          value={insurance.insuranceType}
                        >
                          <InsuranceOptions />
                        </SelectField>
                        <TextField
                          id={`insurer-name-${insurance.id}`}
                          name="insurerName"
                          label="Versicherer"
                          defaultValue={insurance.insurerName}
                          required
                        />
                        <TextField
                          id={`insurance-number-${insurance.id}`}
                          name="insuranceNumber"
                          label="Versicherungsnummer"
                          defaultValue={insurance.insuranceNumber ?? ''}
                        />
                        <TextField
                          id={`member-number-${insurance.id}`}
                          name="memberNumber"
                          label="Mitgliedsnummer"
                          defaultValue={insurance.memberNumber ?? ''}
                        />
                        <TextField
                          id={`insurance-from-${insurance.id}`}
                          name="validFrom"
                          label="Gültig ab"
                          type="date"
                          defaultValue={insurance.validFrom ?? ''}
                        />
                        <TextField
                          id={`insurance-until-${insurance.id}`}
                          name="validUntil"
                          label="Gültig bis"
                          type="date"
                          defaultValue={insurance.validUntil ?? ''}
                        />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="isPrimary"
                          defaultChecked={insurance.isPrimary}
                        />{' '}
                        Primäres Versicherungsverhältnis
                      </label>
                      <p className="text-sm text-slate-600">
                        Versicherungsnummern werden nur in diesem geschützten Bereich angezeigt.
                      </p>
                      <Button type="submit" variant="secondary" className="w-fit">
                        Versicherung speichern
                      </Button>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
            {canUpdateClient ? (
              <details className="rounded-lg border bg-white p-5">
                <summary className="cursor-pointer font-semibold">
                  Versicherungsverhältnis hinzufügen
                </summary>
                <form action={addClientInsuranceAction} className="mt-4 grid gap-4">
                  <input type="hidden" name="id" value={client.id} />
                  <div className="grid gap-4 md:grid-cols-3">
                    <SelectField
                      id="new-insurance-type"
                      name="insuranceType"
                      label="Versicherungsart"
                      value="pflegeversicherung"
                      required
                    >
                      <InsuranceOptions />
                    </SelectField>
                    <TextField
                      id="new-insurer-name"
                      name="insurerName"
                      label="Versicherer"
                      required
                    />
                    <TextField
                      id="new-insurance-number"
                      name="insuranceNumber"
                      label="Versicherungsnummer"
                    />
                    <TextField id="new-member-number" name="memberNumber" label="Mitgliedsnummer" />
                    <TextField
                      id="new-insurance-from"
                      name="validFrom"
                      label="Gültig ab"
                      type="date"
                    />
                    <TextField
                      id="new-insurance-until"
                      name="validUntil"
                      label="Gültig bis"
                      type="date"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="isPrimary" /> Primäres Versicherungsverhältnis
                  </label>
                  <Button type="submit" className="w-fit">
                    Versicherung hinzufügen
                  </Button>
                </form>
              </details>
            ) : null}

            <div className="grid gap-3">
              <h3 className="text-lg font-semibold">Pflegegradverlauf</h3>
              {grades.length ? (
                grades.map((grade) => {
                  const editableFuture = grade.status === 'pending' && grade.validFrom > today;
                  return (
                    <article key={grade.id} className="grid gap-3 rounded-lg border bg-white p-5">
                      <h4 className="font-semibold">
                        Pflegegrad {grade.grade} · {pflegegradStatusLabel(grade.status)}
                      </h4>
                      <p className="text-sm text-slate-700">
                        Gültig {formatDate(grade.validFrom)} bis {formatDate(grade.validUntil)}
                        {grade.decisionDate
                          ? ` · Entscheidung ${formatDate(grade.decisionDate)}`
                          : ''}
                      </p>
                      {editableFuture && canUpdateClient ? (
                        <form
                          action={updateFuturePflegegradAction}
                          className="grid gap-4 md:grid-cols-4"
                        >
                          <input type="hidden" name="id" value={client.id} />
                          <input type="hidden" name="recordId" value={grade.id} />
                          <TextField
                            id={`grade-${grade.id}`}
                            name="grade"
                            label="Pflegegrad"
                            type="number"
                            min={1}
                            max={5}
                            defaultValue={String(grade.grade)}
                            required
                          />
                          <TextField
                            id={`grade-from-${grade.id}`}
                            name="validFrom"
                            label="Gültig ab"
                            type="date"
                            defaultValue={grade.validFrom}
                            required
                          />
                          <SelectField
                            id={`grade-status-${grade.id}`}
                            name="status"
                            label="Status"
                            value={grade.status}
                          >
                            <option value="pending">Ausstehend</option>
                            <option value="confirmed">Bestätigt</option>
                            <option value="revoked">Widerrufen</option>
                          </SelectField>
                          <div className="flex items-end">
                            <Button type="submit" variant="secondary">
                              Plan speichern
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <p className="text-sm text-slate-600">
                          Historische und bestätigte Einträge bleiben unverändert.
                        </p>
                      )}
                    </article>
                  );
                })
              ) : (
                <p className="rounded-lg border bg-white p-5 text-slate-700">
                  Kein Pflegegradverlauf vorhanden.
                </p>
              )}
              {canUpdateClient ? (
                <details className="rounded-lg border bg-white p-5">
                  <summary className="cursor-pointer font-semibold">Pflegegrad ergänzen</summary>
                  <form
                    action={addClientPflegegradAction}
                    className="mt-4 grid gap-4 md:grid-cols-3"
                  >
                    <input type="hidden" name="id" value={client.id} />
                    <TextField
                      id="new-grade"
                      name="grade"
                      label="Pflegegrad"
                      type="number"
                      min={1}
                      max={5}
                      required
                    />
                    <TextField
                      id="new-grade-from"
                      name="validFrom"
                      label="Gültig ab"
                      type="date"
                      required
                    />
                    <SelectField id="new-grade-status" name="status" label="Status" value="pending">
                      <option value="pending">Ausstehend</option>
                      <option value="confirmed">Bestätigt</option>
                      <option value="revoked">Widerrufen</option>
                    </SelectField>
                    <TextField
                      id="new-grade-until"
                      name="validUntil"
                      label="Gültig bis"
                      type="date"
                    />
                    <TextField
                      id="new-grade-decision"
                      name="decisionDate"
                      label="Entscheidungsdatum"
                      type="date"
                    />
                    <TextField
                      id="new-grade-reference"
                      name="insurerReference"
                      label="Referenz des Versicherers"
                      maxLength={120}
                    />
                    <Button type="submit" className="w-fit md:col-span-3">
                      Pflegegrad speichern
                    </Button>
                  </form>
                </details>
              ) : null}
            </div>
          </section>

          <section
            id="timeline"
            aria-labelledby="timeline-title"
            className="grid gap-4 scroll-mt-6"
          >
            <h2 id="timeline-title" className="text-xl font-semibold">
              Verlauf
            </h2>
            {timeline.length ? (
              <ol className="grid gap-3 border-l-2 border-blue-200 pl-5">
                {timeline.map((entry) => (
                  <li key={entry.id} className="rounded-lg border bg-white p-4">
                    <p className="font-medium">{entry.summary}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatDateTime(entry.occurredAt)} · Bearbeitet von {entry.actorId}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-lg border bg-white p-5 text-slate-700">
                Noch keine Verlaufseinträge.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function AddressForm({
  action,
  clientId,
  idPrefix,
}: {
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  idPrefix: string;
}) {
  return (
    <form action={action} className="mt-4 grid gap-4">
      <input type="hidden" name="id" value={clientId} />
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField id={`${idPrefix}-type`} name="addressType" label="Art" value="home">
          <option value="home">Wohnadresse</option>
          <option value="billing">Rechnungsadresse</option>
          <option value="other">Weitere Adresse</option>
        </SelectField>
        <TextField id={`${idPrefix}-street`} name="street" label="Straße" required />
        <TextField id={`${idPrefix}-house`} name="houseNumber" label="Hausnummer" />
        <TextField id={`${idPrefix}-addition`} name="addressAddition" label="Adresszusatz" />
        <TextField id={`${idPrefix}-postal`} name="postalCode" label="Postleitzahl" />
        <TextField id={`${idPrefix}-city`} name="city" label="Ort" required />
        <TextField
          id={`${idPrefix}-country`}
          name="countryCode"
          label="Ländercode"
          defaultValue="DE"
          maxLength={2}
        />
        <TextField id={`${idPrefix}-from`} name="validFrom" label="Gültig ab" type="date" />
        <TextField id={`${idPrefix}-until`} name="validUntil" label="Gültig bis" type="date" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPrimary" /> Als primäre Adresse verwenden
      </label>
      <Button type="submit" className="w-fit">
        Adresse hinzufügen
      </Button>
    </form>
  );
}

function RoleChecks({ selected }: { selected: readonly string[] }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">Kontaktrollen</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {(Object.entries(contactRoleLabels) as Array<[keyof typeof contactRoleLabels, string]>).map(
          ([role, label]) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="roles"
                value={role}
                defaultChecked={selected.includes(role)}
              />{' '}
              {label}
            </label>
          ),
        )}
      </div>
      <span className="text-sm text-slate-600">
        Haupt- und Notfallkontakt werden je Klient eindeutig gehalten.
      </span>
    </fieldset>
  );
}

function RelationshipOptions() {
  return (
    <>
      <option value="daughter">Tochter</option>
      <option value="son">Sohn</option>
      <option value="spouse">Ehepartner/in</option>
      <option value="relative">Angehörige/r</option>
      <option value="legal_representative">Gesetzliche Vertretung</option>
      <option value="guardian">Betreuer/in</option>
      <option value="other">Sonstige</option>
    </>
  );
}

function InsuranceOptions() {
  return (
    <>
      <option value="pflegeversicherung">Pflegeversicherung</option>
      <option value="krankenversicherung">Krankenversicherung</option>
      <option value="private">Privat</option>
      <option value="other">Sonstige</option>
    </>
  );
}

function TextField({
  id,
  name,
  label,
  type = 'text',
  defaultValue,
  required = false,
  maxLength,
  min,
  max,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
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
        min={min}
        max={max}
      />
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  value,
  required = false,
  children,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  value: string;
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
        defaultValue={value}
        required={required}
      >
        {children}
      </select>
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

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link className="rounded-md px-3 py-2 text-blue-900 hover:bg-blue-50" href={href}>
      {children}
    </Link>
  );
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function formatAddress(address: {
  street: string;
  houseNumber: string | null;
  postalCode: string | null;
  city: string;
  countryCode: string;
}): string {
  return [
    `${address.street}${address.houseNumber ? ` ${address.houseNumber}` : ''}`,
    [address.postalCode, address.city].filter(Boolean).join(' '),
    address.countryCode,
  ]
    .filter(Boolean)
    .join(', ');
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function genderLabel(value: string | null): string | null {
  return value === 'female'
    ? 'Weiblich'
    : value === 'male'
      ? 'Männlich'
      : value === 'diverse'
        ? 'Divers'
        : null;
}

function salutationLabel(value: string | null): string | null {
  return value === 'mr'
    ? 'Herr'
    : value === 'ms'
      ? 'Frau'
      : value === 'mx'
        ? 'Mx'
        : value === 'other'
          ? 'Andere'
          : null;
}

function addressTypeLabel(value: string): string {
  return value === 'home'
    ? 'Wohnadresse'
    : value === 'billing'
      ? 'Rechnungsadresse'
      : 'Weitere Adresse';
}

function relationshipLabel(value: string): string {
  return value === 'daughter'
    ? 'Tochter'
    : value === 'son'
      ? 'Sohn'
      : value === 'spouse'
        ? 'Ehepartner/in'
        : value === 'relative'
          ? 'Angehörige/r'
          : value === 'legal_representative'
            ? 'Gesetzliche Vertretung'
            : value === 'guardian'
              ? 'Betreuer/in'
              : 'Sonstige';
}

function pflegegradStatusLabel(value: string): string {
  return value === 'confirmed' ? 'Bestätigt' : value === 'pending' ? 'Ausstehend' : 'Widerrufen';
}

function organizationName(items: Array<{ id: string; name: string }>, id: string): string {
  return items.find((item) => item.id === id)?.name ?? 'Unbekannte Organisation';
}

function facilityName(items: Array<{ id: string; name: string }>, id: string): string {
  return items.find((item) => item.id === id)?.name ?? 'Unbekannte Einrichtung';
}
