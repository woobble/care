import { describe, expect, test } from 'bun:test';
import { can, type AuthorizationPrincipal } from './index';

describe('can', () => {
  const principal: AuthorizationPrincipal = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    grants: [
      { permission: 'client.read', scopeType: 'tenant', scopeId: 'tenant-1' },
      { permission: 'client.update', scopeType: 'facility', scopeId: 'facility-1' },
      { permission: 'client.read', scopeType: 'assigned_clients', scopeId: 'user-1' },
    ],
  };

  test('requires membership tenant and permission', () => {
    expect(can(principal, { action: 'client.read', resource: { tenantId: 'tenant-1' } })).toBe(
      true,
    );
    expect(can(principal, { action: 'client.archive', resource: { tenantId: 'tenant-1' } })).toBe(
      false,
    );
    expect(can(principal, { action: 'client.read', resource: { tenantId: 'tenant-2' } })).toBe(
      false,
    );
  });

  test('evaluates facility and assigned-client scopes', () => {
    expect(
      can(principal, {
        action: 'client.update',
        resource: { tenantId: 'tenant-1', facilityId: 'facility-1' },
      }),
    ).toBe(true);
    const assignedOnly: AuthorizationPrincipal = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      grants: [{ permission: 'client.read', scopeType: 'assigned_clients', scopeId: 'user-1' }],
    };
    expect(
      can(assignedOnly, {
        action: 'client.read',
        resource: { tenantId: 'tenant-1', clientId: 'client-1', assignedUserIds: ['user-1'] },
      }),
    ).toBe(true);
    expect(
      can(assignedOnly, {
        action: 'client.read',
        resource: { tenantId: 'tenant-1', clientId: 'client-1', assignedUserIds: ['user-2'] },
      }),
    ).toBe(false);
  });
});
