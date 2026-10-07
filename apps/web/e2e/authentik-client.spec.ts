import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

test('Authentik users can be invited and administered from the office UI', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);

  const issuer = required('OIDC_ISSUER');
  const authentikOrigin = new URL(issuer).origin;
  const apiToken = required('AUTHENTIK_E2E_API_TOKEN');
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  const runId = randomUUID().slice(0, 8);
  const serviceValidFrom = new Date().toISOString().slice(0, 10);
  const username = `care-e2e-${runId}`;
  const displayName = `Care E2E ${runId}`;
  const email = `${username}@example.test`;
  const password = `Aa1!${randomUUID()}`;
  const invitedUsername = `care-invite-${runId}`;
  const invitedName = `Invitee E2E ${runId}`;
  const invitedEmail = `${invitedUsername}@example.test`;
  const invitedPassword = `Aa1!${randomUUID()}`;
  let authentikUserId: number | undefined;
  let invitedAuthentikUserId: number | undefined;
  let subject: string | undefined;
  let invitedSubject: string | undefined;
  let platformUserId: string | undefined;
  let invitedPlatformUserId: string | undefined;
  let tenantId: string | undefined;
  let adminMembershipId: string | undefined;
  let invitedMembershipId: string | undefined;
  let invitationId: string | undefined;
  let clientId: string | undefined;
  let agreementClientId: string | undefined;
  let serviceId: string | undefined;
  const serviceCategoryName = `E2E Category ${runId}`;
  const serviceCategoryCode = `E2E-CAT-${runId}`;
  const serviceCode = `E2E-SVC-${runId}`;
  const workforceOrganizationName = `E2E Organization ${runId}`;
  const workforceFacilityName = `E2E Facility ${runId}`;
  const workforceTeamName = `E2E Team ${runId}`;
  const workforcePersonnelNumber = `E2E-${runId}`;
  let invitedContext: BrowserContext | undefined;

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
    adminMembershipId = randomUUID();
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
    await page.getByRole('button', { name: 'Pausieren' }).click();
    await expect(agreementCard.getByText('Pausiert', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Fortsetzen' }).click();
    await expect(agreementCard.getByText('Aktiv', { exact: true }).first()).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Beenden', exact: true }).click();
    await expect(agreementCard.getByText('Beendet', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Leistungsplanung beendet', { exact: true })).toBeVisible();

    if (!serviceId) throw new Error('The service detail page did not expose its ID');
    await page.goto(`/services/${serviceId}`);
    await page.getByRole('button', { name: 'Leistung archivieren' }).click();
    await expect(page.locator('span').filter({ hasText: /^Archiviert$/ })).toBeVisible();

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
      await invitedContext?.close();
      if (tenantId) {
        const agreementClientIds = [agreementClientId].filter(
          (id): id is string => id !== undefined,
        );
        if (agreementClientIds.length) {
          await cleanupServiceAgreementRecords(database, tenantId, agreementClientIds);
        }
        await cleanupServiceCatalogRecords(database, tenantId, {
          serviceCode,
          serviceCategoryCode,
        });
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
        ],
        membershipIds: [adminMembershipId, invitedMembershipId].filter(
          (id): id is string => id !== undefined,
        ),
        invitationIds: invitationId ? [invitationId] : [],
        invitationEmails: [invitedEmail],
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
    const serviceRows = await database.query<{ id: string }>(
      'SELECT id FROM services.service_definitions WHERE tenant_id = $1 AND code = $2',
      [tenantId, codes.serviceCode],
    );
    const categoryRows = await database.query<{ id: string }>(
      'SELECT id FROM services.service_categories WHERE tenant_id = $1 AND code = $2',
      [tenantId, codes.serviceCategoryCode],
    );
    const ids = [...serviceRows.rows, ...categoryRows.rows].map((row) => row.id);
    await database.query(
      'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])',
      [tenantId, ids],
    );
    await database.query(
      "DELETE FROM platform.outbox_messages WHERE tenant_id = $1 AND event ->> 'aggregateId' = ANY($2::text[])",
      [tenantId, ids],
    );
    if (serviceRows.rows.length) {
      const serviceIds = serviceRows.rows.map((row) => row.id);
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
): Promise<void> {
  await database.query('BEGIN');
  try {
    const agreements = await database.query<{ id: string }>(
      'SELECT id FROM service_agreements.agreements WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const agreementIds = agreements.rows.map((agreement) => agreement.id);
    if (agreementIds.length) {
      await database.query(
        'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = ANY($3::uuid[])',
        [tenantId, 'service_agreement', agreementIds],
      );
      await database.query(
        "DELETE FROM platform.outbox_messages WHERE tenant_id = $1 AND event ->> 'aggregateId' = ANY($2::text[])",
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
