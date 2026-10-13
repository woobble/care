import { createClient } from "./generated/client/index";
import type { Client, RequestOptions } from "./generated/client/index";
import * as generatedSdk from "./generated/sdk.gen";

export interface ApiClientOptions {
  baseUrl: string;
  accessToken: string;
  tenantId?: string;
  requestId?: string;
  correlationId?: string;
}

type LegacyParams = {
  header?: Record<string, unknown>;
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
};
type LegacyRequestOptions = Omit<RequestOptions, "url" | "path" | "query"> & {
  params?: LegacyParams;
};

export function createCareApi(options: ApiClientOptions) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
  };
  if (options.tenantId) headers["X-Tenant-Id"] = options.tenantId;
  if (options.requestId) headers["X-Request-Id"] = options.requestId;
  if (options.correlationId) headers["X-Correlation-Id"] = options.correlationId;
  const client = createClient({
    baseUrl: options.baseUrl,
    headers,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(new Request(input, { ...init, cache: "no-store" })),
  });
  const sdk = Object.fromEntries(
    Object.entries(generatedSdk).map(([name, operation]) => [
      name,
      (options: Record<string, unknown> = {}) =>
        (operation as (options: Record<string, unknown>) => unknown)({ ...options, client }),
    ]),
  ) as {
    [K in keyof typeof generatedSdk]: (
      ...args: Parameters<(typeof generatedSdk)[K]>
    ) => ReturnType<(typeof generatedSdk)[K]>;
  };

  // Keep existing path/method call sites working while routing requests through
  // Hey API's generated client. `sdk` exposes operations bound to this client.
  const request =
    (method: keyof Pick<Client, "get" | "post" | "put" | "patch" | "delete">) =>
    (url: string, init: Omit<LegacyRequestOptions, "url"> = {}) => {
      const { params, ...rest } = init;
      return client[method]({
        url,
        ...rest,
        path: params?.path,
        query: params?.query,
        headers: { ...params?.header, ...rest.headers },
      } as never);
    };

  return {
    client,
    sdk,
    GET: request("get"),
    POST: request("post"),
    PUT: request("put"),
    PATCH: request("patch"),
    DELETE: request("delete"),
  };
}

export type CareApi = ReturnType<typeof createCareApi>;
export * from "./generated";
export type { components } from "./generated/components.gen";
