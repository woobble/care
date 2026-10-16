import { createClient } from './generated/client/index';
import type { Client, RequestOptions } from './generated/client/index';
import type { routeOperations } from './generated/routes.gen';
import * as generatedSdk from './generated/sdk.gen';

type ApiMethod = keyof Pick<Client, 'get' | 'post' | 'put' | 'patch' | 'delete'>;
type ApiRoutePath<Method extends ApiMethod> = {
  [Path in keyof typeof routeOperations]: Method extends keyof (typeof routeOperations)[Path]
    ? Path
    : never;
}[keyof typeof routeOperations] &
  string;
type ApiOperationName<Method extends ApiMethod, Path extends ApiRoutePath<Method>> = Extract<
  (typeof routeOperations)[Path][Method & keyof (typeof routeOperations)[Path]],
  keyof typeof generatedSdk
>;
type ApiOperationResult<
  Operation extends (...args: never[]) => unknown,
  ThrowOnError extends boolean,
> = Promise<
  ThrowOnError extends true
    ? Exclude<Awaited<ReturnType<Operation>>, { error: unknown }>
    : Extract<Awaited<ReturnType<Operation>>, { error: unknown }>
>;
type ApiRouteResult<
  Method extends ApiMethod,
  Path extends ApiRoutePath<Method>,
  ThrowOnError extends boolean,
> = ApiOperationResult<(typeof generatedSdk)[ApiOperationName<Method, Path>], ThrowOnError>;

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
type LegacyRequestOptions = Omit<RequestOptions, 'url' | 'path' | 'query'> & {
  params?: LegacyParams;
};

export function createCareApi(options: ApiClientOptions) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
  };
  if (options.tenantId) headers['X-Tenant-Id'] = options.tenantId;
  if (options.requestId) headers['X-Request-Id'] = options.requestId;
  if (options.correlationId) headers['X-Correlation-Id'] = options.correlationId;
  const client = createClient({
    baseUrl: options.baseUrl,
    headers,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(new Request(input, { ...init, cache: 'no-store' }))) as typeof fetch,
  });
  const sdk = Object.fromEntries(
    Object.entries(generatedSdk).map(([name, operation]) => [
      name,
      (operationOptions: Record<string, unknown> = {}) =>
        (operation as (options: Record<string, unknown>) => unknown)({
          ...operationOptions,
          client,
        }),
    ]),
  ) as unknown as {
    [K in keyof typeof generatedSdk]: (
      ...args: Parameters<(typeof generatedSdk)[K]>
    ) => ReturnType<(typeof generatedSdk)[K]>;
  };

  // Keep existing path/method call sites working while routing requests through
  // Hey API's generated client. `sdk` exposes operations bound to this client.
  const request =
    <Method extends ApiMethod>(method: Method) =>
    <Path extends ApiRoutePath<Method>, ThrowOnError extends boolean = false>(
      url: Path,
      init: Omit<LegacyRequestOptions, 'url' | 'throwOnError'> & {
        throwOnError?: ThrowOnError;
      } = {},
    ): ApiRouteResult<Method, Path, ThrowOnError> => {
      const { params, ...rest } = init;
      return client[method]({
        url,
        ...rest,
        path: params?.path,
        query: params?.query,
        headers: { ...params?.header, ...rest.headers },
      } as never) as ApiRouteResult<Method, Path, ThrowOnError>;
    };

  return {
    client,
    sdk,
    GET: request('get'),
    POST: request('post'),
    PUT: request('put'),
    PATCH: request('patch'),
    DELETE: request('delete'),
  };
}

export type CareApi = ReturnType<typeof createCareApi>;
export * from './generated';
export type { components } from './generated/components.gen';
