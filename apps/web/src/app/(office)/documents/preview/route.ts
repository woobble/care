import { fetchCareApi } from '@app/web/lib/api';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  const sourceType = query.get('sourceType');
  const id = query.get('id');
  const locale = query.get('locale');
  const asOf = query.get('asOf');
  if (
    (sourceType !== 'evidence_package' &&
      sourceType !== 'service_agreement' &&
      sourceType !== 'benefit_overview') ||
    !id ||
    !uuidPattern.test(id) ||
    (locale !== null && locale !== 'de' && locale !== 'en') ||
    (sourceType === 'benefit_overview' && asOf !== null && !isDate(asOf))
  ) {
    return new Response(null, { status: 400 });
  }
  const command =
    sourceType === 'evidence_package'
      ? { sourceType, evidencePackageId: id }
      : sourceType === 'service_agreement'
        ? { sourceType, agreementId: id }
        : {
            sourceType,
            clientId: id,
            ...(asOf ? { asOf } : {}),
          };
  const upstream = await fetchCareApi('/api/v1/documents/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...command, preview: true, ...(locale ? { locale } : {}) }),
  });
  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  if (upstream.ok) headers.set('Content-Disposition', 'inline; filename="document-preview.pdf"');
  else {
    const contentDisposition = upstream.headers.get('content-disposition');
    if (contentDisposition) headers.set('Content-Disposition', contentDisposition);
  }
  headers.set('Cache-Control', 'private, no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
}

function isDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
