import { describe, expect, test } from 'bun:test';

import {
  canonicalEvidenceSnapshot,
  canonicalSignature,
  hashEvidenceSnapshot,
  hashSignatureArtifact,
  isRepresentativeAuthorizedAt,
  isTypedConfirmationValid,
  normalizeQuantity,
  SignatureTooLargeError,
  verifyEvidenceSnapshot,
  type EvidenceSnapshot,
} from './service-evidence';

const baseSnapshot: EvidenceSnapshot = {
  snapshotVersion: 1,
  tenantId: 'tenant-1',
  clientId: 'client-1',
  clientName: 'Ada Example',
  visitId: 'visit-1',
  plannedStart: '2026-10-07T08:00:00.000Z',
  timezone: 'Europe/Berlin',
  executionId: 'execution-1',
  executionVersion: 3,
  actualStart: '2026-10-07T06:03:00.000Z',
  actualEnd: '2026-10-07T06:42:00.000Z',
  documentationId: 'documentation-1',
  documentationVersion: 2,
  amendmentCount: 0,
  items: [
    {
      performedServiceId: 'performed-2',
      serviceCode: 'CARE-2',
      serviceName: 'Abendpflege',
      unit: 'occurrence',
      plannedQuantity: '1.000',
      actualQuantity: '1.000',
      outcome: 'performed',
      reasonCode: null,
      performedByEmployeeId: 'employee-1',
      evidenceState: 'documented',
    },
    {
      performedServiceId: 'performed-1',
      serviceCode: 'CARE-1',
      serviceName: 'Morgenpflege',
      unit: 'occurrence',
      plannedQuantity: '1.000',
      actualQuantity: '1.000',
      outcome: 'performed',
      reasonCode: null,
      performedByEmployeeId: 'employee-1',
      evidenceState: 'documented',
    },
  ],
};

describe('service evidence snapshots', () => {
  test('canonicalizes item order and hashes deterministically', () => {
    const reordered = { ...baseSnapshot, items: [...baseSnapshot.items].reverse() };
    expect(canonicalEvidenceSnapshot(baseSnapshot)).toBe(canonicalEvidenceSnapshot(reordered));
    expect(hashEvidenceSnapshot(baseSnapshot)).toBe(hashEvidenceSnapshot(reordered));
  });

  test('changes hash when a service fact or source version changes', () => {
    const quantityChanged = {
      ...baseSnapshot,
      items: baseSnapshot.items.map((item) =>
        item.performedServiceId === 'performed-1' ? { ...item, actualQuantity: '0.5' } : item,
      ),
    };
    const versionChanged = { ...baseSnapshot, documentationVersion: 3 };
    expect(hashEvidenceSnapshot(quantityChanged)).not.toBe(hashEvidenceSnapshot(baseSnapshot));
    expect(hashEvidenceSnapshot(versionChanged)).not.toBe(hashEvidenceSnapshot(baseSnapshot));
  });

  test('verifies stored snapshot hashes and rejects tampering', () => {
    const hash = hashEvidenceSnapshot(baseSnapshot);
    expect(verifyEvidenceSnapshot(baseSnapshot, hash)).toBe(true);
    expect(verifyEvidenceSnapshot({ ...baseSnapshot, clientName: 'Changed Name' }, hash)).toBe(
      false,
    );
  });

  test('normalizes numeric quantities without floating point conversion', () => {
    expect(normalizeQuantity('0001.2300')).toBe('1.23');
    expect(normalizeQuantity('0.000')).toBe('0');
    expect(normalizeQuantity(null)).toBeNull();
  });
});

describe('signature capture', () => {
  test('stores bounded normalized strokes with a stable hash', () => {
    const strokes = [
      [
        { x: 0.1, y: 0.2 },
        { x: 0.5, y: 0.4 },
        { x: 0.8, y: 0.7 },
      ],
    ];
    const first = canonicalSignature(strokes);
    const second = canonicalSignature(strokes);
    expect(first).toEqual(second);
    expect(hashSignatureArtifact(first)).toBe(hashSignatureArtifact(second));
  });

  test('rejects empty and out-of-bounds strokes', () => {
    expect(() => canonicalSignature([])).toThrow('visible stroke');
    expect(() =>
      canonicalSignature([
        [
          { x: 0.1, y: 0.1 },
          { x: 0.1, y: 0.1001 },
        ],
      ]),
    ).toThrow('visible stroke');
    expect(() =>
      canonicalSignature([
        [
          { x: -0.1, y: 0.1 },
          { x: 0.5, y: 0.5 },
        ],
      ]),
    ).toThrow('invalid coordinates');
  });

  test('rejects signatures over the stroke limit as oversized', () => {
    const stroke = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
    ];
    expect(() => canonicalSignature(Array.from({ length: 33 }, () => stroke))).toThrow(
      SignatureTooLargeError,
    );
  });

  test('requires the signatory to confirm the selected name', () => {
    expect(isTypedConfirmationValid('Ada Example', ' ada   example ')).toBe(true);
    expect(isTypedConfirmationValid('Ada Example', 'Other Person')).toBe(false);
  });
});

describe('representative eligibility', () => {
  const representative = {
    roles: ['legal_representative'],
    representationType: 'power_of_attorney' as const,
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
  };

  test('requires an active representative role and covers both validity dates', () => {
    expect(isRepresentativeAuthorizedAt(representative, '2026-01-01')).toBe(true);
    expect(isRepresentativeAuthorizedAt(representative, '2026-12-31')).toBe(true);
    expect(isRepresentativeAuthorizedAt(representative, '2025-12-31')).toBe(false);
    expect(isRepresentativeAuthorizedAt(representative, '2027-01-01')).toBe(false);
    expect(
      isRepresentativeAuthorizedAt(
        { ...representative, roles: ['emergency_contact'] },
        '2026-06-01',
      ),
    ).toBe(false);
    expect(
      isRepresentativeAuthorizedAt({ ...representative, representationType: null }, '2026-06-01'),
    ).toBe(false);
  });
});
