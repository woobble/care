import { chromium } from '@playwright/test';
import { Client } from 'pg';
import { v7 as uuidv7 } from 'uuid';

import { auth } from '../src/auth';
import { cleanupOfficeAdminSession, createOfficeAdminSession } from './support/office-admin';

const apiOrigin = required('API_INTERNAL_URL');
const webOrigin = required('WEB_ORIGIN');
const database = new Client({ connectionString: required('MIGRATION_DATABASE_URL') });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: webOrigin });
const page = await context.newPage();
const concurrency = 4;
const sampleCount = 40;
let office: Awaited<ReturnType<typeof createOfficeAdminSession>> | undefined;
let token: string | undefined;
let tenantId: string | undefined;

function percentile(samples: number[], fraction: number): number {
  return samples[Math.max(0, Math.ceil(fraction * samples.length) - 1)] ?? 0;
}

async function request(path: string, method = 'GET', body?: unknown): Promise<Response> {
  if (!token || !tenantId) throw new Error('Synthetic API session is missing');
  return fetch(new URL(path, apiOrigin), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-Id': tenantId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function measureRead(path: string): Promise<Record<string, unknown>> {
  const warmups = await Promise.all(Array.from({ length: 5 }, () => request(path)));
  const failedWarmup = warmups.find((response) => !response.ok);
  if (failedWarmup) throw new Error(`Warm-up for ${path} returned HTTP ${failedWarmup.status}`);
  const latencies: number[] = [];
  const statuses: Record<string, number> = {};
  const startedAt = performance.now();
  for (let offset = 0; offset < sampleCount; offset += concurrency) {
    const batch = Array.from({ length: Math.min(concurrency, sampleCount - offset) }, async () => {
      const start = performance.now();
      const response = await request(path);
      if (!response.ok)
        throw new Error(`Measured request for ${path} returned HTTP ${response.status}`);
      await response.arrayBuffer();
      latencies.push(performance.now() - start);
      statuses[String(response.status)] = (statuses[String(response.status)] ?? 0) + 1;
    });
    // Wait between batches to keep measured concurrency fixed at four.
    // oxlint-disable-next-line no-await-in-loop
    await Promise.all(batch);
  }
  const elapsedMs = performance.now() - startedAt;
  latencies.sort((left, right) => left - right);
  return {
    path,
    samples: sampleCount,
    concurrency,
    elapsedMs: Math.round(elapsedMs),
    requestsPerSecond: Math.round((sampleCount / elapsedMs) * 1000 * 100) / 100,
    p50Ms: Math.round(percentile(latencies, 0.5) * 100) / 100,
    p95Ms: Math.round(percentile(latencies, 0.95) * 100) / 100,
    p99Ms: Math.round(percentile(latencies, 0.99) * 100) / 100,
    statusCounts: statuses,
  };
}

try {
  await database.connect();
  office = await createOfficeAdminSession(database, page, 'api-load');
  tenantId = office.tenantId;
  const cookies = await context.cookies(webOrigin);
  const headers = new Headers({
    cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
  });
  const session = await auth.api.getSession({ headers });
  const account = (await auth.api.listUserAccounts({ headers })).find(
    (candidate) => candidate.providerId === 'authentik',
  );
  if (!session || !account) throw new Error('Authenticated Better Auth account missing');
  token = (await auth.api.getAccessToken({ headers, body: { accountId: account.id } })).accessToken;

  const now = Date.now();
  const dayRange = `/api/v1/visits?from=${encodeURIComponent(new Date(now).toISOString())}&until=${encodeURIComponent(new Date(now + 24 * 60 * 60 * 1000).toISOString())}`;
  const weekRange = `/api/v1/visits?from=${encodeURIComponent(new Date(now).toISOString())}&until=${encodeURIComponent(new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString())}`;
  const routes = [
    '/api/v1/clients?page=1&pageSize=20&q=Care',
    '/api/v1/employees?page=1&pageSize=20&q=Care',
    dayRange,
    weekRange,
    '/api/v1/benefits/worklist?page=1&pageSize=20',
    '/api/v1/billing/invoices?page=1&pageSize=20',
    '/api/v1/billing/receivables?page=1&pageSize=20',
    '/api/v1/billing/claims?page=1&pageSize=20&q=Care',
    '/api/v1/operations/work-queue?page=1&pageSize=20',
    '/api/v1/admin/members?page=1&pageSize=20&q=care',
  ];
  const readResults: Record<string, unknown>[] = [];
  for (const path of routes) {
    // Measure one endpoint at a time to keep route-level results isolated.
    // oxlint-disable-next-line no-await-in-loop
    readResults.push(await measureRead(path));
  }

  const clientsResponse = await request('/api/v1/clients?page=1&pageSize=20&status=active');
  if (!clientsResponse.ok) throw new Error(`Client search returned ${clientsResponse.status}`);
  const clients = (await clientsResponse.json()) as {
    items: Array<{ id: string; preferredName: string | null }>;
  };
  const actionClients = clients.items.slice(0, 3);
  if (actionClients.length < 2) throw new Error('Expected two active synthetic Office clients');

  const batchId = uuidv7().slice(-8);
  const actionStartedAt = performance.now();
  const actionResults = await Promise.all(
    actionClients.map(async (client, index) => {
      const startedAt = performance.now();
      const response = await request(`/api/v1/clients/${client.id}`, 'PATCH', {
        preferredName: `synthetic-load-${batchId}-${index}`,
      });
      await response.arrayBuffer();
      return {
        status: response.status,
        elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      };
    }),
  );
  const actionBatchMs = Math.round((performance.now() - actionStartedAt) * 100) / 100;
  const restoreResults = await Promise.all(
    actionClients.map((client) =>
      request(`/api/v1/clients/${client.id}`, 'PATCH', {
        preferredName: client.preferredName,
      }).then(async (response) => {
        await response.arrayBuffer();
        return response.status;
      }),
    ),
  );
  if (actionResults.some((result) => result.status !== 200)) {
    throw new Error('At least one concurrent Office action failed');
  }
  if (restoreResults.some((status) => status !== 200)) {
    throw new Error('At least one synthetic Office action could not be restored');
  }

  console.log(
    JSON.stringify({
      environment: {
        apiOrigin,
        node: process.version,
        requestCountPerRoute: sampleCount,
        warmupRequestsPerRoute: 5,
        concurrency,
        sampleCountSupportsTailPercentiles: sampleCount >= 40,
      },
      authenticated: true,
      readWorkload: readResults,
      concurrentOfficeAction: {
        operation: 'PATCH distinct synthetic clients; restore original values',
        concurrency: actionResults.length,
        totalElapsedMs: actionBatchMs,
        requests: actionResults,
        cleanupStatusCounts: restoreResults.reduce<Record<string, number>>((counts, response) => {
          counts[String(response)] = (counts[String(response)] ?? 0) + 1;
          return counts;
        }, {}),
      },
    }),
  );
} finally {
  if (office) await cleanupOfficeAdminSession(database, office);
  await context.close();
  await browser.close();
  await database.end();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
