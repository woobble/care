import { describe, expect, test } from 'bun:test';
import { evaluateRequirements, qualificationIsValidAt } from './competency-policy';

describe('professional competency requirements', () => {
  test('ANY allows a valid listed qualification', () => {
    expect(evaluateRequirements('ANY', ['a', 'b'], new Set(['b']))).toEqual({
      allowed: true,
      matchedQualificationIds: ['b'],
      missingQualificationIds: ['a'],
    });
  });

  test('ALL requires every listed qualification', () => {
    expect(evaluateRequirements('ALL', ['a', 'b'], new Set(['a']))).toEqual({
      allowed: false,
      matchedQualificationIds: ['a'],
      missingQualificationIds: ['b'],
    });
  });

  test('empty requirements fail closed for both modes', () => {
    expect(evaluateRequirements('ANY', [], new Set()).allowed).toBe(false);
    expect(evaluateRequirements('ALL', [], new Set()).allowed).toBe(false);
  });

  test('date bounds are inclusive and absent bounds are open-ended', () => {
    expect(qualificationIsValidAt('2026-01-01', '2026-12-31', '2026-01-01')).toBe(true);
    expect(qualificationIsValidAt('2026-01-01', '2026-12-31', '2026-12-31')).toBe(true);
    expect(qualificationIsValidAt('2026-01-01', null, '2026-01-01')).toBe(true);
    expect(qualificationIsValidAt(null, '2026-12-31', '2026-12-31')).toBe(true);
  });

  test('future and expired qualifications are invalid', () => {
    expect(qualificationIsValidAt('2026-10-09', null, '2026-10-08')).toBe(false);
    expect(qualificationIsValidAt(null, '2026-10-07', '2026-10-08')).toBe(false);
  });
});
