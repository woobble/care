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

  expect(clientListItemResponse(item)).toEqual({
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
