import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import { createOfficeAdminSession, required } from './support/office-admin';

test('Office settings persist changes and report recoverable save errors', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();

  try {
    const office = await createOfficeAdminSession(database, page, 'settings');
    const organizationName = `E2E Settings ${office.runId}`;
    await page.goto('/administration/organizations');
    await page.getByLabel('Name', { exact: true }).fill(organizationName);
    await page.getByLabel('Legal name').fill(`E2E Betreuungsdienst ${office.runId}`);
    await page.getByLabel('Address').fill('E2E Provider Street 1, 10115 Berlin');
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByRole('heading', { name: organizationName })).toBeVisible({
      timeout: 30_000,
    });
    const organizationResult = await database.query<{ id: string }>(
      'SELECT id FROM organizations.organizations WHERE tenant_id = $1 AND name = $2',
      [office.tenantId, organizationName],
    );
    const organizationId = organizationResult.rows[0]?.id;
    if (!organizationId)
      throw new Error('The Office UI did not create the settings test organization');

    await page.goto('/billing/settings');
    let billingSection = page.getByRole('region', { name: organizationName });
    await billingSection.locator('input[name="bankAccountHolder"]').fill(organizationName);
    await billingSection.locator('input[name="iban"]').fill('DE89370400440532013000');
    await billingSection.locator('select[name="taxTreatment"]').selectOption('small_business');
    await billingSection.locator('input[name="taxExemptionBasis"]').fill('Synthetic E2E setting');
    await billingSection.locator('select[name="requiredInvoiceFormat"]').selectOption('pdf');
    await billingSection.getByRole('button', { name: 'Save billing profile' }).click();
    await expect(page).toHaveURL(/updated=saved/);
    await expect(
      page.getByRole('status').filter({ hasText: 'Billing profile saved.' }),
    ).toBeVisible();
    await page.reload();
    billingSection = page.getByRole('region', { name: organizationName });
    await expect(billingSection.locator('input[name="bankAccountHolder"]')).toHaveValue(
      organizationName,
    );
    await expect(billingSection.locator('input[name="taxExemptionBasis"]')).toHaveValue(
      'Synthetic E2E setting',
    );
    await billingSection
      .locator('input[name="bankAccountHolder"]')
      .fill('Unpersisted concurrent billing edit');
    const billingVersion = billingSection.locator('input[name="expectedVersion"]');
    await billingVersion.evaluate((input) => {
      (input as HTMLInputElement).value = '0';
    });
    await expect(billingVersion).toHaveValue('0');
    await billingSection.getByRole('button', { name: 'Save billing profile' }).click();
    await expect(billingSection.getByRole('alert')).toContainText(
      'Billing settings changed in another session.',
    );
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(billingSection.locator('input[name="bankAccountHolder"]')).toHaveValue(
      'Unpersisted concurrent billing edit',
    );
    await page.reload();
    billingSection = page.getByRole('region', { name: organizationName });
    await expect(billingSection.locator('input[name="bankAccountHolder"]')).toHaveValue(
      organizationName,
    );
    await expect(page.getByRole('status')).toHaveCount(0);

    await page.goto(`/billing/claims/settings?organizationId=${organizationId}`);
    const payerSection = page.getByRole('region', { name: organizationName });
    const payerCreationForm = payerSection.locator('form').filter({
      has: page.getByRole('button', { name: 'Create payer' }),
    });
    const payerName = `E2E Payer ${office.runId}`;
    await payerCreationForm.locator('input[name="name"]').fill(payerName);
    await payerCreationForm.locator('input[name="payerIdentifier"]').fill(`E2E-${office.runId}`);
    await payerCreationForm.getByRole('button', { name: 'Create payer' }).click();
    await expect(page).toHaveURL(/updated=payer-saved/);
    await expect(
      page.getByRole('status').filter({ hasText: 'Payer directory entry saved.' }),
    ).toBeVisible();
    await page.reload();
    const payerArticle = page.locator('article').filter({ hasText: payerName });
    const payerRequirementsForm = payerArticle.locator('form').filter({
      has: page.getByRole('button', { name: 'Save new requirements version' }),
    });
    await payerRequirementsForm.locator('select[name="channel"]').selectOption('manual_email');
    await payerRequirementsForm
      .locator('select[name="fundingSourceType"]')
      .selectOption('statutory_long_term_care_insurance');
    await payerRequirementsForm
      .locator('input[name="sourceName"]')
      .fill('Synthetic E2E payer rules');
    await payerRequirementsForm.locator('input[name="sourceVersion"]').fill('1');
    await payerRequirementsForm
      .getByRole('button', { name: 'Save new requirements version' })
      .click();
    await expect(page).toHaveURL(/updated=profile-saved/);
    await expect(
      page.getByRole('status').filter({ hasText: 'Payer requirements version saved.' }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Synthetic E2E payer rules/)).toBeVisible();
    await payerRequirementsForm.evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });
    await payerRequirementsForm
      .locator('input[name="sourceName"]')
      .fill('Synthetic E2E invalid attempt');
    await payerRequirementsForm.locator('input[name="sourceVersion"]').fill('2');
    await payerRequirementsForm.locator('input[name="sourceUrl"]').fill('http://example.com');
    await payerRequirementsForm
      .getByRole('button', { name: 'Save new requirements version' })
      .click();
    await expect(payerRequirementsForm.getByRole('alert')).toContainText(
      'Enter a valid payer requirements source and effective period.',
    );
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(payerRequirementsForm.locator('input[name="sourceName"]')).toHaveValue(
      'Synthetic E2E invalid attempt',
    );
    await expect(payerRequirementsForm.locator('input[name="sourceUrl"]')).toHaveValue(
      'http://example.com',
    );
    await page.reload();
    await expect(page.getByText(/Synthetic E2E payer rules/)).toBeVisible();
    await expect(
      page.locator('article').filter({ hasText: payerName }).locator('input[name="sourceUrl"]'),
    ).toHaveValue('');

    await page.goto(
      `/administration/document-templates?organizationId=${organizationId}&type=invoice`,
    );
    const templateForm = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Save new template version' }),
    });
    const savedTemplateHeader = `Synthetic template ${office.runId}`;
    await templateForm.locator('input[name="headerText"]').fill(savedTemplateHeader);
    await templateForm.locator('input[name="contactWebsite"]').fill('https://example.test');
    await templateForm.locator('select[name="defaultLocale"]').selectOption('en');
    await templateForm.getByRole('button', { name: 'Save new template version' }).click();
    await expect(page).toHaveURL(/notice=saved/);
    await expect(page.getByRole('status')).toContainText('Template version saved.');
    await page.reload();
    await expect(page.locator('input[name="headerText"]')).toHaveValue(savedTemplateHeader);
    await expect(page.locator('input[name="contactWebsite"]')).toHaveValue('https://example.test');
    await page.locator('input[name="headerText"]').fill('Unpersisted concurrent template edit');
    const templateVersion = page.locator('input[name="expectedVersion"]');
    await templateVersion.evaluate((input) => {
      (input as HTMLInputElement).value = '0';
    });
    await expect(templateVersion).toHaveValue('0');
    await page.getByRole('button', { name: 'Save new template version' }).click();
    await expect(templateForm.getByRole('alert')).toContainText(
      'The template changed. Reload it and try again.',
    );
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.locator('input[name="headerText"]')).toHaveValue(
      'Unpersisted concurrent template edit',
    );
    await page.reload();
    await expect(page.locator('input[name="headerText"]')).toHaveValue(savedTemplateHeader);
    await expect(page.getByRole('status')).toHaveCount(0);

    await page.goto(`/operations/reminder-settings?organizationId=${organizationId}`);
    const agreementReminderForm = page.locator('form').filter({
      has: page.locator('input[name="category"][value="agreements"]'),
    });
    await agreementReminderForm.locator('input[name="offsetsDays"]').fill('45, 10, 0');
    await agreementReminderForm.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(/updated=saved/);
    await expect(page.getByRole('status')).toContainText('Reminder settings saved.');
    await page.reload();
    const savedReminderForm = page.locator('form').filter({
      has: page.locator('input[name="category"][value="agreements"]'),
    });
    await expect(savedReminderForm.locator('input[name="offsetsDays"]')).toHaveValue('45, 10, 0');
    await savedReminderForm.locator('input[name="offsetsDays"]').fill('46, 12, 0');
    const reminderVersion = savedReminderForm.locator('input[name="expectedVersion"]');
    await reminderVersion.evaluate((input) => {
      (input as HTMLInputElement).value = '0';
    });
    await expect(reminderVersion).toHaveValue('0');
    await savedReminderForm.getByRole('button', { name: 'Save changes' }).click();
    await expect(savedReminderForm.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(savedReminderForm.locator('input[name="offsetsDays"]')).toHaveValue('46, 12, 0');
    await page.reload();
    await expect(
      page
        .locator('form')
        .filter({ has: page.locator('input[name="category"][value="agreements"]') })
        .locator('input[name="offsetsDays"]'),
    ).toHaveValue('45, 10, 0');
    await expect(page.getByRole('status')).toHaveCount(0);
  } finally {
    await database.end();
  }
});
