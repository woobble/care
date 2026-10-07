import { describe, expect, test } from 'bun:test';
import { createClientSchema, updateClientSchema } from './clients.dto';

describe('client request schemas', () => {
  test('trims required names and rejects unknown fields', () => {
    const client = createClientSchema.parse({
      firstName: ' Ada ',
      lastName: ' Lovelace ',
      organizationId: '0199b2d2-8e00-7000-8000-000000000003',
      primaryFacilityId: '0199b2d2-8e00-7000-8000-000000000004',
    });
    expect(client.firstName).toBe('Ada');
    expect(client.lastName).toBe('Lovelace');
    expect(
      createClientSchema.safeParse({
        firstName: 'Ada',
        lastName: 'Lovelace',
        organizationId: '0199b2d2-8e00-7000-8000-000000000003',
        primaryFacilityId: '0199b2d2-8e00-7000-8000-000000000004',
        tenantId: 'other',
      }).success,
    ).toBe(false);
    expect(createClientSchema.safeParse({ firstName: 'Ada', lastName: 'Lovelace' }).success).toBe(
      false,
    );
  });

  test('requires at least one allowed update field', () => {
    expect(updateClientSchema.safeParse({}).success).toBe(false);
    expect(updateClientSchema.safeParse({ email: 'care@example.test' }).success).toBe(true);
  });
});
