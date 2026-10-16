import { describe, expect, test } from 'bun:test';

import {
  InvalidClientAddressError,
  InvalidClientContactError,
  InvalidClientInsuranceError,
  InvalidPflegegradError,
  validateClientAddress,
  validateClientContact,
  validateClientInsurance,
  validatePflegegrad,
} from './client-master-data';

describe('client master data validation', () => {
  test('accepts international addresses and rejects malformed validity', () => {
    expect(() =>
      validateClientAddress({
        addressType: 'home',
        street: 'Rue de Rivoli',
        city: 'Paris',
        countryCode: 'FR',
        validFrom: '2026-01-01',
        validUntil: '2025-12-31',
        isPrimary: true,
      }),
    ).toThrow(InvalidClientAddressError);
    expect(() =>
      validateClientAddress({
        addressType: 'home',
        street: 'Rue de Rivoli',
        city: 'Paris',
        countryCode: 'FR',
        isPrimary: true,
      }),
    ).not.toThrow();
  });

  test('requires representation roles and unique contact roles', () => {
    expect(() =>
      validateClientContact({
        firstName: 'Grace',
        lastName: 'Hopper',
        relationshipType: 'relative',
        roles: ['primary_contact', 'primary_contact'],
      }),
    ).toThrow(InvalidClientContactError);
    expect(() =>
      validateClientContact({
        firstName: 'Grace',
        lastName: 'Hopper',
        relationshipType: 'legal_representative',
        representationType: 'power_of_attorney',
        roles: [],
      }),
    ).toThrow(InvalidClientContactError);
  });

  test('validates insurance date ranges', () => {
    expect(() =>
      validateClientInsurance({
        insuranceType: 'krankenversicherung',
        insurerName: 'Example',
        validFrom: '2026-05-01',
        validUntil: '2026-05-01',
        isPrimary: true,
      }),
    ).toThrow(InvalidClientInsuranceError);
  });

  test('accepts grades 1–5 and rejects grade zero and invalid dates', () => {
    expect(() =>
      validatePflegegrad({
        grade: 5,
        validFrom: '2030-01-01',
        status: 'pending',
      }),
    ).not.toThrow();
    expect(() =>
      validatePflegegrad({ grade: 0, validFrom: '2026-01-01', status: 'confirmed' }),
    ).toThrow(InvalidPflegegradError);
    expect(() =>
      validatePflegegrad({ grade: 2, validFrom: '2026-02-30', status: 'confirmed' }),
    ).toThrow(InvalidPflegegradError);
  });
});
