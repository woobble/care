import type { SchedulingConflict } from '@module/scheduling/domain/tour';

export class VisitExecutionPlanningLockedError extends Error {
  readonly code = 'VISIT_EXECUTION_PLANNING_LOCKED';

  constructor() {
    super('Scheduling changes are locked after visit execution starts');
    this.name = 'VisitExecutionPlanningLockedError';
  }
}

export class VisitNotFoundError extends Error {
  readonly code = 'VISIT_NOT_FOUND';
  constructor() {
    super('Visit was not found');
    this.name = 'VisitNotFoundError';
  }
}

export class VisitOutsideProviderContextError extends Error {
  readonly code = 'VISIT_OUTSIDE_PROVIDER_CONTEXT';
  constructor() {
    super('Client is not available through an active provider context');
    this.name = 'VisitOutsideProviderContextError';
  }
}

export class VisitEmployeeConflictError extends Error {
  readonly code = 'VISIT_EMPLOYEE_CONFLICT';
  constructor(
    readonly plannedStart: Date,
    readonly plannedEnd: Date,
    readonly timezone: string,
  ) {
    super('Employee already has an overlapping planned visit');
    this.name = 'VisitEmployeeConflictError';
  }
}

export class VisitEmployeeUnavailableError extends Error {
  readonly code = 'VISIT_EMPLOYEE_NOT_AVAILABLE';
  constructor() {
    super('Employee is unavailable during the visit time');
    this.name = 'VisitEmployeeUnavailableError';
  }
}

export class VisitOutsideEmployeeAvailabilityError extends Error {
  readonly code = 'VISIT_OUTSIDE_EMPLOYEE_AVAILABILITY';

  constructor() {
    super('Visit falls outside the employee working availability');
    this.name = 'VisitOutsideEmployeeAvailabilityError';
  }
}

export class VisitTravelBufferConflictError extends Error {
  readonly code = 'VISIT_TRAVEL_BUFFER_CONFLICT';

  constructor() {
    super('There is not enough time for the configured travel buffer between visits');
    this.name = 'VisitTravelBufferConflictError';
  }
}

export class VisitDailyPlanLimitError extends Error {
  readonly code = 'VISIT_DAILY_PLAN_LIMIT';

  constructor(readonly maxDailyMinutes: number) {
    super(`The employee's planned daily minutes would exceed ${maxDailyMinutes}`);
    this.name = 'VisitDailyPlanLimitError';
  }
}

export class ActiveVisitSubstitutionError extends Error {
  readonly code = 'VISIT_SUBSTITUTION_ACTIVE';
  constructor() {
    super('A visit already has a proposed substitute');
    this.name = 'ActiveVisitSubstitutionError';
  }
}

export class TourNotFoundError extends Error {
  readonly code = 'SCHEDULING_TOUR_NOT_FOUND';
  constructor() {
    super('Tour was not found');
    this.name = 'TourNotFoundError';
  }
}

export class SchedulingConflictsError extends Error {
  readonly code = 'SCHEDULING_CONFLICT';
  constructor(readonly conflicts: SchedulingConflict[]) {
    super('Tour cannot be published while blocking travel conflicts remain');
    this.name = 'SchedulingConflictsError';
  }
}
