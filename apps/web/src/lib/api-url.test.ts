import { expect, test } from 'bun:test';
import { resolveCareApiUrl } from './api-url';

const baseUrl = 'http://care-api.internal:3001';

test('resolves rooted API paths and preserves query strings', () => {
  const url = resolveCareApiUrl('/api/v1/facilities/search?q=North&page=2', baseUrl);

  expect(url.href).toBe('http://care-api.internal:3001/api/v1/facilities/search?q=North&page=2');
});

test('rejects URLs and paths outside the API route', () => {
  for (const path of [
    'https://attacker.example/api/v1/users',
    '//attacker.example/api/v1/users',
    '/api/v1\\attacker.example/users',
    '/api/v1/../../admin',
    'api/v1/users',
  ]) {
    expect(() => resolveCareApiUrl(path, baseUrl)).toThrow();
  }
});
