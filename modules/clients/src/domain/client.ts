export type ClientStatus = 'pending' | 'active' | 'archived';

export interface ClientPersonalData {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface ClientSnapshot extends ClientPersonalData {
  id: string;
  tenantId: string;
  status: ClientStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class Client {
  private constructor(private readonly state: ClientSnapshot) {}

  static pending(input: Omit<ClientSnapshot, 'status'>): Client {
    validatePersonalData(input);
    return new Client({ ...input, status: 'pending' });
  }

  static reconstitute(state: ClientSnapshot): Client {
    return new Client(state);
  }

  get snapshot(): ClientSnapshot {
    return { ...this.state };
  }

  updatePersonalData(input: ClientPersonalData, now = new Date()): string[] {
    if (this.state.status === 'archived') throw new ClientArchivedError();
    validatePersonalData(input);
    const changedFields = Object.keys(input).filter(
      (field) =>
        this.state[field as keyof ClientSnapshot] !== input[field as keyof ClientPersonalData],
    );
    Object.assign(this.state, input, { updatedAt: now });
    return changedFields;
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
}

export function validatePersonalData(input: ClientPersonalData): void {
  if (input.firstName.trim().length === 0 || input.lastName.trim().length === 0) {
    throw new InvalidClientPersonalDataError();
  }
  if (input.dateOfBirth) {
    const value = new Date(`${input.dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== input.dateOfBirth) {
      throw new InvalidClientPersonalDataError();
    }
  }
}

export class InvalidClientPersonalDataError extends Error {
  readonly code = 'INVALID_CLIENT_DATA';

  constructor() {
    super('Client name or date of birth is invalid');
    this.name = 'InvalidClientPersonalDataError';
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
