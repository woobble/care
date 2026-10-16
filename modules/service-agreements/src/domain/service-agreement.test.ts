import { describe, expect, test } from 'bun:test';

import {
  AgreementService,
  AgreementServiceAlreadyEndedError,
  AgreementServiceInvalidQuantityError,
  AgreementServiceInvalidValidityError,
  InvalidScheduleRuleError,
  ServiceAgreement,
  ServiceAgreementAlreadyEndedError,
  ServiceAgreementInvalidStatusError,
  ServiceAgreementInvalidValidityError,
  validateAgreementServiceFields,
  type AgreementServiceFields,
} from './service-agreement';

const agreementInput = {
  id: '0199b2d2-8e00-7000-8000-000000000001',
  tenantId: '0199b2d2-8e00-7000-8000-000000000002',
  clientId: '0199b2d2-8e00-7000-8000-000000000003',
  organizationId: '0199b2d2-8e00-7000-8000-000000000004',
  facilityId: '0199b2d2-8e00-7000-8000-000000000005',
  validFrom: '2030-01-01',
  validUntil: '2030-01-01',
  createdAt: new Date('2029-01-01T00:00:00.000Z'),
  updatedAt: new Date('2029-01-01T00:00:00.000Z'),
};

const serviceFields: AgreementServiceFields = {
  validFrom: null,
  validUntil: null,
  quantity: null,
  note: null,
  scheduleRule: null,
  preferredTimeStart: null,
  preferredTimeEnd: null,
};

function agreement() {
  return ServiceAgreement.create(agreementInput);
}

function agreementService() {
  return AgreementService.create({
    id: '0199b2d2-8e00-7000-8000-000000000006',
    tenantId: agreementInput.tenantId,
    agreementId: agreementInput.id,
    serviceDefinitionId: '0199b2d2-8e00-7000-8000-000000000007',
    serviceCode: 'CARE-1',
    serviceName: 'Grundpflege',
    serviceUnit: 'occurrence',
    status: 'active',
    endedAt: null,
    ...serviceFields,
    createdAt: agreementInput.createdAt,
    updatedAt: agreementInput.updatedAt,
  });
}

describe('service agreement domain', () => {
  test('accepts future agreements and inclusive same-day validity', () => {
    expect(agreement().snapshot).toMatchObject({
      status: 'draft',
      validFrom: '2030-01-01',
      validUntil: '2030-01-01',
    });
  });

  test('rejects impossible dates and reversed agreement periods', () => {
    expect(() => agreement().update({ validFrom: '2030-02-30' })).toThrow(
      ServiceAgreementInvalidValidityError,
    );
    expect(() => ServiceAgreement.create({ ...agreementInput, validFrom: '2030-01-02' })).toThrow(
      ServiceAgreementInvalidValidityError,
    );
  });

  test('allows the explicit lifecycle and prevents reactivation after ending', () => {
    const value = agreement();
    value.activate();
    expect(value.snapshot.status).toBe('active');
    value.suspend();
    expect(value.snapshot.status).toBe('suspended');
    value.resume();
    expect(value.snapshot.status).toBe('active');
    value.end();
    expect(value.snapshot.status).toBe('ended');
    expect(() => value.resume()).toThrow(ServiceAgreementAlreadyEndedError);
    expect(() => value.activate()).toThrow(ServiceAgreementAlreadyEndedError);
  });

  test('rejects lifecycle transitions from the wrong state', () => {
    expect(() => agreement().resume()).toThrow(ServiceAgreementInvalidStatusError);
    const active = agreement();
    active.activate();
    expect(() => active.activate()).toThrow(ServiceAgreementInvalidStatusError);
  });

  test('validates schedule variants, time preferences, and unit-aware quantities', () => {
    expect(() =>
      validateAgreementServiceFields(
        {
          ...serviceFields,
          quantity: '1.25',
          scheduleRule: { type: 'weekly', weekdays: ['monday', 'monday'] },
        },
        'minute',
      ),
    ).toThrow(InvalidScheduleRuleError);
    expect(() =>
      validateAgreementServiceFields(
        { ...serviceFields, scheduleRule: { type: 'occurrences_per_week', count: 0 } },
        'occurrence',
      ),
    ).toThrow(InvalidScheduleRuleError);
    expect(() =>
      validateAgreementServiceFields(
        { ...serviceFields, preferredTimeStart: '09:00', preferredTimeEnd: null },
        'minute',
      ),
    ).toThrow(AgreementServiceInvalidValidityError);
    expect(() =>
      validateAgreementServiceFields({ ...serviceFields, quantity: '1.5' }, 'occurrence'),
    ).toThrow(AgreementServiceInvalidQuantityError);
    expect(() =>
      validateAgreementServiceFields({ ...serviceFields, quantity: '0.001' }, 'minute'),
    ).not.toThrow();
  });

  test('retains ended service lines and prevents later edits', () => {
    const line = agreementService();
    line.end(new Date('2030-01-01T12:00:00.000Z'));
    expect(line.snapshot).toMatchObject({
      status: 'ended',
      endedAt: new Date('2030-01-01T12:00:00.000Z'),
    });
    expect(() => line.update(serviceFields)).toThrow(AgreementServiceAlreadyEndedError);
  });
});
