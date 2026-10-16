import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import { dateInBerlin, submitServerAction } from './support/browser';
import {
  cleanupOfficeAdminSession,
  createOfficeAdminSession,
  required,
} from './support/office-admin';
import { cleanupLifecycleScenario, seedLifecycleScenario } from './support/lifecycle-scenario';

test('Office staff can allocate completed services, issue invoices, and record payment', async ({
  page,
}) => {
  test.setTimeout(360_000);
  page.setDefaultTimeout(15_000);
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();
  let office: Awaited<ReturnType<typeof createOfficeAdminSession>> | undefined;
  let billingRecordsMayExist = false;
  let scenario: Awaited<ReturnType<typeof seedLifecycleScenario>> | undefined;
  try {
    office = await createOfficeAdminSession(database, page, 'benefits-billing');
    scenario = await seedLifecycleScenario(database, office, { visit: 'completed' });
    const serviceDate = dateInBerlin();

    await page.goto('/benefits');
    const completedService = page
      .getByRole('heading', { name: `${scenario.serviceName} · ${scenario.clientName}` })
      .first()
      .locator('xpath=ancestor::li[1]');
    await expect(completedService).toBeVisible();
    const allocationForm = completedService.locator('form');
    const fundingOption = await allocationForm
      .locator('select[name="allocation-0-selection"] option')
      .filter({ hasText: `E2E self pay ${scenario.runId}` })
      .getAttribute('value');
    if (!fundingOption) throw new Error('The completed service has no self-pay allocation option');
    await allocationForm
      .locator('select[name="allocation-0-selection"]')
      .selectOption(fundingOption);
    await allocationForm.locator('input[name="allocation-0-amount"]').fill('45');
    await allocationForm.locator('select[name="allocation-0-status"]').selectOption('confirmed');
    await submitServerAction(
      page,
      allocationForm.getByRole('button', { name: 'Allocate funding' }),
    );
    await expect(
      page.getByRole('status').filter({ hasText: 'Service funding was allocated.' }),
    ).toBeVisible();

    const billingFilters = new URLSearchParams({
      from: serviceDate,
      until: serviceDate,
      organizationId: scenario.organizationId,
      facilityId: scenario.facilityId,
      clientId: scenario.clientId,
      ready: 'true',
    });
    await page.goto(`/billing?${billingFilters.toString()}`);
    await expect(page.getByRole('heading', { name: 'Billable service worklist' })).toBeVisible();
    const clientInvoiceGroup = page.locator('#worklist section').filter({
      has: page.locator('header p').filter({ hasText: 'Client invoice' }),
    });
    const candidate = clientInvoiceGroup.locator('li').filter({ hasText: scenario.serviceName });
    const includeCandidate = candidate.getByRole('checkbox', { name: 'Include this service' });
    await expect(includeCandidate).toBeEnabled();
    await includeCandidate.check();
    billingRecordsMayExist = true;
    await clientInvoiceGroup.getByRole('button', { name: 'Create draft invoice' }).click();
    await expect(page).toHaveURL(/\/billing\/invoices\/[0-9a-f-]{36}\?updated=draft$/i);
    const invoiceId = new URL(page.url()).pathname.split('/').at(-1);
    if (!invoiceId) throw new Error('The billing worklist did not open the invoice draft');
    await expect(page.getByRole('heading', { name: 'Invoice lines' })).toBeVisible();
    await expect(page.getByText(scenario.serviceName, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await expect(page).toHaveURL(new RegExp(`/billing/invoices/${invoiceId}\\?updated=issued$`));
    await expect(page.getByRole('status')).toHaveText('Invoice issued.');

    await page.goto(`/billing/payments?invoiceId=${invoiceId}`);
    const paymentForm = page.locator('section[aria-labelledby="record-payment-title"] form');
    await expect(paymentForm.locator('input[name="invoiceId"]')).toHaveValue(invoiceId);
    await paymentForm.locator('input[name="payerName"]').fill(`E2E payer ${scenario.runId}`);
    await paymentForm.locator('input[name="payerReference"]').fill(`E2E-${scenario.runId}`);
    const paymentReference = `E2E payment ${scenario.runId}`;
    await paymentForm.locator('input[name="reference"]').fill(paymentReference);
    await paymentForm.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Payment recorded.' })).toBeVisible();
    const paymentRow = page.locator('li').filter({ hasText: paymentReference });
    await expect(paymentRow.getByRole('combobox', { name: 'Allocate to invoice' })).toContainText(
      scenario.clientName,
    );
    await paymentRow.getByRole('button', { name: 'Allocate payment' }).click();
    await expect(page).toHaveURL(/updated=allocation$/);
    await page.goto(`/billing/invoices/${invoiceId}`);
    await expect(page.locator('section[aria-labelledby="invoice-summary-title"]')).toContainText(
      'Paid',
    );

    const billingState = await database.query<{ status: string; grand_total_cents: number }>(
      'SELECT status, grand_total_cents FROM billing.invoices WHERE tenant_id = $1 AND id = $2',
      [scenario.tenantId, invoiceId],
    );
    expect(billingState.rows[0]).toMatchObject({ status: 'issued', grand_total_cents: 4500 });
  } finally {
    try {
      // Invoice and payment records retain their actor IDs for the lifetime of the disposable
      // Compose database, matching the billing history created by the original full journey.
      if (!billingRecordsMayExist && scenario) await cleanupLifecycleScenario(database, scenario);
      if (!billingRecordsMayExist && office) await cleanupOfficeAdminSession(database, office);
    } finally {
      await database.end();
    }
  }
});
