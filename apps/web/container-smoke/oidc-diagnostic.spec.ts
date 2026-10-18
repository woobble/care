import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

import { cleanupOfficeAdminSession, required } from '../e2e/support/office-admin';

test('production web image completes Authentik OIDC login and stores an access token', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
  await database.connect();

  const issuer = required('OIDC_ISSUER');
  const authentikOrigin = new URL(issuer).origin;
  const apiToken = required('AUTHENTIK_E2E_API_TOKEN');
  const runId = uuidv7().replaceAll('-', '').slice(-8).toLowerCase();
  const username = `care-oidc-diagnostic-${runId}`;
  const displayName = `Care OIDC diagnostic ${runId}`;
  const email = `${username}@example.test`;
  const password = `Aa1!${uuidv7()}`;
  let authentikUser: { pk: number; uuid: string } | undefined;

  try {
    const createResponse = await fetch(new URL('/api/v3/core/users/', authentikOrigin), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        name: displayName,
        email,
        is_active: true,
        attributes: { care_email_verified: true },
      }),
    });
    expect(createResponse.ok).toBeTruthy();
    authentikUser = (await createResponse.json()) as { pk: number; uuid: string };

    const passwordResponse = await fetch(
      new URL(`/api/v3/core/users/${authentikUser.pk}/set_password/`, authentikOrigin),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      },
    );
    expect(passwordResponse.ok).toBeTruthy();

    await page.goto(required('WEB_ORIGIN'));
    const providerRegistrationPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/auth/sign-in/social',
      { timeout: 60_000 },
    );
    const failedRequests: Array<{ method: string; path: string; error: string | undefined }> = [];
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      if (url.origin !== new URL(required('WEB_ORIGIN')).origin) return;
      failedRequests.push({
        method: request.method(),
        path: url.pathname,
        error: request.failure()?.errorText,
      });
    });
    await page.getByRole('button', { name: 'Sign in with Authentik' }).click();
    const providerRegistration = await providerRegistrationPromise;
    const providerPayload = (await providerRegistration.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const providerError = providerPayload?.error as Record<string, unknown> | undefined;
    const providerErrorCode =
      typeof providerPayload?.code === 'string'
        ? providerPayload.code
        : typeof providerError?.code === 'string'
          ? providerError.code
          : null;
    console.log(
      `Sanitized OIDC provider registration: ${JSON.stringify({ status: providerRegistration.status(), errorCode: providerErrorCode, failedRequests })}`,
    );
    expect(providerRegistration.status(), 'Authentik provider registration should succeed').toBe(
      200,
    );
    expect(providerErrorCode).toBeNull();
    const navigationDiagnostic = await page.evaluate(() => ({
      origin: location.origin,
      pathname: location.pathname,
      title: document.title,
      signInFailureVisible: Boolean(document.querySelector('[role="alert"]')),
      inputNames: Array.from(document.querySelectorAll('input')).map((input) => input.name),
    }));
    console.log(`Sanitized OIDC navigation diagnostic: ${JSON.stringify(navigationDiagnostic)}`);

    const usernameField = page.locator('input[name="uidField"]');
    try {
      await expect(usernameField).toBeVisible({ timeout: 60_000 });
    } catch (error) {
      const authentikPageDiagnostic = await page.evaluate(() => ({
        origin: location.origin,
        pathname: location.pathname,
        title: document.title,
        bodyText: document.body.innerText
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
          .slice(0, 900),
        inputNames: Array.from(document.querySelectorAll('input')).map((input) => input.name),
        buttonLabels: Array.from(document.querySelectorAll('button')).map((button) =>
          button.innerText.trim(),
        ),
      }));
      console.log(
        `Sanitized Authentik page diagnostic: ${JSON.stringify(authentikPageDiagnostic)}`,
      );
      throw error;
    }
    await usernameField.fill(username);
    await page
      .getByRole('button', { name: /continue|log in|sign in/i })
      .last()
      .click();
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL((url) => url.origin === new URL(required('WEB_ORIGIN')).origin, {
        timeout: 60_000,
      }),
      page
        .getByRole('button', { name: /continue|log in|sign in/i })
        .last()
        .click(),
    ]);

    const diagnostic = await page.evaluate(async () => {
      const sessionResponse = await fetch('/api/auth/get-session', { cache: 'no-store' });
      const sessionPayload = await sessionResponse.json().catch(() => null);
      const accountsResponse = await fetch('/api/auth/list-accounts', { cache: 'no-store' });
      const accountsPayload = await accountsResponse.json().catch(() => null);
      const accounts = Array.isArray(accountsPayload) ? accountsPayload : [];
      const providerIds = accounts.map((account) =>
        typeof account?.providerId === 'string' ? account.providerId : '<missing>',
      );
      const authentikAccount = accounts.find((account) => account?.providerId === 'authentik');
      let tokenStatus: number | null = null;
      let tokenPresent: boolean | null = null;
      let tokenErrorCode: string | null = null;

      if (authentikAccount && typeof authentikAccount.id === 'string') {
        const tokenResponse = await fetch('/api/auth/get-access-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: authentikAccount.id }),
          cache: 'no-store',
        });
        const tokenPayload = await tokenResponse.json().catch(() => null);
        tokenStatus = tokenResponse.status;
        tokenPresent =
          typeof tokenPayload?.accessToken === 'string' && tokenPayload.accessToken.length > 0;
        tokenErrorCode =
          typeof tokenPayload?.code === 'string'
            ? tokenPayload.code
            : typeof tokenPayload?.error?.code === 'string'
              ? tokenPayload.error.code
              : null;
      }

      return {
        location: location.pathname,
        sessionStatus: sessionResponse.status,
        sessionPresent: Boolean(sessionPayload?.session),
        accountsStatus: accountsResponse.status,
        accountCount: accounts.length,
        providerIds,
        tokenStatus,
        tokenPresent,
        tokenErrorCode,
      };
    });

    console.log(`Sanitized OIDC diagnostic: ${JSON.stringify(diagnostic)}`);
    expect(diagnostic.sessionPresent).toBeTruthy();
    expect(diagnostic.providerIds).toContain('authentik');
    expect(diagnostic.tokenPresent).toBeTruthy();
    const pageState = await page.evaluate(() => ({
      location: location.pathname,
      bodyText: document.body.innerText.slice(0, 800),
      alertCount: document.querySelectorAll('[role="alert"]').length,
    }));
    console.log(`Sanitized authenticated page state: ${JSON.stringify(pageState)}`);
    await expect(
      page.getByText('Your account does not have access to an active organization.'),
    ).toBeVisible();
  } finally {
    if (authentikUser) {
      await cleanupOfficeAdminSession(database, {
        apiToken,
        authentikOrigin,
        authentikUserId: authentikUser.pk,
        issuer,
        subject: authentikUser.uuid,
      });
    }
    await database.end();
  }
});
