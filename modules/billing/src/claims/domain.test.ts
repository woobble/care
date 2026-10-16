import { describe, expect, test } from 'bun:test';

import { assertClaimDecision, isAllowedClaimTransition } from './domain';

describe('payer claim lifecycle', () => {
  test('keeps submission, payer acceptance, and resubmission as separate transitions', () => {
    expect(isAllowedClaimTransition('draft', 'ready')).toBe(true);
    expect(isAllowedClaimTransition('ready', 'submitted')).toBe(true);
    expect(isAllowedClaimTransition('submitted', 'accepted')).toBe(true);
    expect(isAllowedClaimTransition('submitted', 'clarification_required')).toBe(true);
    expect(isAllowedClaimTransition('clarification_required', 'resubmitted')).toBe(true);
    expect(isAllowedClaimTransition('draft', 'submitted')).toBe(false);
    expect(isAllowedClaimTransition('accepted', 'resubmitted')).toBe(false);
  });

  test('validates line-level partial decisions against the immutable claim amount', () => {
    expect(() =>
      assertClaimDecision({
        decision: 'partially_accepted',
        decisionDate: '2026-10-10',
        acceptedCents: 7_000,
        rejectedCents: 3_000,
        amountCents: 10_000,
        claimLines: [
          { id: 'line-a', amountCents: 6_000 },
          { id: 'line-b', amountCents: 4_000 },
        ],
        lines: [
          { claimLineId: 'line-a', acceptedCents: 6_000, rejectedCents: 0 },
          { claimLineId: 'line-b', acceptedCents: 1_000, rejectedCents: 3_000 },
        ],
      }),
    ).not.toThrow();
  });

  test('rejects unexplained short or excessive line decisions', () => {
    expect(() =>
      assertClaimDecision({
        decision: 'partially_accepted',
        decisionDate: '2026-10-10',
        acceptedCents: 7_000,
        rejectedCents: 2_000,
        amountCents: 10_000,
        claimLines: [{ id: 'line-a', amountCents: 10_000 }],
        lines: [{ claimLineId: 'line-a', acceptedCents: 7_000, rejectedCents: 2_000 }],
      }),
    ).toThrow();
    expect(() =>
      assertClaimDecision({
        decision: 'accepted',
        decisionDate: '2026-10-10',
        acceptedCents: 11_000,
        rejectedCents: 0,
        amountCents: 10_000,
        claimLines: [{ id: 'line-a', amountCents: 10_000 }],
        lines: [{ claimLineId: 'line-a', acceptedCents: 11_000, rejectedCents: 0 }],
      }),
    ).toThrow();
  });
});
