import { describe, expect, test } from 'bun:test';
import { Client, InvalidClientTransitionError } from './client';

const makeClient = () =>
  Client.pending({
    id: '0199b2d2-8e00-7000-8000-000000000001',
    tenantId: '0199b2d2-8e00-7000-8000-000000000002',
    organizationId: '0199b2d2-8e00-7000-8000-000000000003',
    primaryFacilityId: '0199b2d2-8e00-7000-8000-000000000004',
    firstName: 'Ada',
    lastName: 'Musterfrau',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  });

describe('Client lifecycle', () => {
  test('only allows pending to active, then active to archived', () => {
    const client = makeClient();
    client.activate();
    expect(client.snapshot.status).toBe('active');
    client.archive();
    expect(client.snapshot.status).toBe('archived');
    expect(() => client.activate()).toThrow(InvalidClientTransitionError);
  });

  test('does not change archived personal data', () => {
    const client = makeClient();
    client.activate();
    client.archive();
    expect(() => client.updatePersonalData({ firstName: 'Ada', lastName: 'Changed' })).toThrow(
      'Archived clients cannot be changed',
    );
  });
});
