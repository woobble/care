import { describe, expect, test } from 'bun:test';
import { createClientSchema, updateClientSchema } from './dto';

describe('client request schemas', () => {
  test('trims required names and rejects unknown fields', () => {
    expect(createClientSchema.parse({ firstName: ' Ada ', lastName: ' Lovelace ' })).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(
      createClientSchema.safeParse({ firstName: 'Ada', lastName: 'Lovelace', tenantId: 'other' })
        .success,
    ).toBe(false);
  });

  test('requires at least one allowed update field', () => {
    expect(updateClientSchema.safeParse({}).success).toBe(false);
    expect(updateClientSchema.safeParse({ email: 'care@example.test' }).success).toBe(true);
  });
});
