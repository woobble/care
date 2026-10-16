import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

const reviewDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../artifacts/documents-communications-review',
);

test('Office staff can review documents and record linked communications with follow-up', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(20_000);
  await mkdir(reviewDirectory, { recursive: true });
  await page.addInitScript(() => {
    const hideNextDevToolbar = () => {
      const style = document.createElement('style');
      style.textContent = 'nextjs-portal { display: none !important; }';
      document.head?.append(style);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hideNextDevToolbar, { once: true });
    } else {
      hideNextDevToolbar();
    }
  });

  const issuer = required('OIDC_ISSUER');
  const authentikOrigin = new URL(issuer).origin;
  const authentikToken = required('AUTHENTIK_E2E_API_TOKEN');
  const baseUrl = required('WEB_ORIGIN');
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  const runId = uuidv7().replaceAll('-', '').slice(-8).toLowerCase();
  const username = `care-doc-comm-${runId}`;
  const email = `${username}@example.test`;
  const password = `Aa1!${uuidv7()}`;
  const subject = await createAuthentikUser(authentikOrigin, authentikToken, {
    username,
    email,
    name: `Documents E2E ${runId}`,
    password,
  });
  let tenantId: string | undefined;
  let platformUserId: string | undefined;
  let membershipId: string | undefined;

  await database.connect();
  try {
    const fixture = await loadFixture(database);
    await signInWithAuthentik(page, username, password, baseUrl);
    await expect(
      page.getByText('Your account does not have access to an active organization.'),
    ).toBeVisible();
    const platformUser = await waitForPlatformUser(database, issuer, subject.uuid);
    platformUserId = platformUser.id;
    tenantId = fixture.tenantId;
    const role = await database.query<{ id: string }>(
      "SELECT id FROM identity.roles WHERE tenant_id = $1 AND name = 'Administrator'",
      [tenantId],
    );
    const roleId = role.rows[0]?.id;
    if (!roleId) throw new Error('The Demo Care Administrator role is missing; run bun run seed');
    membershipId = uuidv7();
    await database.query('BEGIN');
    try {
      await database.query(
        "INSERT INTO identity.tenant_memberships (id, user_id, tenant_id, status) VALUES ($1, $2, $3, 'active')",
        [membershipId, platformUserId, tenantId],
      );
      await database.query(
        'INSERT INTO identity.membership_roles (membership_id, tenant_id, role_id) VALUES ($1, $2, $3)',
        [membershipId, tenantId, roleId],
      );
      await database.query(
        `INSERT INTO identity.membership_scopes (membership_id, tenant_id, scope_type, scope_id)
         VALUES ($1, $2, 'tenant', $2)`,
        [membershipId, tenantId],
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

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/documents');
    await expect(page.getByRole('heading', { name: 'Document workspace' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await capture(page, 'documents-worklist-desktop-light.png');

    await page.getByLabel('Search title, type, client, or source').fill(fixture.documentClientName);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('q'))
      .toBe(fixture.documentClientName);
    await expect(page.getByRole('table')).toContainText(fixture.documentClientName);
    await expect(page.getByRole('table')).toContainText('Claim summary');

    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await capture(page, 'documents-worklist-desktop-dark.png');
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await page.setViewportSize({ width: 768, height: 1024 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'documents-worklist-tablet-768.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'documents-worklist-mobile-390.png');
    const mobileSummaryDocument = page.getByRole('link', { name: 'Claim summary' }).last();
    await mobileSummaryDocument.scrollIntoViewIfNeeded();
    await expect(mobileSummaryDocument).toBeVisible();
    await capture(page, 'documents-worklist-mobile-results-390.png');
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/documents/create');
    await expect(page.getByRole('heading', { name: 'Create or find a document' })).toBeVisible();
    await capture(page, 'document-create-workflow-desktop.png');
    await page.setViewportSize({ width: 768, height: 1024 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'document-create-workflow-tablet-768.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'document-create-workflow-mobile-390.png');
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('/administration/document-templates?organizationId=' + fixture.organizationId);
    await expect(page.getByRole('heading', { name: 'Document templates' })).toBeVisible();
    await capture(page, 'document-templates-desktop.png');
    await page.setViewportSize({ width: 768, height: 1024 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'document-templates-tablet-768.png');

    await page.goto(`/documents/${fixture.documentId}`);
    await expect(page.getByRole('heading', { name: 'Document details' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Versions from this source' })).toBeVisible();
    await expect(page.locator('iframe[title^="PDF preview"]')).toBeVisible();
    const previewResponse = await page.request.get(
      new URL(`/documents/${fixture.documentId}/preview`, baseUrl).toString(),
    );
    expect(previewResponse.status()).toBe(200);
    expect(previewResponse.headers()['content-type']).toContain('application/pdf');
    const previewPdf = await PDFDocument.load(await previewResponse.body());
    expect(previewPdf.getPageCount()).toBeGreaterThan(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'document-detail-preview-desktop.png');
    await page.locator('#document-preview-title').scrollIntoViewIfNeeded();
    await capture(page, 'document-pdf-preview-desktop.png');
    await page.setViewportSize({ width: 768, height: 1024 });
    await assertNoHorizontalOverflow(page);
    await page.locator('#document-metadata-title').scrollIntoViewIfNeeded();
    await capture(page, 'document-detail-tablet-768.png');
    await page.locator('#document-preview-title').scrollIntoViewIfNeeded();
    await capture(page, 'document-pdf-preview-tablet-768.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await page.locator('#document-metadata-title').scrollIntoViewIfNeeded();
    await capture(page, 'document-detail-preview-mobile-390.png');
    await page.locator('#document-preview-title').scrollIntoViewIfNeeded();
    await capture(page, 'document-pdf-preview-mobile-390.png');

    await page.goto('/documents/ffffffff-ffff-7fff-8fff-ffffffffffff');
    await expect(
      page.getByText('This document is unavailable or you do not have permission to view it.', {
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, 'document-unavailable-error-desktop.png');

    await page.goto(`/clients/${fixture.clientId}/service-agreements`);
    const agreement = page.locator(`#agreement-${fixture.agreementId}`);
    await expect(agreement).toBeVisible();
    await expect(agreement.getByRole('button', { name: 'Generate agreement PDF' })).toBeVisible();
    await capture(page, 'document-generation-agreement-form-desktop.png');
    const downloadResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname.match(/^\/documents\/[0-9a-f-]+\/pdf$/i) !== null,
      { timeout: 60_000 },
    );
    await agreement.getByRole('button', { name: 'Generate agreement PDF' }).click();
    const generatedDownload = await downloadResponse;
    expect(generatedDownload.status()).toBe(200);
    expect(generatedDownload.headers()['content-type']).toContain('application/pdf');
    expect(new URL(generatedDownload.url()).pathname).toMatch(/^\/documents\/[0-9a-f-]+\/pdf$/i);
    const generatedState = await database.query<{
      id: string;
      status: string;
      title: string | null;
      source_reference: string | null;
    }>(
      `SELECT id, status, title, source_reference FROM documents.artifacts
       WHERE tenant_id = $1 AND source_entity_type = 'service_agreement' AND source_entity_id = $2
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [tenantId, fixture.agreementId],
    );
    const generatedDocument = generatedState.rows[0];
    if (!generatedDocument) throw new Error('Agreement PDF generation did not create a document');
    expect(generatedDocument.status).toBe('ready');
    expect(generatedDocument.title).toBe('Service agreement');
    const generatedDocumentId = generatedDocument.id;
    const generatedPreview = await page.request.get(
      new URL(`/documents/${generatedDocumentId}/preview`, baseUrl).toString(),
    );
    expect(generatedPreview.status()).toBe(200);
    const generatedPdf = await PDFDocument.load(await generatedPreview.body());
    expect(generatedPdf.getPageCount()).toBeGreaterThan(0);

    await page.goto(`/documents/${generatedDocumentId}`);
    await expect(page.getByRole('heading', { name: /Service agreement/ })).toBeVisible();
    await expect(page.getByRole('link', { name: fixture.clientName })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Record related communication' })).toBeVisible();
    await capture(page, 'document-detail-generated-agreement-desktop.png');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/communications');
    await expect(page.getByRole('heading', { name: 'Communication history' })).toBeVisible();
    await capture(page, 'communications-worklist-desktop-light.png');
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await capture(page, 'communications-worklist-desktop-dark.png');
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await page.setViewportSize({ width: 768, height: 1024 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'communications-worklist-tablet-768.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'communications-worklist-mobile-390.png');

    await page.goto('/communications/new');
    await expect(page.getByRole('heading', { name: 'Start a communication record' })).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, 'communication-client-selection-desktop.png');

    await page.goto(`/documents/${generatedDocumentId}`);
    await page.getByRole('link', { name: 'Record related communication' }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `/clients/${fixture.clientId}/communications\\?documentId=${generatedDocumentId}#new-interaction`,
      ),
    );
    const createSection = page.locator('#new-interaction');
    await expect(
      createSection.getByRole('heading', { name: 'Record an interaction' }),
    ).toBeVisible();
    await expect(createSection.locator('select[name="source"]')).toHaveValue(
      `document:${generatedDocumentId}`,
    );
    const contactSelector = createSection.getByRole('combobox', { name: 'Client contact' });
    await contactSelector.click();
    const contactSearch = page.getByRole('combobox', { name: 'Search by name' });
    await contactSearch.fill(fixture.contactName);
    const contactOption = page
      .getByRole('dialog')
      .getByRole('option')
      .filter({ hasText: fixture.contactName.split(' ').at(-1)! })
      .first();
    await expect(contactOption).toBeVisible();
    await contactOption.click();

    const subjectLine = `E2E document call ${runId}`;
    const summary = `Discussed the requested document with ${fixture.contactName}.`;
    await createSection.locator('select[name="direction"]').selectOption('outbound');
    await createSection.locator('select[name="channel"]').selectOption('phone');
    await createSection.locator('select[name="category"]').selectOption('documentation');
    await createSection.locator('select[name="outcome"]').selectOption('action_required');
    await createSection.getByLabel('Subject').fill(subjectLine);
    await createSection.getByLabel('Summary').fill(summary);
    await createSection.scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture(page, 'communication-create-desktop.png');
    await page.setViewportSize({ width: 768, height: 1024 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'communication-create-tablet-768.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'communication-create-mobile-390.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Save interaction' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/clients/${fixture.clientId}/communications\\?updated=recorded`),
    );

    const interaction = page
      .locator('li')
      .filter({ has: page.getByRole('heading', { name: subjectLine }) })
      .first();
    await expect(interaction).toContainText(summary);
    await expect(interaction).toContainText(fixture.contactName);
    await expect(interaction.getByRole('link', { name: 'Document' })).toBeVisible();
    await interaction.scrollIntoViewIfNeeded();
    await capture(page, 'client-communication-timeline-desktop.png');
    await page.setViewportSize({ width: 768, height: 1024 });
    await assertNoHorizontalOverflow(page);
    await interaction.scrollIntoViewIfNeeded();
    await capture(page, 'client-communication-timeline-tablet-768.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await capture(page, 'client-communication-timeline-mobile-390.png');

    const taskTitle = `Follow up on document ${runId}`;
    await interaction.getByLabel('Task title').fill(taskTitle);
    await interaction.getByLabel('Due date and time').fill(localTimeFromNow(24 * 60));
    await interaction.getByRole('button', { name: 'Create task' }).click();
    await expect(page).toHaveURL(
      new RegExp(`/clients/${fixture.clientId}/communications\\?updated=followup`),
    );
    const followUpLink = page.getByRole('link', { name: taskTitle });
    await expect(followUpLink).toBeVisible();
    await followUpLink.scrollIntoViewIfNeeded();
    await capture(page, 'client-communication-follow-up-mobile-390.png');
    const taskHref = await followUpLink.getAttribute('href');
    if (!taskHref) throw new Error('The follow-up task has no Operations link');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/communications?q=${encodeURIComponent(subjectLine)}&followUpStatus=open`);
    await expect(page.getByRole('table')).toContainText(subjectLine);
    await expect(page.getByRole('table')).toContainText('Open');
    await capture(page, 'communications-worklist-follow-up-desktop.png');

    await page.goto(taskHref);
    await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible();
    const openSource = page.getByRole('link', { name: 'Open source' });
    await expect(openSource).toHaveAttribute('href', `/clients/${fixture.clientId}/communications`);
    await capture(page, 'communication-follow-up-operations-task-desktop.png');
    await openSource.click();
    await expect(page).toHaveURL(new RegExp(`/clients/${fixture.clientId}/communications`));
    await expect(page.getByRole('heading', { name: subjectLine })).toBeVisible();

    await interaction
      .getByLabel('Reason for correction')
      .fill('Clarified the referenced document.');
    await interaction.getByLabel('Summary').fill(`${summary} Follow-up was assigned.`);
    await interaction.getByRole('button', { name: 'Save correction' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Correction saved with a history snapshot.',
    );
    const recordedInteraction = await database.query<{ id: string }>(
      `SELECT id FROM communications.interactions
       WHERE tenant_id = $1 AND client_id = $2 AND subject = $3
       ORDER BY occurred_at DESC LIMIT 1`,
      [tenantId, fixture.clientId, subjectLine],
    );
    const interactionIdFromDatabase = recordedInteraction.rows[0]?.id;
    if (!interactionIdFromDatabase) throw new Error('The communication was not persisted');
    await page.goto(
      `/clients/${fixture.clientId}/communications?interactionId=${interactionIdFromDatabase}`,
    );
    await expect(page.getByRole('heading', { name: 'Correct this record' })).toBeVisible();
    await expect(page.getByText(/Previous version/)).toBeVisible();
    await page.getByRole('heading', { name: 'Correct this record' }).scrollIntoViewIfNeeded();
    await capture(page, 'communication-amendment-history-desktop.png');

    const unauthorizedContext = await browser.newContext({ baseURL: baseUrl });
    try {
      const unauthorizedPage = await unauthorizedContext.newPage();
      await unauthorizedPage.goto(`/documents/${generatedDocumentId}`);
      await expect(unauthorizedPage.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(unauthorizedPage.getByText(fixture.clientName, { exact: true })).toHaveCount(0);
      await unauthorizedPage.goto(`/clients/${fixture.clientId}/communications`);
      await expect(unauthorizedPage.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(unauthorizedPage.getByText(subjectLine, { exact: true })).toHaveCount(0);
    } finally {
      await unauthorizedContext.close();
    }
  } finally {
    if (membershipId) {
      await database.query('BEGIN');
      try {
        await database.query('DELETE FROM identity.membership_roles WHERE membership_id = $1', [
          membershipId,
        ]);
        await database.query('DELETE FROM identity.membership_scopes WHERE membership_id = $1', [
          membershipId,
        ]);
        await database.query('DELETE FROM identity.tenant_memberships WHERE id = $1', [
          membershipId,
        ]);
        await database.query('COMMIT');
      } catch (error) {
        await database.query('ROLLBACK');
        throw error;
      }
    }
    if (platformUserId) {
      const authenticationUsers = await database.query<{ id: string }>(
        `SELECT auth_user.id FROM authentication.users auth_user
         JOIN authentication.accounts account ON account.user_id = auth_user.id
         WHERE account.provider_id = 'authentik' AND account.account_id = $1`,
        [subject.uuid],
      );
      const authUserIds = authenticationUsers.rows.map((row) => row.id);
      if (authUserIds.length) {
        await database.query(
          'DELETE FROM authentication.sessions WHERE user_id = ANY($1::text[])',
          [authUserIds],
        );
        await database.query(
          'DELETE FROM authentication.accounts WHERE user_id = ANY($1::text[])',
          [authUserIds],
        );
        await database.query('DELETE FROM authentication.users WHERE id = ANY($1::text[])', [
          authUserIds,
        ]);
      }
      await database.query(
        'DELETE FROM identity.external_identities WHERE issuer = $1 AND subject = $2',
        [issuer, subject.uuid],
      );
      // The recorded interaction keeps its immutable author identity for local audit history.
    }
    await database.end();
    await authentikRequest(authentikOrigin, authentikToken, `/api/v3/core/users/${subject.pk}/`, {
      method: 'DELETE',
    }).catch(() => undefined);
  }
  expect(testInfo.status).toBe('passed');
});

async function loadFixture(database: Client): Promise<{
  tenantId: string;
  documentId: string;
  documentClientName: string;
  clientId: string;
  clientName: string;
  agreementId: string;
  organizationId: string;
  contactName: string;
}> {
  const tenant = await database.query<{ id: string }>(
    "SELECT id FROM organizations.tenants WHERE slug = 'demo-care' AND active = true",
  );
  const tenantId = tenant.rows[0]?.id;
  if (!tenantId) throw new Error('Demo Care tenant is missing; run bun run seed');
  const document = await database.query<{ id: string; client_name: string }>(
    `SELECT d.id, c.id AS client_id,
       concat(coalesce(nullif(c.preferred_name, ''), c.first_name), ' ', c.last_name) AS client_name
     FROM documents.artifacts d
     JOIN clients.clients c ON c.tenant_id = d.tenant_id AND c.id = d.client_id
     WHERE d.tenant_id = $1 AND d.document_type = 'claim_summary' AND d.status = 'ready'
     ORDER BY d.created_at DESC LIMIT 1`,
    [tenantId],
  );
  const savedDocument = document.rows[0];
  if (!savedDocument) throw new Error('No ready claim summary is available in the Demo Care seed');
  const agreement = await database.query<{
    id: string;
    organization_id: string;
    client_id: string;
    contact_name: string;
  }>(
    `SELECT agreement.id, agreement.organization_id, agreement.client_id,
       concat(contact.first_name, ' ', contact.last_name) AS contact_name
     FROM service_agreements.agreements agreement
     JOIN clients.client_contacts contact
       ON contact.tenant_id = agreement.tenant_id AND contact.client_id = agreement.client_id
     WHERE agreement.tenant_id = $1 AND agreement.status = 'active'
       AND EXISTS (
         SELECT 1 FROM clients.client_contacts other_contact
         WHERE other_contact.tenant_id = agreement.tenant_id
           AND other_contact.client_id = agreement.client_id
       )
     ORDER BY agreement.created_at DESC, agreement.id
     LIMIT 1`,
    [tenantId],
  );
  const savedAgreement = agreement.rows[0];
  if (!savedAgreement)
    throw new Error('No active agreement with a contact is available in the Demo Care seed');
  const client = await database.query<{ client_name: string }>(
    `SELECT concat(coalesce(nullif(preferred_name, ''), first_name), ' ', last_name) AS client_name
     FROM clients.clients WHERE tenant_id = $1 AND id = $2`,
    [tenantId, savedAgreement.client_id],
  );
  return {
    tenantId,
    documentId: savedDocument.id,
    documentClientName: savedDocument.client_name,
    clientId: savedAgreement.client_id,
    clientName: client.rows[0]?.client_name ?? savedDocument.client_name,
    agreementId: savedAgreement.id,
    organizationId: savedAgreement.organization_id,
    contactName: savedAgreement.contact_name,
  };
}

async function createAuthentikUser(
  origin: string,
  token: string,
  input: { username: string; name: string; email: string; password: string },
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
        attributes: { care_email_verified: true },
      }),
    },
  );
  await authentikRequest(origin, token, `/api/v3/core/users/${user.pk}/set_password/`, {
    method: 'POST',
    body: JSON.stringify({ password: input.password }),
  });
  return user;
}

async function authentikRequest<T = unknown>(
  origin: string,
  token: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(new URL(path, origin), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Authentik API ${path} returned ${response.status}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function signInWithAuthentik(
  page: Page,
  username: string,
  password: string,
  baseUrl: string,
): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with Authentik' }).click();
  const usernameField = page.locator('input[name="uidField"]');
  await expect(usernameField).toBeVisible({ timeout: 45_000 });
  await usernameField.fill(username);
  await page
    .getByRole('button', { name: /continue|log in|sign in/i })
    .last()
    .click();
  const passwordField = page.getByLabel('Password');
  await passwordField.fill(password);
  await Promise.all([
    page.waitForURL((url) => url.origin === new URL(baseUrl).origin, { timeout: 60_000 }),
    page
      .getByRole('button', { name: /continue|log in|sign in/i })
      .last()
      .click(),
  ]);
}

async function waitForPlatformUser(
  database: Client,
  issuer: string,
  subject: string,
): Promise<{ id: string }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await database.query<{ id: string }>(
      `SELECT users.id FROM identity.external_identities
       JOIN identity.users ON users.id = external_identities.user_id
       WHERE external_identities.issuer = $1 AND external_identities.subject = $2`,
      [issuer, subject],
    );
    if (result.rows[0]) return result.rows[0];
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error('Authentik login did not provision the platform identity');
}

async function capture(page: Page, filename: string): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({ path: resolve(reviewDirectory, filename) });
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document, JSON.stringify(widths)).toBeLessThanOrEqual(widths.viewport);
}

function localTimeFromNow(minutes: number): string {
  const date = new Date(Date.now() + minutes * 60_000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for focused Authentik browser tests`);
  return value;
}
