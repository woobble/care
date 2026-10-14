import { NextResponse } from 'next/server';
import { fetchCareApi } from '@app/web/lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: Readonly<{ params: Promise<{ serviceId: string }> }>,
) {
  const { serviceId } = await params;
  const url = new URL(request.url);
  const organizationId = url.searchParams.get('organizationId') ?? '';
  const facilityId = url.searchParams.get('facilityId');
  const validAt = url.searchParams.get('validAt') ?? '';
  if (
    !uuidPattern.test(serviceId) ||
    !uuidPattern.test(organizationId) ||
    (facilityId !== null && !uuidPattern.test(facilityId)) ||
    !datePattern.test(validAt)
  ) {
    return NextResponse.json({ error: 'Invalid price lookup request' }, { status: 400 });
  }

  const query = new URLSearchParams({ organizationId, validAt });
  if (facilityId) query.set('facilityId', facilityId);
  const response = await fetchCareApi({
    route: 'servicePrices',
    pathParams: [serviceId],
    query,
    init: { method: 'GET', cache: 'no-store' },
  });
  const payload = await response.json().catch(() => ({ error: 'Price lookup failed' }));
  return NextResponse.json(payload, {
    status: response.status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
