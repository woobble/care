export class BenefitClientNotFoundError extends Error {
  readonly code = 'BENEFIT_CLIENT_NOT_FOUND';

  constructor() {
    super('Client was not found');
    this.name = 'BenefitClientNotFoundError';
  }
}

export class BenefitFundingSourceNotFoundError extends Error {
  readonly code = 'BENEFIT_FUNDING_SOURCE_NOT_FOUND';

  constructor() {
    super('Funding source was not found');
    this.name = 'BenefitFundingSourceNotFoundError';
  }
}

export class BenefitEntitlementNotFoundError extends Error {
  readonly code = 'BENEFIT_ENTITLEMENT_NOT_FOUND';

  constructor() {
    super('Benefit entitlement was not found');
    this.name = 'BenefitEntitlementNotFoundError';
  }
}

export class BenefitEntitlementVersionConflictError extends Error {
  readonly code = 'BENEFIT_ENTITLEMENT_VERSION_CONFLICT';

  constructor() {
    super('Benefit entitlement changed since it was loaded');
    this.name = 'BenefitEntitlementVersionConflictError';
  }
}

export class BenefitEntitlementPeriodConflictError extends Error {
  readonly code = 'BENEFIT_ENTITLEMENT_PERIOD_CONFLICT';

  constructor() {
    super('Statutory benefit entitlement periods cannot overlap');
    this.name = 'BenefitEntitlementPeriodConflictError';
  }
}

export class BenefitAllocationNotFoundError extends Error {
  readonly code = 'BENEFIT_ALLOCATION_NOT_FOUND';

  constructor() {
    super('Service allocation was not found');
    this.name = 'BenefitAllocationNotFoundError';
  }
}

export class InvalidBenefitFundingSourceError extends Error {
  readonly code = 'INVALID_BENEFIT_FUNDING_SOURCE';

  constructor() {
    super('Funding source values are invalid or inconsistent with client insurance');
    this.name = 'InvalidBenefitFundingSourceError';
  }
}

export class InvalidBenefitEntitlementError extends Error {
  readonly code = 'INVALID_BENEFIT_ENTITLEMENT';

  constructor() {
    super('Benefit entitlement values or status are invalid');
    this.name = 'InvalidBenefitEntitlementError';
  }
}

export class InvalidBenefitAdjustmentError extends Error {
  readonly code = 'INVALID_BENEFIT_ADJUSTMENT';

  constructor() {
    super('Benefit adjustment values are invalid');
    this.name = 'InvalidBenefitAdjustmentError';
  }
}

export class BenefitBudgetInsufficientError extends Error {
  readonly code = 'BENEFIT_BUDGET_INSUFFICIENT';

  constructor(readonly missingAmountCents: number) {
    super('The selected verified benefit balance is insufficient');
    this.name = 'BenefitBudgetInsufficientError';
  }
}

export class BenefitServiceNotEligibleError extends Error {
  readonly code = 'BENEFIT_SERVICE_NOT_ELIGIBLE';

  constructor(readonly reasonCode: string) {
    super('The service is not eligible for the selected benefit');
    this.name = 'BenefitServiceNotEligibleError';
  }
}

export class BenefitAllocationConflictError extends Error {
  readonly code = 'BENEFIT_ALLOCATION_CONFLICT';

  constructor() {
    super(
      'Service allocations exceed the available service amount or conflict with prior allocation',
    );
    this.name = 'BenefitAllocationConflictError';
  }
}

export class BenefitAdjustmentConflictError extends Error {
  readonly code = 'BENEFIT_ADJUSTMENT_CONFLICT';

  constructor() {
    super('Budget adjustment idempotency key was already used with different values');
    this.name = 'BenefitAdjustmentConflictError';
  }
}

export class BenefitAllocationAlreadyReversedError extends Error {
  readonly code = 'BENEFIT_ALLOCATION_ALREADY_REVERSED';

  constructor() {
    super('Service allocation has already been reversed');
    this.name = 'BenefitAllocationAlreadyReversedError';
  }
}

export class InvalidBenefitWorklistQueryError extends Error {
  readonly code = 'INVALID_BENEFIT_WORKLIST_QUERY';

  constructor() {
    super('Benefit worklist query is invalid');
    this.name = 'InvalidBenefitWorklistQueryError';
  }
}

export class BenefitProviderRecognitionRequiredError extends Error {
  readonly code = 'BENEFIT_PROVIDER_RECOGNITION_REQUIRED';

  constructor() {
    super('A valid provider recognition is required for this statutory allocation');
    this.name = 'BenefitProviderRecognitionRequiredError';
  }
}

export class InvalidProviderRecognitionError extends Error {
  readonly code = 'INVALID_PROVIDER_RECOGNITION';

  constructor() {
    super('Provider recognition values are invalid');
    this.name = 'InvalidProviderRecognitionError';
  }
}

export class ProviderRecognitionNotFoundError extends Error {
  readonly code = 'PROVIDER_RECOGNITION_NOT_FOUND';

  constructor() {
    super('Provider recognition was not found');
    this.name = 'ProviderRecognitionNotFoundError';
  }
}
