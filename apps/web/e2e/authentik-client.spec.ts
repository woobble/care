import { v7 as uuidv7 } from 'uuid';
import { Client } from 'pg';
import { devices, expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { loadStorageConfig } from '@care/config';
import { createS3ObjectStorage } from '@care/storage';

const retiredModuleNavigationName =
  /^(?:Medications?|Clinical Documentation|Care Planning|Competency Policies|Workforce Compliance|Medikamente?|Klinische Dokumentation|Pflegeplanung|Kompetenzrichtlinien|Personal Compliance)$/i;

test('Authentik users can be invited and administered from the office UI', async ({
  page,
  browser,
}) => {
  test.setTimeout(600_000);

  const issuer = required('OIDC_ISSUER');
  const authentikOrigin = new URL(issuer).origin;
  const apiToken = required('AUTHENTIK_E2E_API_TOKEN');
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  const runId = uuidv7();
  const serviceValidFrom = dateInBerlin();
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
  const replacementEmployeePersonnelNumber = `E2E-COVER-${runId}`;
  const e2ePayerName = `E2E Payer ${runId}`;
  const executionMarker = `execution-note-${runId}`;
  const admissionVisitMarker = `admission-first-visit-${runId}`;
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
  let pilotTenantId: string | undefined;
  let adminMembershipId: string | undefined;
  let pilotMembershipId: string | undefined;
  let invitedMembershipId: string | undefined;
  let caregiverMembershipId: string | undefined;
  let replacementEmployeeId: string | undefined;
  let invitationId: string | undefined;
  let clientId: string | undefined;
  let agreementClientId: string | undefined;
  let admissionCaseId: string | undefined;
  let admissionClientId: string | undefined;
  let admissionVisitId: string | undefined;
  let serviceId: string | undefined;
  let executionVisitId: string | undefined;
  let initialEvidencePackageId: string | undefined;
  let replacementEvidencePackageId: string | undefined;
  let finalEvidencePackageId: string | undefined;
  let invoiceId: string | undefined;
  let claimId: string | undefined;
  let billingRecordsMayExist = false;
  let representativeContactId: string | undefined;
  const serviceCategoryName = `E2E Category ${runId}`;
  const codeSuffix = runId.slice(-24);
  const serviceCategoryCode = `E2E-CAT-${codeSuffix}`;
  const serviceCode = `E2E-SVC-${codeSuffix}`;
  const e2eOrganizationName = `E2E Organization ${runId}`;
  const e2eFacilityName = `E2E Facility ${runId}`;
  const e2eTeamName = `E2E Team ${runId}`;
  const caregiverPersonnelNumber = `E2E-${runId}`;
  let invitedContext: BrowserContext | undefined;
  let caregiverContext: BrowserContext | undefined;

  await database.connect();
  try {
    await waitForAuthentik(authentikOrigin, issuer);
    await page.goto('/');
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'CARE_LOCALE')).toBe(
      false,
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Sprache' })).toHaveValue('de');
    await page.getByRole('combobox', { name: 'Sprache' }).selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    const createdUser = await createAuthentikUser(authentikOrigin, apiToken, {
      username,
      name: displayName,
      email,
      password,
    });
    authentikUserId = createdUser.pk;
    subject = createdUser.uuid;
    await signInWithAuthentik(page, username, password);
    const noAccessMessage = page.getByText(
      'Your account does not have access to an active organization.',
    );
    if (!(await noAccessMessage.isVisible())) {
      const authState = await database.query<{
        session_count: string;
        account_count: string;
        access_token_count: string;
        refresh_token_count: string;
      }>(
        `SELECT
           (SELECT count(*) FROM authentication.sessions AS session
            JOIN authentication.users AS auth_user ON auth_user.id = session.user_id
            WHERE auth_user.email = $1)::text AS session_count,
           (SELECT count(*) FROM authentication.accounts AS account
            JOIN authentication.users AS auth_user ON auth_user.id = account.user_id
            WHERE auth_user.email = $1)::text AS account_count,
           (SELECT count(*) FROM authentication.accounts AS account
            JOIN authentication.users AS auth_user ON auth_user.id = account.user_id
            WHERE auth_user.email = $1 AND account.access_token IS NOT NULL)::text AS access_token_count,
           (SELECT count(*) FROM authentication.accounts AS account
            JOIN authentication.users AS auth_user ON auth_user.id = account.user_id
            WHERE auth_user.email = $1 AND account.refresh_token IS NOT NULL)::text AS refresh_token_count`,
        [email],
      );
      throw new Error(
        `Authentik login reached ${new URL(page.url()).pathname}${new URL(page.url()).search}; ` +
          `Better Auth records: ${JSON.stringify(authState.rows[0] ?? {})}`,
      );
    }

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
    await page.locator('select[name="tenantId"]').selectOption(tenantId);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/clients$/);
    await page.goto('/clients?localeCheck=1');
    await expect(page).toHaveURL(/\/clients\?localeCheck=1$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.locator('nav[aria-label]').getByRole('link', { name: retiredModuleNavigationName }),
    ).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
    await expect(page).toHaveURL(/\/clients\?localeCheck=1$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(
      page.getByRole('heading', { name: 'Klientinnen und Klienten', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Sprache' })).toHaveValue('de');
    await page.getByRole('combobox', { name: 'Sprache' }).selectOption('en');
    await expect(page).toHaveURL(/\/clients\?localeCheck=1$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Create client' }).click();
    await expect(page).toHaveURL(/\/clients\/new$/);
    await page.locator('#firstName').fill('E2E');
    await page.locator('#lastName').fill(runId);
    await page.getByLabel('Organization').selectOption({ label: 'Demo Pflegedienst' });
    await page.getByLabel('Primary facility').selectOption({ label: 'Facility West' });
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/i);
    clientId = new URL(page.url()).pathname.split('/').at(-1);
    if (!clientId) throw new Error('The office UI did not redirect to the created client');
    await expect(page.getByRole('heading', { name: `E2E ${runId}` })).toBeVisible();
    await expect(page.locator('span').filter({ hasText: /^Pending$/ })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Add address' }).click();
    await page.locator('#new-address-street').fill(`E2E Street ${runId}`);
    await page.locator('#new-address-house').fill('12');
    await page.locator('#new-address-postal').fill('10115');
    await page.locator('#new-address-city').fill('Berlin');
    const addressForm = page.locator('details').filter({ hasText: 'Add address' }).locator('form');
    await addressForm.locator('input[name="isPrimary"]').check();
    const clientPath = new URL(page.url()).pathname;
    const addressResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === clientPath,
    );
    await Promise.all([
      addressForm.getByRole('button', { name: 'Add address' }).click(),
      addressResponse,
    ]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Home address · Primary' })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Add contact' }).click();
    await page.locator('#new-contact-first').fill('E2E');
    await page.locator('#new-contact-last').fill('Kontakt');
    await page.locator('input[name="roles"][value="primary_contact"]').check();
    await page.locator('input[name="roles"][value="emergency_contact"]').check();
    await page.getByRole('button', { name: 'Add contact' }).click();
    await expect(page.getByRole('heading', { name: 'E2E Kontakt' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Emergency contact' })).toBeChecked();

    await page.locator('summary').filter({ hasText: 'Add insurance relationship' }).click();
    const insuranceForm = page
      .locator('details')
      .filter({ hasText: 'Add insurance relationship' })
      .locator('form');
    await insuranceForm.locator('#new-insurer-name').fill('E2E Demo Insurance');
    await insuranceForm.locator('#new-insurance-number').fill(`E2E-PRIVATE-${runId}`);
    await insuranceForm.locator('input[name="isPrimary"]').check();
    await insuranceForm.getByRole('button').click();
    await expect(page.getByRole('heading', { name: 'E2E Demo Insurance · Primary' })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Add care level record' }).click();
    await page.locator('#new-grade').fill('3');
    await page.locator('#new-grade-from').fill('2000-01-01');
    await page.locator('#new-grade-status').selectOption('confirmed');
    await page.getByRole('button', { name: 'Save care level' }).click();
    await expect(page.getByText('Care level 3 · Confirmed')).toBeVisible();
    await expect(page.getByText('Care level history added', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.locator('span').filter({ hasText: /^Active$/ })).toBeVisible();
    const clientArchivePath = new URL(page.url()).pathname;
    const clientArchiveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === clientArchivePath,
    );
    await Promise.all([
      page.getByRole('button', { name: 'Archive' }).click(),
      clientArchiveResponse,
    ]);
    await page.reload();
    await expect(page.locator('span').filter({ hasText: /^Archived$/ })).toBeVisible();

    await page.goto('/administration/organizations');
    await page.getByLabel('Name', { exact: true }).fill(e2eOrganizationName);
    await page.getByLabel('Legal name').fill(`E2E Betreuungsdienst ${runId}`);
    await page.getByLabel('Address').fill('E2E Provider Street 1, 10115 Berlin');
    const organizationCreateUrlBefore = page.url();
    const organizationCreateNavigation = page.waitForURL(
      (url) => url.href !== organizationCreateUrlBefore,
      { timeout: 15_000 },
    );
    await Promise.all([
      page.getByRole('button', { name: 'Create organization' }).click(),
      organizationCreateNavigation,
    ]);
    const organizationCreateUrl = new URL(page.url());
    if (organizationCreateUrl.pathname === '/administration/organizations') {
      const alertText = await page.getByRole('alert').textContent();
      throw new Error(
        `Organization creation failed: ${organizationCreateUrl.searchParams.get('error') ?? 'unknown'}; ${alertText?.trim() ?? 'no error message'}`,
      );
    }
    await expect(page.getByRole('heading', { name: e2eOrganizationName })).toBeVisible();
    const e2eOrganizationRow = await database.query<{ id: string }>(
      'SELECT id FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [tenantId, e2eOrganizationName],
    );
    const e2eOrganizationId = e2eOrganizationRow.rows[0]?.id;
    if (!e2eOrganizationId) throw new Error('The office UI did not create the organization');

    await page.locator('#facility-name').fill(e2eFacilityName);
    await page.getByRole('button', { name: 'Create facility' }).click();
    await expect(page.getByRole('heading', { name: e2eFacilityName })).toBeVisible();
    const e2eFacilityRow = await database.query<{ id: string }>(
      'SELECT id FROM organizations.facilities WHERE tenant_id = $1 AND organization_id = $2 AND name = $3',
      [tenantId, e2eOrganizationId, e2eFacilityName],
    );
    const e2eFacilityId = e2eFacilityRow.rows[0]?.id;
    if (!e2eFacilityId) throw new Error('The office UI did not create the facility');

    await page.locator('#team-name').fill(e2eTeamName);
    await page.getByRole('button', { name: 'Create team' }).click();
    await expect(page.getByRole('heading', { name: e2eTeamName })).toBeVisible();
    const e2eTeamRow = await database.query<{ id: string }>(
      'SELECT id FROM organizations.teams WHERE tenant_id = $1 AND organization_id = $2 AND name = $3',
      [tenantId, e2eOrganizationId, e2eTeamName],
    );
    const e2eTeamId = e2eTeamRow.rows[0]?.id;
    if (!e2eTeamId) throw new Error('The office UI did not create the team');

    await page.goto('/employees/new');
    await page.getByLabel('Organization').selectOption(e2eOrganizationId);
    await page.getByLabel('First name').fill('E2E');
    await page.getByLabel('Last name').fill(runId);
    await page.getByLabel('Personnel number').fill(caregiverPersonnelNumber);
    await page.getByRole('button', { name: 'Create employee' }).click();
    await expect(page.getByRole('heading', { name: `E2E ${runId}` })).toBeVisible();
    const caregiverEmployeeRow = await database.query<{ id: string }>(
      'SELECT id FROM employees.employees WHERE tenant_id = $1 AND personnel_number = $2',
      [tenantId, caregiverPersonnelNumber],
    );
    const caregiverEmployeeId = caregiverEmployeeRow.rows[0]?.id;
    if (!caregiverEmployeeId) throw new Error('The office UI did not create the employee');

    await page.getByLabel('Assign facility').selectOption(e2eFacilityId);
    await page.getByRole('button', { name: 'Assign facility' }).click();
    await expect(
      page.getByText(`${e2eFacilityName} · Primary facility`, { exact: true }),
    ).toBeVisible();
    await page.getByLabel('Assign to team').selectOption(e2eTeamId);
    const teamAssignmentPath = new URL(page.url()).pathname;
    const teamAssignmentResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === teamAssignmentPath,
    );
    await Promise.all([
      page.getByRole('button', { name: 'Assign to team' }).click(),
      teamAssignmentResponse,
    ]);
    await page.reload();
    await expect(
      page.locator('#assignments article').filter({ hasText: e2eTeamName }),
    ).toBeVisible();
    await page.getByLabel('Add qualification').selectOption({ label: 'Pflegefachkraft (PFK)' });
    await page.getByRole('button', { name: 'Save qualification' }).click();
    await expect(
      page.locator('#qualifications li').filter({ hasText: 'Pflegefachkraft (PFK)' }),
    ).toBeVisible();
    expect(caregiverEmployeeId).toMatch(/^[0-9a-f-]+$/i);

    await page.goto('/employees/new');
    await page.getByLabel('Organization').selectOption(e2eOrganizationId);
    await page.getByLabel('First name').fill('Cover E2E');
    await page.getByLabel('Last name').fill(runId);
    await page.getByLabel('Personnel number').fill(replacementEmployeePersonnelNumber);
    await page.getByRole('button', { name: 'Create employee' }).click();
    await expect(page.getByRole('heading', { name: `Cover E2E ${runId}` })).toBeVisible();
    const replacementEmployeeRow = await database.query<{ id: string }>(
      'SELECT id FROM employees.employees WHERE tenant_id = $1 AND personnel_number = $2',
      [tenantId, replacementEmployeePersonnelNumber],
    );
    replacementEmployeeId = replacementEmployeeRow.rows[0]?.id;
    if (!replacementEmployeeId) throw new Error('The office UI did not create the cover employee');
    await page.getByLabel('Assign facility').selectOption(e2eFacilityId);
    await page.getByRole('button', { name: 'Assign facility' }).click();
    await expect(
      page.getByText(`${e2eFacilityName} · Primary facility`, { exact: true }),
    ).toBeVisible();

    await page.goto('/services');
    const categoryForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Create category' }),
    });
    await categoryForm.locator('input[name="name"]').fill(serviceCategoryName);
    await categoryForm.locator('input[name="code"]').fill(serviceCategoryCode);
    await page.getByRole('button', { name: 'Create category' }).click();
    await expect(page.locator(`input[name="code"][value="${serviceCategoryCode}"]`)).toBeVisible();
    await page.getByRole('link', { name: 'Create service' }).click();
    await page.locator('#code').fill(serviceCode);
    await page.locator('#name').fill(`E2E Service ${runId}`);
    await page.locator('#categoryId').selectOption({ label: serviceCategoryName });
    await page.locator('#unit').selectOption('occurrence');
    await page.locator('#benefitCategory').selectOption('recognized_support');
    await page.locator('#defaultDurationMinutes').fill('30');
    await page.locator('#validFrom').fill(serviceValidFrom);
    await page.getByRole('button', { name: 'Create service' }).click();
    await expect(page.getByRole('heading', { name: `E2E Service ${runId}` })).toBeVisible();
    serviceId = new URL(page.url()).pathname.split('/').at(-1);
    await page.locator(`input[name="organizationIds"][value="${e2eOrganizationId}"]`).check();
    await page.locator(`input[name="facilityIds"][value="${e2eFacilityId}"]`).check();
    await page.getByRole('button', { name: 'Save availability' }).click();
    await expect(page.getByRole('table').getByText(e2eFacilityName)).toBeVisible();
    const priceForm = page.locator('form').filter({ has: page.locator('#newPriceOrganizationId') });
    await priceForm.locator('select[name="organizationId"]').selectOption(e2eOrganizationId);
    await priceForm.locator('select[name="facilityId"]').selectOption(e2eFacilityId);
    await priceForm.locator('input[name="price"]').fill('45.00');
    await priceForm.locator('select[name="pricingUnit"]').selectOption('visit');
    await priceForm.locator('input[name="validFrom"]').fill(serviceValidFrom);
    await priceForm.getByRole('button', { name: 'Record price' }).click();
    await expect(page.getByText('Price recorded.', { exact: true })).toBeVisible();

    await page.goto('/admissions/new');
    await page.getByLabel('Prospect first name').fill('Admission E2E');
    await page.getByLabel('Prospect last name').fill(runId);
    await page.getByLabel('Organization').selectOption(e2eOrganizationId);
    await page.getByLabel('Facility').selectOption(e2eFacilityId);
    await page.getByLabel('Inquiry source').fill('E2E browser journey');
    await page.getByLabel('Funding plan').selectOption('private_pay');
    await page.getByLabel('Preferred start date').fill(serviceValidFrom);
    await page.getByLabel('Requested services, one per line').fill(`E2E Service ${runId}`);
    await page.getByRole('button', { name: 'New admission case' }).click();
    await expect(page).toHaveURL(/\/admissions\/[0-9a-f-]{36}$/i);
    admissionCaseId = new URL(page.url()).pathname.split('/').at(-1);
    if (!admissionCaseId) throw new Error('The admission detail page did not expose its ID');
    const createdAdmission = await database.query<{ id: string }>(
      'SELECT id FROM onboarding.cases WHERE tenant_id = $1 AND id = $2 AND first_name = $3 AND last_name = $4',
      [tenantId, admissionCaseId, 'Admission E2E', runId],
    );
    expect(createdAdmission.rows[0]?.id).toBe(admissionCaseId);
    await page.goto(`/admissions/${admissionCaseId}`);
    await expect(page.getByRole('heading', { name: `Admission E2E ${runId}` })).toBeVisible();

    await page.getByRole('button', { name: 'Register prospect as pending client' }).click();
    const admissionClientLink = page.locator('a[href^="/clients/"]').first();
    await expect(admissionClientLink).toBeVisible();
    const admissionClientHref = await admissionClientLink.getAttribute('href');
    admissionClientId = admissionClientHref?.match(/^\/clients\/([0-9a-f-]{36})$/i)?.[1];
    if (!admissionClientId) throw new Error('The admissions UI did not link the registered client');
    const registeredAdmission = await database.query<{ client_id: string | null }>(
      'SELECT client_id FROM onboarding.cases WHERE tenant_id = $1 AND id = $2',
      [tenantId, admissionCaseId],
    );
    expect(registeredAdmission.rows[0]?.client_id).toBe(admissionClientId);
    await page.goto(`/clients/${admissionClientId}`);
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.locator('span').filter({ hasText: /^Active$/ })).toBeVisible();
    await page.goto(`/admissions/${admissionCaseId}`);

    const admissionStageForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Move to stage' }),
    });
    await admissionStageForm.getByLabel('Move to stage').selectOption('assessment');
    await admissionStageForm.getByRole('button', { name: 'Move to stage' }).click();
    await expect(page.getByText(/Assessment · Stage/)).toBeVisible();
    const preparationStageForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Move to stage' }),
    });
    await preparationStageForm.getByLabel('Move to stage').selectOption('preparation');
    await preparationStageForm.getByRole('button', { name: 'Move to stage' }).click();
    await expect(page.getByText(/Preparation · Stage/)).toBeVisible();

    await page.getByRole('link', { name: 'Plan first visit' }).click();
    await expect(page.getByRole('heading', { name: 'Plan a visit manually' })).toBeVisible();
    const admissionVisitForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Create visit' }),
    });
    await admissionVisitForm.locator('input[name="localDate"]').fill(serviceValidFrom);
    await admissionVisitForm.locator('input[name="localStartTime"]').fill('09:15');
    await admissionVisitForm.locator('input[name="localEndTime"]').fill('09:45');
    await admissionVisitForm
      .locator('select[name="serviceDefinitionIds"]')
      .selectOption(serviceId!);
    await admissionVisitForm.locator('textarea[name="note"]').fill(admissionVisitMarker);
    await admissionVisitForm.getByRole('button', { name: 'Create visit' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/admissions/${admissionCaseId}\\?updated=first_visit$`),
    );
    await expect(page.getByRole('status')).toContainText('First visit planned');
    const firstVisitLink = await database.query<{ first_visit_id: string | null }>(
      'SELECT first_visit_id FROM onboarding.cases WHERE tenant_id = $1 AND id = $2',
      [tenantId, admissionCaseId],
    );
    admissionVisitId = firstVisitLink.rows[0]?.first_visit_id ?? undefined;
    if (!admissionVisitId) throw new Error('The first visit was not linked to the admission');
    const scheduledAdmissionVisit = await database.query<{ id: string }>(
      'SELECT id FROM scheduling.visits WHERE tenant_id = $1 AND id = $2 AND note = $3',
      [tenantId, admissionVisitId, admissionVisitMarker],
    );
    expect(scheduledAdmissionVisit.rows[0]?.id).toBe(admissionVisitId);
    await expect(page.getByRole('link', { name: admissionVisitId })).toHaveAttribute(
      'href',
      `/visits/${admissionVisitId}`,
    );

    await page.goto('/clients/new');
    await page.getByLabel('Organization').selectOption(e2eOrganizationId);
    await page.getByLabel('Primary facility').selectOption(e2eFacilityId);
    await page.getByLabel('First name').fill('Agreement E2E');
    await page.getByLabel('Last name').fill(runId);
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/i);
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
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.locator('span').filter({ hasText: /^Active$/ })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Add insurance relationship' }).click();
    const benefitInsuranceForm = page
      .locator('details')
      .filter({ hasText: 'Add insurance relationship' })
      .locator('form');
    await benefitInsuranceForm.locator('#new-insurer-name').fill('E2E Pflegekasse');
    await benefitInsuranceForm.locator('#new-insurance-number').fill(`E2E-KASSE-${runId}`);
    await benefitInsuranceForm.locator('input[name="isPrimary"]').check();
    await benefitInsuranceForm.getByRole('button').click();
    await expect(page.getByRole('heading', { name: 'E2E Pflegekasse · Primary' })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Add care level record' }).click();
    await page.locator('#new-grade').fill('3');
    await page.locator('#new-grade-from').fill('2000-01-01');
    await page.locator('#new-grade-status').selectOption('confirmed');
    await page.getByRole('button', { name: 'Save care level' }).click();
    await expect(page.getByText('Care level 3 · Confirmed')).toBeVisible();

    await page.goto(`/clients/${agreementClientId}/benefits`);
    const fundingSourceForm = page.locator('form').filter({ has: page.locator('#sourceType') });
    await fundingSourceForm
      .locator('#sourceType')
      .selectOption('statutory_long_term_care_insurance');
    const insuranceOption = await fundingSourceForm
      .locator('#clientInsuranceId option')
      .filter({ hasText: 'E2E Pflegekasse' })
      .getAttribute('value');
    if (!insuranceOption) throw new Error('The benefits form did not include the Pflegekasse');
    await fundingSourceForm.locator('#clientInsuranceId').selectOption(insuranceOption);
    await fundingSourceForm.locator('#funding-label').fill('E2E Pflegekasse');
    await fundingSourceForm.getByRole('button', { name: 'Add source' }).click();
    await expect(page).toHaveURL(/updated=funding_source/);

    const entitlementForm = page.locator('form').filter({ has: page.locator('#benefitType') });
    await entitlementForm.locator('#benefitType').selectOption('entlastungsbetrag_45b');
    const entitlementSourceOption = await entitlementForm
      .locator('#entitlement-source option')
      .filter({ hasText: 'E2E Pflegekasse' })
      .getAttribute('value');
    if (!entitlementSourceOption)
      throw new Error('The entitlement form did not include the Pflegekasse');
    await entitlementForm.locator('#entitlement-source').selectOption(entitlementSourceOption);
    await entitlementForm.locator('#entitlement-validFrom').fill(serviceValidFrom);
    await entitlementForm.locator('#entitlement-source-info').selectOption('payer_confirmed');
    await entitlementForm.getByRole('button', { name: 'Add entitlement' }).click();
    await expect(page).toHaveURL(/updated=entitlement/);
    await expect(page.getByRole('heading', { name: 'Entlastungsbetrag (§45b)' })).toBeVisible();
    await expect(page.getByText(/Pflegegrad on/)).toBeVisible();

    await page.goto('/billing/claims/settings');
    await expect(page.getByRole('heading', { name: 'Claims settings' })).toBeVisible();
    const payerOrganizationSection = page.getByRole('region', { name: e2eOrganizationName });
    const payerCreationForm = payerOrganizationSection.locator('form').filter({
      has: page.getByRole('button', { name: 'Create payer' }),
    });
    await payerCreationForm.locator('input[name="name"]').fill(e2ePayerName);
    await payerCreationForm.locator('input[name="payerIdentifier"]').fill(`E2E-${codeSuffix}`);
    await payerCreationForm
      .locator('input[name="addressText"]')
      .fill(`E2E Payer Street 1, 10115 Berlin`);
    billingRecordsMayExist = true;
    await payerCreationForm.getByRole('button', { name: 'Create payer' }).click();
    await expect(page.getByRole('status')).toContainText('Payer directory entry saved.');
    const payerArticle = page.locator('article').filter({ hasText: e2ePayerName });
    const payerRequirementsForm = payerArticle.locator('form').filter({
      has: page.getByRole('button', { name: 'Save new requirements version' }),
    });
    await payerRequirementsForm.locator('select[name="channel"]').selectOption('manual_email');
    await payerRequirementsForm
      .locator('select[name="fundingSourceType"]')
      .selectOption('statutory_long_term_care_insurance');
    await payerRequirementsForm.locator('input[name="validFrom"]').fill(serviceValidFrom);
    await payerRequirementsForm
      .locator('input[name="sourceName"]')
      .fill('E2E payer billing requirements');
    await payerRequirementsForm.locator('input[name="sourceVersion"]').fill('1');
    await payerRequirementsForm.locator('input[name="sourceEffectiveDate"]').fill(serviceValidFrom);
    await payerRequirementsForm
      .getByRole('button', { name: 'Save new requirements version' })
      .click();
    await expect(page.getByRole('status')).toContainText('Payer requirements version saved.');

    await page.goto(`/clients/${agreementClientId}/invoices`);
    const payerArrangementForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Save payer arrangement' }),
    });
    const payerRows = await database.query<{ id: string }>(
      'SELECT id FROM billing.payers WHERE tenant_id = $1 AND organization_id = $2 AND name = $3',
      [tenantId, e2eOrganizationId, e2ePayerName],
    );
    const payerId = payerRows.rows[0]?.id;
    if (!payerId) throw new Error('The payer directory entry was not persisted');
    await payerArrangementForm.locator('select[name="payerId"]').selectOption(payerId);
    const payerAssociation = payerArrangementForm.locator('select[name="payerAssociation"]');
    await payerAssociation.selectOption({ label: 'E2E Pflegekasse' });
    await expect(payerAssociation).toHaveValue(/^funding:/);
    await payerArrangementForm.locator('input[name="payerReference"]').fill(`E2E-${runId}`);
    await payerArrangementForm
      .locator('select[name="payerType"]')
      .selectOption('statutory_insurance');
    await payerArrangementForm
      .locator('select[name="arrangementType"]')
      .selectOption('direct_payer_billing');
    await payerArrangementForm.locator('select[name="recipientType"]').selectOption('insurance');
    await payerArrangementForm.locator('input[name="recipientName"]').fill('E2E Pflegekasse');
    await payerArrangementForm
      .locator('input[name="recipientAddress"]')
      .fill('E2E Payer Street 1, 10115 Berlin');
    await payerArrangementForm.locator('select[name="mandateStatus"]').selectOption('authorized');
    await payerArrangementForm.locator('input[name="validFrom"]').fill(serviceValidFrom);
    await payerArrangementForm.locator('input[name="documentedSource"]').fill('E2E payer mandate');
    await payerArrangementForm
      .locator('input[name="documentedReference"]')
      .fill(`E2E mandate ${runId}`);
    await payerArrangementForm.getByRole('button', { name: 'Save payer arrangement' }).click();
    await expect(page).toHaveURL(/updated=PAYER_ARRANGEMENT_SAVED/);
    await expect(page.getByRole('status')).toContainText('Payer arrangement saved.');

    await page.goto('/billing/settings');
    const billingProfileSection = page.getByRole('region', { name: e2eOrganizationName });
    await billingProfileSection
      .locator('input[name="bankAccountHolder"]')
      .fill(e2eOrganizationName);
    await billingProfileSection.locator('input[name="iban"]').fill('DE89370400440532013000');
    await billingProfileSection
      .locator('select[name="taxTreatment"]')
      .selectOption('small_business');
    await billingProfileSection.locator('input[name="taxExemptionBasis"]').fill('§ 19 UStG');
    await billingProfileSection.locator('select[name="requiredInvoiceFormat"]').selectOption('pdf');
    await billingProfileSection.locator('input[name="requireAcknowledgement"]').check();
    await billingProfileSection.getByRole('button', { name: 'Save billing profile' }).click();
    await expect(page.getByRole('status')).toContainText('Billing profile saved.');

    await page.goto('/benefits');
    const recognitionForm = page
      .locator('form')
      .filter({ has: page.locator('#recognition-organization') });
    await recognitionForm.locator('#recognition-organization').selectOption(e2eOrganizationId);
    await recognitionForm
      .locator('#recognized-offering')
      .fill('Angebote zur Unterstützung im Alltag');
    await recognitionForm.locator('#recognition-valid-from').fill(serviceValidFrom);
    await recognitionForm.locator('#recognition-reference').fill(`E2E Anerkennung ${runId}`);
    await recognitionForm.getByRole('button', { name: 'Record recognition' }).click();
    await expect(page.getByRole('status')).toContainText('Provider recognition recorded.');

    await page.goto(
      `/planning?date=${serviceValidFrom}&estimateClientId=${agreementClientId}&estimateServiceId=${serviceId}&estimateDate=${serviceValidFrom}&estimateQuantity=1`,
    );
    await expect(
      page.getByRole('heading', { name: 'Planned service budget estimate' }),
    ).toBeVisible();
    await expect(page.getByText('Estimated service cost', { exact: true })).toBeVisible();
    await expect(page.getByText('Eligible for this service date')).toBeVisible();

    await page.goto(`/clients/${agreementClientId}`);
    await page.getByRole('link', { name: 'Service planning' }).click();
    await expect(page.getByRole('heading', { name: 'Service planning' })).toBeVisible();

    await page.locator('summary').filter({ hasText: 'Create service planning' }).click();
    await page.locator('#new-agreement-from').fill(serviceValidFrom);
    await page.locator('#new-agreement-reference').fill(`E2E-${runId}`);
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByRole('heading', { name: `E2E-${runId}` })).toBeVisible();
    const agreementCard = page.locator('article[id^="agreement-"]');

    await page.getByRole('button', { name: 'Search available services' }).click();
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
    await agreementServiceForm.getByRole('button', { name: 'Add service' }).click();
    await expect(page.getByRole('heading', { name: `E2E Service ${runId}` })).toBeVisible();
    await expect(page.getByText('Weekly: Monday, Wednesday')).toBeVisible();

    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(page.getByText('Service planning activated', { exact: true })).toBeVisible();
    await expect(agreementCard.getByText('Active', { exact: true }).first()).toBeVisible();

    const generationFrom = addCalendarDays(dateInBerlin(), 1);
    const generationUntil = addCalendarDays(generationFrom, 6);
    const generationDetails = page
      .locator('details')
      .filter({ hasText: 'Generate visits' })
      .first();
    await generationDetails.locator('summary').click();
    const generationForm = generationDetails.locator('form');
    await generationForm.locator('input[name="from"]').fill(generationFrom);
    await generationForm.locator('input[name="until"]').fill(generationUntil);
    await generationForm.getByRole('button', { name: 'Generate visits' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Visit generation is complete.' }),
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
    await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible();
    const generatedVisitLink = page.locator(`a[href="/visits/${generatedVisit.id}"]`);
    await expect(generatedVisitLink).toContainText(`Agreement E2E ${runId}`);
    await generatedVisitLink.click();
    await expect(page.getByRole('heading', { name: `Agreement E2E ${runId}` })).toBeVisible();
    await page.getByLabel('Assign employee').selectOption(caregiverEmployeeId);
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Employees' })
        .getByRole('listitem')
        .filter({ has: page.getByText(`E2E ${runId}`, { exact: true }) }),
    ).toBeVisible();

    await page.getByLabel('Start', { exact: true }).fill('08:15');
    await page.getByLabel('End', { exact: true }).fill('08:45');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Yes', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();

    await page.goto(`/clients/${agreementClientId}`);
    await expect(page.getByRole('heading', { name: 'Upcoming visits' })).toBeVisible();
    await expect(page.getByText(`Agreement E2E ${runId}`, { exact: true })).toBeVisible();
    await page.goto(`/employees/${caregiverEmployeeId}`);
    await expect(page.getByRole('heading', { name: 'Upcoming visits' })).toBeVisible();
    await expect(page.getByText(`Agreement E2E ${runId}`, { exact: true })).toBeVisible();

    await page.goto(`/visits/${generatedVisit.id}`);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Cancel visit' }).click();
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
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
      await page.getByRole('button', { name: 'Cancel visit' }).click();
      await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
    }

    await page.goto(`/clients/${agreementClientId}/service-agreements`);
    await expect(page.getByRole('heading', { name: 'Service planning' })).toBeVisible();
    await page.getByRole('button', { name: 'Suspend' }).click();
    await expect(agreementCard.getByText('Suspended', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(agreementCard.getByText('Active', { exact: true }).first()).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'End', exact: true }).click();
    await expect(agreementCard.getByText('Ended', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Service planning ended', { exact: true })).toBeVisible();

    const caregiver = await createAuthentikUser(authentikOrigin, apiToken, {
      username: caregiverUsername,
      name: caregiverName,
      email: caregiverEmail,
      password: caregiverPassword,
      emailVerified: true,
    });
    caregiverAuthentikUserId = caregiver.pk;
    caregiverSubject = caregiver.uuid;
    caregiverContext = await browser.newContext({
      ...devices['Pixel 7'],
      locale: 'en',
      timezoneId: 'Europe/Berlin',
    });
    const caregiverPage = await caregiverContext.newPage();
    await signInWithAuthentik(caregiverPage, caregiverUsername, caregiverPassword);
    await expect(
      caregiverPage.getByText('Your account does not have access to an active organization.'),
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

    await page.goto(`/employees/${caregiverEmployeeId}`);
    await page.getByLabel('Link an active user').selectOption(caregiverPlatformUserId);
    await page.getByRole('button', { name: 'Link user' }).click();
    await expect(page.getByText(caregiverName, { exact: true })).toBeVisible();

    await page.goto('/');
    if (await page.getByRole('button', { name: 'Sign in with Authentik' }).isVisible()) {
      await signInWithAuthentik(page, username, password);
    }
    await page.locator('select[name="tenantId"]').selectOption(tenantId);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/clients$/);

    if (!serviceId || !agreementClientId) {
      throw new Error('The E2E service and client must exist before execution');
    }
    await page.goto(`/services/${serviceId}`);
    await expect(page.getByRole('heading', { name: `E2E Service ${runId}` })).toBeVisible();
    const executionSchedule = nextVisitTimesInBerlin();
    const executionDate = executionSchedule.date;
    const executionDateAtNoonUtc = new Date(`${executionDate}T12:00:00.000Z`);
    const englishCareDate = new Intl.DateTimeFormat('en', {
      dateStyle: 'full',
      timeZone: 'Europe/Berlin',
    }).format(executionDateAtNoonUtc);
    const germanCareDate = new Intl.DateTimeFormat('de', {
      dateStyle: 'full',
      timeZone: 'Europe/Berlin',
    }).format(executionDateAtNoonUtc);
    await page.goto(`/planning?date=${executionDate}`);
    const manualVisitForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Create visit' }),
    });
    await manualVisitForm.getByLabel('Client').selectOption(agreementClientId);
    await manualVisitForm.locator('input[name="localDate"]').fill(executionDate);
    await manualVisitForm.locator('input[name="localStartTime"]').fill(executionSchedule.start);
    await manualVisitForm.locator('input[name="localEndTime"]').fill(executionSchedule.end);
    await manualVisitForm.locator('select[name="serviceDefinitionIds"]').selectOption(serviceId);
    await manualVisitForm.locator('select[name="employeeId"]').selectOption(caregiverEmployeeId);
    await manualVisitForm.locator('textarea[name="note"]').fill(executionMarker);
    await manualVisitForm.getByRole('button', { name: 'Create visit' }).click();
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
    await caregiverPage.locator('select[name="tenantId"]').selectOption(tenantId);
    await caregiverPage.getByRole('button', { name: 'Continue' }).click();
    await expect(caregiverPage).toHaveURL(/\/clients$/);
    await caregiverPage.goto('/care/today');
    await expect(caregiverPage).toHaveURL(/\/care\/today$/);
    await expect(caregiverPage.locator('html')).toHaveAttribute('lang', 'en');
    await expect(caregiverPage.getByRole('heading', { name: 'My visits' })).toBeVisible();
    await expect(
      caregiverPage
        .locator('nav[aria-label]')
        .getByRole('link', { name: retiredModuleNavigationName }),
    ).toHaveCount(0);
    const mobileVisitLink = caregiverPage.getByRole('link', {
      name: `Agreement E2E ${runId}`,
    });
    const mobileVisitRow = caregiverPage.getByRole('listitem').filter({ has: mobileVisitLink });
    await expect(
      caregiverPage.getByText(`Visits for ${englishCareDate}`, { exact: true }),
    ).toBeVisible();
    await expect(mobileVisitRow).toContainText('Next visit');
    await expect(mobileVisitRow).toContainText('Not started');
    await caregiverPage.getByRole('combobox', { name: 'Language' }).selectOption('de');
    await expect(caregiverPage.locator('html')).toHaveAttribute('lang', 'de');
    await expect(caregiverPage.getByRole('heading', { name: 'Meine Einsätze' })).toBeVisible();
    await expect(
      caregiverPage
        .locator('nav[aria-label]')
        .getByRole('link', { name: retiredModuleNavigationName }),
    ).toHaveCount(0);
    await expect(
      caregiverPage.getByText(`Einsätze am ${germanCareDate}`, { exact: true }),
    ).toBeVisible();
    await expect(mobileVisitRow).toContainText('Nächster Einsatz');
    await expect(mobileVisitRow).toContainText('Nicht gestartet');
    await caregiverPage.reload();
    await expect(caregiverPage.getByRole('combobox', { name: 'Sprache' })).toHaveValue('de');
    await expect(
      caregiverPage.getByText(`Einsätze am ${germanCareDate}`, { exact: true }),
    ).toBeVisible();
    await caregiverPage.getByRole('combobox', { name: 'Sprache' }).selectOption('en');
    await expect(caregiverPage.locator('html')).toHaveAttribute('lang', 'en');
    await expect(caregiverPage.getByRole('heading', { name: 'My visits' })).toBeVisible();
    await expect(
      caregiverPage.getByText(`Visits for ${englishCareDate}`, { exact: true }),
    ).toBeVisible();
    await expect(mobileVisitLink).toContainText(`Agreement E2E ${runId}`);
    await mobileVisitLink.click();
    await expect(
      caregiverPage.getByRole('heading', { name: `Agreement E2E ${runId}` }),
    ).toBeVisible();
    await expectMobileLayoutToFit(caregiverPage);
    if (!replacementEmployeeId) throw new Error('The cover employee is missing for reassignment');
    await page.goto(`/visits/${executionVisitId}`);
    await page.getByLabel('Assign employee').selectOption(replacementEmployeeId);
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/visits/${executionVisitId}\\?updated=assigned$`));
    await expect(
      page
        .getByRole('region', { name: 'Employees' })
        .getByRole('listitem')
        .filter({ has: page.getByText(`Cover E2E ${runId}`, { exact: true }) }),
    ).toBeVisible();
    const formerAssignment = page
      .getByRole('region', { name: 'Employees' })
      .getByRole('listitem')
      .filter({ has: page.getByText(`E2E ${runId}`, { exact: true }) });
    await formerAssignment.getByRole('button', { name: 'Unassign', exact: true }).click();
    await expect(formerAssignment).toHaveCount(0);

    await caregiverPage.getByRole('button', { name: 'Start visit' }).tap();
    const reassignmentDeniedAlert = caregiverPage
      .getByRole('alert')
      .filter({ hasText: 'You are not assigned to this visit.' });
    await expect(reassignmentDeniedAlert).toContainText('You are not assigned to this visit.');
    const deniedExecution = await database.query<{ id: string }>(
      'SELECT id FROM visit_execution.executions WHERE tenant_id = $1 AND visit_id = $2',
      [tenantId, executionVisitId],
    );
    expect(deniedExecution.rows).toHaveLength(0);

    await page.getByLabel('Assign employee').selectOption(caregiverEmployeeId);
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/visits/${executionVisitId}\\?updated=assigned$`));
    await expect(
      page
        .getByRole('region', { name: 'Employees' })
        .getByRole('listitem')
        .filter({ has: page.getByText(`E2E ${runId}`, { exact: true }) }),
    ).toBeVisible();
    await caregiverPage.reload();
    await expect(caregiverPage.getByRole('button', { name: 'Start visit' })).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Start visit' }).tap();
    await expect(caregiverPage.getByText('In progress', { exact: true })).toBeVisible();
    await expectMobileLayoutToFit(caregiverPage);
    await expect(caregiverPage.getByRole('heading', { name: 'Planned services' })).toBeVisible();
    const plannedServiceForm = caregiverPage.locator('form').filter({
      has: caregiverPage.getByRole('button', { name: 'Save outcome' }),
    });
    await plannedServiceForm.locator('select[name="status"]').selectOption('performed');
    await plannedServiceForm.locator('input[name="actualQuantity"]').fill('1');
    await plannedServiceForm.getByRole('button', { name: 'Save outcome' }).tap();
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Service outcome saved.' }),
    ).toBeVisible();

    const unplannedForm = caregiverPage.locator('form').filter({
      has: caregiverPage.getByRole('button', { name: 'Record service' }),
    });
    await unplannedForm.locator('select[name="serviceDefinitionId"]').selectOption(serviceId);
    await unplannedForm.locator('select[name="status"]').selectOption('performed');
    await unplannedForm.locator('input[name="actualQuantity"]').fill('1');
    await unplannedForm.getByRole('button', { name: 'Record service' }).tap();
    await expect(
      caregiverPage.getByRole('heading', { name: 'Additional services recorded' }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Start documentation' }).tap();
    await expect(
      caregiverPage.getByRole('heading', { name: 'Service documentation' }),
    ).toBeVisible();

    const observationText = `E2E observation ${runId}`;
    const observationSection = caregiverPage
      .getByRole('heading', { name: 'Observations', level: 3 })
      .locator('..');
    const observationForm = observationSection.locator('form');
    await observationSection.locator('textarea[name="content"]').fill(observationText);
    await expect(observationForm.getByRole('status')).toContainText(
      'Draft kept temporarily in this browser tab',
    );
    await caregiverPage.goto('/care/today');
    await caregiverPage.goto(`/care/visits/${executionVisitId}`);
    const recoveredObservationForm = caregiverPage
      .getByRole('heading', { name: 'Observations', level: 3 })
      .locator('..')
      .locator('form');
    await expect(recoveredObservationForm.getByText('An unsent draft from')).toBeVisible();
    await recoveredObservationForm.getByRole('button', { name: 'Restore draft' }).tap();
    await expect(recoveredObservationForm.locator('textarea[name="content"]')).toHaveValue(
      observationText,
    );
    const visitPath = new URL(caregiverPage.url()).pathname;
    const observationSaveResponse = caregiverPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.headers()['content-type']?.startsWith('text/x-component') === true &&
        new URL(response.url()).pathname === visitPath,
    );
    await Promise.all([
      recoveredObservationForm.getByRole('button', { name: 'Save changes' }).tap(),
      observationSaveResponse,
    ]);
    await expect(
      caregiverPage
        .getByRole('heading', { name: 'Observations', level: 3 })
        .locator('..')
        .locator('li > p')
        .filter({ hasText: observationText }),
    ).toBeVisible();
    await expect(recoveredObservationForm.getByRole('status')).toContainText(
      'The server confirmed this submission.',
    );
    const remainingObservationDrafts = await caregiverPage.evaluate((visitId) => {
      const visitPart = encodeURIComponent(visitId);
      const formPart = encodeURIComponent('entry-new:observation');
      return Array.from({ length: window.sessionStorage.length }, (_, index) =>
        window.sessionStorage.key(index),
      ).filter((key) => key?.includes(visitPart) && key?.includes(formPart)).length;
    }, executionVisitId);
    expect(remainingObservationDrafts).toBe(0);

    const deviationText = `E2E deviation ${runId}`;
    const deviationSection = caregiverPage
      .getByRole('heading', { name: 'Deviations' })
      .locator('..');
    await deviationSection.locator('textarea[name="content"]').fill(deviationText);
    await deviationSection.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      deviationSection.locator('li > p').filter({ hasText: deviationText }),
    ).toBeVisible();

    const incidentText = `E2E incident ${runId}`;
    const incidentSection = caregiverPage.getByRole('heading', { name: 'Incidents' }).locator('..');
    await incidentSection.locator('textarea[name="content"]').fill(incidentText);
    await incidentSection.locator('select[name="severity"]').selectOption('low');
    await incidentSection.getByRole('button', { name: 'Save changes' }).click();
    await expect(incidentSection.locator('li > p').filter({ hasText: incidentText })).toBeVisible();
    await expect(
      caregiverPage
        .getByRole('heading', { name: 'Finalize documentation' })
        .locator('..')
        .getByText(/Service evidence is missing/)
        .first(),
    ).toBeVisible();

    await caregiverPage.getByRole('button', { name: 'Complete visit' }).click();
    await expect(caregiverPage.getByText('Completed', { exact: true })).toBeVisible();

    await caregiverPage.goto('/care/today');
    await expect(caregiverPage.getByText('⚠ Documentation incomplete')).toBeVisible();
    await page.goto('/documentation');
    await expect(page.getByRole('heading', { name: 'Incomplete documentation' })).toBeVisible();
    await expect(page.getByText(`Agreement E2E ${runId}`, { exact: true })).toBeVisible();
    const documentationClientFilter = page.getByLabel('Client');
    await documentationClientFilter.fill(`Agreement E2E ${runId}`);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText('1 visit', { exact: true })).toBeVisible();
    await documentationClientFilter.fill('Unknown client');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText('0 visits', { exact: true })).toBeVisible();

    await caregiverPage.goto(`/care/visits/${executionVisitId}`);
    const evidenceSection = caregiverPage
      .getByRole('heading', { name: 'Service documentation' })
      .locator('..');
    const evidenceRows = evidenceSection.locator('li');
    await expect(evidenceRows).toHaveCount(2);
    const staleDraftForm = caregiverPage.locator('form').filter({
      has: caregiverPage.locator('input[name="type"][value="care_note"]'),
    });
    await staleDraftForm.locator('textarea[name="content"]').fill(`Stale E2E draft ${runId}`);
    await expect(staleDraftForm.getByRole('status')).toContainText(
      'Draft kept temporarily in this browser tab',
    );
    for (let index = 0; index < (await evidenceRows.count()); index += 1) {
      const row = evidenceRows.nth(index);
      await row.locator('textarea[name="note"]').fill(`E2E service evidence ${index + 1} ${runId}`);
      await row.getByRole('button', { name: 'Save evidence' }).tap();
      await expect(row.getByText('Evidence recorded', { exact: true })).toBeVisible();
    }
    await caregiverPage.reload();
    const staleDraftAfterReload = caregiverPage.locator('form').filter({
      has: caregiverPage.locator('input[name="type"][value="care_note"]'),
    });
    await expect(
      staleDraftAfterReload.getByText(
        'A draft from an earlier server version cannot be restored safely',
      ),
    ).toBeVisible();
    await expect(staleDraftAfterReload.locator('textarea[name="content"]')).toHaveValue('');
    await caregiverPage.once('dialog', (dialog) => dialog.accept());
    await staleDraftAfterReload.getByRole('button', { name: 'Discard draft' }).tap();
    await expect(
      staleDraftAfterReload.getByText(
        'A draft from an earlier server version cannot be restored safely',
      ),
    ).toHaveCount(0);
    const remainingStaleDrafts = await caregiverPage.evaluate((visitId) => {
      const visitPart = encodeURIComponent(visitId);
      const formPart = encodeURIComponent('entry-new:care_note');
      return Array.from({ length: window.sessionStorage.length }, (_, index) =>
        window.sessionStorage.key(index),
      ).filter((key) => key?.includes(visitPart) && key?.includes(formPart)).length;
    }, executionVisitId);
    expect(remainingStaleDrafts).toBe(0);
    await expect(
      caregiverPage.getByRole('button', { name: 'Finalize documentation' }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Finalize documentation' }).tap();
    await expect(caregiverPage.getByText('Finalized', { exact: true })).toBeVisible();
    await expect(caregiverPage.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(caregiverPage.getByRole('button', { name: 'Save evidence' })).toHaveCount(0);

    await caregiverPage.goto(`/care/visits/${executionVisitId}/evidence`);
    await expect(
      caregiverPage.getByRole('heading', { name: 'Review service evidence' }),
    ).toBeVisible();
    await expectMobileLayoutToFit(caregiverPage);
    await caregiverPage.getByRole('button', { name: 'Create service evidence' }).click();
    await expect(caregiverPage.getByText('Version 1', { exact: true })).toBeVisible();
    await expectMobileLayoutToFit(caregiverPage);
    await expect(
      caregiverPage.getByText(`E2E Service ${runId}`, { exact: true }).first(),
    ).toBeVisible();
    const firstSignaturePad = caregiverPage.locator('#acknowledge-evidence').getByRole('img');
    await firstSignaturePad.scrollIntoViewIfNeeded();
    const signatureBounds = await firstSignaturePad.boundingBox();
    if (!signatureBounds) throw new Error('The mobile signature pad is not visible');
    const touch = await caregiverPage.context().newCDPSession(caregiverPage);
    const touchPoint = (x: number, y: number) => ({
      id: 1,
      x,
      y,
      radiusX: 2,
      radiusY: 2,
      force: 1,
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        touchPoint(
          signatureBounds.x + signatureBounds.width * 0.2,
          signatureBounds.y + signatureBounds.height * 0.6,
        ),
      ],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        touchPoint(
          signatureBounds.x + signatureBounds.width * 0.45,
          signatureBounds.y + signatureBounds.height * 0.35,
        ),
      ],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        touchPoint(
          signatureBounds.x + signatureBounds.width * 0.75,
          signatureBounds.y + signatureBounds.height * 0.55,
        ),
      ],
    });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    const acknowledgementFormState = await caregiverPage
      .locator('#acknowledge-evidence')
      .evaluate((form) => {
        const formElement = form as HTMLFormElement;
        const invalidControls = Array.from(formElement.elements)
          .filter(
            (
              element,
            ): element is
              | HTMLButtonElement
              | HTMLInputElement
              | HTMLSelectElement
              | HTMLTextAreaElement =>
              element instanceof HTMLButtonElement ||
              element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement,
          )
          .filter((element) => !element.checkValidity())
          .map(
            (element) => `${element.tagName.toLowerCase()}[name="${element.getAttribute('name')}"]`,
          );
        return {
          online: navigator.onLine,
          valid: formElement.checkValidity(),
          invalidControls,
          serializedStrokeCount: JSON.parse(
            formElement.querySelector<HTMLInputElement>('input[name="strokes"]')?.value ?? '[]',
          ).length,
        };
      });
    expect(acknowledgementFormState.online).toBe(true);
    expect(acknowledgementFormState.valid).toBe(true);
    expect(acknowledgementFormState.serializedStrokeCount).toBeGreaterThan(0);
    let acknowledgementDialogSeen = false;
    await caregiverPage.once('dialog', async (dialog) => {
      acknowledgementDialogSeen = true;
      await dialog.accept();
    });
    const signatureSubmit = caregiverPage.getByRole('button', { name: 'Confirm signature' });
    await expect(signatureSubmit).toBeEnabled();
    await signatureSubmit.click();
    expect(acknowledgementDialogSeen).toBe(true);
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Service evidence acknowledged' }),
    ).toBeVisible();
    await expectMobileLayoutToFit(caregiverPage);
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
    await expect(page.getByRole('heading', { name: 'Execution' })).toBeVisible();
    await expect(page.getByText('Visit completed', { exact: true })).toBeVisible();
    await expect(page.getByText(`E2E Service ${runId}`, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(observationText, { exact: true })).toBeVisible();
    await expect(page.getByText(deviationText, { exact: true })).toBeVisible();
    await expect(page.getByText(incidentText, { exact: true })).toBeVisible();
    const amendmentDetails = page.locator('details').filter({ hasText: 'Amend documentation' });
    await amendmentDetails.locator('summary').click();
    await amendmentDetails.locator('input[name="reason"]').fill(`E2E correction reason ${runId}`);
    await amendmentDetails.locator('textarea[name="correction"]').fill(`E2E amendment ${runId}`);
    await amendmentDetails.getByRole('button', { name: 'Save addition' }).click();
    await expect(page.getByText(`E2E amendment ${runId}`, { exact: true })).toBeVisible();
    const correctionDetails = page
      .locator('details')
      .filter({ hasText: 'Correct execution times' });
    await correctionDetails.locator('summary').click();
    const actualStartInput = correctionDetails.locator('input[name="actualStart"]');
    await actualStartInput.fill(shiftDateTimeLocal(await actualStartInput.inputValue(), -1));
    await correctionDetails.locator('textarea[name="reason"]').fill('E2E correction reason');
    await correctionDetails.getByRole('button', { name: 'Correct times' }).click();
    await expect(page.getByText('Visit times corrected', { exact: true })).toBeVisible();

    await caregiverPage.goto(`/care/visits/${executionVisitId}/evidence`);
    await expect(
      caregiverPage.getByText('A new version is required', { exact: true }),
    ).toBeVisible();
    await expect(
      caregiverPage.getByText('The earlier acknowledgement remains recorded', { exact: false }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Create current service evidence' }).click();
    await expect(caregiverPage.getByText('Version 2', { exact: true })).toBeVisible();
    const signatoryPicker = caregiverPage.getByLabel('Select the person acknowledging');
    await signatoryPicker.selectOption(`representative:${representativeContactId}`);
    await caregiverPage.locator('input[name="method-choice"][value="typed_confirmation"]').check();
    await caregiverPage.locator('input[name="confirmationName"]').fill('E2E Representative');
    await caregiverPage.once('dialog', (dialog) => dialog.accept());
    await caregiverPage.getByRole('button', { name: 'Record acknowledgement' }).click();
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Service evidence acknowledged' }),
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
    await expect(page.getByRole('heading', { name: 'Service evidence' })).toBeVisible();
    const acknowledgedRow = page.getByRole('row').filter({
      has: page.locator(`a[href="/service-evidence/${replacementEvidencePackageId}"]`),
    });
    await expect(acknowledgedRow).toContainText('Acknowledged');
    await expect(acknowledgedRow).toContainText('E2E Representative');
    await expect(acknowledgedRow.getByRole('link')).toHaveAttribute(
      'href',
      `/service-evidence/${replacementEvidencePackageId}`,
    );
    await acknowledgedRow.getByRole('link').click();
    await expect(page.getByText('E2E Representative', { exact: true })).toBeVisible();
    await expect(page.getByText('authorized representative', { exact: true })).toBeVisible();
    await expect(page.getByText('Name confirmation', { exact: true })).toBeVisible();
    const initialVersionLink = page.locator(
      `a[href="/service-evidence/${initialEvidencePackageId}"]`,
    );
    await expect(initialVersionLink).toBeVisible();
    await initialVersionLink.click();
    await expect(page.getByRole('img', { name: 'Saved signature' })).toBeVisible();
    await page.goto(`/service-evidence/${replacementEvidencePackageId}`);
    const revokeForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Revoke acknowledgement' }),
    });
    await revokeForm.locator('input[name="reason"]').fill(`E2E revocation ${runId}`);
    await page.once('dialog', (dialog) => dialog.accept());
    await revokeForm.getByRole('button', { name: 'Revoke acknowledgement' }).click();
    await expect(page.getByRole('status')).toContainText('The acknowledgement was revoked.');
    await expect(page.getByText('Revoked', { exact: true }).first()).toBeVisible();

    await caregiverPage.goto(`/care/visits/${executionVisitId}/evidence`);
    await caregiverPage
      .getByLabel('Select the person acknowledging')
      .selectOption(`representative:${representativeContactId}`);
    await caregiverPage
      .locator('details')
      .filter({
        hasText: 'Acknowledgement declined or unavailable',
      })
      .locator('summary')
      .click();
    const declineForm = caregiverPage.locator('form').filter({
      has: caregiverPage.getByRole('button', { name: 'Record decline' }),
    });
    await declineForm.locator('select[name="reasonCode"]').selectOption('disagrees_with_record');
    await declineForm.locator('textarea[name="note"]').fill(`E2E decline note ${runId}`);
    await caregiverPage.once('dialog', (dialog) => dialog.accept());
    await declineForm.getByRole('button', { name: 'Record decline' }).click();
    await expect(
      caregiverPage
        .getByRole('status')
        .filter({ hasText: 'The decline is recorded for this version' }),
    ).toBeVisible();
    expect(
      await caregiverPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    const claimEvidenceRefresh = `E2E claim evidence refresh ${runId}`;
    await page.goto(`/visits/${executionVisitId}`);
    const claimEvidenceAmendment = page
      .locator('details')
      .filter({ hasText: 'Amend documentation' });
    await claimEvidenceAmendment.locator('summary').click();
    await claimEvidenceAmendment
      .locator('input[name="reason"]')
      .fill(`E2E billing evidence reason ${runId}`);
    await claimEvidenceAmendment.locator('textarea[name="correction"]').fill(claimEvidenceRefresh);
    await claimEvidenceAmendment.getByRole('button', { name: 'Save addition' }).click();
    await expect(page.getByText(claimEvidenceRefresh, { exact: true })).toBeVisible();

    await caregiverPage.goto(`/care/visits/${executionVisitId}/evidence`);
    await expect(
      caregiverPage.getByText('A new version is required', { exact: true }),
    ).toBeVisible();
    await caregiverPage.getByRole('button', { name: 'Create current service evidence' }).tap();
    await expect(caregiverPage.getByText('Version 3', { exact: true })).toBeVisible();
    await caregiverPage
      .getByLabel('Select the person acknowledging')
      .selectOption(`representative:${representativeContactId}`);
    await caregiverPage.locator('input[name="method-choice"][value="typed_confirmation"]').check();
    await caregiverPage.locator('input[name="confirmationName"]').fill('E2E Representative');
    await caregiverPage.once('dialog', (dialog) => dialog.accept());
    await caregiverPage.getByRole('button', { name: 'Record acknowledgement' }).tap();
    await expect(
      caregiverPage.getByRole('status').filter({ hasText: 'Service evidence acknowledged' }),
    ).toBeVisible();
    const finalPackage = await database.query<{
      id: string;
      version: number;
      status: string;
    }>(
      `SELECT package.id, package.version, acknowledgement.status
       FROM service_evidence.evidence_packages AS package
       JOIN care_documentation.documents AS documentation
         ON documentation.tenant_id = package.tenant_id AND documentation.id = package.documentation_id
       LEFT JOIN service_evidence.acknowledgements AS acknowledgement
         ON acknowledgement.tenant_id = package.tenant_id
         AND acknowledgement.evidence_package_id = package.id
         AND acknowledgement.revoked_at IS NULL
       WHERE package.tenant_id = $1 AND documentation.visit_id = $2
       ORDER BY package.version DESC LIMIT 1`,
      [tenantId, executionVisitId],
    );
    finalEvidencePackageId = finalPackage.rows[0]?.id;
    if (
      finalPackage.rows[0]?.version !== 3 ||
      finalPackage.rows[0]?.status !== 'acknowledged' ||
      !finalEvidencePackageId
    ) {
      throw new Error('The latest evidence package was not acknowledged after the amendment');
    }
    await page.goto(
      `/service-evidence?clientQuery=${encodeURIComponent(`Agreement E2E ${runId}`)}`,
    );
    const finalEvidenceRow = page.getByRole('row').filter({
      has: page.locator(`a[href="/service-evidence/${finalEvidencePackageId}"]`),
    });
    await expect(finalEvidenceRow).toContainText('Acknowledged');
    await expect(finalEvidenceRow).toContainText('E2E Representative');

    await page.goto(`/clients/${agreementClientId}`);
    await expect(page.getByText('Visit started', { exact: true })).toBeVisible();
    await expect(page.getByText('Visit completed', { exact: true })).toBeVisible();
    await expect(page.getByText('Documentation finalized', { exact: true })).toBeVisible();
    await expect(page.getByText('Incident documented', { exact: true })).toBeVisible();
    await expect(page.getByText('Documentation amended', { exact: true }).first()).toBeVisible();
    const clientExecutionRow = page.locator(`a[href="/visits/${executionVisitId}"]`);
    await expect(clientExecutionRow).toContainText('Execution: Completed');
    await expect(clientExecutionRow).toContainText('Actual');
    await page.goto(`/employees/${caregiverEmployeeId}`);
    const employeeExecutionRow = page.locator(`a[href="/visits/${executionVisitId}"]`);
    await expect(employeeExecutionRow).toContainText('Execution: Completed');
    await expect(employeeExecutionRow).toContainText('Actual');

    await page.goto('/benefits');
    const completedService = page
      .getByRole('heading', { name: `E2E Service ${runId} · Agreement E2E ${runId}` })
      .first()
      .locator('xpath=ancestor::li[1]');
    const allocationForm = completedService.locator('form');
    const allocationSourceOption = await allocationForm
      .locator('select[name="allocation-0-selection"] option')
      .filter({ hasText: 'E2E Pflegekasse' })
      .getAttribute('value');
    if (!allocationSourceOption)
      throw new Error('The service allocation form has no eligible §45b source');
    await allocationForm
      .locator('select[name="allocation-0-selection"]')
      .selectOption(allocationSourceOption);
    await allocationForm.locator('input[name="allocation-0-amount"]').fill('45');
    await allocationForm.locator('select[name="allocation-0-status"]').selectOption('confirmed');
    await allocationForm.getByRole('button', { name: 'Allocate funding' }).click();
    await expect(page.getByRole('status')).toContainText('Service funding was allocated.', {
      timeout: 30_000,
    });

    await page.goto(`/clients/${agreementClientId}/benefits`);
    const budgetHistory = page.locator('section[aria-labelledby="history-title"]');
    await expect(budgetHistory.getByRole('heading', { name: 'Budget history' })).toBeVisible();
    await expect(
      budgetHistory.getByRole('table').getByText('Completed service allocation', { exact: true }),
    ).toBeVisible();

    const billingFilters = new URLSearchParams({
      from: serviceValidFrom,
      until: serviceValidFrom,
      organizationId: e2eOrganizationId,
      facilityId: e2eFacilityId,
      clientId: agreementClientId,
      ready: 'true',
    });
    await page.goto(`/billing?${billingFilters.toString()}`);
    await expect(page.getByRole('heading', { name: 'Billable service worklist' })).toBeVisible();
    const payerInvoiceGroup = page.locator('#worklist section').filter({
      has: page.locator('header p').filter({ hasText: 'E2E Pflegekasse' }),
    });
    if ((await payerInvoiceGroup.count()) === 0) {
      const readyWorklist = (await page.locator('#worklist').innerText()).slice(0, 4_000);
      const blockedFilters = new URLSearchParams(billingFilters);
      blockedFilters.set('ready', 'false');
      await page.goto(`/billing?${blockedFilters.toString()}`);
      throw new Error(
        `No ready payer invoice group. Ready worklist: ${readyWorklist}\n` +
          `Blocked worklist: ${(await page.locator('#worklist').innerText()).slice(0, 4_000)}`,
      );
    }
    await expect(payerInvoiceGroup).toHaveCount(1);
    await expect(payerInvoiceGroup.locator('header p')).toContainText('Payer invoice');
    await expect(payerInvoiceGroup.locator('header p')).toContainText('E2E Pflegekasse');
    const payerCandidate = payerInvoiceGroup
      .locator('li')
      .filter({ hasText: `E2E Service ${runId}` })
      .filter({ hasText: 'E2E Pflegekasse' })
      .first();
    const includeCandidate = payerCandidate.locator('input[name="selectedLine"]');
    await expect(includeCandidate).toBeEnabled();
    await includeCandidate.check();
    await payerInvoiceGroup.getByRole('button', { name: 'Create draft invoice' }).click();
    await expect(page).toHaveURL(/\/billing\/invoices\/[0-9a-f-]{36}\?updated=draft$/i);
    invoiceId = new URL(page.url()).pathname.split('/').at(-1);
    if (!invoiceId) throw new Error('The billing worklist did not open the invoice draft');
    await expect(page.getByRole('heading', { name: 'Invoice lines' })).toBeVisible();
    await expect(page.getByText(`E2E Service ${runId}`, { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Invoice summary' })
        .getByRole('definition')
        .filter({ hasText: 'E2E Pflegekasse' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await expect(page).toHaveURL(new RegExp(`/billing/invoices/${invoiceId}\\?updated=issued$`));
    await expect(page.getByRole('status')).toHaveText('Invoice issued.');
    await expect(page.locator('section[aria-labelledby="draft-actions-title"]')).toHaveCount(0);

    const invoiceTotals = await database.query<{ grand_total_cents: number }>(
      'SELECT grand_total_cents FROM billing.invoices WHERE tenant_id = $1 AND id = $2',
      [tenantId, invoiceId],
    );
    const invoiceAmountCents = invoiceTotals.rows[0]?.grand_total_cents;
    if (!invoiceAmountCents || invoiceAmountCents <= 0) {
      throw new Error('The issued invoice does not have a billable total');
    }
    const invoiceAmount = (invoiceAmountCents / 100).toFixed(2);
    const invoicePdfLink = page.getByRole('link', { name: 'Download invoice PDF' });
    await expect
      .poll(
        async () => {
          await page.reload();
          return invoicePdfLink.isVisible();
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe(true);
    const invoicePdfResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/billing/invoices/${invoiceId}/pdf` &&
        response.request().method() === 'GET',
    );
    await invoicePdfLink.click();
    const invoicePdfResponse = await invoicePdfResponsePromise;
    expect(invoicePdfResponse.status()).toBe(200);
    expect(invoicePdfResponse.headers()['content-type']).toContain('application/pdf');

    await page.goto(`/billing/invoices/${invoiceId}`);
    await page.getByRole('link', { name: 'Create claim' }).click();
    await expect(page).toHaveURL(new RegExp(`/billing/claims/new\\?invoiceId=${invoiceId}$`));
    const claimCreationForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Create claim draft' }),
    });
    await claimCreationForm.locator('select[name="payerBillingProfileId"]').selectOption({
      index: 1,
    });
    await claimCreationForm.getByRole('button', { name: 'Create claim draft' }).click();
    await expect(page).toHaveURL(/\/billing\/claims\/[0-9a-f-]{36}\?updated=created$/i);
    claimId = new URL(page.url()).pathname.split('/').at(-1);
    if (!claimId) throw new Error('The issued invoice did not create a payer claim draft');
    await expect(page.getByRole('heading', { name: 'Readiness' })).toBeVisible();
    await expect(page.getByText('All configured readiness checks are satisfied.')).toBeVisible();
    const prepareClaimButton = page.getByRole('button', { name: 'Prepare submission package' });
    await expect(prepareClaimButton).toBeEnabled();
    await prepareClaimButton.click();
    await expect(page.getByRole('status')).toHaveText('Submission package prepared.');
    const claimDocumentRows = page
      .locator('section[aria-labelledby="claim-documents"]')
      .locator('li');
    await expect(claimDocumentRows).toHaveCount(3);
    const claimDocumentResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith(`/billing/claims/${claimId}/documents/`) &&
        response.request().method() === 'GET',
    );
    await claimDocumentRows.first().getByRole('link', { name: 'Download' }).click();
    const claimDocumentResponse = await claimDocumentResponsePromise;
    expect(claimDocumentResponse.status()).toBe(200);
    expect(claimDocumentResponse.headers()['content-type']).toContain('application/pdf');

    await page.goto(`/billing/claims/${claimId}`);
    const claimSubmissionForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Record submission' }),
    });
    await claimSubmissionForm
      .locator('input[name="externalReference"]')
      .fill(`E2E submission ${runId}`);
    await claimSubmissionForm
      .locator('input[name="protectedNote"]')
      .fill('Submitted manually through the payer portal.');
    await claimSubmissionForm.getByRole('button', { name: 'Record submission' }).click();
    await expect(page.getByRole('status')).toContainText('Manual submission recorded.');
    const claimDecisionForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Save payer decision' }),
    });
    await claimDecisionForm
      .locator('input[name="externalReference"]')
      .fill(`E2E decision ${runId}`);
    await claimDecisionForm.getByRole('button', { name: 'Save payer decision' }).click();
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible();

    await page.goto('/billing/payments');
    const paymentEntryForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Record payment' }),
    });
    await paymentEntryForm.locator('select[name="organizationId"]').selectOption(e2eOrganizationId);
    await paymentEntryForm.locator('input[name="payerName"]').fill(e2ePayerName);
    await paymentEntryForm.locator('input[name="payerReference"]').fill(`E2E-PAYER-${runId}`);
    await paymentEntryForm.locator('input[name="amount"]').fill(invoiceAmount);
    const paymentReference = `E2E-CLAIM-PAYMENT-${runId}`;
    await paymentEntryForm.locator('input[name="reference"]').fill(paymentReference);
    await paymentEntryForm.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByRole('status')).toContainText('Payment recorded.');

    await page.goto(`/billing/claims/${claimId}`);
    const claimPaymentForm = page
      .locator('form')
      .filter({
        has: page.getByRole('button', { name: 'Link payment' }),
      })
      .filter({ hasText: paymentReference });
    await expect(claimPaymentForm).toBeVisible();
    await claimPaymentForm.getByRole('button', { name: 'Link payment' }).click();
    await expect(page.getByRole('status')).toContainText('Payment linked to claim.');

    await page.goto(`/billing/invoices/${invoiceId}`);
    const invoiceSummary = page.locator('section[aria-labelledby="invoice-summary-title"]');
    await expect(invoiceSummary).toContainText('Paid');
    await page.goto(`/clients/${agreementClientId}/invoices`);
    const clientInvoiceRow = page
      .locator('section[aria-labelledby="client-invoice-history"]')
      .getByRole('row')
      .filter({
        has: page.locator(`a[href="/billing/invoices/${invoiceId}"]`),
      });
    await expect(clientInvoiceRow).toContainText('Paid');

    if (!serviceId) throw new Error('The service detail page did not expose its ID');
    await page.goto(`/services/${serviceId}`);
    const serviceArchivePath = new URL(page.url()).pathname;
    const serviceArchiveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === serviceArchivePath,
    );
    await Promise.all([
      page.getByRole('button', { name: 'Archive service' }).click(),
      serviceArchiveResponse,
    ]);
    await page.reload();
    await expect(page.locator('span').filter({ hasText: /^Archived$/ })).toBeVisible();

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
      invitedPage.getByText('Your account does not have access to an active organization.'),
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
    await expect(page.getByRole('status')).toContainText('Access record updated.');
    await page.locator(`input[name="roleId"][value="${officeRoleId}"]`).uncheck();
    await page.getByRole('button', { name: 'Save roles' }).click();
    await expect(page.getByRole('status')).toContainText('Access record updated.');
    await expect(page.locator(`input[name="roleId"][value="${officeRoleId}"]`)).not.toBeChecked();
    await page.locator(`input[name="roleId"][value="${officeRoleId}"]`).check();
    await page.getByRole('button', { name: 'Save roles' }).click();
    await expect(page.getByRole('status')).toContainText('Access record updated.');

    await page.locator('input[name="scopeMode"][value="scoped"]').check();
    const facilityScope = page.locator(`input[name="scope"][value="facility:${facilityWestId}"]`);
    await facilityScope.check();
    await page.getByRole('button', { name: 'Save scopes' }).click();
    await expect(page.getByRole('status')).toContainText('Access record updated.');
    await facilityScope.uncheck();
    await page.getByRole('button', { name: 'Save scopes' }).click();
    await expect(page.getByRole('status')).toContainText('Access record updated.');
    await expect(facilityScope).not.toBeChecked();
    await facilityScope.check();
    await page.getByRole('button', { name: 'Save scopes' }).click();
    await expect(page.getByRole('status')).toContainText('Access record updated.');
    await page.getByRole('button', { name: 'Activate membership' }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText('Office', { exact: true })).toBeVisible();
    await expect(
      page.locator(`input[name="scope"][value="facility:${facilityWestId}"]`),
    ).toBeChecked();

    await page.goto('/administration/audit');
    await expect(page.getByText('Membership activated', { exact: true })).toBeVisible();

    await invitedPage.goto('/');
    await invitedPage.locator('select[name="tenantId"]').selectOption(tenantId);
    await invitedPage.getByRole('button', { name: 'Continue' }).click();
    await expect(invitedPage).toHaveURL(/\/clients$/);
    await invitedPage.goto('/administration/facilities');
    await expect(invitedPage.getByText('Facility West', { exact: true })).toBeVisible();
    await expect(invitedPage.getByText('Main Office', { exact: true })).toHaveCount(0);

    await page.goto(`/administration/users/${invitedMembershipId}`);
    await page.getByRole('button', { name: 'Deactivate membership' }).click();
    await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Activate membership' }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Revoke access' }).click();
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
    await expect(page.getByText('Revoked memberships cannot be reactivated.')).toBeVisible();

    const pilotTenant = await database.query<{ id: string }>(
      "SELECT id FROM organizations.tenants WHERE slug = 'muster-betreuungsdienst-nrw' AND active = true",
    );
    pilotTenantId = pilotTenant.rows[0]?.id;
    if (pilotTenantId) {
      const pilotAdministrator = await database.query<{ id: string }>(
        "SELECT id FROM identity.roles WHERE tenant_id = $1 AND name = 'Administrator'",
        [pilotTenantId],
      );
      const pilotAdministratorRoleId = pilotAdministrator.rows[0]?.id;
      if (!pilotAdministratorRoleId || !platformUserId) {
        throw new Error('The pilot tenant or E2E administrator is missing');
      }
      pilotMembershipId = uuidv7();
      await database.query('BEGIN');
      try {
        await database.query(
          "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
          [pilotMembershipId, platformUserId, pilotTenantId],
        );
        await database.query(
          'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
          [pilotMembershipId, pilotTenantId, pilotAdministratorRoleId],
        );
        await database.query(
          "INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id) VALUES ($1, $2, 'tenant', $2)",
          [pilotMembershipId, pilotTenantId],
        );
        await database.query('COMMIT');
      } catch (error) {
        await database.query('ROLLBACK');
        throw error;
      }

      await page.goto('/');
      await page.locator('select[name="tenantId"]').selectOption(pilotTenantId);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page).toHaveURL(/\/clients$/);
      await page.goto('/operations/tasks?q=%5BSYNTHETIC%20PILOT%5D');
      await expect(
        page.getByRole('heading', { name: 'Manual tasks', exact: true, level: 1 }),
      ).toBeVisible();
      await expect(page.locator('section[aria-labelledby="task-list-title"] ul > li')).toHaveCount(
        15,
      );
      const claimTaskTitle = '[SYNTHETIC PILOT] Review local claim exercise';
      await page.getByRole('link', { name: /Review local claim exercise/ }).click();
      await expect(page.getByRole('heading', { name: claimTaskTitle })).toBeVisible();
      const claimSourceLink = page.getByRole('link', { name: 'Open source record' });
      await expect(claimSourceLink).toHaveAttribute('href', /^\/billing\/claims\/[0-9a-f-]{36}$/i);
      const claimSourceUrl = new URL((await claimSourceLink.getAttribute('href'))!, page.url())
        .href;
      await claimSourceLink.click();
      await expect(page).toHaveURL(claimSourceUrl);
      await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
      await page.goto('/operations/deadlines');
      await expect(page.getByRole('heading', { name: 'Deadlines & Reminders' })).toBeVisible();
    }
  } finally {
    try {
      await Promise.all(
        [caregiverContext, invitedContext]
          .filter((context): context is BrowserContext => context !== undefined)
          .map((context) => context.close().catch(() => undefined)),
      );
      if (pilotTenantId && pilotMembershipId) {
        await cleanupPilotMembership(database, pilotTenantId, pilotMembershipId);
      }
      // Payer profiles and their actor references are retained with financial history in this
      // disposable Compose database, which is removed after the browser run.
      if (tenantId && !billingRecordsMayExist) {
        const testClientIds = [agreementClientId, admissionClientId].filter(
          (id): id is string => id !== undefined,
        );
        if (admissionCaseId) await cleanupAdmissionRecords(database, tenantId, admissionCaseId);
        await cleanupBenefitsRecords(database, tenantId, testClientIds, e2eOrganizationName);
        if (testClientIds.length) {
          await cleanupServiceAgreementRecords(
            database,
            tenantId,
            testClientIds,
            [executionVisitId].filter((id): id is string => id !== undefined),
          );
        }
        await cleanupServiceCatalogRecords(database, tenantId, {
          serviceCode,
          serviceCategoryCode,
        });
        await cleanupOnboardingTemplates(database, tenantId, e2eOrganizationName);
        await database.query(
          'UPDATE employees.employees SET user_id = NULL WHERE tenant_id = $1 AND personnel_number = ANY($2::text[])',
          [tenantId, [caregiverPersonnelNumber]],
        );
      }
      if (!billingRecordsMayExist) {
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
          ...(clientId || agreementClientId || admissionClientId
            ? {
                clientIds: [clientId, agreementClientId, admissionClientId].filter(
                  (id): id is string => id !== undefined,
                ),
              }
            : {}),
        });
        if (tenantId) {
          await cleanupOrganizationRecords(database, tenantId, {
            organizationName: e2eOrganizationName,
            facilityName: e2eFacilityName,
            teamName: e2eTeamName,
            personnelNumbers: [caregiverPersonnelNumber, replacementEmployeePersonnelNumber],
          });
        }
      }
    } finally {
      await database.end();
      if (!billingRecordsMayExist && authentikUserId !== undefined) {
        await authentikRequest(
          authentikOrigin,
          apiToken,
          `/api/v3/core/users/${authentikUserId}/`,
          { method: 'DELETE' },
          true,
        );
      }
      if (!billingRecordsMayExist && invitedAuthentikUserId !== undefined) {
        await authentikRequest(
          authentikOrigin,
          apiToken,
          `/api/v3/core/users/${invitedAuthentikUserId}/`,
          { method: 'DELETE' },
          true,
        );
      }
      if (!billingRecordsMayExist && caregiverAuthentikUserId !== undefined) {
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
        'DELETE FROM services.service_prices WHERE tenant_id = $1 AND service_id = ANY($2::uuid[])',
        [tenantId, serviceIds],
      );
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

async function cleanupBenefitsRecords(
  database: Client,
  tenantId: string,
  clientIds: string[],
  organizationName: string,
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const organization = await database.query<{ id: string }>(
      'SELECT id FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [tenantId, organizationName],
    );
    const organizationIds = organization.rows.map((row) => row.id);
    const sources = await database.query<{ id: string }>(
      'SELECT id FROM benefits.funding_sources WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const entitlements = await database.query<{ id: string }>(
      'SELECT id FROM benefits.client_entitlements WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const buckets = await database.query<{ id: string }>(
      'SELECT id FROM benefits.allocation_buckets WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const allocations = await database.query<{ id: string }>(
      'SELECT id FROM benefits.service_allocations WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const reversals = await database.query<{ id: string }>(
      'SELECT id FROM benefits.service_allocation_reversals WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const ledger = await database.query<{ id: string }>(
      'SELECT id FROM benefits.ledger_entries WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    const recognitions = organizationIds.length
      ? await database.query<{ id: string }>(
          'SELECT id FROM benefits.provider_recognitions WHERE tenant_id = $1 AND organization_id = ANY($2::uuid[])',
          [tenantId, organizationIds],
        )
      : { rows: [] as Array<{ id: string }> };
    const resourceIds = [
      ...sources.rows.map((row) => row.id),
      ...entitlements.rows.map((row) => row.id),
      ...buckets.rows.map((row) => row.id),
      ...allocations.rows.map((row) => row.id),
      ...reversals.rows.map((row) => row.id),
      ...ledger.rows.map((row) => row.id),
      ...recognitions.rows.map((row) => row.id),
    ];
    await database.query(
      'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])',
      [tenantId, resourceIds],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE tenant_id = $1
         AND (event ->> 'aggregateId' = ANY($2::text[])
           OR event -> 'payload' ->> 'clientId' = ANY($3::text[]))`,
      [tenantId, resourceIds, clientIds],
    );
    for (const [table, trigger] of [
      ['service_allocation_reversals', 'service_allocation_reversals_immutable'],
      ['service_allocations', 'service_allocations_immutable'],
      ['ledger_entries', 'benefit_ledger_entries_immutable'],
      ['allocation_buckets', 'benefit_allocation_buckets_immutable'],
    ] as const) {
      await database.query(`ALTER TABLE benefits.${table} DISABLE TRIGGER ${trigger}`);
    }
    await database.query(
      'DELETE FROM benefits.ledger_entries WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    await database.query(
      'DELETE FROM benefits.service_allocation_reversals WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    await database.query(
      'DELETE FROM benefits.service_allocations WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    await database.query(
      'DELETE FROM benefits.allocation_buckets WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    await database.query(
      'DELETE FROM benefits.client_entitlements WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    await database.query(
      'DELETE FROM benefits.funding_sources WHERE tenant_id = $1 AND client_id = ANY($2::uuid[])',
      [tenantId, clientIds],
    );
    if (organizationIds.length) {
      await database.query(
        'DELETE FROM benefits.provider_recognitions WHERE tenant_id = $1 AND organization_id = ANY($2::uuid[])',
        [tenantId, organizationIds],
      );
    }
    for (const [table, trigger] of [
      ['allocation_buckets', 'benefit_allocation_buckets_immutable'],
      ['ledger_entries', 'benefit_ledger_entries_immutable'],
      ['service_allocations', 'service_allocations_immutable'],
      ['service_allocation_reversals', 'service_allocation_reversals_immutable'],
    ] as const) {
      await database.query(`ALTER TABLE benefits.${table} ENABLE TRIGGER ${trigger}`);
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

function nextVisitTimesInBerlin(): { date: string; start: string; end: string } {
  const timezone = 'Europe/Berlin';
  const today = dateInTimezone(new Date(), timezone);
  let startDate = new Date(Date.now() + 45 * 60_000);
  if (dateInTimezone(startDate, timezone) !== today) {
    startDate = new Date(Date.now() + 5 * 60_000);
  }
  if (dateInTimezone(startDate, timezone) !== today) {
    throw new Error('The browser E2E needs at least one minute left in today’s Berlin schedule');
  }

  const endDate = new Date(startDate.getTime() + 30 * 60_000);
  const end =
    dateInTimezone(endDate, timezone) === today ? timeInTimezone(endDate, timezone) : '23:59';
  return { date: today, start: timeInTimezone(startDate, timezone), end };
}

function timeInTimezone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('hour')}:${part('minute')}`;
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

async function cleanupOrganizationRecords(
  database: Client,
  tenantId: string,
  names: {
    organizationName: string;
    facilityName: string;
    teamName: string;
    personnelNumbers: readonly string[];
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
      'SELECT id FROM employees.employees WHERE tenant_id = $1 AND personnel_number = ANY($2::text[])',
      [tenantId, names.personnelNumbers],
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
  await page.getByRole('button', { name: 'Sign in with Authentik' }).click();
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

async function reauthenticateOffice(
  page: Page,
  username: string,
  password: string,
  tenantId: string,
): Promise<void> {
  await page.context().clearCookies();
  await signInWithAuthentik(page, username, password);
  await page.locator('select[name="tenantId"]').selectOption(tenantId);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/clients$/);
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

async function cleanupAdmissionRecords(
  database: Client,
  tenantId: string,
  caseId: string,
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await database.query(
      'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      `DELETE FROM platform.outbox_messages
       WHERE tenant_id = $1
         AND (event ->> 'aggregateId' = $2 OR event -> 'payload' ->> 'caseId' = $2)`,
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.case_documents WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.case_tasks WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.case_communications WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM communications.prospect_interactions WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.checklist_responses WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.assessments WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query(
      'DELETE FROM onboarding.transitions WHERE tenant_id = $1 AND case_id = $2',
      [tenantId, caseId],
    );
    await database.query('DELETE FROM onboarding.cases WHERE tenant_id = $1 AND id = $2', [
      tenantId,
      caseId,
    ]);
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function cleanupPilotMembership(
  database: Client,
  tenantId: string,
  membershipId: string,
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await database.query(
      'DELETE FROM identity.membership_scopes WHERE tenant_id = $1 AND membership_id = $2',
      [tenantId, membershipId],
    );
    await database.query(
      'DELETE FROM identity.membership_roles WHERE tenant_id = $1 AND membership_id = $2',
      [tenantId, membershipId],
    );
    await database.query(
      'DELETE FROM identity.tenant_memberships WHERE tenant_id = $1 AND id = $2',
      [tenantId, membershipId],
    );
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function cleanupOnboardingTemplates(
  database: Client,
  tenantId: string,
  organizationName: string,
): Promise<void> {
  await database.query('BEGIN');
  try {
    await database.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const organizations = await database.query<{ id: string }>(
      'SELECT id FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [tenantId, organizationName],
    );
    const templateRows = await database.query<{ id: string }>(
      'SELECT id FROM onboarding.checklist_templates WHERE tenant_id = $1 AND organization_id = ANY($2::uuid[])',
      [tenantId, organizations.rows.map((organization) => organization.id)],
    );
    const templateIds = templateRows.rows.map((template) => template.id);
    if (templateIds.length) {
      await database.query(
        'DELETE FROM audit.audit_entries WHERE tenant_id = $1 AND resource_id = ANY($2::uuid[])',
        [tenantId, templateIds],
      );
      await database.query(
        "DELETE FROM platform.outbox_messages WHERE tenant_id = $1 AND event ->> 'aggregateId' = ANY($2::text[])",
        [tenantId, templateIds],
      );
      await database.query(
        'DELETE FROM onboarding.checklist_template_items WHERE tenant_id = $1 AND template_id = ANY($2::uuid[])',
        [tenantId, templateIds],
      );
      await database.query(
        'DELETE FROM onboarding.checklist_templates WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, templateIds],
      );
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK');
    throw error;
  }
}

async function expectMobileLayoutToFit(page: Page): Promise<void> {
  const { documentWidth, visualWidth } = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    visualWidth: window.visualViewport?.width ?? window.innerWidth,
  }));
  expect(documentWidth).toBeLessThanOrEqual(visualWidth);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the Authentik E2E test`);
  return value;
}
