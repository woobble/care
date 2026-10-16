import { expect, test } from 'bun:test';

import type { AuditWriter } from '@care/audit';
import type { DatabaseTransaction, UnitOfWork } from '@care/database';
import type { OrganizationRepository } from '@care/organizations';
import type { AuthorizationPrincipal, PermissionGrant } from '@care/permissions';
import type { OutboxWriter } from '@care/platform';
import type { ClientMasterDataRepository } from '@module/clients/infrastructure/persistence/client-master-data.repository';
import {
  ClientRepository,
  type ClientSearchFilter,
} from '@module/clients/infrastructure/persistence/client.repository';

import { ClientApplicationService } from './client.service';

const tenantId = '435806c8-4d80-45f5-8c12-3197cc5989a8';

function makePrincipal(grants: PermissionGrant[]): AuthorizationPrincipal {
  return {
    userId: 'c3a106d6-4dfa-4cc2-946e-3072fd94d9ad',
    tenantId,
    grants,
  };
}

function clientReadGrant(): PermissionGrant {
  return { permission: 'client.read', scopeType: 'tenant', scopeId: tenantId };
}

async function searchWithGrants(grants: PermissionGrant[]): Promise<ClientSearchFilter> {
  let captured: ClientSearchFilter | undefined;
  const unitOfWork: UnitOfWork = {
    transaction<T>(
      _options: { tenantId?: string },
      operation: (transaction: DatabaseTransaction) => Promise<T>,
    ): Promise<T> {
      return operation({} as DatabaseTransaction);
    },
  };
  const clients = {
    async search(_transaction: DatabaseTransaction, filter: ClientSearchFilter) {
      captured = filter;
      return { items: [], total: 0 };
    },
  } as unknown as ClientRepository;
  const service = new ClientApplicationService(
    unitOfWork,
    clients,
    {} as ClientMasterDataRepository,
    {} as OrganizationRepository,
    {} as AuditWriter,
    {} as OutboxWriter,
  );

  await service.search(makePrincipal(grants), { text: 'member-42' });
  if (!captured) throw new Error('Client search filter was not captured');
  return captured;
}

test('client search limits insurance identifiers to the client update scope', async () => {
  const organizationId = '5d9c3876-a8e1-4aad-851a-ad16feb4ce6f';
  const filter = await searchWithGrants([
    clientReadGrant(),
    { permission: 'client.update', scopeType: 'organization', scopeId: organizationId },
  ]);

  expect(filter.access).toEqual({
    tenantWide: true,
    organizationIds: [],
    facilityIds: [],
  });
  expect(filter.identifierAccess).toEqual({
    tenantWide: false,
    organizationIds: [organizationId],
    facilityIds: [],
  });
});

test('client search does not search insurance identifiers without client update access', async () => {
  const filter = await searchWithGrants([clientReadGrant()]);

  expect(filter.identifierAccess).toEqual({
    tenantWide: false,
    organizationIds: [],
    facilityIds: [],
  });
});

test('unsupported update scopes do not widen or break client list search', async () => {
  const filter = await searchWithGrants([
    clientReadGrant(),
    { permission: 'client.update', scopeType: 'assigned_clients', scopeId: 'user-1' },
  ]);

  expect(filter.identifierAccess).toEqual({
    tenantWide: false,
    organizationIds: [],
    facilityIds: [],
  });
});
