import { describe, expect, test } from 'bun:test';
import { visitQuerySchema } from './scheduling.dto';

describe('visit search query', () => {
  const range = {
    from: '2026-10-12T00:00:00.000Z',
    until: '2026-10-19T00:00:00.000Z',
  };

  test('trims supported list search terms', () => {
    const result = visitQuerySchema.safeParse({ ...range, search: '  Anna Müller  ' });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.search).toBe('Anna Müller');
  });

  test('rejects empty or oversized search values', () => {
    expect(visitQuerySchema.safeParse({ ...range, search: '   ' }).success).toBe(false);
    expect(visitQuerySchema.safeParse({ ...range, search: 'x'.repeat(101) }).success).toBe(false);
  });
});
