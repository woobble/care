import type { ServiceUnit } from './service';

export type ServicePricingUnit = 'hour' | 'minute' | 'visit' | 'fixed';

export interface ServicePriceInput {
  serviceId: string;
  organizationId: string;
  facilityId?: string | null;
  priceCents: number;
  pricingUnit: ServicePricingUnit;
  validFrom: string;
  validUntil?: string | null;
}

export interface ServicePriceSnapshot extends ServicePriceInput {
  id: string;
  tenantId: string;
  facilityId: string | null;
  validUntil: string | null;
  createdBy: string;
  createdAt: Date;
}

export function selectEffectiveServicePrice(
  prices: readonly ServicePriceSnapshot[],
  input: { facilityId?: string | null },
): ServicePriceSnapshot | undefined {
  return (
    (input.facilityId
      ? prices.find((price) => price.facilityId === input.facilityId)
      : undefined) ?? prices.find((price) => price.facilityId === null)
  );
}

export function validateServicePrice(input: ServicePriceInput): void {
  if (
    !input.serviceId ||
    !input.organizationId ||
    (input.facilityId !== undefined && input.facilityId !== null && !input.facilityId) ||
    !Number.isSafeInteger(input.priceCents) ||
    input.priceCents <= 0 ||
    !(['hour', 'minute', 'visit', 'fixed'] as const).includes(input.pricingUnit) ||
    !isIsoDate(input.validFrom) ||
    (input.validUntil !== undefined && input.validUntil !== null && !isIsoDate(input.validUntil)) ||
    (input.validUntil !== undefined &&
      input.validUntil !== null &&
      input.validUntil <= input.validFrom)
  ) {
    throw new InvalidServicePriceError();
  }
}

export function calculateServicePriceCents(
  priceCents: number,
  pricingUnit: ServicePricingUnit,
  serviceUnit: ServiceUnit,
  quantity: string,
): number {
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
    throw new InvalidServicePriceError();
  }
  if (pricingUnit === 'fixed') return priceCents;
  if (
    (pricingUnit === 'visit' && serviceUnit !== 'occurrence') ||
    (pricingUnit !== 'visit' && pricingUnit !== serviceUnit)
  ) {
    throw new ServicePricingUnitMismatchError();
  }

  const match = /^(0|[1-9]\d*)(?:\.(\d{1,3}))?$/.exec(quantity);
  if (!match) throw new InvalidServicePriceQuantityError();
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? '').padEnd(3, '0') || '0');
  const milliUnits = whole * 1000n + fraction;
  if (milliUnits <= 0n) throw new InvalidServicePriceQuantityError();

  // Service quantities are stored to three decimal places; round half up to a cent.
  const cents = (BigInt(priceCents) * milliUnits + 500n) / 1000n;
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidServicePriceQuantityError();
  }
  return Number(cents);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export class InvalidServicePriceError extends Error {
  readonly code = 'INVALID_SERVICE_PRICE';

  constructor() {
    super('Service price values or validity period are invalid');
    this.name = 'InvalidServicePriceError';
  }
}

export class InvalidServicePriceQuantityError extends Error {
  readonly code = 'INVALID_SERVICE_PRICE_QUANTITY';

  constructor() {
    super('Service quantity cannot be priced');
    this.name = 'InvalidServicePriceQuantityError';
  }
}

export class ServicePricingUnitMismatchError extends Error {
  readonly code = 'SERVICE_PRICING_UNIT_MISMATCH';

  constructor() {
    super('The service price unit does not match the service quantity unit');
    this.name = 'ServicePricingUnitMismatchError';
  }
}

export class ServicePriceScopeDeniedError extends Error {
  readonly code = 'SERVICE_PRICE_SCOPE_DENIED';

  constructor() {
    super('The service price is outside the authorized provider scope');
    this.name = 'ServicePriceScopeDeniedError';
  }
}

export class ServicePriceNotFoundError extends Error {
  readonly code = 'SERVICE_PRICE_NOT_FOUND';

  constructor() {
    super('No service price is effective for the requested context and date');
    this.name = 'ServicePriceNotFoundError';
  }
}

export class ServicePriceConflictError extends Error {
  readonly code = 'SERVICE_PRICE_PERIOD_CONFLICT';

  constructor() {
    super('Service price periods cannot overlap for the same provider scope');
    this.name = 'ServicePriceConflictError';
  }
}
