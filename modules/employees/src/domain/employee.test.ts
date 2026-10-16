import { describe, expect, test } from 'bun:test';

import {
  isValidDateRange,
  InvalidEmployeeTransitionError,
  transitionEmployeeStatus,
} from './employee';

describe('employee lifecycle', () => {
  test('activates and deactivates employees but does not reopen an archived record', () => {
    expect(transitionEmployeeStatus('inactive', 'activate')).toBe('active');
    expect(transitionEmployeeStatus('active', 'deactivate')).toBe('inactive');
    expect(transitionEmployeeStatus('active', 'archive')).toBe('archived');
    expect(() => transitionEmployeeStatus('archived', 'activate')).toThrow(
      InvalidEmployeeTransitionError,
    );
    expect(() => transitionEmployeeStatus('archived', 'deactivate')).toThrow(
      InvalidEmployeeTransitionError,
    );
  });

  test('accepts open and ordered validity ranges and rejects reversed ranges', () => {
    expect(isValidDateRange(null, null)).toBe(true);
    expect(isValidDateRange('2026-01-01', null)).toBe(true);
    expect(isValidDateRange('2026-01-01', '2026-01-31')).toBe(true);
    expect(isValidDateRange('2026-02-01', '2026-01-31')).toBe(false);
  });
});
