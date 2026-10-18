import { createHash } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { Client } from 'pg';

import { createOfficeAdminSession } from '../e2e/support/office-admin';
import { dateInBerlin } from '../e2e/support/browser';
import { seedLifecycleScenario } from '../e2e/support/lifecycle-scenario';

test('production images generate and authorize a private invoice PDF through SeaweedFS', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(20_000);
  const database = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await database.connect();
  let billingStarted = false;
  try {
    const office = await createOfficeAdminSession(database, page, 'production-image-pdf');
    const scenario = await seedLifecycleScenario(database, office, { visit: 'completed' });
    if (!scenario.performedServiceId)
      throw new Error('Synthetic completed-service fixture is missing');
    const serviceDate = dateInBerlin();
    const filters = new URLSearchParams({
      from: serviceDate,
      until: serviceDate,
      organizationId: scenario.organizationId,
      facilityId: scenario.facilityId,
      clientId: scenario.clientId,
      ready: 'true',
    });
    await page.goto(`/billing?${filters}`);
    await expect(page.getByRole('heading', { name: 'Billable service worklist' })).toBeVisible();
    const group = page
      .locator('#worklist section')
      .filter({ has: page.locator('header p').filter({ hasText: 'Client invoice' }) });
    const candidate = group.locator('li').filter({ hasText: scenario.serviceName });
    await expect(candidate.getByRole('checkbox', { name: 'Include this service' })).toBeEnabled();
    await candidate.getByRole('checkbox', { name: 'Include this service' }).check();
    billingStarted = true;
    await submitProductionAction(page, group.getByRole('button', { name: 'Create draft invoice' }));
    await expect(page).toHaveURL(/\/billing\/invoices\/[0-9a-f-]{36}\?updated=draft$/i);
    const invoiceId = new URL(page.url()).pathname.split('/').at(-1);
    if (!invoiceId) throw new Error('Draft invoice route did not provide an invoice ID');
    await submitProductionAction(page, page.getByRole('button', { name: 'Issue invoice' }));
    await expect(page).toHaveURL(new RegExp(`/billing/invoices/${invoiceId}\\?updated=issued$`));
    await expect(page.getByRole('status')).toHaveText('Invoice issued.');

    const response = await page.evaluate(async (path) => {
      const result = await fetch(path, { cache: 'no-store' });
      const data = new Uint8Array(await result.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < data.length; offset += 32_768) {
        binary += String.fromCharCode(...data.subarray(offset, offset + 32_768));
      }
      return {
        status: result.status,
        headers: Object.fromEntries(result.headers),
        body: btoa(binary),
      };
    }, `/billing/invoices/${invoiceId}/pdf`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['cache-control']).toContain('no-store');
    const bytes = Buffer.from(response.body, 'base64');
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    const stored = await database.query<{ sha256: string; invoice_number: string }>(
      `SELECT documents.sha256, invoices.invoice_number
       FROM billing.invoice_documents AS documents
       JOIN billing.invoices AS invoices ON invoices.tenant_id = documents.tenant_id AND invoices.id = documents.invoice_id
       WHERE documents.tenant_id = $1 AND documents.invoice_id = $2
         AND documents.correction_id IS NULL AND documents.status = 'ready'
       ORDER BY documents.document_version DESC LIMIT 1`,
      [scenario.tenantId, invoiceId],
    );
    expect(stored.rows[0]?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(stored.rows[0]?.invoice_number).toBeTruthy();

    const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const anonymousPage = await anonymous.newPage();
      await anonymousPage.goto(process.env.WEB_ORIGIN!);
      const anonymousResponse = await anonymousPage.evaluate(async (path) => {
        const result = await fetch(path, { cache: 'no-store' });
        const anonymousBytes = new Uint8Array(await result.arrayBuffer());
        return {
          status: result.status,
          url: new URL(result.url).pathname,
          prefix: String.fromCharCode(...anonymousBytes.subarray(0, 5)),
        };
      }, `/billing/invoices/${invoiceId}/pdf`);
      expect(anonymousResponse.url).toBe('/');
      expect(anonymousResponse.prefix).not.toBe('%PDF-');
    } finally {
      await anonymous.close();
    }
    console.log(
      'Production-image invoice PDF: authorized download, PDF parse, stored SHA-256, invoice identity, and anonymous non-disclosure passed.',
    );
  } finally {
    await database.end();
    if (billingStarted)
      console.log(
        'Synthetic billing artifacts are isolated to the disposable Compose project volume.',
      );
  }
});

async function submitProductionAction(page: Page, button: Locator): Promise<void> {
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === 'POST' && 'next-action' in request.headers();
  });
  await button.click();
  expect((await responsePromise).ok()).toBeTruthy();
}
