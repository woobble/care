import createClient from 'openapi-fetch';
import type { paths } from './generated/schema';

export interface ApiClientOptions {
  baseUrl: string;
  accessToken: string;
  tenantId?: string;
  requestId?: string;
  correlationId?: string;
}

export function createCareApi(options: ApiClientOptions) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
  };
  if (options.tenantId) headers['X-Tenant-Id'] = options.tenantId;
  if (options.requestId) headers['X-Request-Id'] = options.requestId;
  if (options.correlationId) headers['X-Correlation-Id'] = options.correlationId;
  return createClient<paths>({ baseUrl: options.baseUrl, headers });
}

export type CareApi = ReturnType<typeof createCareApi>;
export type { components, paths } from './generated/schema';
