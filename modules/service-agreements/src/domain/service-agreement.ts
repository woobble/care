export type AgreementStatus = 'draft' | 'active' | 'suspended' | 'ended';
export type AgreementServiceStatus = 'active' | 'ended';
export type ServiceUnit = 'occurrence' | 'minute' | 'hour' | 'day';
export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type AgreementServiceScheduleRule =
  | { type: 'daily' }
  | { type: 'weekly'; weekdays: Weekday[] }
  | { type: 'occurrences_per_week'; count: number }
  | { type: 'interval_days'; intervalDays: number }
  | { type: 'on_demand' };

export interface ServiceAgreementData {
  validFrom: string;
  validUntil?: string | null;
  reference?: string | null;
  description?: string | null;
}

export interface ServiceAgreementSnapshot extends ServiceAgreementData {
  id: string;
  tenantId: string;
  clientId: string;
  organizationId: string;
  facilityId: string;
  status: AgreementStatus;
  validUntil: string | null;
  reference: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgreementServiceFields {
  validFrom: string | null;
  validUntil: string | null;
  quantity: string | null;
  note: string | null;
  scheduleRule: AgreementServiceScheduleRule | null;
  preferredTimeStart: string | null;
  preferredTimeEnd: string | null;
}

export interface AgreementServiceSnapshot extends AgreementServiceFields {
  id: string;
  tenantId: string;
  agreementId: string;
  serviceDefinitionId: string;
  serviceCode: string;
  serviceName: string;
  serviceUnit: ServiceUnit;
  status: AgreementServiceStatus;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function validateServiceAgreementData(input: ServiceAgreementData): void {
  if (
    !isISODate(input.validFrom) ||
    (input.validUntil != null &&
      (!isISODate(input.validUntil) || input.validUntil < input.validFrom)) ||
    (input.reference != null && (!input.reference.trim() || input.reference.trim().length > 120)) ||
    (input.description != null && input.description.length > 2000)
  ) {
    throw new ServiceAgreementInvalidValidityError();
  }
}

export function validateAgreementServiceFields(
  input: AgreementServiceFields,
  serviceUnit: ServiceUnit,
): void {
  if (!isQuantityValid(input.quantity, serviceUnit)) {
    throw new AgreementServiceInvalidQuantityError();
  }
  if (!isScheduleRuleValid(input.scheduleRule)) throw new InvalidScheduleRuleError();
  if (
    (input.validFrom !== null && !isISODate(input.validFrom)) ||
    (input.validUntil !== null && !isISODate(input.validUntil)) ||
    (input.validFrom !== null && input.validUntil !== null && input.validUntil < input.validFrom) ||
    (input.note !== null && input.note.length > 1000) ||
    !isTime(input.preferredTimeStart) ||
    !isTime(input.preferredTimeEnd) ||
    (input.preferredTimeStart === null) !== (input.preferredTimeEnd === null) ||
    (input.preferredTimeStart !== null &&
      input.preferredTimeEnd !== null &&
      input.preferredTimeStart >= input.preferredTimeEnd)
  ) {
    throw new AgreementServiceInvalidValidityError();
  }
}

export class ServiceAgreement {
  private constructor(private readonly state: ServiceAgreementSnapshot) {}

  static create(
    input: ServiceAgreementData & {
      id: string;
      tenantId: string;
      clientId: string;
      organizationId: string;
      facilityId: string;
      createdAt: Date;
      updatedAt: Date;
    },
  ): ServiceAgreement {
    validateServiceAgreementData(input);
    return new ServiceAgreement({
      ...input,
      validUntil: input.validUntil ?? null,
      reference: input.reference?.trim() || null,
      description: input.description?.trim() || null,
      status: 'draft',
    });
  }

  static reconstitute(snapshot: ServiceAgreementSnapshot): ServiceAgreement {
    return new ServiceAgreement(snapshot);
  }

  get snapshot(): ServiceAgreementSnapshot {
    return { ...this.state };
  }

  update(input: ServiceAgreementData, now = new Date()): string[] {
    this.ensureNotEnded();
    validateServiceAgreementData(input);
    const next = {
      validFrom: input.validFrom,
      validUntil: input.validUntil ?? null,
      reference: input.reference?.trim() || null,
      description: input.description?.trim() || null,
    };
    const changed = Object.keys(next).filter(
      (key) => this.state[key as keyof ServiceAgreementSnapshot] !== next[key as keyof typeof next],
    );
    if (changed.length > 0) Object.assign(this.state, next, { updatedAt: now });
    return changed;
  }

  activate(now = new Date()): void {
    this.transition('draft', 'active', now);
  }

  suspend(now = new Date()): void {
    this.transition('active', 'suspended', now);
  }

  resume(now = new Date()): void {
    this.transition('suspended', 'active', now);
  }

  end(now = new Date()): void {
    this.ensureNotEnded();
    this.state.status = 'ended';
    this.state.updatedAt = now;
  }

  private transition(from: AgreementStatus, to: AgreementStatus, now: Date): void {
    this.ensureNotEnded();
    if (this.state.status !== from) {
      throw new ServiceAgreementInvalidStatusError(this.state.status, to);
    }
    this.state.status = to;
    this.state.updatedAt = now;
  }

  private ensureNotEnded(): void {
    if (this.state.status === 'ended') throw new ServiceAgreementAlreadyEndedError();
  }
}

export class AgreementService {
  private constructor(private readonly state: AgreementServiceSnapshot) {}

  static create(
    input: Omit<AgreementServiceSnapshot, 'status' | 'endedAt'> & {
      status?: AgreementServiceStatus;
      endedAt?: Date | null;
    },
  ): AgreementService {
    validateAgreementServiceFields(input, input.serviceUnit);
    return new AgreementService({
      ...input,
      status: input.status ?? 'active',
      endedAt: input.endedAt ?? null,
    });
  }

  static reconstitute(snapshot: AgreementServiceSnapshot): AgreementService {
    return new AgreementService(snapshot);
  }

  get snapshot(): AgreementServiceSnapshot {
    return { ...this.state };
  }

  update(input: AgreementServiceFields, now = new Date()): string[] {
    if (this.state.status === 'ended') throw new AgreementServiceAlreadyEndedError();
    validateAgreementServiceFields(input, this.state.serviceUnit);
    const changed: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      if (this.state[key as keyof AgreementServiceSnapshot] !== value) changed.push(key);
    }
    if (changed.length > 0) Object.assign(this.state, input, { updatedAt: now });
    return changed;
  }

  end(now = new Date()): void {
    if (this.state.status === 'ended') throw new AgreementServiceAlreadyEndedError();
    this.state.status = 'ended';
    this.state.endedAt = now;
    this.state.updatedAt = now;
  }
}

export function isScheduleRuleValid(rule: AgreementServiceScheduleRule | null): boolean {
  if (rule === null) return true;
  switch (rule.type) {
    case 'daily':
    case 'on_demand':
      return true;
    case 'weekly':
      return (
        rule.weekdays.length > 0 &&
        rule.weekdays.length <= 7 &&
        new Set(rule.weekdays).size === rule.weekdays.length &&
        rule.weekdays.every((day) =>
          ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(
            day,
          ),
        )
      );
    case 'occurrences_per_week':
      return Number.isInteger(rule.count) && rule.count >= 1 && rule.count <= 14;
    case 'interval_days':
      return (
        Number.isInteger(rule.intervalDays) && rule.intervalDays >= 1 && rule.intervalDays <= 365
      );
  }
}

export function isQuantityValid(quantity: string | null, unit: ServiceUnit): boolean {
  if (quantity === null) return true;
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(quantity)) return false;
  const [whole = '0', fractional = ''] = quantity.split('.');
  const thousandths = BigInt(whole) * 1000n + BigInt(fractional.padEnd(3, '0') || '0');
  return thousandths > 0n && (unit !== 'occurrence' || thousandths % 1000n === 0n);
}

function isTime(value: string | null): boolean {
  return value === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isISODate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export class ServiceAgreementError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceAgreementError';
  }
}

export class ServiceAgreementInvalidValidityError extends ServiceAgreementError {
  constructor() {
    super('SERVICE_AGREEMENT_INVALID_VALIDITY', 400, 'Service agreement values are invalid');
  }
}

export class AgreementServiceInvalidValidityError extends ServiceAgreementError {
  constructor() {
    super('AGREEMENT_SERVICE_INVALID_VALIDITY', 400, 'Agreement service values are invalid');
  }
}

export class AgreementServiceInvalidQuantityError extends ServiceAgreementError {
  constructor() {
    super(
      'AGREEMENT_SERVICE_INVALID_QUANTITY',
      400,
      'The planned quantity is invalid for its unit',
    );
  }
}

export class InvalidScheduleRuleError extends ServiceAgreementError {
  constructor() {
    super('INVALID_SCHEDULE_RULE', 400, 'The schedule rule is invalid');
  }
}

export class ServiceAgreementAlreadyEndedError extends ServiceAgreementError {
  constructor() {
    super('SERVICE_AGREEMENT_ALREADY_ENDED', 409, 'An ended agreement cannot be changed');
  }
}

export class ServiceAgreementInvalidStatusError extends ServiceAgreementError {
  constructor(
    readonly from: AgreementStatus,
    readonly to: AgreementStatus,
  ) {
    super('SERVICE_AGREEMENT_INVALID_STATUS', 409, `Cannot change agreement from ${from} to ${to}`);
  }
}

export class AgreementServiceAlreadyEndedError extends ServiceAgreementError {
  constructor() {
    super('AGREEMENT_SERVICE_ALREADY_ENDED', 409, 'An ended agreement service cannot be changed');
  }
}

export class ServiceAgreementNotFoundError extends ServiceAgreementError {
  constructor() {
    super('SERVICE_AGREEMENT_NOT_FOUND', 404, 'Service agreement not found');
  }
}

export class AgreementServiceNotFoundError extends ServiceAgreementError {
  constructor() {
    super('AGREEMENT_SERVICE_NOT_FOUND', 404, 'Agreement service not found');
  }
}

export class AgreementServiceDuplicateError extends ServiceAgreementError {
  constructor() {
    super(
      'AGREEMENT_SERVICE_DUPLICATE',
      409,
      'This service already has an active line in the agreement',
    );
  }
}

export class ServiceAgreementOverlapError extends ServiceAgreementError {
  constructor() {
    super('SERVICE_AGREEMENT_OVERLAP', 409, 'Another active agreement covers this period');
  }
}

export class ServiceAgreementRequiresServiceError extends ServiceAgreementError {
  constructor() {
    super(
      'SERVICE_AGREEMENT_REQUIRES_SERVICE',
      409,
      'End the agreement before ending its last service',
    );
  }
}

export class InvalidServiceAgreementQueryError extends ServiceAgreementError {
  constructor() {
    super('INVALID_SERVICE_AGREEMENT_QUERY', 400, 'Agreement query values are invalid');
  }
}

export class ServiceAgreementProviderContextError extends ServiceAgreementError {
  constructor() {
    super(
      'INVALID_PROVIDER_CONTEXT',
      400,
      'The client provider context is invalid for this agreement',
    );
  }
}
