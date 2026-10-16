import { describe, expect, test } from 'bun:test';

import { contactAuthorizationFor } from './contact-authorization';

describe('contact authorization snapshot', () => {
  const today = '2026-10-10';

  test('requires an explicit authorized role and a current representation for legal representatives', () => {
    expect(
      contactAuthorizationFor({
        roles: ['primary_contact'],
        representationType: 'power_of_attorney',
        validFrom: null,
        validUntil: null,
        today,
      }),
    ).toBe('not_confirmed');
    expect(
      contactAuthorizationFor({
        roles: ['authorized_contact'],
        representationType: null,
        validFrom: null,
        validUntil: null,
        today,
      }),
    ).toBe('authorized_contact');
    expect(
      contactAuthorizationFor({
        roles: ['legal_representative'],
        representationType: null,
        validFrom: null,
        validUntil: null,
        today,
      }),
    ).toBe('not_confirmed');
  });

  test('does not treat expired or future representation as current', () => {
    expect(
      contactAuthorizationFor({
        roles: ['legal_representative'],
        representationType: 'legal_guardianship',
        validFrom: '2026-10-11',
        validUntil: null,
        today,
      }),
    ).toBe('not_confirmed');
    expect(
      contactAuthorizationFor({
        roles: ['legal_representative'],
        representationType: 'legal_guardianship',
        validFrom: null,
        validUntil: '2026-10-09',
        today,
      }),
    ).toBe('not_confirmed');
  });

  test('records the strongest current explicit role', () => {
    const representation = {
      representationType: 'power_of_attorney',
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      today,
    };
    expect(contactAuthorizationFor({ roles: ['authorized_contact'], ...representation })).toBe(
      'authorized_contact',
    );
    expect(
      contactAuthorizationFor({
        roles: ['authorized_contact', 'legal_representative'],
        ...representation,
      }),
    ).toBe('legal_representative');
    expect(
      contactAuthorizationFor({
        roles: ['authorized_contact', 'legal_representative'],
        representationType: 'legal_guardianship',
        validFrom: null,
        validUntil: '2026-10-09',
        today,
      }),
    ).toBe('authorized_contact');
  });
});
