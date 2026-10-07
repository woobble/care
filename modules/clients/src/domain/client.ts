export type ClientStatus = 'pending' | 'active' | 'archived';
export type ClientGender = 'female' | 'male' | 'diverse';
export type ClientSalutation = 'mr' | 'ms' | 'mx' | 'other';

export interface ClientPersonalData {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  dateOfDeath?: string | null;
  gender?: ClientGender | null;
  salutation?: ClientSalutation | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
}

export interface ClientSnapshot extends ClientPersonalData {
  id: string;
  tenantId: string;
  organizationId: string | null;
  primaryFacilityId: string | null;
  status: ClientStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientProviderContext {
  organizationId: string;
  primaryFacilityId: string;
}

export class Client {
  private constructor(private readonly state: ClientSnapshot) {}

  static pending(input: Omit<ClientSnapshot, 'status'> & ClientProviderContext): Client {
    validatePersonalData(input);
    if (!input.organizationId || !input.primaryFacilityId) throw new InvalidProviderContextError();
    return new Client({ ...input, status: 'pending' });
  }

  static reconstitute(state: ClientSnapshot): Client {
    return new Client(state);
  }

  get snapshot(): ClientSnapshot {
    return { ...this.state };
  }

  updatePersonalData(input: ClientPersonalData, now = new Date()): string[] {
    this.ensureMutable();
    validatePersonalData(input);
    const changedFields = Object.keys(input).filter(
      (field) =>
        this.state[field as keyof ClientSnapshot] !== input[field as keyof ClientPersonalData],
    );
    Object.assign(this.state, input, { updatedAt: now });
    return changedFields;
  }

  changeProviderContext(input: ClientProviderContext, now = new Date()): string[] {
    this.ensureMutable();
    const changedFields: string[] = [];
    if (this.state.organizationId !== input.organizationId) changedFields.push('organizationId');
    if (this.state.primaryFacilityId !== input.primaryFacilityId)
      changedFields.push('primaryFacilityId');
    if (changedFields.length > 0) Object.assign(this.state, input, { updatedAt: now });
    return changedFields;
  }

  touch(now = new Date()): void {
    this.ensureMutable();
    this.state.updatedAt = now;
  }

  activate(now = new Date()): void {
    if (this.state.status !== 'pending')
      throw new InvalidClientTransitionError(this.state.status, 'active');
    this.state.status = 'active';
    this.state.updatedAt = now;
  }

  archive(now = new Date()): void {
    if (this.state.status !== 'active')
      throw new InvalidClientTransitionError(this.state.status, 'archived');
    this.state.status = 'archived';
    this.state.updatedAt = now;
  }

  private ensureMutable(): void {
    if (this.state.status === 'archived') throw new ClientArchivedError();
  }
}

export function displayClientName(
  client: Pick<ClientSnapshot, 'firstName' | 'lastName' | 'preferredName'>,
): string {
  return `${client.preferredName?.trim() || client.firstName} ${client.lastName}`;
}

export function validatePersonalData(input: ClientPersonalData): void {
  if (input.firstName.trim().length === 0 || input.lastName.trim().length === 0) {
    throw new InvalidClientPersonalDataError();
  }
  const birth = input.dateOfBirth ? parseDate(input.dateOfBirth) : null;
  const death = input.dateOfDeath ? parseDate(input.dateOfDeath) : null;
  if ((input.dateOfBirth && !birth) || (input.dateOfDeath && !death)) {
    throw new InvalidClientPersonalDataError();
  }
  if (birth && death && death < birth) throw new InvalidClientPersonalDataError();
}

function parseDate(value: string): number | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.getTime();
}

export class InvalidClientPersonalDataError extends Error {
  readonly code = 'INVALID_CLIENT_DATA';

  constructor() {
    super('Client name or dates are invalid');
    this.name = 'InvalidClientPersonalDataError';
  }
}

export class InvalidProviderContextError extends Error {
  readonly code = 'INVALID_PROVIDER_CONTEXT';

  constructor() {
    super('A client must be assigned to an organization and facility in the same tenant');
    this.name = 'InvalidProviderContextError';
  }
}

export class ClientArchivedError extends Error {
  readonly code = 'CLIENT_ARCHIVED';

  constructor() {
    super('Archived clients cannot be changed');
    this.name = 'ClientArchivedError';
  }
}

export class InvalidClientTransitionError extends Error {
  readonly code = 'INVALID_CLIENT_TRANSITION';

  constructor(
    readonly from: ClientStatus,
    readonly to: ClientStatus,
  ) {
    super(`Cannot change client from ${from} to ${to}`);
    this.name = 'InvalidClientTransitionError';
  }
}
