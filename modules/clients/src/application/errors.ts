import type { Permission } from '@care/permissions';

export class ClientNotFoundError extends Error {
  readonly code = 'CLIENT_NOT_FOUND';

  constructor() {
    super('Client not found');
    this.name = 'ClientNotFoundError';
  }
}

export class InvalidPaginationError extends Error {
  readonly code = 'INVALID_PAGINATION';

  constructor() {
    super('Pagination, sorting or filter values are invalid');
    this.name = 'InvalidPaginationError';
  }
}

export class ClientScopeDeniedError extends Error {
  readonly code = 'INSUFFICIENT_PERMISSION';

  constructor(readonly action: Permission) {
    super('The requested client is outside the granted scope');
    this.name = 'ClientScopeDeniedError';
  }
}

export class FacilityNotInOrganizationError extends Error {
  readonly code = 'FACILITY_NOT_IN_ORGANIZATION';

  constructor() {
    super('The selected facility does not belong to the selected organization');
    this.name = 'FacilityNotInOrganizationError';
  }
}

export class ClientContactRoleConflictError extends Error {
  readonly code = 'CLIENT_CONTACT_ROLE_CONFLICT';

  constructor(readonly role: string) {
    super('Another contact already has this exclusive role');
    this.name = 'ClientContactRoleConflictError';
  }
}

export class PflegegradRecordImmutableError extends Error {
  readonly code = 'PFLEGEGRAD_RECORD_IMMUTABLE';

  constructor() {
    super('Confirmed and historical Pflegegrad records cannot be rewritten');
    this.name = 'PflegegradRecordImmutableError';
  }
}
