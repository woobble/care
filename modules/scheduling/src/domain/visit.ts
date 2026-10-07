import { isSupportedTimeZone } from '@care/organizations';

export type VisitStatus = 'planned' | 'confirmed' | 'cancelled';
export type VisitOrigin = 'agreement_generated' | 'manual';
export type VisitAssignmentStatus = 'active' | 'unassigned';

export interface VisitData {
  id: string;
  tenantId: string;
  clientId: string;
  organizationId: string;
  facilityId: string;
  origin: VisitOrigin;
  serviceAgreementId: string | null;
  status: VisitStatus;
  plannedStart: Date;
  plannedEnd: Date;
  timeWindowStart: Date | null;
  timeWindowEnd: Date | null;
  timezone: string;
  note: string | null;
  manuallyAdjusted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VisitServiceData {
  id: string;
  tenantId: string;
  visitId: string;
  serviceAgreementId: string | null;
  agreementServiceId: string | null;
  serviceDefinitionId: string;
  serviceCodeSnapshot: string;
  serviceNameSnapshot: string;
  unitSnapshot: 'occurrence' | 'minute' | 'hour' | 'day';
  plannedQuantity: string;
  plannedDurationMinutes: number | null;
  generationKey: string | null;
  generatedFromRule: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VisitSnapshot extends VisitData {
  services: VisitServiceData[];
}

export interface VisitAssignmentSnapshot {
  id: string;
  tenantId: string;
  visitId: string;
  employeeId: string;
  role: string | null;
  status: VisitAssignmentStatus;
  assignedAt: Date;
  assignedBy: string;
  unassignedAt: Date | null;
}

export function validateVisit(
  input: Pick<
    VisitData,
    | 'origin'
    | 'serviceAgreementId'
    | 'plannedStart'
    | 'plannedEnd'
    | 'timeWindowStart'
    | 'timeWindowEnd'
    | 'timezone'
    | 'note'
  >,
): void {
  if (
    !isValidDate(input.plannedStart) ||
    !isValidDate(input.plannedEnd) ||
    input.plannedEnd <= input.plannedStart ||
    (input.timeWindowStart !== null && !isValidDate(input.timeWindowStart)) ||
    (input.timeWindowEnd !== null && !isValidDate(input.timeWindowEnd)) ||
    (input.timeWindowStart === null) !== (input.timeWindowEnd === null) ||
    (input.timeWindowStart !== null &&
      input.timeWindowEnd !== null &&
      input.timeWindowEnd <= input.timeWindowStart) ||
    (input.note !== null && input.note.length > 2000) ||
    !isSupportedTimeZone(input.timezone) ||
    !(['agreement_generated', 'manual'] as const).includes(input.origin) ||
    (input.origin === 'agreement_generated' && input.serviceAgreementId === null)
  ) {
    throw new InvalidVisitDataError();
  }
}

export function validateVisitService(
  input: Pick<
    VisitServiceData,
    'serviceCodeSnapshot' | 'serviceNameSnapshot' | 'plannedQuantity' | 'plannedDurationMinutes'
  >,
): void {
  if (
    !input.serviceCodeSnapshot.trim() ||
    input.serviceCodeSnapshot.length > 64 ||
    !input.serviceNameSnapshot.trim() ||
    input.serviceNameSnapshot.length > 160 ||
    !isPositiveQuantity(input.plannedQuantity) ||
    (input.plannedDurationMinutes !== null &&
      (!Number.isInteger(input.plannedDurationMinutes) ||
        input.plannedDurationMinutes < 1 ||
        input.plannedDurationMinutes > 1440))
  ) {
    throw new InvalidVisitServiceError();
  }
}

export function isPositiveQuantity(value: string): boolean {
  if (!/^\d{1,9}(?:\.\d{1,3})?$/.test(value)) return false;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0') || '0') > 0n;
}

export class VisitLifecycle {
  constructor(private status: VisitStatus) {}

  get current(): VisitStatus {
    return this.status;
  }

  confirm(): VisitStatus {
    if (this.status === 'cancelled') throw new VisitCancelledError();
    if (this.status !== 'planned') throw new InvalidVisitStatusError(this.status, 'confirmed');
    this.status = 'confirmed';
    return this.status;
  }

  unconfirm(): VisitStatus {
    if (this.status === 'cancelled') throw new VisitCancelledError();
    if (this.status !== 'confirmed') throw new InvalidVisitStatusError(this.status, 'planned');
    this.status = 'planned';
    return this.status;
  }

  cancel(): VisitStatus {
    if (this.status === 'cancelled') throw new VisitCancelledError();
    this.status = 'cancelled';
    return this.status;
  }
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export class InvalidVisitDataError extends Error {
  readonly code = 'VISIT_INVALID_TIME';
  constructor() {
    super('Visit data or planned time is invalid');
    this.name = 'InvalidVisitDataError';
  }
}

export class InvalidVisitServiceError extends Error {
  readonly code = 'VISIT_SERVICE_INVALID';
  constructor() {
    super('Visit service snapshots or planned quantity are invalid');
    this.name = 'InvalidVisitServiceError';
  }
}

export class InvalidVisitStatusError extends Error {
  readonly code = 'VISIT_INVALID_STATUS';
  constructor(
    readonly current: VisitStatus,
    readonly requested: VisitStatus,
  ) {
    super(`Visit cannot transition from ${current} to ${requested}`);
    this.name = 'InvalidVisitStatusError';
  }
}

export class VisitCancelledError extends Error {
  readonly code = 'VISIT_CANCELLED';
  constructor() {
    super('Cancelled visits cannot be changed');
    this.name = 'VisitCancelledError';
  }
}
