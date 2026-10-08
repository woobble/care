import { describe, expect, test } from 'bun:test';
import {
  assertExpectedCarePlanVersion,
  CarePlanActivationIncompleteError,
  CarePlanLifecycleTransitionError,
  CarePlanVersionConflictError,
  copyForwardRevisionContent,
  diffCarePlanRevisions,
  transitionCarePlanStatus,
  validateActivationCompleteness,
  type CarePlanRevisionDetail,
} from './care-plan';

const timestamp = new Date('2026-10-08T12:00:00.000Z');

function revisionDetail(): CarePlanRevisionDetail {
  return {
    revision: {
      id: 'revision-1',
      tenantId: 'tenant-1',
      planId: 'plan-1',
      clientId: 'client-1',
      revisionNumber: 1,
      status: 'active',
      authorEmployeeId: 'employee-1',
      authorEmployeeName: 'Case Worker',
      reason: null,
      effectiveFrom: '2026-10-01',
      createdAt: timestamp,
      activatedByEmployeeId: 'employee-1',
      activatedByEmployeeName: 'Case Worker',
      activatedAt: timestamp,
      supersededAt: null,
    },
    assessment: {
      revisionId: 'revision-1',
      clientConcerns: 'Needs help with bathing',
      clientWishes: null,
      clientGoals: null,
      clientHabits: null,
      clientPreferences: null,
      clientPriorities: null,
      professionalObservedNeeds: null,
      professionalResources: null,
      professionalLimitations: null,
      professionalRisks: null,
      professionalRationale: null,
      updatedAt: timestamp,
    },
    sourceReferences: [
      {
        id: 'record-1',
        clinicalRecordId: 'record-1',
        recordKind: 'risk_assessment',
        rationale: 'Reviewed with the client',
        createdAt: timestamp,
      },
    ],
    needs: [
      {
        id: 'need-1',
        revisionId: 'revision-1',
        category: 'personal_care',
        title: 'Bathing support',
        description: null,
        source: 'client_report',
        priority: 'normal',
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    resources: [
      {
        id: 'resource-1',
        revisionId: 'revision-1',
        category: 'personal_interest',
        description: 'Enjoys choosing her own clothes',
        status: 'available',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    riskResponses: [
      {
        id: 'risk-response-1',
        revisionId: 'revision-1',
        clinicalRecordId: 'record-1',
        status: 'monitor',
        plannedResponse: 'Observe for dizziness before bathing',
        needIds: ['need-1'],
        measureIds: ['measure-1'],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    goals: [
      {
        id: 'goal-1',
        revisionId: 'revision-1',
        title: 'Maintain independence during bathing',
        description: null,
        targetDate: null,
        status: 'active',
        priority: 'normal',
        needIds: ['need-1'],
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    measures: [
      {
        id: 'measure-1',
        revisionId: 'revision-1',
        title: 'Support bathing',
        instruction: 'Offer assistance while preserving privacy',
        category: 'assistance',
        needIds: ['need-1'],
        goalIds: ['goal-1'],
        serviceDefinitionId: null,
        frequencyText: 'At each morning visit',
        responsibleRole: 'Caregiver',
        validFrom: '2026-10-01',
        validUntil: null,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

describe('care plan lifecycle', () => {
  test('allows supported transitions and rejects terminal or skipped transitions', () => {
    expect(transitionCarePlanStatus('draft', 'active')).toBe('active');
    expect(transitionCarePlanStatus('active', 'under_review')).toBe('under_review');
    expect(transitionCarePlanStatus('under_review', 'ended')).toBe('ended');
    expect(() => transitionCarePlanStatus('draft', 'ended')).toThrow(
      CarePlanLifecycleTransitionError,
    );
    expect(() => transitionCarePlanStatus('ended', 'active')).toThrow(
      CarePlanLifecycleTransitionError,
    );
  });

  test('detects a stale expected version', () => {
    expect(() => assertExpectedCarePlanVersion(4, 4)).not.toThrow();
    expect(() => assertExpectedCarePlanVersion(4, 3)).toThrow(CarePlanVersionConflictError);
  });

  test('requires assessment content, a need or resource, and an effective active measure', () => {
    const detail = revisionDetail();
    expect(() =>
      validateActivationCompleteness({
        assessment: detail.assessment,
        needs: detail.needs,
        resources: [],
        measures: detail.measures,
        effectiveDate: '2026-10-01',
      }),
    ).not.toThrow();
    expect(() =>
      validateActivationCompleteness({
        assessment: detail.assessment,
        needs: detail.needs,
        resources: [],
        measures: [],
        effectiveDate: '2026-10-01',
      }),
    ).toThrow(CarePlanActivationIncompleteError);
    expect(() =>
      validateActivationCompleteness({
        assessment: { ...detail.assessment, clientConcerns: null },
        needs: detail.needs,
        resources: [],
        measures: detail.measures,
        effectiveDate: '2026-10-01',
      }),
    ).toThrow(CarePlanActivationIncompleteError);
  });
});

describe('care plan revisions', () => {
  test('copies item and relationship IDs into the new revision', () => {
    const source = revisionDetail();
    const copy = copyForwardRevisionContent(source, 'revision-2');

    expect(copy.needs.map(({ id }) => id)).toEqual(['need-1']);
    expect(copy.goals.map(({ id }) => id)).toEqual(['goal-1']);
    expect(copy.measures.map(({ id }) => id)).toEqual(['measure-1']);
    expect(copy.riskResponses.map(({ id }) => id)).toEqual(['risk-response-1']);
    expect(copy.sourceReferences.map(({ clinicalRecordId }) => clinicalRecordId)).toEqual([
      'record-1',
    ]);
    expect(copy.needs[0]?.revisionId).toBe('revision-2');
    expect(copy.goals[0]?.revisionId).toBe('revision-2');
    expect(copy.measures[0]?.revisionId).toBe('revision-2');
    expect(copy.riskResponses[0]?.revisionId).toBe('revision-2');
    expect(copy.riskResponses[0]?.needIds).toEqual(['need-1']);
    expect(copy.riskResponses[0]?.measureIds).toEqual(['measure-1']);
    expect(copy.goals[0]?.needIds).toEqual(['need-1']);
    expect(copy.measures[0]?.needIds).toEqual(['need-1']);
    expect(copy.measures[0]?.goalIds).toEqual(['goal-1']);
    expect(copy.measures[0]?.needIds).not.toBe(source.measures[0]?.needIds);
  });

  test('reports additions, changes, removals, and assessment changes by stable ID', () => {
    const previous = revisionDetail();
    previous.needs.push({ ...previous.needs[0]!, id: 'need-2', title: 'Old need' });
    previous.sourceReferences.push({
      id: 'record-2',
      clinicalRecordId: 'record-2',
      recordKind: 'observation',
      rationale: null,
      createdAt: timestamp,
    });

    const next = revisionDetail();
    next.revision.id = 'revision-2';
    next.assessment = {
      ...next.assessment,
      revisionId: 'revision-2',
      clientConcerns: 'Updated concern',
    };
    next.needs[0] = { ...next.needs[0]!, revisionId: 'revision-2', title: 'Updated need' };
    next.needs.push({ ...next.needs[0]!, id: 'need-3', title: 'New need' });
    next.sourceReferences[0] = {
      ...next.sourceReferences[0]!,
      rationale: 'New rationale',
    };

    const diff = diffCarePlanRevisions(previous, next);

    expect(diff.needs).toEqual({ added: ['need-3'], changed: ['need-1'], removed: ['need-2'] });
    expect(diff.sourceReferences).toEqual({
      added: [],
      changed: ['record-1'],
      removed: ['record-2'],
    });
    expect(diff.assessmentChanged).toBe(true);
    expect(diff.goals).toEqual({ added: [], changed: [], removed: [] });
  });
});
