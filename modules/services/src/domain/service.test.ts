import { describe, expect, test } from 'bun:test';
import {
  InvalidServiceAvailabilityError,
  InvalidServiceCategoryError,
  InvalidServiceDefinitionError,
  ServiceDefinition,
  ServiceDefinitionArchivedError,
  validateServiceAvailability,
  validateServiceCategory,
  validateServiceDefinition,
} from './service';

const serviceData = {
  id: '0199b2d2-8e00-7000-8000-000000000001',
  tenantId: '0199b2d2-8e00-7000-8000-000000000002',
  code: 'CARE-01',
  name: 'Morning care',
  categoryId: '0199b2d2-8e00-7000-8000-000000000003',
  unit: 'occurrence' as const,
  validFrom: '2026-01-01',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('service catalog domain', () => {
  test('rejects an invalid unit and validity range', () => {
    expect(() => validateServiceDefinition({ ...serviceData, unit: 'visit' as never })).toThrow(
      InvalidServiceDefinitionError,
    );
    expect(() => validateServiceDefinition({ ...serviceData, validUntil: '2025-12-31' })).toThrow(
      InvalidServiceDefinitionError,
    );
  });

  test('rejects empty category codes', () => {
    expect(() => validateServiceCategory({ name: 'Basic Care', code: '   ' })).toThrow(
      InvalidServiceCategoryError,
    );
  });

  test('requires a valid availability range', () => {
    expect(() =>
      validateServiceAvailability({
        organizationId: '0199b2d2-8e00-7000-8000-000000000004',
        active: true,
        validFrom: '2026-05-01',
        validUntil: '2026-05-01',
      }),
    ).toThrow(InvalidServiceAvailabilityError);
  });

  test('archives services without allowing them to be edited again', () => {
    const service = ServiceDefinition.create(serviceData);
    service.archive(new Date('2026-02-01T00:00:00Z'));
    expect(service.snapshot.status).toBe('archived');
    expect(() => service.update(serviceData)).toThrow(ServiceDefinitionArchivedError);
  });
});
