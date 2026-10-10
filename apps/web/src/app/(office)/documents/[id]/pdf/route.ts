import { fetchCareApi } from '@app/web/lib/api';

export async function GET(
  _request: Request,
  { params }: Readonly<{ params: Promise<{ id: string }> }>,
): Promise<Response> {
  const { id } = await params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const upstream = await fetchCareApi(`/api/v1/documents/${id}/download`);
  const headers = new Headers();
  for (const name of ['content-disposition', 'content-length', 'content-type']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Cache-Control', 'private, no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
