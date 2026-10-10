import type { VisitData } from './visit';

export type SchedulingConflictSeverity = 'blocking' | 'warning';
export type SchedulingConflictCode =
  | 'missing_assignment'
  | 'employee_overlap'
  | 'employee_absence'
  | 'outside_employee_availability'
  | 'employee_availability_unknown'
  | 'insufficient_travel_time'
  | 'travel_feasibility_unknown'
  | 'client_overlap'
  | 'employee_preference'
  | 'client_preference'
  | 'substitution_awaiting_confirmation'
  | 'unpublished_schedule_changes';

export interface SchedulingConflict {
  code: SchedulingConflictCode;
  severity: SchedulingConflictSeverity;
  visitId: string;
  employeeId?: string;
  relatedVisitId?: string;
  requiredMinutes?: number;
  availableMinutes?: number;
}

export function compareTourStops(left: VisitData, right: VisitData): number {
  return (
    left.plannedStart.getTime() - right.plannedStart.getTime() || left.id.localeCompare(right.id)
  );
}

export function tourFeasibilityConflicts(
  visits: VisitData[],
  legs: Array<{ fromVisitId: string | null; toVisitId: string; travelMinutes: number | null }>,
): SchedulingConflict[] {
  const byId = new Map(visits.map((visit) => [visit.id, visit]));
  const conflicts: SchedulingConflict[] = [];
  for (const leg of legs) {
    if (leg.fromVisitId === null) continue;
    const from = byId.get(leg.fromVisitId);
    const to = byId.get(leg.toVisitId);
    if (!from || !to) continue;
    const availableMinutes = Math.floor(
      (to.plannedStart.getTime() - from.plannedEnd.getTime()) / 60_000,
    );
    if (leg.travelMinutes === null) {
      conflicts.push({
        code: 'travel_feasibility_unknown',
        severity: 'warning',
        visitId: to.id,
        relatedVisitId: from.id,
      });
    } else if (leg.travelMinutes > availableMinutes) {
      conflicts.push({
        code: 'insufficient_travel_time',
        severity: 'blocking',
        visitId: to.id,
        relatedVisitId: from.id,
        requiredMinutes: leg.travelMinutes,
        availableMinutes: Math.max(0, availableMinutes),
      });
    }
  }
  return conflicts;
}

export function sameTourDate(visit: VisitData, localDate: string, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(visit.plannedStart);
  const date = `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
  return date === localDate;
}

export class InvalidTourError extends Error {
  readonly code = 'SCHEDULING_TOUR_INVALID';
  constructor() {
    super('Tour or stop order is invalid');
    this.name = 'InvalidTourError';
  }
}

export class TourVersionConflictError extends Error {
  readonly code = 'SCHEDULING_VERSION_CONFLICT';
  constructor() {
    super('Tour version changed before the update was applied');
    this.name = 'TourVersionConflictError';
  }
}

export class ExecutedVisitSubstitutionError extends Error {
  readonly code = 'VISIT_EXECUTION_PLANNING_LOCKED';
  constructor() {
    super('An executed visit cannot be reassigned');
    this.name = 'ExecutedVisitSubstitutionError';
  }
}
