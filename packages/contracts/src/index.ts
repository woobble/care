export type UUID = string & { readonly __brand: 'UUID' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function asUUID(value: string): UUID {
  if (!UUID_PATTERN.test(value)) throw new TypeError('Invalid UUID');
  return value as UUID;
}

export interface RequestContext {
  requestId: string;
  correlationId: string;
  userId?: UUID;
  tenantId?: UUID;
  organizationId?: UUID;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  traceId: string;
  detail?: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
