import { expect, test } from 'bun:test';

import type { ClientSearchItem } from '@care/clients';

import { clientListItemResponse } from './clients.mapper';

test('client list responses include only fields used by the list', () => {
  const item: ClientSearchItem = {
    client: {
      id: '05b0c513-e45d-4e13-94d9-e2fcad4aa351',
      organizationId: '5d9c3876-a8e1-4aad-851a-ad16feb4ce6f',
      primaryFacilityId: '17973951-b9d8-4779-8278-4f849bc8bcc1',
      firstName: 'Ada',
      lastName: 'Example',
      preferredName: null,
      dateOfBirth: '1945-04-15',
      status: 'active',
    },
    organizationName: 'Example organization',
    facilityName: 'Example facility',
    currentPflegegrad: 2,
  };
  const principal = {
    userId: 'c3a106d6-4dfa-4cc2-946e-3072fd94d9ad',
    tenantId: '435806c8-4d80-45f5-8c12-3197cc5989a8',
    grants: [
      {
        permission: 'organization.read' as const,
        scopeType: 'organization' as const,
        scopeId: item.client.organizationId!,
      },
      {
        permission: 'facility.read' as const,
        scopeType: 'facility' as const,
        scopeId: item.client.primaryFacilityId!,
      },
    ],
  };

  expect(clientListItemResponse(item, principal)).toEqual({
    id: item.client.id,
    organizationId: item.client.organizationId,
    primaryFacilityId: item.client.primaryFacilityId,
    firstName: 'Ada',
    lastName: 'Example',
    preferredName: null,
    dateOfBirth: '1945-04-15',
    status: 'active',
    organizationName: 'Example organization',
    facilityName: 'Example facility',
    currentPflegegrad: 2,
  });
});

test('client list responses redact related names without their read grants', () => {
  const item: ClientSearchItem = {
    client: {
      id: '05b0c513-e45d-4e13-94d9-e2fcad4aa351',
      organizationId: '5d9c3876-a8e1-4aad-851a-ad16feb4ce6f',
      primaryFacilityId: '17973951-b9d8-4779-8278-4f849bc8bcc1',
      firstName: 'Ada',
      lastName: 'Example',
      preferredName: null,
      dateOfBirth: '1945-04-15',
      status: 'active',
    },
    organizationName: 'Private organization',
    facilityName: 'Private facility',
    currentPflegegrad: 2,
  };

  expect(
    clientListItemResponse(item, {
      userId: 'c3a106d6-4dfa-4cc2-946e-3072fd94d9ad',
      tenantId: '435806c8-4d80-45f5-8c12-3197cc5989a8',
      grants: [
        {
          permission: 'client.read',
          scopeType: 'tenant',
          scopeId: '435806c8-4d80-45f5-8c12-3197cc5989a8',
        },
      ],
    }),
  ).toMatchObject({ organizationName: null, facilityName: null });
});
