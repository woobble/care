export const EXECUTION_REASONS = [
  'client_declined',
  'client_not_present',
  'service_not_required',
  'time_constraint',
  'provider_decision',
  'other',
] as const;

export type ExecutionReasonCode = (typeof EXECUTION_REASONS)[number];
export type ExecutionStatus = 'not_started' | 'in_progress' | 'completed';
export type PerformedServiceStatus = 'performed' | 'partially_performed' | 'not_performed';

export interface ServiceDecision {
  status: PerformedServiceStatus;
  plannedQuantity: string | null;
  actualQuantity: string | null;
  reasonCode?: string | null;
  note?: string | null;
}

export class InvalidPerformedServiceStatusError extends Error {
  readonly code = 'PERFORMED_SERVICE_INVALID_STATUS';

  constructor() {
    super('The performed-service status or reason is invalid');
    this.name = 'InvalidPerformedServiceStatusError';
  }
}

export class InvalidPerformedServiceQuantityError extends Error {
  readonly code = 'PERFORMED_SERVICE_INVALID_QUANTITY';

  constructor() {
    super('The performed-service quantity is invalid');
    this.name = 'InvalidPerformedServiceQuantityError';
  }
}

export class InvalidExecutionNoteError extends Error {
  readonly code = 'VISIT_EXECUTION_NOTE_INVALID';

  constructor() {
    super('The operational note is invalid');
    this.name = 'InvalidExecutionNoteError';
  }
}

export function validateServiceDecision(input: ServiceDecision): void {
  if (!['performed', 'partially_performed', 'not_performed'].includes(input.status)) {
    throw new InvalidPerformedServiceStatusError();
  }
  if (
    input.reasonCode != null &&
    !EXECUTION_REASONS.includes(input.reasonCode as ExecutionReasonCode)
  ) {
    throw new InvalidPerformedServiceStatusError();
  }
  if (input.status === 'not_performed' && input.reasonCode == null) {
    throw new InvalidPerformedServiceStatusError();
  }
  if (input.note != null && input.note.length > 1000) throw new InvalidExecutionNoteError();
  if (input.plannedQuantity != null && quantity(input.plannedQuantity) === null) {
    throw new InvalidPerformedServiceQuantityError();
  }
  const actual = input.actualQuantity == null ? null : quantity(input.actualQuantity);
  if (input.actualQuantity != null && actual === null) {
    throw new InvalidPerformedServiceQuantityError();
  }

  if (input.status === 'performed' && (actual === null || actual <= 0n)) {
    throw new InvalidPerformedServiceQuantityError();
  }
  if (input.status === 'partially_performed') {
    const planned = input.plannedQuantity == null ? null : quantity(input.plannedQuantity);
    if (actual === null || actual <= 0n || planned === null || actual >= planned) {
      throw new InvalidPerformedServiceQuantityError();
    }
  }
  if (input.status === 'not_performed' && actual !== null && actual !== 0n) {
    throw new InvalidPerformedServiceQuantityError();
  }
}

export function normalizeOperationalNote(note: string | null | undefined): string | null {
  if (note == null) return null;
  const normalized = note.trim();
  if (normalized.length > 1000) throw new InvalidExecutionNoteError();
  return normalized || null;
}

function quantity(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
