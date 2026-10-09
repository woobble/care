import { localDateTimeToInstant } from '@care/scheduling';

export const DOSAGE_UNITS = ['mg', 'g', 'mL', 'tablet', 'capsule', 'drop', 'puff', 'patch'] as const;
export const MEDICATION_ROUTES = [
  'oral',
  'topical',
  'subcutaneous',
  'intramuscular',
  'inhalation',
  'transdermal',
  'other',
] as const;
export const DOSAGE_FORMS = [
  'tablet',
  'capsule',
  'drops',
  'solution',
  'injection',
  'cream',
  'patch',
  'inhalation',
  'other',
] as const;

export type DosageUnit = (typeof DOSAGE_UNITS)[number];
export type MedicationRoute = (typeof MEDICATION_ROUTES)[number];
export type DosageForm = (typeof DOSAGE_FORMS)[number];
export type MedicationOrderStatus = 'draft' | 'active' | 'paused' | 'discontinued';
export type MedicationOutcome = 'administered' | 'not_administered' | 'refused' | 'withheld';
export type MedicationReason =
  | 'client_refused'
  | 'client_unavailable'
  | 'medication_unavailable'
  | 'held_per_instruction'
  | 'administration_not_possible'
  | 'other';

export type MedicationSchedule =
  | { type: 'fixed_times'; times: string[]; timezone: string }
  | { type: 'interval'; anchorAt: string; intervalMinutes: number; timezone: string }
  | {
      type: 'as_needed';
      indication: string;
      timezone: string;
      maximumDoseAmount?: string;
      maximumAdministrations?: number;
      frequencyWindowMinutes?: number;
      minimumIntervalMinutes?: number;
    };

export interface MedicationOrderFacts {
  medicationDefinitionId: string;
  medicationSnapshot: {
    name: string;
    activeIngredient: string | null;
    strength: string | null;
    dosageForm: DosageForm;
    manufacturer: string | null;
  };
  doseAmount: string;
  doseUnit: DosageUnit;
  route: MedicationRoute;
  instructions: string | null;
  indication: string | null;
  prescriberName: string | null;
  sourceType: 'prescriber' | 'care_authorizing_source' | 'staff_transcription';
  sourceReference: string | null;
  prescribedAt: string | null;
  validFrom: string;
  validUntil: string | null;
  schedule: MedicationSchedule;
}

const decimalPattern = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/;

export function isPositiveDecimal(value: string): boolean {
  if (!decimalPattern.test(value)) return false;
  return decimalMilliunits(value) > 0n;
}

export function decimalMilliunits(value: string): bigint {
  if (!decimalPattern.test(value)) throw new RangeError('Invalid precise decimal');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
}

export function validateSchedule(schedule: MedicationSchedule): boolean {
  if (!schedule.timezone.trim()) return false;
  if (schedule.type === 'fixed_times') {
    return (
      schedule.times.length > 0 &&
      schedule.times.length <= 24 &&
      schedule.times.every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) &&
      new Set(schedule.times).size === schedule.times.length
    );
  }
  if (schedule.type === 'interval') {
    const anchor = new Date(schedule.anchorAt);
    return (
      Number.isFinite(anchor.getTime()) &&
      anchor.toISOString() === schedule.anchorAt &&
      Number.isInteger(schedule.intervalMinutes) &&
      schedule.intervalMinutes >= 30 &&
      schedule.intervalMinutes <= 10080
    );
  }
  if (!schedule.indication.trim()) return false;
  if (
    schedule.maximumDoseAmount !== undefined &&
    !isPositiveDecimal(schedule.maximumDoseAmount)
  ) return false;
  if (
    schedule.maximumAdministrations !== undefined &&
    (!Number.isInteger(schedule.maximumAdministrations) || schedule.maximumAdministrations < 1)
  ) return false;
  if ((schedule.maximumAdministrations === undefined) !== (schedule.frequencyWindowMinutes === undefined)) {
    return false;
  }
  if (
    schedule.frequencyWindowMinutes !== undefined &&
    (!Number.isInteger(schedule.frequencyWindowMinutes) || schedule.frequencyWindowMinutes < 1)
  ) return false;
  return (
    schedule.minimumIntervalMinutes === undefined ||
    (Number.isInteger(schedule.minimumIntervalMinutes) && schedule.minimumIntervalMinutes >= 1)
  );
}

/** Resolve a daily medication time using the earlier instant for repeated times and
 * the usual forward shift by the DST gap for nonexistent local times. */
export function medicationScheduleInstant(date: string, time: string, timezone: string): Date | null {
  const exact = localDateTimeToInstant(date, time, timezone, 'earlier');
  if (exact) return exact;

  const target = Date.parse(`${date}T${time}:00.000Z`);
  if (!Number.isFinite(target)) return null;
  for (let deltaMinutes = 1; deltaMinutes <= 180; deltaMinutes += 1) {
    const beforeWall = target - deltaMinutes * 60_000;
    const afterWall = target + deltaMinutes * 60_000;
    const before = medicationWallInstant(beforeWall, timezone);
    const after = medicationWallInstant(afterWall, timezone);
    if (!before || !after) continue;
    const beforeOffset = beforeWall - before.getTime();
    const afterOffset = afterWall - after.getTime();
    if (afterOffset <= beforeOffset) continue;

    const shifted = new Date(target - beforeOffset);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(shifted);
    const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${fields.year}-${fields.month}-${fields.day}` === date ? shifted : null;
  }
  return null;
}

function medicationWallInstant(wallMilliseconds: number, timezone: string): Date | null {
  const wall = new Date(wallMilliseconds).toISOString();
  return localDateTimeToInstant(wall.slice(0, 10), wall.slice(11, 16), timezone, 'earlier');
}

export function validateOrderFacts(facts: MedicationOrderFacts): boolean {
  return (
    facts.medicationSnapshot.name.trim().length > 0 &&
    isPositiveDecimal(facts.doseAmount) &&
    (facts.instructions === null || facts.instructions.trim().length <= 4000) &&
    (facts.indication === null || facts.indication.trim().length <= 1000) &&
    (facts.prescriberName === null || facts.prescriberName.trim().length <= 200) &&
    (facts.sourceReference === null || (facts.sourceReference.trim().length > 0 && facts.sourceReference.length <= 1000)) &&
    /^\d{4}-\d{2}-\d{2}$/.test(facts.validFrom) &&
    (facts.validUntil === null || facts.validUntil >= facts.validFrom) &&
    validateSchedule(facts.schedule)
  );
}

export function assertOrderTransition(
  current: MedicationOrderStatus,
  next: MedicationOrderStatus,
): void {
  const allowed: Record<MedicationOrderStatus, readonly MedicationOrderStatus[]> = {
    draft: ['active', 'discontinued'],
    active: ['paused', 'discontinued'],
    paused: ['active', 'discontinued'],
    discontinued: [],
  };
  if (!allowed[current].includes(next)) throw new MedicationOrderInvalidStateError();
}

export class MedicationOrderInvalidStateError extends Error {
  readonly code = 'MEDICATION_ORDER_INVALID_STATE';
  constructor() {
    super('Medication order cannot make the requested lifecycle transition');
    this.name = 'MedicationOrderInvalidStateError';
  }
}

