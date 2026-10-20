export class InvalidOperationsInputError extends Error {
  readonly code = 'OPERATIONS_INVALID_INPUT';
  constructor() {
    super('The operations request is invalid');
  }
}

export class OperationsTaskNotFoundError extends Error {
  readonly code = 'OPERATIONS_TASK_NOT_FOUND';
  constructor() {
    super('The task was not found');
  }
}

export class OperationsSourceNotFoundError extends Error {
  readonly code = 'OPERATIONS_SOURCE_NOT_FOUND';
  constructor() {
    super('The referenced source record was not found');
  }
}

export class OperationsTaskVersionConflictError extends Error {
  readonly code = 'OPERATIONS_TASK_VERSION_CONFLICT';
  constructor() {
    super('The task changed in another Office session');
  }
}

export class OperationsTaskStateError extends Error {
  readonly code = 'OPERATIONS_TASK_INVALID_STATE';
  constructor() {
    super('The task cannot make the requested transition');
  }
}
