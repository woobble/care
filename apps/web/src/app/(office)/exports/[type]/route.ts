import { fetchCareApi } from '../../../../lib/api';

const endpoints = {
  invoices: '/api/v1/billing/exports/invoices',
  'invoice-lines': '/api/v1/billing/exports/invoice-lines',
  receivables: '/api/v1/billing/exports/receivables',
  'benefit-allocations': '/api/v1/benefits/exports/allocations',
} as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: Request,
  { params }: Readonly<{ params: Promise<{ type: string }> }>,
): Promise<Response> {
  const { type } = await params;
  if (!Object.hasOwn(endpoints, type)) return new Response(null, { status: 404 });
  const query = new URL(request.url).searchParams;
  const from = query.get('from');
  const until = query.get('until');
  const organizationId = query.get('organizationId');
  const facilityId = query.get('facilityId');
  const clientId = query.get('clientId');
  if (
    !from ||
    !until ||
    !datePattern.test(from) ||
    !datePattern.test(until) ||
    from > until ||
    !organizationId ||
    !uuidPattern.test(organizationId) ||
    (facilityId !== null && !uuidPattern.test(facilityId)) ||
    (clientId !== null && !uuidPattern.test(clientId))
  ) {
    return new Response(null, { status: 400 });
  }
  const filters = new URLSearchParams({ from, until, organizationId });
  if (facilityId) filters.set('facilityId', facilityId);
  if (clientId) filters.set('clientId', clientId);
  const endpoint = endpoints[type as keyof typeof endpoints];
  const upstream = await fetchCareApi(`${endpoint}?${filters.toString()}`);
  const headers = new Headers();
  for (const name of ['content-disposition', 'content-length', 'content-type']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Cache-Control', 'private, no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
}
