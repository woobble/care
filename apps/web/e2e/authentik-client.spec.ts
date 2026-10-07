import { v7 as uuidv7 } from 'uuid';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { loadStorageConfig } from '@care/config';
import { createS3ObjectStorage } from '@care/storage';

test('Authentik users can be invited and administered from the office UI', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);

  const issuer = required('OIDC_ISSUER');
  const authentikOrigin = new URL(issuer).origin;
  const apiToken = required('AUTHENTIK_E2E_API_TOKEN');
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  const runId = uuidv7();
  const serviceValidFrom = new Date().toISOString().slice(0, 10);
  const username = `care-e2e-${runId}`;
  const displayName = `Care E2E ${runId}`;
  const email = `${username}@example.test`;
  const password = `Aa1!${uuidv7()}`;
  const invitedUsername = `care-invite-${runId}`;
  const invitedName = `Invitee E2E ${runId}`;
  const invitedEmail = `${invitedUsername}@example.test`;
  const invitedPassword = `Aa1!${uuidv7()}`;
  const caregiverUsername = `caregiver-e2e-${runId}`;
  const caregiverName = `Caregiver E2E ${runId}`;
  const caregiverEmail = `${caregiverUsername}@example.test`;
  const caregiverPassword = `Aa1!${uuidv7()}`;
  const executionMarker = `execution-note-${runId}`;
  let authentikUserId: number | undefined;
  let invitedAuthentikUserId: number | undefined;
  let caregiverAuthentikUserId: number | undefined;
  let subject: string | undefined;
  let invitedSubject: string | undefined;
  let caregiverSubject: string | undefined;
  let platformUserId: string | undefined;
  let invitedPlatformUserId: string | undefined;
  let caregiverPlatformUserId: string | undefined;
  let tenantId: string | undefined;
  let adminMembershipId: string | undefined;
  let invitedMembershipId: string | undefined;
  let caregiverMembershipId: string | undefined;
  let invitationId: string | undefined;
  let clientId: string | undefined;
  let agreementClientId: string | undefined;
  let serviceId: string | undefined;
  let executionVisitId: string | undefined;
  let initialEvidencePackageId: string | undefined;
  let replacementEvidencePackageId: string | undefined;
  let representativeContactId: string | undefined;
  const serviceCategoryName = `E2E Category ${runId}`;
  const codeSuffix = runId.slice(-24);
  const serviceCategoryCode = `E2E-CAT-${codeSuffix}`;
  const serviceCode = `E2E-SVC-${codeSuffix}`;
  const workforceOrganizationName = `E2E Organization ${runId}`;
  const workforceFacilityName = `E2E Facility ${runId}`;
  const workforceTeamName = `E2E Team ${runId}`;
  const workforcePersonnelNumber = `E2E-${runId}`;
  let invitedContext: BrowserContext | undefined;
  let caregiverContext: BrowserContext | undefined;

  await database.connect();
  try {
    await waitForAuthentik(authentikOrigin, issuer);
    const createdUser = await createAuthentikUser(authentikOrigin, apiToken, {
      username,
      name: displayName,
      email,
      password,
    });
    authentikUserId = createdUser.pk;
    subject = createdUser.uuid;
    await signInWithAuthentik(page, username, password);
    await expect(
      page.getByText('Ihr Benutzerkonto hat noch keinen aktiven Mandantenzugriff.'),
    ).toBeVisible();

    const provisioned = await waitForPlatformUser(database, issuer, subject);
    platformUserId = provisioned.id;
    expect(provisioned.membershipCount).toBe(0);

    const tenant = await database.query<{ id: string }>(
      "SELECT id FROM organizations.tenants WHERE slug = 'demo-care' AND active = true",
    );
    tenantId = tenant.rows[0]?.id;
    if (!tenantId) throw new Error('Demo Care tenant is missing; run the development seed');

    const adminRole = await database.query<{ id: string }>(
      "SELECT id FROM identity.roles WHERE tenant_id = $1 AND name = 'Administrator'",
      [tenantId],
    );
    const adminRoleId = adminRole.rows[0]?.id;
    if (!adminRoleId) throw new Error('Demo Care Administrator role is missing; run bun run seed');
    adminMembershipId = uuidv7();
    await database.query('BEGIN');
    try {
      await database.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [adminMembershipId, platformUserId, tenantId],
      );
      await database.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [adminMembershipId, tenantId, adminRoleId],
      );
      await database.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $3)`,
        [adminMembershipId, tenantId, tenantId],
      );
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }

    await page.reload();
    await page.getByLabel('Mandant').selectOption(tenantId);
    await page.getByRole('button', { name: 'Weiter' }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(
      page.getByRole('heading', { name: 'Klientinnen und Klienten', exact: true }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Klient anlegen' }).click();
    await expect(page).toHaveURL(/\/clients\/new$/);
    await page.locator('#firstName').fill('E2E');
    await page.locator('#lastName').fill(runId);
    await page.getByLabel('Organisation').selectOption({ label: 'Demo Pflegedienst' });
    await page.getByLabel('Primäre Einrichtung').selectOption({ label: 'Facility West' });
    await page.getByRole('button', { name: 'Klient anlegen' }).click();
    await expect(page.getByRole('heading', { name: `E2E ${runId}` })).toBeVisible();
    clientId = new URL(page.url()).pathname.split('/').at(-1);
    await expect(page.locator('span').filter({ hasText: /^Ausstehend$/ })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Adresse hinzufügen' }).click();
    await page.locator('#new-address-street').fill(`E2E Street ${runId}`);
    await page.locator('#new-address-house').fill('12');
    await page.locator('#new-address-postal').fill('10115');
    await page.locator('#new-address-city').fill('Berlin');
    const addressForm = page
      .locator('details')
      .filter({ hasText: 'Adresse hinzufügen' })
      .locator('form');
    await addressForm.locator('input[name="isPrimary"]').check();
    await addressForm.getByRole('button', { name: 'Adresse hinzufügen' }).click();
    await expect(page.getByRole('heading', { name: 'Wohnadresse · Primär' })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Kontakt hinzufügen' }).click();
    await page.locator('#new-contact-first').fill('E2E');
    await page.locator('#new-contact-last').fill('Kontakt');
    await page.locator('input[name="roles"][value="primary_contact"]').check();
    await page.locator('input[name="roles"][value="emergency_contact"]').check();
    await page.getByRole('button', { name: 'Kontakt hinzufügen' }).click();
    await expect(page.getByRole('heading', { name: 'E2E Kontakt' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Notfallkontakt' })).toBeChecked();

    await page.locator('summary').filter({ hasText: 'Versicherungsverhältnis hinzufügen' }).click();
    const insuranceForm = page
      .locator('details')
      .filter({ hasText: 'Versicherungsverhältnis hinzufügen' })
      .locator('form');
    await insuranceForm.locator('#new-insurer-name').fill('E2E Demo Insurance');
    await insuranceForm.locator('#new-insurance-number').fill(`E2E-PRIVATE-${runId}`);
    await insuranceForm.locator('input[name="isPrimary"]').check();
    await insuranceForm.getByRole('button', { name: 'Versicherung hinzufügen' }).click();
    await expect(page.getByRole('heading', { name: 'E2E Demo Insurance · Primär' })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Pflegegrad ergänzen' }).click();
    await page.locator('#new-grade').fill('3');
    await page.locator('#new-grade-from').fill('2000-01-01');
    await page.locator('#new-grade-status').selectOption('confirmed');
    await page.getByRole('button', { name: 'Pflegegrad speichern' }).click();
    await expect(page.getByText('Pflegegrad 3 · Bestätigt')).toBeVisible();
    await expect(page.getByText('Pflegegradverlauf ergänzt', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Aktivieren' }).click();
    await expect(page.locator('span').filter({ hasText: /^Aktiv$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Archivieren' }).click();
    await expect(page.locator('span').filter({ hasText: /^Archiviert$/ })).toBeVisible();

    await page.goto('/administration/organizations');
    await page.getByLabel('Name', { exact: true }).fill(workforceOrganizationName);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByRole('heading', { name: workforceOrganizationName })).toBeVisible();
    const workforceOrganizationRow = await database.query<{ id: string }>(
      'SELECT id FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [tenantId, workforceOrganizationName],
    );
    const workforceOrganizationId = workforceOrganizationRow.rows[0]?.id;
    if (!workforceOrganizationId) throw new Error('The office UI did not create the organization');

    await page.locator('#facility-name').fill(workforceFacilityName);
    await page.getByRole('button', { name: 'Create facility' }).click();
    await expect(page.getByRole('heading', { name: workforceFacilityName })).toBeVisible();
    const workforceFacilityRow = await database.query<{ id: string }>(
      'SELECT id FROM organizations.facilities WHERE tenant_id = $1 AND organization_id = $2 AND name = $3',
      [tenantId, workforceOrganizationId, workforceFacilityName],
    );
    const workforceFacilityId = workforceFacilityRow.rows[0]?.id;
    if (!workforceFacilityId) throw new Error('The office UI did not create the facility');

    await page.locator('#team-name').fill(workforceTeamName);
    await page.getByRole('button', { name: 'Create team' }).click();
    await expect(page.getByRole('heading', { name: workforceTeamName })).toBeVisible();
    const workforceTeamRow = await database.query<{ id: string }>(
      'SELECT id FROM organizations.teams WHERE tenant_id = $1 AND organization_id = $2 AND name = $3',
      [tenantId, workforceOrganizationId, workforceTeamName],
    );
    const workforceTeamId = workforceTeamRow.rows[0]?.id;
    if (!workforceTeamId) throw new Error('The office UI did not create the team');

    await page.goto('/employees/new');
    await page.getByLabel('Organisation').selectOption(workforceOrganizationId);
    await page.getByLabel('Vorname').fill('E2E');
    await page.getByLabel('Nachname').fill(runId);
    await page.getByLabel('Personalnummer').fill(workforcePersonnelNumber);
    await page.getByRole('button', { name: 'Mitarbeiter anlegen' }).click();
    await expect(page.getByRole('heading', { name: `E2E ${runId}` })).toBeVisible();
    const workforceEmployeeRow = await database.query<{ id: string }>(
      'SELECT id FROM employees.employees WHERE tenant_id = $1 AND personnel_number = $2',
      [tenantId, workforcePersonnelNumber],
    );
    const workforceEmployeeId = workforceEmployeeRow.rows[0]?.id;
    if (!workforceEmployeeId) throw new Error('The office UI did not create the employee');

    await page.getByLabel('Einrichtung zuweisen').selectOption(workforceFacilityId);
    await page.getByRole('button', { name: 'Einrichtung zuweisen' }).click();
    await expect(
      page.getByText(`${workforceFacilityName} · Hauptstandort`, { exact: true }),
    ).toBeVisible();
    await page.getByLabel('Team zuweisen').selectOption(workforceTeamId);
    await page.getByRole('button', { name: 'Team zuweisen' }).click();
    await expect(
      page.locator('#assignments article').filter({ hasText: workforceTeamName }),
    ).toBeVisible();
    await page
      .getByLabel('Qualifikation hinzufügen')
      .selectOption({ label: 'Pflegefachkraft (PFK)' });
    await page.getByRole('button', { name: 'Qualifikation speichern' }).click();
    await expect(
      page.locator('#qualifications li').filter({ hasText: 'Pflegefachkraft (PFK)' }),
    ).toBeVisible();
    expect(workforceEmployeeId).toMatch(/^[0-9a-f-]+$/i);

    await page.goto('/services');
    const categoryForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Kategorie anlegen' }),
    });
    await categoryForm.locator('input[name="name"]').fill(serviceCategoryName);
    await categoryForm.locator('input[name="code"]').fill(serviceCategoryCode);
    await page.getByRole('button', { name: 'Kategorie anlegen' }).click();
    await expect(page.locator(`input[name="code"][value="${serviceCategoryCode}"]`)).toBeVisible();
    await page.getByRole('link', { name: 'Leistung anlegen' }).click();
    await page.locator('#code').fill(serviceCode);
    await page.locator('#name').fill(`E2E Service ${runId}`);
    await page.locator('#categoryId').selectOption({ label: serviceCategoryName });
    await page.locator('#unit').selectOption('occurrence');
    await page.locator('#defaultDurationMinutes').fill('30');
    await page.locator('#validFrom').fill(serviceValidFrom);
    await page.getByRole('button', { name: 'Leistung anlegen' }).click();
    await expect(page.getByRole('heading', { name: `E2E Service ${runId}` })).toBeVisible();
    serviceId = new URL(page.url()).pathname.split('/').at(-1);
    await page.locator(`input[name="organizationIds"][value="${workforceOrganizationId}"]`).check();
    await page.locator(`input[name="facilityIds"][value="${workforceFacilityId}"]`).check();
    await page.getByRole('button', { name: 'Verfügbarkeit speichern' }).click();
    await expect(page.getByRole('table').getByText(workforceFacilityName)).toBeVisible();

    await page.goto('/clients/new');
    await page.getByLabel('Organisation').selectOption(workforceOrganizationId);
    await page.getByLabel('Primäre Einrichtung').selectOption(workforceFacilityId);
    await page.getByLabel('Vorname').fill('Agreement E2E');
    await page.getByLabel('Nachname').fill(runId);
    await page.getByRole('button', { name: 'Klient anlegen' }).click();
    await expect(page.getByRole('heading', { name: `Agreement E2E ${runId}` })).toBeVisible();
    agreementClientId = new URL(page.url()).pathname.split('/').at(-1);
    if (!agreementClientId) throw new Error('The client detail page did not expose its ID');
    representativeContactId = uuidv7();
    await database.query(
      `INSERT INTO clients.client_contacts
         (id, tenant_id, client_id, first_name, last_name, relationship_type,
          representation_type, representation_valid_from, representation_valid_until,
          created_at, updated_at)
       VALUES ($1, $2, $3, 'E2E', 'Representative', 'legal_representative',
               'power_of_attorney', '2000-01-01', '2099-12-31', now(), now())`,
      [representativeContactId, tenantId, agreementClientId],
    );
    await database.query(
      `INSERT INTO clients.client_contact_roles (tenant_id, client_id, contact_id, role)
       VALUES ($1, $2, $3, 'legal_representative')`,
      [tenantId, agreementClientId, representativeContactId],
    );
    await page.getByRole('button', { name: 'Aktivieren' }).click();
    await expect(page.locator('span').filter({ hasText: /^Aktiv$/ })).toBeVisible();
    await page.getByRole('link', { name: 'Leistungsplanung' }).click();
    await expect(page.getByRole('heading', { name: 'Leistungsplanung' })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Leistungsplanung anlegen' }).click();
    await page.locator('#new-agreement-from').fill(serviceValidFrom);
    await page.locator('#new-agreement-reference').fill(`E2E-${runId}`);
    await page.getByRole('button', { name: 'Entwurf anlegen' }).click();
    await expect(page.getByRole('heading', { name: `E2E-${runId}` })).toBeVisible();
    const agreementCard = page.locator('article[id^="agreement-"]');

    await page.getByRole('button', { name: 'Verfügbare Leistungen suchen' }).click();
    const servicePicker = page.locator('select[name="serviceDefinitionId"]');
    const serviceOption = servicePicker.locator('option').filter({
      hasText: `E2E Service ${runId}`,
    });
    const serviceOptionValue = await serviceOption.getAttribute('value');
    if (!serviceOptionValue)
      throw new Error('The agreement service picker did not include the service');
    await servicePicker.selectOption(serviceOptionValue);
    const agreementServiceForm = page.locator('form').filter({ has: servicePicker });
    await agreementServiceForm.locator('input[name="quantity"]').fill('1');
    await agreementServiceForm.locator('select[name="cadence"]').selectOption('weekly');
    await agreementServiceForm.locator('input[name="weekdays"][value="monday"]').check();
    await agreementServiceForm.locator('input[name="weekdays"][value="wednesday"]').check();
    await agreementServiceForm.locator('input[name="preferredTimeStart"]').fill('08:00');
    await agreementServiceForm.locator('input[name="preferredTimeEnd"]').fill('09:00');
    await agreementServiceForm.getByRole('button', { name: 'Leistung hinzufügen' }).click();
    await expect(page.getByRole('heading', { name: `E2E Service ${runId}` })).toBeVisible();
    await expect(page.getByText('Wöchentlich: Montag, Mittwoch')).toBeVisible();

    await page.getByRole('button', { name: 'Aktivieren', exact: true }).click();
    await expect(page.getByText('Leistungsplanung aktiviert', { exact: true })).toBeVisible();
    await expect(agreementCard.getByText('Aktiv', { exact: true }).first()).toBeVisible();

    const generationFrom = addCalendarDays(dateInBerlin(), 1);
    const generationUntil = addCalendarDays(generationFrom, 6);
    const generationDetails = page
      .locator('details')
      .filter({ hasText: 'Besuche erzeugen' })
      .first();
    await generationDetails.locator('summary').click();
    const generationForm = generationDetails.locator('form');
    await generationForm.locator('input[name="from"]').fill(generationFrom);
    await generationForm.locator('input[name="until"]').fill(generationUntil);
    await generationForm.getByRole('button', { name: 'Besuche erzeugen' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Besuchserzeugung abgeschlossen.' }),
    ).toBeVisible();
    const generatedRows = await database.query<{ id: string; planned_start: Date }>(
      `SELECT id, planned_start FROM scheduling.visits
       WHERE tenant_id = $1 AND client_id = $2 AND service_agreement_id IS NOT NULL
       ORDER BY planned_start, id`,
      [tenantId, agreementClientId],
    );
    const generatedVisit = generatedRows.rows[0];
    if (!generatedVisit) throw new Error('The agreement UI did not generate a visit');
    const generatedDate = dateInTimezone(generatedVisit.planned_start, 'Europe/Berlin');
    await page.goto(`/planning?clientId=${agreementClientId}&date=${generatedDate}`);
    await expect(page.getByRole('heading', { name: 'Einsatzplanung' })).toBeVisible();
    const generatedVisitLink = page.locator(`a[href="/visits/${generatedVisit.id}"]`);
    await expect(generatedVisitLink).toContainText(`Agreement E2E ${runId}`);
    await generatedVisitLink.click();
    await expect(page.getByRole('heading', { name: `Agreement E2E ${runId}` })).toBeVisible();
    await page.getByLabel('Mitarbeitende zuweisen').selectOption(workforceEmployeeId);
    await page.getByRole('button', { name: 'Zuweisen' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Mitarbeitende' })
        .getByRole('listitem')
        .filter({ hasText: `E2E ${runId}` }),
    ).toBeVisible();

    await page.getByLabel('Beginn', { exact: true }).fill('08:15');
    await page.getByLabel('Ende', { exact: true }).fill('08:45');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Ja', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Bestätigen' }).click();
    await expect(page.getByText('Bestätigt', { exact: true })).toBeVisible();

    await page.goto(`/clients/${agreementClientId}`);
    await expect(page.getByRole('heading', { name: 'Kommende Einsätze' })).toBeVisible();
    await expect(page.getByText(`Agreement E2E ${runId}`, { exact: true })).toBeVisible();
    await page.goto(`/employees/${workforceEmployeeId}`);
    await expect(page.getByRole('heading', { name: 'Kommende Einsätze' })).toBeVisible();
    await expect(page.getByText(`Agreement E2E ${runId}`, { exact: true })).toBeVisible();

    await page.goto(`/visits/${generatedVisit.id}`);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Einsatz absagen' }).click();
    await expect(page.getByText('Abgesagt', { exact: true })).toBeVisible();
    const remainingVisits = await database.query<{ id: string; status: string }>(
      `SELECT id, status FROM scheduling.visits
       WHERE tenant_id = $1 AND client_id = $2 AND service_agreement_id IS NOT NULL
         AND status <> 'cancelled'
       ORDER BY planned_start, id`,
      [tenantId, agreementClientId],
    );
    for (const visit of remainingVisits.rows) {
      await page.goto(`/visits/${visit.id}`);
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Einsatz absagen' }).click();
      await expect(page.getByText('Abgesagt', { exact: true })).toBeVisible();
    }

    await page.goto(`/clients/${agreementClientId}/service-agreements`);
    await expect(page.getByRole('heading', { name: 'Leistungsplanung' })).toBeVisible();
    await page.getByRole('button', { name: 'Pausieren' }).click();
    await expect(agreementCard.getByText('Pausiert', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Fortsetzen' }).click();
    await expect(agreementCard.getByText('Aktiv', { exact: true }).first()).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Beenden', exact: true }).click();
    await expect(agreementCard.getByText('Beendet', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Leistungsplanung beendet', { exact: true })).toBeVisible();

    const caregiver = await createAuthentikUser(authentikOrigin, apiToken, {
      username: caregiverUsername,
      name: caregiverName,
      email: caregiverEmail,
      password: caregiverPassword,
      emailVerified: true,
    });
    caregiverAuthentikUserId = caregiver.pk;
    caregiverSubject = caregiver.uuid;
    caregiverContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const caregiverPage = await caregiverContext.newPage();
    await signInWithAuthentik(caregiverPage, caregiverUsername, caregiverPassword);
    await expect(
      caregiverPage.getByText('Ihr Benutzerkonto hat noch keinen aktiven Mandantenzugriff.'),
    ).toBeVisible();
    const caregiverProvision = await waitForPlatformUser(database, issuer, caregiverSubject);
    caregiverPlatformUserId = caregiverProvision.id;
    expect(caregiverProvision.membershipCount).toBe(0);
    const caregiverRole = await database.query<{ id: string }>(
      "SELECT id FROM identity.roles WHERE tenant_id = $1 AND name = 'Caregiver'",
      [tenantId],
    );
    const caregiverRoleId = caregiverRole.rows[0]?.id;
    if (!caregiverRoleId || !caregiverPlatformUserId) {
      throw new Error('The seeded Caregiver role or provisioned caregiver user is missing');
    }
    caregiverMembershipId = uuidv7();
    await database.query('BEGIN');
    try {
      await database.query(
        `INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [caregiverMembershipId, caregiverPlatformUserId, tenantId],
      );
      await database.query(
        `INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id)
         VALUES ($1, $2, $3)`,
        [caregiverMembershipId, tenantId, caregiverRoleId],
      );
      await database.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $3)`,
        [caregiverMembershipId, tenantId, tenantId],
      );
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }

    await page.goto(`/employees/${workforceEmployeeId}`);
    await page.getByLabel('Aktiven Benutzer verknüpfen').selectOption(caregiverPlatformUserId);
    await page.getByRole('button', { name: 'Benutzer verknüpfen' }).click();
    await expect(page.getByText(caregiverName, { exact: true })).toBeVisible();

    if (!serviceId || !agreementClientId) {
      throw new Error('The E2E service and client must exist before execution');
    }
    await page.goto(`/services/${serviceId}`);
    await expect(page.getByRole('heading', { name: `E2E Service ${runId}` })).toBeVisible();
    const executionDate = dateInBerlin();
    await page.goto(`/planning?date=${executionDate}`);
    const manualVisitForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Einsatz anlegen' }),
    });
    await manualVisitForm.getByLabel('Klientin oder Klient').selectOption(agreementClientId);
    await manualVisitForm.locator('input[name="localDate"]').fill(executionDate);
    await manualVisitForm.locator('input[name="localStartTime"]').fill('08:00');
    await manualVisitForm.locator('input[name="localEndTime"]').fill('08:30');
    await manualVisitForm.locator('select[name="serviceDefinitionIds"]').selectOption(serviceId);
    await manualVisitForm.locator('select[name="employeeId"]').selectOption(workforceEmployeeId);
    await manualVisitForm.locator('textarea[name="note"]').fill(executionMarker);
    await manualVisitForm.getByRole('button', { name: 'Einsatz anlegen' }).click();
    await expect(page).toHaveURL(/(?:\?|&)updated=visit(?:&|$)/);
    const executionVisit = await database.query<{ id: string }>(
      'SELECT id FROM scheduling.visits WHERE tenant_id = $1 AND note = $2',
      [tenantId, executionMarker],
    );
    executionVisitId = executionVisit.rows[0]?.id;
    if (!executionVisitId) {
      throw new Error('The Office UI reported success but the execution visit was not persisted');
    }

    await caregiverPage.goto('/');
    await caregiverPage.getByLabel('Mandant').selectOption(tenantId);
    await caregiverPage.getByRole('button', { name: 'Weiter' }).click();
    await expect(caregiverPage).toHaveURL(/\/clients$/);
    await caregiverPage.goto('/care/today');
    await expect(caregiverPage).toHaveURL(/\/care\/today$/);
    await expect(caregiverPage.getByRole('heading', { name: 'Meine Einsätze' })).toBeVisible();
    const mobileVisitLink = caregiverPage.locator(`a[href="/care/visits/${executionVisitId}"]`);
    await expect(mobileVisitLink).toContainText(`Agreement E2E ${runId}`);
    await mobileVisitLink.click();
    await expect(
      caregiverPage.getByRole('heading', { name: `Agreement E2E ${runId}` }),
    ).toBeVisible();
    expect(
      await caregiverPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await caregiverPage.getByRole('button', { name: 'Einsatz starten' }).click();
    await expect(caregiverPage.getByText('In Bearbeitung', { exact: true })).toBeVisible();
    await expect(caregiverPage.getByRole('heading', { name: 'Geplante Leistungen' })).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Ergebnis speichern' }).click();
    await expect(caregiverPage.getByRole('status')).toContainText('Leistungsergebnis gespeichert.');

    const unplannedForm = caregiverPage.locator('form').filter({
      has: caregiverPage.getByRole('button', { name: 'Leistung erfassen' }),
    });
    await unplannedForm.locator('select[name="serviceDefinitionId"]').selectOption(serviceId);
    await unplannedForm.getByRole('button', { name: 'Leistung erfassen' }).click();
    await expect(
      caregiverPage.getByRole('heading', { name: 'Zusätzlich erfasste Leistungen' }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Dokumentation beginnen' }).click();
    await expect(
      caregiverPage.getByRole('heading', { name: 'Leistungsdokumentation' }),
    ).toBeVisible();

    const observationText = `E2E observation ${runId}`;
    const observationSection = caregiverPage
      .getByRole('heading', { name: 'Beobachtungen' })
      .locator('..');
    await observationSection.locator('textarea[name="content"]').fill(observationText);
    await observationSection.getByRole('button', { name: 'Eintrag speichern' }).click();
    await expect(
      observationSection.locator('li > p').filter({ hasText: observationText }),
    ).toBeVisible();

    const deviationText = `E2E deviation ${runId}`;
    const deviationSection = caregiverPage
      .getByRole('heading', { name: 'Abweichungen' })
      .locator('..');
    await deviationSection.locator('textarea[name="content"]').fill(deviationText);
    await deviationSection.getByRole('button', { name: 'Eintrag speichern' }).click();
    await expect(
      deviationSection.locator('li > p').filter({ hasText: deviationText }),
    ).toBeVisible();

    const incidentText = `E2E incident ${runId}`;
    const incidentSection = caregiverPage.getByRole('heading', { name: 'Vorfälle' }).locator('..');
    await incidentSection.locator('textarea[name="content"]').fill(incidentText);
    await incidentSection.locator('select[name="severity"]').selectOption('low');
    await incidentSection.getByRole('button', { name: 'Eintrag speichern' }).click();
    await expect(incidentSection.locator('li > p').filter({ hasText: incidentText })).toBeVisible();
    await expect(
      caregiverPage
        .getByRole('heading', { name: 'Dokumentation finalisieren' })
        .locator('..')
        .getByText(/Leistungsnachweis fehlt/)
        .first(),
    ).toBeVisible();

    await caregiverPage.getByRole('button', { name: 'Einsatz abschließen' }).click();
    await expect(caregiverPage.getByText('Abgeschlossen', { exact: true })).toBeVisible();

    await caregiverPage.goto('/care/today');
    await expect(
      caregiverPage.getByText('⚠ Dokumentation unvollständig', { exact: true }),
    ).toBeVisible();
    await page.goto('/documentation');
    await expect(page.getByRole('heading', { name: 'Unvollständige Dokumentation' })).toBeVisible();
    await expect(page.getByText(`Agreement E2E ${runId}`, { exact: true })).toBeVisible();
    const documentationClientFilter = page.getByLabel('Klient');
    await documentationClientFilter.fill(`Agreement E2E ${runId}`);
    await page.getByRole('button', { name: 'Filter anwenden' }).click();
    await expect(page.getByText('1 Einsätze', { exact: true })).toBeVisible();
    await documentationClientFilter.fill('Unknown client');
    await page.getByRole('button', { name: 'Filter anwenden' }).click();
    await expect(page.getByText('0 Einsätze', { exact: true })).toBeVisible();

    await caregiverPage.goto(`/care/visits/${executionVisitId}`);
    const evidenceSection = caregiverPage
      .getByRole('heading', { name: 'Leistungsdokumentation' })
      .locator('..');
    const evidenceRows = evidenceSection.locator('li');
    await expect(evidenceRows).toHaveCount(2);
    for (let index = 0; index < (await evidenceRows.count()); index += 1) {
      const row = evidenceRows.nth(index);
      await row.locator('textarea[name="note"]').fill(`E2E service evidence ${index + 1} ${runId}`);
      await row.getByRole('button', { name: 'Nachweis speichern' }).click();
      await expect(row.getByText('Nachweis erfasst', { exact: true })).toBeVisible();
    }
    await expect(
      caregiverPage.getByRole('button', { name: 'Dokumentation finalisieren' }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Dokumentation finalisieren' }).click();
    await expect(caregiverPage.getByText('Finalisiert', { exact: true })).toBeVisible();
    await expect(caregiverPage.getByRole('button', { name: 'Eintrag speichern' })).toHaveCount(0);
    await expect(caregiverPage.getByRole('button', { name: 'Nachweis speichern' })).toHaveCount(0);

    await caregiverPage.goto(`/care/visits/${executionVisitId}/evidence`);
    await expect(
      caregiverPage.getByRole('heading', { name: 'Leistungsnachweis prüfen' }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Leistungsnachweis erstellen' }).click();
    await expect(caregiverPage.getByText('Version 1', { exact: true })).toBeVisible();
    await expect(
      caregiverPage.getByText(`E2E Service ${runId}`, { exact: true }).first(),
    ).toBeVisible();
    const firstSignaturePad = caregiverPage.getByRole('img', {
      name: /Unterschriftsfeld/,
    });
    await firstSignaturePad.scrollIntoViewIfNeeded();
    const signatureBounds = await firstSignaturePad.boundingBox();
    if (!signatureBounds) throw new Error('The mobile signature pad is not visible');
    await caregiverPage.mouse.move(
      signatureBounds.x + signatureBounds.width * 0.2,
      signatureBounds.y + signatureBounds.height * 0.6,
    );
    await caregiverPage.mouse.down();
    await caregiverPage.mouse.move(
      signatureBounds.x + signatureBounds.width * 0.45,
      signatureBounds.y + signatureBounds.height * 0.35,
      { steps: 4 },
    );
    await caregiverPage.mouse.move(
      signatureBounds.x + signatureBounds.width * 0.75,
      signatureBounds.y + signatureBounds.height * 0.55,
      { steps: 4 },
    );
    await caregiverPage.mouse.up();
    await caregiverPage.once('dialog', (dialog) => dialog.accept());
    const signatureSubmit = caregiverPage.getByRole('button', { name: 'Unterschrift bestätigen' });
    await expect(signatureSubmit).toBeEnabled();
    await signatureSubmit.click();
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Leistungsnachweis bestätigt' }),
    ).toBeVisible();
    expect(
      await caregiverPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const firstPackage = await database.query<{ id: string }>(
      `SELECT package.id
       FROM service_evidence.evidence_packages AS package
       JOIN care_documentation.documents AS documentation
         ON documentation.tenant_id = package.tenant_id AND documentation.id = package.documentation_id
       WHERE package.tenant_id = $1 AND documentation.visit_id = $2
       ORDER BY package.version DESC LIMIT 1`,
      [tenantId, executionVisitId],
    );
    initialEvidencePackageId = firstPackage.rows[0]?.id;
    if (!initialEvidencePackageId) throw new Error('The first evidence package was not persisted');

    await page.goto(`/visits/${executionVisitId}`);
    await expect(page.getByRole('heading', { name: 'Ausführung' })).toBeVisible();
    await expect(page.getByText('Einsatz abgeschlossen', { exact: true })).toBeVisible();
    await expect(page.getByText(`E2E Service ${runId}`, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(observationText, { exact: true })).toBeVisible();
    await expect(page.getByText(deviationText, { exact: true })).toBeVisible();
    await expect(page.getByText(incidentText, { exact: true })).toBeVisible();
    const amendmentDetails = page.locator('details').filter({ hasText: 'Dokumentation ergänzen' });
    await amendmentDetails.locator('summary').click();
    await amendmentDetails.locator('input[name="reason"]').fill(`E2E correction reason ${runId}`);
    await amendmentDetails.locator('textarea[name="correction"]').fill(`E2E amendment ${runId}`);
    await amendmentDetails.getByRole('button', { name: 'Ergänzung speichern' }).click();
    await expect(page.getByText(`E2E amendment ${runId}`, { exact: true })).toBeVisible();
    const correctionDetails = page
      .locator('details')
      .filter({ hasText: 'Ausführungszeiten korrigieren' });
    await correctionDetails.locator('summary').click();
    const actualStartInput = correctionDetails.locator('input[name="actualStart"]');
    await actualStartInput.fill(shiftDateTimeLocal(await actualStartInput.inputValue(), -1));
    await correctionDetails.locator('textarea[name="reason"]').fill('E2E correction reason');
    await correctionDetails.getByRole('button', { name: 'Zeiten korrigieren' }).click();
    await expect(page.getByText('Einsatzzeiten korrigiert', { exact: true })).toBeVisible();

    await caregiverPage.goto(`/care/visits/${executionVisitId}/evidence`);
    await expect(
      caregiverPage.getByText('Neue Version erforderlich', { exact: true }),
    ).toBeVisible();
    await expect(
      caregiverPage.getByText('Die frühere Bestätigung bleibt erhalten', { exact: false }),
    ).toBeVisible();
    await caregiverPage
      .getByRole('button', { name: 'Aktuellen Leistungsnachweis erstellen' })
      .click();
    await expect(caregiverPage.getByText('Version 2', { exact: true })).toBeVisible();
    const signatoryPicker = caregiverPage.getByLabel('Unterzeichnende Person auswählen');
    await signatoryPicker.selectOption(`representative:${representativeContactId}`);
    await caregiverPage.locator('input[name="method-choice"][value="typed_confirmation"]').check();
    await caregiverPage.locator('input[name="confirmationName"]').fill('E2E Representative');
    await caregiverPage.once('dialog', (dialog) => dialog.accept());
    await caregiverPage.getByRole('button', { name: 'Bestätigung erfassen' }).click();
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Leistungsnachweis bestätigt' }),
    ).toBeVisible();
    const replacementPackage = await database.query<{ id: string; version: number }>(
      `SELECT package.id, package.version
       FROM service_evidence.evidence_packages AS package
       JOIN care_documentation.documents AS documentation
         ON documentation.tenant_id = package.tenant_id AND documentation.id = package.documentation_id
       WHERE package.tenant_id = $1 AND documentation.visit_id = $2
       ORDER BY package.version DESC LIMIT 1`,
      [tenantId, executionVisitId],
    );
    replacementEvidencePackageId = replacementPackage.rows[0]?.id;
    if (replacementPackage.rows[0]?.version !== 2 || !replacementEvidencePackageId) {
      throw new Error('The replacement evidence package was not persisted as version 2');
    }

    await page.goto(
      `/service-evidence?clientQuery=${encodeURIComponent(`Agreement E2E ${runId}`)}`,
    );
    await expect(page.getByRole('heading', { name: 'Leistungsnachweise' })).toBeVisible();
    const acknowledgedRow = page
      .getByRole('row')
      .filter({ hasText: `Agreement E2E ${runId}` })
      .filter({ hasText: 'Bestätigt' });
    await expect(acknowledgedRow).toContainText('E2E Representative');
    await expect(acknowledgedRow.getByRole('link')).toHaveAttribute(
      'href',
      `/service-evidence/${replacementEvidencePackageId}`,
    );
    await acknowledgedRow.getByRole('link').click();
    await expect(page.getByText('E2E Representative', { exact: true })).toBeVisible();
    await expect(page.getByText('bevollmächtigte Vertretung', { exact: true })).toBeVisible();
    await expect(page.getByText('Namensbestätigung', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Version 1 · Ersetzt' })).toHaveAttribute(
      'href',
      `/service-evidence/${initialEvidencePackageId}`,
    );
    await page.getByRole('link', { name: 'Version 1 · Ersetzt' }).click();
    await expect(page.getByRole('img', { name: 'Gespeicherte Unterschrift' })).toBeVisible();
    await page.goto(`/service-evidence/${replacementEvidencePackageId}`);
    const revokeForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Bestätigung widerrufen' }),
    });
    await revokeForm.locator('input[name="reason"]').fill(`E2E revocation ${runId}`);
    await page.once('dialog', (dialog) => dialog.accept());
    await revokeForm.getByRole('button', { name: 'Bestätigung widerrufen' }).click();
    await expect(page.getByRole('status')).toContainText('Bestätigung wurde widerrufen');
    await expect(page.getByText('Widerrufen', { exact: true }).first()).toBeVisible();

    await caregiverPage.goto(`/care/visits/${executionVisitId}/evidence`);
    await caregiverPage
      .getByLabel('Unterzeichnende Person auswählen')
      .selectOption(`representative:${representativeContactId}`);
    await caregiverPage
      .locator('details')
      .filter({
        hasText: 'Bestätigung abgelehnt oder nicht möglich',
      })
      .locator('summary')
      .click();
    const declineForm = caregiverPage.locator('form').filter({
      has: caregiverPage.getByRole('button', { name: 'Ablehnung erfassen' }),
    });
    await declineForm.locator('select[name="reasonCode"]').selectOption('disagrees_with_record');
    await declineForm.locator('textarea[name="note"]').fill(`E2E decline note ${runId}`);
    await caregiverPage.once('dialog', (dialog) => dialog.accept());
    await declineForm.getByRole('button', { name: 'Ablehnung erfassen' }).click();
    await expect(
      caregiverPage
        .getByRole('status')
        .filter({ hasText: 'Die Ablehnung wurde für diese Version festgehalten' }),
    ).toBeVisible();
    expect(
      await caregiverPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await page.goto(`/clients/${agreementClientId}`);
    await expect(page.getByText('Einsatz begonnen', { exact: true })).toBeVisible();
    await expect(page.getByText('Einsatz abgeschlossen', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Besuchsdokumentation abgeschlossen', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Vorfall dokumentiert', { exact: true })).toBeVisible();
    await expect(page.getByText('Besuchsdokumentation ergänzt', { exact: true })).toBeVisible();
    const clientExecutionRow = page.locator(`a[href="/visits/${executionVisitId}"]`);
    await expect(clientExecutionRow).toContainText('Ausführung: Abgeschlossen');
    await expect(clientExecutionRow).toContainText('Tatsächlich');
    await page.goto(`/employees/${workforceEmployeeId}`);
    const employeeExecutionRow = page.locator(`a[href="/visits/${executionVisitId}"]`);
    await expect(employeeExecutionRow).toContainText('Ausführung: Abgeschlossen');
    await expect(employeeExecutionRow).toContainText('Tatsächlich');

    if (!serviceId) throw new Error('The service detail page did not expose its ID');
    await page.goto(`/services/${serviceId}`);
    await page.getByRole('button', { name: 'Leistung archivieren' }).click();
    await expect(page.locator('span').filter({ hasText: /^Archiviert$/ })).toBeVisible();
    if (executionVisitId) {
      await page.goto(`/visits/${executionVisitId}`);
      await expect(page.getByText(`E2E Service ${runId}`, { exact: true }).first()).toBeVisible();
    }

    await page.goto('/administration/users');
    await expect(page.getByRole('heading', { name: 'Users & Access' })).toBeVisible();
    await page.getByLabel('Email').fill(invitedEmail);
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Invitation created.' })).toBeVisible();
    const pendingInvitation = await database.query<{ id: string }>(
      "SELECT id FROM identity.tenant_invitations WHERE tenant_id = $1 AND email = $2 AND status = 'pending'",
      [tenantId, invitedEmail],
    );
    invitationId = pendingInvitation.rows[0]?.id;
    if (!invitationId) throw new Error('The administration UI did not create an invitation');

    const invitee = await createAuthentikUser(authentikOrigin, apiToken, {
      username: invitedUsername,
      name: invitedName,
      email: invitedEmail,
      password: invitedPassword,
      emailVerified: true,
    });
    invitedAuthentikUserId = invitee.pk;
    invitedSubject = invitee.uuid;
    invitedContext = await browser.newContext();
    const invitedPage = await invitedContext.newPage();
    await signInWithAuthentik(invitedPage, invitedUsername, invitedPassword);
    await expect(
      invitedPage.getByText('Ihr Benutzerkonto hat noch keinen aktiven Mandantenzugriff.'),
    ).toBeVisible();
    const invitedProvision = await waitForPlatformUser(database, issuer, invitedSubject);
    invitedPlatformUserId = invitedProvision.id;
    expect(invitedProvision.membershipCount).toBe(1);
    const pendingMembership = await database.query<{ id: string; status: string }>(
      'SELECT id, status FROM identity.tenant_memberships WHERE user_id = $1 AND tenant_id = $2',
      [invitedPlatformUserId, tenantId],
    );
    invitedMembershipId = pendingMembership.rows[0]?.id;
    expect(pendingMembership.rows[0]?.status).toBe('pending');

    const roleAndScope = await database.query<{ office_role_id: string; facility_id: string }>(
      `SELECT role.id AS office_role_id, facility.id AS facility_id
       FROM identity.roles AS role
       CROSS JOIN organizations.facilities AS facility
       WHERE role.tenant_id = $1 AND role.name = 'Office'
         AND facility.tenant_id = $1 AND facility.name = 'Facility West'`,
      [tenantId],
    );
    const officeRoleId = roleAndScope.rows[0]?.office_role_id;
    const facilityWestId = roleAndScope.rows[0]?.facility_id;
    if (!invitedMembershipId || !officeRoleId || !facilityWestId) {
      throw new Error('Seeded member, Office role, or Facility West is missing');
    }

    await page.goto('/administration/users');
    await page.getByRole('link', { name: invitedName }).click();
    await expect(page.getByRole('heading', { name: invitedName })).toBeVisible();
    await page.locator(`input[name="roleId"][value="${officeRoleId}"]`).check();
    await page.getByRole('button', { name: 'Save roles' }).click();
    await expect(page.getByText('Member access updated.')).toBeVisible();
    await page.locator(`input[name="roleId"][value="${officeRoleId}"]`).uncheck();
    await page.getByRole('button', { name: 'Save roles' }).click();
    await expect(page.getByText('Member access updated.')).toBeVisible();
    await expect(page.locator(`input[name="roleId"][value="${officeRoleId}"]`)).not.toBeChecked();
    await page.locator(`input[name="roleId"][value="${officeRoleId}"]`).check();
    await page.getByRole('button', { name: 'Save roles' }).click();
    await expect(page.getByText('Member access updated.')).toBeVisible();

    await page.locator('input[name="scopeMode"][value="scoped"]').check();
    const facilityScope = page.locator(`input[name="scope"][value="facility:${facilityWestId}"]`);
    await facilityScope.check();
    await page.getByRole('button', { name: 'Save scopes' }).click();
    await expect(page.getByText('Member access updated.')).toBeVisible();
    await facilityScope.uncheck();
    await page.getByRole('button', { name: 'Save scopes' }).click();
    await expect(page.getByText('Member access updated.')).toBeVisible();
    await expect(facilityScope).not.toBeChecked();
    await facilityScope.check();
    await page.getByRole('button', { name: 'Save scopes' }).click();
    await expect(page.getByText('Member access updated.')).toBeVisible();
    await page.getByRole('button', { name: 'Activate membership' }).click();
    await expect(page.getByText('Aktiv', { exact: true })).toBeVisible();
    await expect(page.getByText('Office', { exact: true })).toBeVisible();
    await expect(
      page.locator(`input[name="scope"][value="facility:${facilityWestId}"]`),
    ).toBeChecked();

    await page.goto('/administration/audit');
    await expect(page.getByText('tenant.member.activated')).toBeVisible();

    await invitedPage.goto('/');
    await invitedPage.getByLabel('Mandant').selectOption(tenantId);
    await invitedPage.getByRole('button', { name: 'Weiter' }).click();
    await expect(invitedPage).toHaveURL(/\/clients$/);
    await invitedPage.goto('/administration/facilities');
    await expect(invitedPage.getByText('Facility West', { exact: true })).toBeVisible();
    await expect(invitedPage.getByText('Main Office', { exact: true })).toHaveCount(0);

    await page.goto(`/administration/users/${invitedMembershipId}`);
    await page.getByRole('button', { name: 'Deactivate membership' }).click();
    await expect(page.getByText('Inaktiv', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Activate membership' }).click();
    await expect(page.getByText('Aktiv', { exact: true })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Revoke access' }).click();
    await expect(page.getByText('Widerrufen', { exact: true })).toBeVisible();
    await expect(page.getByText('Revoked memberships cannot be reactivated.')).toBeVisible();
  } finally {
    try {
      await Promise.all(
        [caregiverContext, invitedContext]
          .filter((context): context is BrowserContext => context !== undefined)
          .map((context) => context.close().catch(() => undefined)),
      );
      if (tenantId) {
        const agreementClientIds = [agreementClientId].filter(
          (id): id is string => id !== undefined,
        );
        if (agreementClientIds.length) {
          await cleanupServiceAgreementRecords(
            database,
            tenantId,
            agreementClientIds,
            [executionVisitId].filter((id): id is string => id !== undefined),
          );
        }
        await cleanupServiceCatalogRecords(database, tenantId, {
          serviceCode,
          serviceCategoryCode,
        });
        await database.query(
          'UPDATE employees.employees SET user_id = NULL WHERE tenant_id = $1 AND personnel_number = $2',
          [tenantId, workforcePersonnelNumber],
        );
      }
      await cleanup(database, {
        issuer,
        users: [
          {
            ...(subject ? { subject } : {}),
            ...(platformUserId ? { userId: platformUserId } : {}),
          },
          {
            ...(invitedSubject ? { subject: invitedSubject } : {}),
            ...(invitedPlatformUserId ? { userId: invitedPlatformUserId } : {}),
          },
          {
            ...(caregiverSubject ? { subject: caregiverSubject } : {}),
            ...(caregiverPlatformUserId ? { userId: caregiverPlatformUserId } : {}),
          },
        ],
        membershipIds: [adminMembershipId, invitedMembershipId, caregiverMembershipId].filter(
          (id): id is string => id !== undefined,
        ),
        invitationIds: invitationId ? [invitationId] : [],
        invitationEmails: [invitedEmail, caregiverEmail],
        ...(tenantId ? { tenantId } : {}),
        ...(clientId || agreementClientId
          ? {
              clientIds: [clientId, agreementClientId].filter(
                (id): id is string => id !== undefined,
              ),
            }
          : {}),
      });
      if (tenantId) {
        await cleanupWorkforceRecords(database, tenantId, {
          organizationName: workforceOrganizationName,
          facilityName: workforceFacilityName,
          teamName: workforceTeamName,
          personnelNumber: workforcePersonnelNumber,
        });
      }
    } finally {
      await database.end();
      if (authentikUserId !== undefined) {
        await authentikRequest(
          authentikOrigin,
          apiToken,
          `/api/v3/core/users/${authentikUserId}/`,
          { method: 'DELETE' },
          true,
        );
      }
      if (invitedAuthentikUserId !== undefined) {
        await authentikRequest(
          authentikOrigin,
          apiToken,
          `/api/v3/core/users/${invitedAuthentikUserId}/`,
          { method: 'DELETE' },
          true,
        );
      }
      if (caregiverAuthentikUserId !== undefined) {
        await authentikRequest(
          authentikOrigin,
          apiToken,
          `/api/v3/core/users/${caregiverAuthentikUserId}/`,
          { method: 'DELETE' },
          true,
        );
      }
    }
  }
});

async function waitForAuthentik(origin: string, issuer: string): Promise<void> {
  const discoveryUrl = new URL('.well-known/openid-configuration', issuer);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(discoveryUrl).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Authentik at ${origin} did not become ready`);
}

async function cleanupServiceCatalogRecords(
  database: Client,
  tenantId: string,
  codes: { serviceCode: string; serviceCategoryCode: string },
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const serviceRows = await database.query<{ id: string }>(
      'SELECT id FROM services.service_definitions WHERE tenant_id = $1 AND code = $2',
      [tenantId, codes.serviceCode],
    );
    const categoryRows = await database.query<{ id: string }>(
      'SELECT id FROM services.service_categories WHERE tenant_id = $1 AND code = $2',
      [tenantId, codes.serviceCategoryCode],
    );
    const serviceIds = serviceRows.rows.map((row) => row.id);
    const visitRows = serviceIds.length
      ? await database.query<{ id: string }>(
          `SELECT DISTINCT visit_id AS id FROM scheduling.visit_services
           WHERE tenant_id = $1 AND service_definition_id = ANY($2::uuid[])`,
          [tenantId, serviceIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const visitIds = visitRows.rows.map((row) => row.id);
    const executionRows = visitIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM visit_execution.executions WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const executionIds = executionRows.rows.map((row) => row.id);
    const resourceIds = [
      ...serviceIds,
      ...categoryRows.rows.map((row) => row.id),
      ...visitIds,
      ...executionIds,
    ];
    await database.query(
      'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])',
      [tenantId, resourceIds],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE tenant_id = $1
         AND (event ->> 'aggregateId' = ANY($2::text[])
           OR event -> 'payload' ->> 'visitId' = ANY($3::text[]))`,
      [tenantId, resourceIds, visitIds],
    );
    if (serviceRows.rows.length) {
      if (visitIds.length) {
        await database.query(
          'DELETE FROM visit_execution.performed_services WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        );
        await database.query(
          'DELETE FROM visit_execution.executions WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        );
        await database.query(
          'DELETE FROM scheduling.visit_assignments WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        );
        await database.query(
          'DELETE FROM scheduling.visit_services WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        );
        await database.query(
          'DELETE FROM scheduling.visits WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
          [tenantId, visitIds],
        );
      }
      await database.query(
        'DELETE FROM services.service_availability WHERE tenant_id = $1 AND service_id = ANY($2::uuid[])',
        [tenantId, serviceIds],
      );
      await database.query(
        'DELETE FROM services.service_definitions WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, serviceIds],
      );
    }
    if (categoryRows.rows.length) {
      await database.query(
        'DELETE FROM services.service_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, categoryRows.rows.map((row) => row.id)],
      );
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function cleanupServiceAgreementRecords(
  database: Client,
  tenantId: string,
  clientIds: string[],
  additionalVisitIds: string[] = [],
): Promise<void> {
  let signatureStorageKeys: string[] = [];
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const agreements = await database.query<{ id: string }>(
      'SELECT id FROM service_agreements.agreements WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const agreementIds = agreements.rows.map((agreement) => agreement.id);
    const generationRows = agreementIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM scheduling.schedule_generations WHERE tenant_id = $1 AND agreement_id = ANY($2::uuid[])',
          [tenantId, agreementIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const visitRows = await database.query<{ id: string }>(
      'SELECT id FROM scheduling.visits WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const generationIds = generationRows.rows.map((row) => row.id);
    const visitIds = [...new Set([...visitRows.rows.map((row) => row.id), ...additionalVisitIds])];
    const executionRows = visitIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM visit_execution.executions WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const executionIds = executionRows.rows.map((row) => row.id);
    const documentationRows = visitIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM care_documentation.documents WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
          [tenantId, visitIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const documentationIds = documentationRows.rows.map((row) => row.id);
    const evidencePackageRows = documentationIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM service_evidence.evidence_packages WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const evidencePackageIds = evidencePackageRows.rows.map((row) => row.id);
    const acknowledgementRows = evidencePackageIds.length
      ? await database.query<{ id: string; signature_storage_key: string | null }>(
          `SELECT id, signature_storage_key FROM service_evidence.acknowledgements
           WHERE tenant_id = $1 AND evidence_package_id = ANY($2::uuid[])`,
          [tenantId, evidencePackageIds],
        )
      : { rows: [] as Array<{ id: string; signature_storage_key: string | null }> };
    const acknowledgementIds = acknowledgementRows.rows.map((row) => row.id);
    signatureStorageKeys = acknowledgementRows.rows
      .map((row) => row.signature_storage_key)
      .filter((key): key is string => key !== null);
    const schedulingResourceIds = [
      ...generationIds,
      ...visitIds,
      ...executionIds,
      ...agreementIds,
      ...evidencePackageIds,
      ...acknowledgementIds,
    ];
    await database.query(
      `DELETE FROM audit.audit_entries
       WHERE tenant_id = $1 AND
         (resource_id = ANY($2::uuid[]) OR (resource_type = 'client' AND resource_id = ANY($3::uuid[])))`,
      [tenantId, schedulingResourceIds, clientIds],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE tenant_id = $1
         AND (event ->> 'aggregateId' = ANY($2::text[])
           OR event -> 'payload' ->> 'agreementId' = ANY($3::text[])
           OR event -> 'payload' ->> 'clientId' = ANY($4::text[])
           OR event -> 'payload' ->> 'visitId' = ANY($5::text[]))`,
      [tenantId, schedulingResourceIds, agreementIds, clientIds, visitIds],
    );
    if (visitIds.length) {
      if (documentationIds.length) {
        await database.query(
          'ALTER TABLE service_evidence.acknowledgements DISABLE TRIGGER acknowledgements_append_only',
        );
        await database.query(
          'ALTER TABLE service_evidence.evidence_packages DISABLE TRIGGER evidence_packages_immutable',
        );
        await database.query(
          'DELETE FROM service_evidence.acknowledgements WHERE tenant_id = $1 AND evidence_package_id = ANY($2::uuid[])',
          [tenantId, evidencePackageIds],
        );
        await database.query(
          'DELETE FROM service_evidence.evidence_packages WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
          [tenantId, evidencePackageIds],
        );
        await database.query(
          'ALTER TABLE service_evidence.evidence_packages ENABLE TRIGGER evidence_packages_immutable',
        );
        await database.query(
          'ALTER TABLE service_evidence.acknowledgements ENABLE TRIGGER acknowledgements_append_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.entries DISABLE TRIGGER documentation_entries_draft_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.service_evidence DISABLE TRIGGER service_evidence_draft_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.amendments DISABLE TRIGGER documentation_amendments_append_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.history DISABLE TRIGGER documentation_history_append_only',
        );
        await database.query(
          'DELETE FROM care_documentation.service_evidence WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        );
        await database.query(
          'DELETE FROM care_documentation.entries WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        );
        await database.query(
          'DELETE FROM care_documentation.amendments WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        );
        await database.query(
          'DELETE FROM care_documentation.history WHERE tenant_id = $1 AND documentation_id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        );
        await database.query(
          'DELETE FROM care_documentation.documents WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
          [tenantId, documentationIds],
        );
        await database.query(
          'ALTER TABLE care_documentation.amendments ENABLE TRIGGER documentation_amendments_append_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.history ENABLE TRIGGER documentation_history_append_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.service_evidence ENABLE TRIGGER service_evidence_draft_only',
        );
        await database.query(
          'ALTER TABLE care_documentation.entries ENABLE TRIGGER documentation_entries_draft_only',
        );
      }
      await database.query(
        'ALTER TABLE visit_execution.performed_services DISABLE TRIGGER performed_services_completed_immutable',
      );
      await database.query(
        'DELETE FROM visit_execution.performed_services WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
        [tenantId, visitIds],
      );
      await database.query(
        'ALTER TABLE visit_execution.performed_services ENABLE TRIGGER performed_services_completed_immutable',
      );
      await database.query(
        'DELETE FROM visit_execution.executions WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
        [tenantId, visitIds],
      );
      await database.query(
        'DELETE FROM scheduling.visit_assignments WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
        [tenantId, visitIds],
      );
      await database.query(
        'DELETE FROM scheduling.visit_services WHERE tenant_id = $1 AND visit_id = ANY($2::uuid[])',
        [tenantId, visitIds],
      );
      await database.query(
        'DELETE FROM scheduling.visits WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, visitIds],
      );
    }
    if (agreementIds.length) {
      await database.query(
        'DELETE FROM scheduling.schedule_generations WHERE tenant_id = $1 AND agreement_id = ANY($2::uuid[])',
        [tenantId, agreementIds],
      );
      await database.query(
        'DELETE FROM service_agreements.agreement_services WHERE tenant_id = $1 AND agreement_id = ANY($2::uuid[])',
        [tenantId, agreementIds],
      );
      await database.query(
        'DELETE FROM service_agreements.agreements WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, agreementIds],
      );
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
  if (signatureStorageKeys.length) {
    const config = loadStorageConfig();
    const storage = createS3ObjectStorage({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket: config.S3_BUCKET,
      accessKey: config.S3_ACCESS_KEY,
      secretKey: config.S3_SECRET_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    });
    await Promise.all(signatureStorageKeys.map((key) => storage.delete(key)));
  }
}

function dateInBerlin(): string {
  return dateInTimezone(new Date(), 'Europe/Berlin');
}

function shiftDateTimeLocal(value: string, minutes: number): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error('Expected a local datetime input value');
  }
  const date = new Date(`${value}:00.000Z`);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString().slice(0, 16);
}

function dateInTimezone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addCalendarDays(value: string, count: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

async function cleanupWorkforceRecords(
  database: Client,
  tenantId: string,
  names: {
    organizationName: string;
    facilityName: string;
    teamName: string;
    personnelNumber: string;
  },
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const organizations = await database.query<{ id: string }>(
      'SELECT id FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [tenantId, names.organizationName],
    );
    const facilities = await database.query<{ id: string }>(
      'SELECT id FROM organizations.facilities WHERE tenant_id = $1 AND name = $2',
      [tenantId, names.facilityName],
    );
    const teams = await database.query<{ id: string }>(
      'SELECT id FROM organizations.teams WHERE tenant_id = $1 AND name = $2',
      [tenantId, names.teamName],
    );
    const employees = await database.query<{ id: string }>(
      'SELECT id FROM employees.employees WHERE tenant_id = $1 AND personnel_number = $2',
      [tenantId, names.personnelNumber],
    );
    const resourceIds = [
      ...organizations.rows.map((row) => row.id),
      ...facilities.rows.map((row) => row.id),
      ...teams.rows.map((row) => row.id),
      ...employees.rows.map((row) => row.id),
    ];
    await database.query(
      'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])',
      [tenantId, resourceIds],
    );
    await database.query(
      "DELETE FROM platform.outbox_messages WHERE tenant_id = $1 AND event ->> 'aggregateId' = ANY($2::text[])",
      [tenantId, resourceIds],
    );
    if (employees.rows.length) {
      const employeeIds = employees.rows.map((row) => row.id);
      await database.query(
        'DELETE FROM employees.employee_facility_assignments WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
      await database.query(
        'DELETE FROM employees.employee_team_memberships WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
      await database.query(
        'DELETE FROM employees.employee_qualifications WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
      await database.query(
        'DELETE FROM employees.employee_skills WHERE tenant_id = $1 AND employee_id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
      await database.query(
        'DELETE FROM employees.employees WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, employeeIds],
      );
    }
    await database.query('DELETE FROM organizations.teams WHERE tenant_id = $1 AND name = $2', [
      tenantId,
      names.teamName,
    ]);
    await database.query(
      'DELETE FROM organizations.facilities WHERE tenant_id = $1 AND name = $2',
      [tenantId, names.facilityName],
    );
    await database.query(
      'DELETE FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [tenantId, names.organizationName],
    );
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function createAuthentikUser(
  origin: string,
  token: string,
  input: {
    username: string;
    name: string;
    email: string;
    password: string;
    emailVerified?: boolean;
  },
): Promise<{ pk: number; uuid: string }> {
  const user = await authentikRequest<{ pk: number; uuid: string }>(
    origin,
    token,
    '/api/v3/core/users/',
    {
      method: 'POST',
      body: JSON.stringify({
        username: input.username,
        name: input.name,
        email: input.email,
        is_active: true,
        attributes: { care_email_verified: input.emailVerified === true },
      }),
    },
  );
  await authentikRequest(origin, token, `/api/v3/core/users/${user.pk}/set_password/`, {
    method: 'POST',
    body: JSON.stringify({ password: input.password }),
  });
  return user;
}

async function signInWithAuthentik(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Mit Authentik anmelden' }).click();
  await page.locator('input[name="uidField"]').fill(username);
  await page
    .getByRole('button', { name: /continue|log in|sign in/i })
    .last()
    .click();
  const passwordField = page.getByLabel('Password');
  await passwordField.fill(password);
  await expect(passwordField).toHaveValue(password);
  const webOrigin = new URL(required('WEB_ORIGIN')).origin;
  await Promise.all([
    page.waitForURL((url) => url.origin === webOrigin, { timeout: 60_000 }),
    page
      .getByRole('button', { name: /continue|log in|sign in/i })
      .last()
      .click(),
  ]);
}

async function authentikRequest<T = unknown>(
  origin: string,
  token: string,
  path: string,
  init: RequestInit,
  allowMissing = false,
): Promise<T> {
  const response = await fetch(new URL(path, origin), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (allowMissing && response.status === 404) return undefined as T;
  if (!response.ok) throw new Error(`Authentik API ${path} returned ${response.status}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function waitForPlatformUser(
  database: Client,
  issuer: string,
  subject: string,
): Promise<{ id: string; membershipCount: number }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await database.query<{ id: string; membership_count: string }>(
      `SELECT users.id,
              (SELECT count(*) FROM identity.tenant_memberships WHERE user_id = users.id)::text AS membership_count
       FROM identity.external_identities
       JOIN identity.users ON users.id = external_identities.user_id
       WHERE external_identities.issuer = $1 AND external_identities.subject = $2`,
      [issuer, subject],
    );
    if (result.rows[0]) {
      return { id: result.rows[0].id, membershipCount: Number(result.rows[0].membership_count) };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Authentik login did not provision the platform identity');
}

async function cleanup(
  database: Client,
  input: {
    issuer: string;
    users: Array<{ subject?: string; userId?: string }>;
    membershipIds: string[];
    invitationIds: string[];
    invitationEmails: string[];
    tenantId?: string;
    clientId?: string;
    clientIds?: string[];
  },
): Promise<void> {
  await database.query('BEGIN');
  try {
    if (input.tenantId) {
      await database.query("SELECT set_config('app.tenant_id', $1, true)", [input.tenantId]);
    }
    const subjects = input.users.flatMap((user) => (user.subject ? [user.subject] : []));
    const mappedUsers = subjects.length
      ? await database.query<{ id: string }>(
          `SELECT users.id
           FROM identity.users AS users
           JOIN identity.external_identities AS external ON external.user_id = users.id
           WHERE external.issuer = $1 AND external.subject = ANY($2::text[])`,
          [input.issuer, subjects],
        )
      : { rows: [] as Array<{ id: string }> };
    const userIds = [
      ...new Set([
        ...input.users.flatMap((user) => (user.userId ? [user.userId] : [])),
        ...mappedUsers.rows.map((row) => row.id),
      ]),
    ];
    const mappedMemberships = userIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM identity.tenant_memberships WHERE user_id = ANY($1::uuid[])',
          [userIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const membershipIds = [
      ...new Set([...input.membershipIds, ...mappedMemberships.rows.map((row) => row.id)]),
    ];
    const mappedInvitations = input.invitationEmails.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM identity.tenant_invitations WHERE email = ANY($1::text[])',
          [input.invitationEmails],
        )
      : { rows: [] as Array<{ id: string }> };
    const invitationIds = [
      ...new Set([...input.invitationIds, ...mappedInvitations.rows.map((row) => row.id)]),
    ];
    const clientIds = [
      ...new Set([...(input.clientId ? [input.clientId] : []), ...(input.clientIds ?? [])]),
    ];
    const aggregateIds = [...membershipIds, ...invitationIds];
    aggregateIds.push(...clientIds);
    let clientResourceIds = aggregateIds;
    if (clientIds.length && input.tenantId) {
      const childRows = await database.query<{ id: string }>(
        `SELECT id FROM clients.client_addresses WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])
         UNION ALL SELECT id FROM clients.client_contacts WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])
         UNION ALL SELECT id FROM clients.client_insurances WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])
         UNION ALL SELECT id FROM clients.pflegegrad_records WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])`,
        [input.tenantId, clientIds],
      );
      clientResourceIds = [...aggregateIds, ...childRows.rows.map((row) => row.id)];
    }
    await database.query(
      `DELETE FROM audit.audit_entries
       WHERE resource_id = ANY($1::uuid[]) OR actor_id = ANY($2::uuid[])`,
      [clientResourceIds, userIds],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE event ->> 'aggregateId' = ANY($1::text[])
          OR event -> 'actor' ->> 'id' = ANY($2::text[])
          OR event -> 'payload' ->> 'clientId' = ANY($3::text[])`,
      [clientResourceIds, userIds, clientIds],
    );
    if (clientIds.length && input.tenantId) {
      await database.query(
        'DELETE FROM clients.client_contact_roles WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM clients.client_addresses WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM clients.client_contacts WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM clients.client_insurances WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM clients.pflegegrad_records WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
      await database.query(
        'DELETE FROM clients.clients WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [input.tenantId, clientIds],
      );
    } else if (clientIds.length) {
      await database.query('DELETE FROM clients.clients WHERE id = ANY($1::uuid[])', [clientIds]);
    }
    if (invitationIds.length) {
      await database.query('DELETE FROM identity.tenant_invitations WHERE id = ANY($1::uuid[])', [
        invitationIds,
      ]);
    }
    if (membershipIds.length) {
      await database.query(
        'DELETE FROM identity.membership_roles WHERE membership_id = ANY($1::uuid[])',
        [membershipIds],
      );
      await database.query(
        'DELETE FROM identity.membership_scopes WHERE membership_id = ANY($1::uuid[])',
        [membershipIds],
      );
      await database.query('DELETE FROM identity.tenant_memberships WHERE id = ANY($1::uuid[])', [
        membershipIds,
      ]);
    }
    const authUserIds = subjects.length
      ? await database.query<{ id: string }>(
          `SELECT auth_user.id
           FROM authentication.users AS auth_user
           JOIN authentication.accounts AS account ON account.user_id = auth_user.id
           WHERE account.provider_id = 'authentik' AND account.account_id = ANY($1::text[])`,
          [subjects],
        )
      : { rows: [] as Array<{ id: string }> };
    const ids = authUserIds.rows.map((row) => row.id);
    if (ids.length) {
      await database.query('DELETE FROM authentication.sessions WHERE user_id = ANY($1::text[])', [
        ids,
      ]);
      await database.query('DELETE FROM authentication.accounts WHERE user_id = ANY($1::text[])', [
        ids,
      ]);
      await database.query('DELETE FROM authentication.users WHERE id = ANY($1::text[])', [ids]);
    }
    if (subjects.length) {
      await database.query(
        'DELETE FROM identity.external_identities WHERE issuer = $1 AND subject = ANY($2::text[])',
        [input.issuer, subjects],
      );
    }
    if (userIds.length) {
      await database.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the Authentik E2E test`);
  return value;
}
