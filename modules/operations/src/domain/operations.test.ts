import { describe, expect, test } from 'bun:test';
import { evidenceIssueCode, evidencePackageIssueCode, stableIssueId } from './operations';

describe('operations issue projections', () => {
  test('keeps derived issue identities stable for the same source condition', () => {
    expect(stableIssueId('scheduling', 'visit', 'visit-1', 'missing_assignment')).toBe(
      stableIssueId('scheduling', 'visit', 'visit-1', 'missing_assignment'),
    );
    expect(stableIssueId('scheduling', 'visit', 'visit-1', 'missing_assignment')).not.toBe(
      stableIssueId('scheduling', 'visit', 'visit-1', 'employee_absence'),
    );
  });

  test('does not project acknowledgement issues without an evidence package', () => {
    expect(
      evidenceIssueCode(
        { status: 'awaiting_acknowledgement', evidencePackageId: null, signatureAvailable: false },
        true,
      ),
    ).toBeNull();
  });

  test('projects only required pending acknowledgements and accepts acknowledged evidence without a signature', () => {
    expect(
      evidenceIssueCode(
        {
          status: 'awaiting_acknowledgement',
          evidencePackageId: 'package-1',
          signatureAvailable: false,
        },
        true,
      ),
    ).toBe('acknowledgement_missing');
    expect(
      evidenceIssueCode(
        {
          status: 'awaiting_acknowledgement',
          evidencePackageId: 'package-1',
          signatureAvailable: false,
        },
        false,
      ),
    ).toBeNull();
    expect(
      evidenceIssueCode(
        { status: 'acknowledged', evidencePackageId: 'package-1', signatureAvailable: false },
        false,
      ),
    ).toBeNull();
  });

  test('maps current evidence package states to the same issue codes as the worklist', () => {
    expect(evidencePackageIssueCode('ready')).toBe('acknowledgement_missing');
    expect(evidencePackageIssueCode('declined')).toBe('acknowledgement_declined');
    expect(evidencePackageIssueCode('revoked')).toBe('acknowledgement_revoked');
    expect(evidencePackageIssueCode('outdated')).toBe('evidence_outdated');
    expect(evidencePackageIssueCode('acknowledged')).toBeNull();
  });
});
