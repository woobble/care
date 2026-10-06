import { describe, expect, test } from 'bun:test';
import { can, canGrantPermissions, type AuthorizationPrincipal } from './index';

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

  test('evaluates organization and facility resources against matching scope ids', () => {
    const scoped: AuthorizationPrincipal = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      grants: [
        { permission: 'organization.read', scopeType: 'organization', scopeId: 'org-1' },
        { permission: 'facility.read', scopeType: 'facility', scopeId: 'facility-1' },
      ],
    };

    expect(
      can(scoped, {
        action: 'organization.read',
        resource: { tenantId: 'tenant-1', organizationId: 'org-1' },
      }),
    ).toBe(true);
    expect(
      can(scoped, {
        action: 'organization.read',
        resource: { tenantId: 'tenant-1', organizationId: 'org-2' },
      }),
    ).toBe(false);
    expect(
      can(scoped, {
        action: 'facility.read',
        resource: {
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          facilityId: 'facility-1',
        },
      }),
    ).toBe(true);
  });

  test('requires explicit role assignment and prevents permission escalation', () => {
    const administrator: AuthorizationPrincipal = {
      userId: 'admin',
      tenantId: 'tenant-1',
      grants: [
        { permission: 'tenant.roles.assign', scopeType: 'tenant', scopeId: 'tenant-1' },
        { permission: 'tenant.members.manage', scopeType: 'tenant', scopeId: 'tenant-1' },
        { permission: 'client.read', scopeType: 'tenant', scopeId: 'tenant-1' },
      ],
    };
    const office: AuthorizationPrincipal = {
      userId: 'office',
      tenantId: 'tenant-1',
      grants: [{ permission: 'client.read', scopeType: 'tenant', scopeId: 'tenant-1' }],
    };
    const tenant = { tenantId: 'tenant-1' };

    expect(canGrantPermissions(administrator, ['client.read'], tenant)).toBe(true);
    expect(canGrantPermissions(administrator, ['tenant.members.manage'], tenant)).toBe(true);
    expect(canGrantPermissions(office, ['client.read'], tenant)).toBe(false);
    expect(canGrantPermissions(administrator, ['client.read'], { tenantId: 'tenant-2' })).toBe(
      false,
    );
  });
});
