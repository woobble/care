import { expect, test } from 'bun:test';

import { buildCareApiUrl, type CareApiRequest } from './api-routes';

const baseUrl = 'http://care-api.internal:3001';

test('builds a registered API route and preserves query parameters', () => {
  const url = buildCareApiUrl(
    {
      route: 'facilitiesSearch',
      query: new URLSearchParams({ q: 'North clinic', page: '2' }),
    },
    baseUrl,
  );

  expect(url.origin).toBe(baseUrl);
  expect(url.pathname).toBe('/api/v1/facilities/search');
  expect(url.searchParams.get('q')).toBe('North clinic');
  expect(url.searchParams.get('page')).toBe('2');
});

test('keeps untrusted values inside one encoded path segment', () => {
  const url = buildCareApiUrl({ route: 'documentDownload', pathParams: ['../secret'] }, baseUrl);

  expect(url.origin).toBe(baseUrl);
  expect(url.pathname).toBe('/api/v1/documents/%2E%2E%2Fsecret/download');

  const authority = buildCareApiUrl(
    { route: 'documentDownload', pathParams: ['//attacker.example'] },
    baseUrl,
  );
  expect(authority.origin).toBe(baseUrl);
  expect(authority.pathname).toBe('/api/v1/documents/%2F%2Fattacker%2Eexample/download');
});

test('rejects route keys outside the registry', () => {
  const request = { route: 'arbitrary', query: new URLSearchParams() } as unknown as CareApiRequest;

  expect(() => buildCareApiUrl(request, baseUrl)).toThrow();
  expect(() =>
    buildCareApiUrl({ route: 'documentDownload', pathParams: ['..'] }, baseUrl),
  ).toThrow();
});
