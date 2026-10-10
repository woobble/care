import { AuthorizationDeniedError, can } from '@care/permissions';
import type { AuthorizationPrincipal, Permission } from '@care/permissions';
import type { ClientSnapshot } from '@module/clients/domain/client';
import { ClientNotFoundError } from './errors';
import type { ClientScopeFilter } from '@module/clients/infrastructure/persistence/client.repository';

export function clientScopeFilter(
  principal: AuthorizationPrincipal,
  action: Permission,
): ClientScopeFilter {
  const grants = principal.grants.filter((grant) => grant.permission === action);
  const tenantWide = grants.some(
    (grant) => grant.scopeType === 'tenant' && grant.scopeId === principal.tenantId,
  );
  const organizationIds = [
    ...new Set(
      grants.filter((grant) => grant.scopeType === 'organization').map((grant) => grant.scopeId),
    ),
  ];
  const facilityIds = [
    ...new Set(
      grants.filter((grant) => grant.scopeType === 'facility').map((grant) => grant.scopeId),
    ),
  ];
  if (!tenantWide && organizationIds.length === 0 && facilityIds.length === 0) {
    throw new AuthorizationDeniedError(action);
  }
  return { tenantWide, organizationIds, facilityIds };
}

export function authorizeClientResource(
  principal: AuthorizationPrincipal,
  action: Permission,
  client: ClientSnapshot,
): void {
  if (
    !can(principal, {
      action,
      resource: {
        tenantId: client.tenantId,
        clientId: client.id,
        ...(client.organizationId ? { organizationId: client.organizationId } : {}),
        ...(client.primaryFacilityId ? { facilityId: client.primaryFacilityId } : {}),
      },
    })
  ) {
    throw new ClientNotFoundError();
  }
}
