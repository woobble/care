import { describe, expect, test } from 'bun:test';

import {
  evaluateDocumentationCompleteness,
  normalizeDocumentationText,
  validateDocumentationEntry,
  validateServiceEvidence,
} from './care-documentation';

describe('care documentation completeness', () => {
  test('requires documentation and evidence for every performed service', () => {
    expect(
      evaluateDocumentationCompleteness({
        hasExecution: true,
        hasDocumentation: false,
        services: [
          {
            performedServiceId: 'service-1',
            status: 'performed',
            reasonCode: null,
            evidence: null,
          },
        ],
      }),
    ).toEqual({
      isComplete: false,
      missing: [
        { code: 'DOCUMENTATION_REQUIRED' },
        { code: 'SERVICE_EVIDENCE_REQUIRED', performedServiceId: 'service-1' },
      ],
    });
  });

  test('requires an explanation for a partial service without a reason code', () => {
    expect(
      evaluateDocumentationCompleteness({
        hasExecution: true,
        hasDocumentation: true,
        services: [
          {
            performedServiceId: 'service-2',
            status: 'partially_performed',
            reasonCode: null,
            evidence: { status: 'documented', note: ' ' },
          },
        ],
      }).missing,
    ).toEqual([{ code: 'PARTIAL_SERVICE_EXPLANATION_REQUIRED', performedServiceId: 'service-2' }]);
  });

  test('requires incident severity and occurrence time', () => {
    expect(() =>
      validateDocumentationEntry({ type: 'incident', content: 'A fall occurred.' }),
    ).toThrow();
  });

  test('requires a valid execution, documentation, and a reason for a service not performed', () => {
    expect(
      evaluateDocumentationCompleteness({
        hasExecution: false,
        hasDocumentation: false,
        services: [
          {
            performedServiceId: 'service-3',
            status: 'not_performed',
            reasonCode: null,
            evidence: null,
          },
        ],
      }).missing,
    ).toEqual([
      { code: 'VISIT_EXECUTION_REQUIRED' },
      { code: 'SERVICE_EVIDENCE_REQUIRED', performedServiceId: 'service-3' },
      { code: 'NOT_PERFORMED_REASON_REQUIRED', performedServiceId: 'service-3' },
    ]);

    expect(
      evaluateDocumentationCompleteness({
        hasExecution: true,
        hasDocumentation: true,
        services: [
          {
            performedServiceId: 'service-3',
            status: 'not_performed',
            reasonCode: null,
            evidence: { status: 'not_required', note: 'Client declined' },
          },
        ],
      }).missing,
    ).toEqual([{ code: 'NOT_PERFORMED_REASON_REQUIRED', performedServiceId: 'service-3' }]);
  });

  test('rechecks evidence when an execution outcome changes', () => {
    expect(
      evaluateDocumentationCompleteness({
        hasExecution: true,
        hasDocumentation: true,
        services: [
          {
            performedServiceId: 'service-4',
            status: 'performed',
            reasonCode: null,
            evidence: { status: 'not_required', note: 'Client declined' },
          },
          {
            performedServiceId: 'service-5',
            status: 'partially_performed',
            reasonCode: null,
            evidence: { status: 'not_required', note: 'Client declined' },
          },
        ],
      }).missing,
    ).toEqual([
      { code: 'SERVICE_EVIDENCE_REQUIRED', performedServiceId: 'service-4' },
      { code: 'SERVICE_EVIDENCE_REQUIRED', performedServiceId: 'service-5' },
      { code: 'PARTIAL_SERVICE_EXPLANATION_REQUIRED', performedServiceId: 'service-5' },
    ]);
  });

  test('allows complete evidence for performed, partial, and not-performed services', () => {
    expect(
      evaluateDocumentationCompleteness({
        hasExecution: true,
        hasDocumentation: true,
        services: [
          {
            performedServiceId: 'performed',
            status: 'performed',
            reasonCode: null,
            evidence: { status: 'documented', note: null },
          },
          {
            performedServiceId: 'partial',
            status: 'partially_performed',
            reasonCode: null,
            evidence: { status: 'documented', note: 'Shortened at client request' },
          },
          {
            performedServiceId: 'not-performed',
            status: 'not_performed',
            reasonCode: 'client_declined',
            evidence: { status: 'not_required', note: 'Client declined' },
          },
        ],
      }),
    ).toEqual({ isComplete: true, missing: [] });
  });

  test('rejects not-required evidence without a non-performed service and explanation', () => {
    expect(() =>
      validateServiceEvidence({ status: 'not_required', serviceStatus: 'performed', note: 'Done' }),
    ).toThrow();
    expect(() =>
      validateServiceEvidence({
        status: 'not_required',
        serviceStatus: 'not_performed',
        note: '  ',
      }),
    ).toThrow();
    expect(() =>
      validateServiceEvidence({
        status: 'documented',
        serviceStatus: 'performed',
        note: 'x'.repeat(1001),
      }),
    ).toThrow();
  });

  test('trims generic documentation text and rejects empty entries', () => {
    expect(normalizeDocumentationText('  Client was comfortable.  ')).toBe(
      'Client was comfortable.',
    );
    expect(() => normalizeDocumentationText('   ')).toThrow();
  });
});
