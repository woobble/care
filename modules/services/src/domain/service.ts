export type ServiceStatus = 'active' | 'archived';
export type ServiceUnit = 'occurrence' | 'minute' | 'hour' | 'day';
export type ServiceCategoryStatus = 'active' | 'archived';

export interface ServiceCategoryData {
  name: string;
  code?: string | null;
  description?: string | null;
  sortOrder?: number | null;
}

export interface ServiceCategorySnapshot extends ServiceCategoryData {
  id: string;
  tenantId: string;
  code: string | null;
  description: string | null;
  sortOrder: number | null;
  status: ServiceCategoryStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceDefinitionData {
  code: string;
  name: string;
  description?: string | null;
  categoryId: string;
  unit: ServiceUnit;
  defaultDurationMinutes?: number | null;
  validFrom: string;
  validUntil?: string | null;
}

export interface ServiceDefinitionSnapshot extends ServiceDefinitionData {
  id: string;
  tenantId: string;
  description: string | null;
  defaultDurationMinutes: number | null;
  validUntil: string | null;
  status: ServiceStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceAvailabilityData {
  organizationId: string;
  facilityId?: string | null;
  active: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface ServiceAvailabilitySnapshot extends ServiceAvailabilityData {
  id: string;
  tenantId: string;
  serviceId: string;
  facilityId: string | null;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function validateServiceCategory(input: ServiceCategoryData): void {
  if (
    !input.name.trim() ||
    input.name.length > 120 ||
    (input.code !== undefined &&
      input.code !== null &&
      (!input.code.trim() || input.code.trim().length > 40)) ||
    (input.description !== undefined &&
      input.description !== null &&
      input.description.length > 1000) ||
    (input.sortOrder !== undefined &&
      input.sortOrder !== null &&
      (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 10000))
  ) {
    throw new InvalidServiceCategoryError();
  }
}

export function validateServiceDefinition(input: ServiceDefinitionData): void {
  if (
    !input.code.trim() ||
    input.code.length > 64 ||
    !input.name.trim() ||
    input.name.length > 160 ||
    (input.description !== undefined &&
      input.description !== null &&
      input.description.length > 2000) ||
    (input.defaultDurationMinutes !== undefined &&
      input.defaultDurationMinutes !== null &&
      (!Number.isInteger(input.defaultDurationMinutes) ||
        input.defaultDurationMinutes < 1 ||
        input.defaultDurationMinutes > 1440)) ||
    !(['occurrence', 'minute', 'hour', 'day'] as const).includes(input.unit) ||
    !isISODate(input.validFrom) ||
    (input.validUntil && !isISODate(input.validUntil)) ||
    (input.validUntil !== undefined &&
      input.validUntil !== null &&
      input.validUntil <= input.validFrom)
  ) {
    throw new InvalidServiceDefinitionError();
  }
}

export function validateServiceAvailability(input: ServiceAvailabilityData): void {
  if (
    !input.organizationId ||
    (input.validFrom && !isISODate(input.validFrom)) ||
    (input.validUntil && !isISODate(input.validUntil)) ||
    (input.validFrom && input.validUntil && input.validUntil <= input.validFrom)
  ) {
    throw new InvalidServiceAvailabilityError();
  }
}

export class ServiceDefinition {
  private constructor(private readonly state: ServiceDefinitionSnapshot) {}

  static create(
    input: ServiceDefinitionData & {
      id: string;
      tenantId: string;
      createdAt: Date;
      updatedAt: Date;
    },
  ): ServiceDefinition {
    validateServiceDefinition(input);
    return new ServiceDefinition({
      ...input,
      description: input.description ?? null,
      defaultDurationMinutes: input.defaultDurationMinutes ?? null,
      validUntil: input.validUntil ?? null,
      status: 'active',
    });
  }

  static reconstitute(state: ServiceDefinitionSnapshot): ServiceDefinition {
    return new ServiceDefinition(state);
  }

  get snapshot(): ServiceDefinitionSnapshot {
    return { ...this.state };
  }

  update(input: ServiceDefinitionData, now = new Date()): string[] {
    if (this.state.status === 'archived') throw new ServiceDefinitionArchivedError();
    validateServiceDefinition(input);
    const changedFields = Object.keys(input).filter(
      (field) =>
        this.state[field as keyof ServiceDefinitionSnapshot] !==
        input[field as keyof ServiceDefinitionData],
    );
    if (changedFields.length > 0) Object.assign(this.state, input, { updatedAt: now });
    return changedFields;
  }

  archive(now = new Date()): void {
    if (this.state.status === 'archived') throw new ServiceDefinitionArchivedError();
    this.state.status = 'archived';
    this.state.updatedAt = now;
  }
}

export class InvalidServiceCategoryError extends Error {
  readonly code = 'INVALID_SERVICE_CATEGORY';

  constructor() {
    super('Service category values are invalid');
    this.name = 'InvalidServiceCategoryError';
  }
}

export class ServiceCategoryNotFoundError extends Error {
  readonly code = 'SERVICE_CATEGORY_NOT_FOUND';

  constructor() {
    super('Service category not found');
    this.name = 'ServiceCategoryNotFoundError';
  }
}

export class ServiceCategoryArchivedError extends Error {
  readonly code = 'SERVICE_CATEGORY_ARCHIVED';

  constructor() {
    super('Archived service categories cannot be changed');
    this.name = 'ServiceCategoryArchivedError';
  }
}

export class InvalidServiceDefinitionError extends Error {
  readonly code = 'INVALID_SERVICE_DEFINITION';

  constructor() {
    super('Service definition values or validity period are invalid');
    this.name = 'InvalidServiceDefinitionError';
  }
}

export class ServiceNotFoundError extends Error {
  readonly code = 'SERVICE_NOT_FOUND';

  constructor() {
    super('Service not found');
    this.name = 'ServiceNotFoundError';
  }
}

export class ServiceDefinitionArchivedError extends Error {
  readonly code = 'SERVICE_ARCHIVED';

  constructor() {
    super('Archived services cannot be changed');
    this.name = 'ServiceDefinitionArchivedError';
  }
}

export class InvalidServiceAvailabilityError extends Error {
  readonly code = 'INVALID_SERVICE_AVAILABILITY';

  constructor() {
    super('Service availability values or validity period are invalid');
    this.name = 'InvalidServiceAvailabilityError';
  }
}

export class InvalidServicePaginationError extends Error {
  readonly code = 'INVALID_SERVICE_PAGINATION';

  constructor() {
    super('Service search pagination or sorting values are invalid');
    this.name = 'InvalidServicePaginationError';
  }
}

function isISODate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
