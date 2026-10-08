import { describe, expect, it } from 'bun:test';
import { auditActionKey } from './audit';
import { errorMessageKey } from './errors';
import {
  documentationEntryTypeKey,
  documentationRequirementKey,
  documentationSeverityKey,
  executionReasonKey,
  executionServiceStatusKey,
  executionStatusKey,
  statusLabelKey,
  visitStatusKey,
} from './status';

describe('presentation keys for domain values', () => {
  it('maps visit and execution statuses without changing the source values', () => {
    expect(statusLabelKey('confirmed')).toBe('Common.status.confirmed');
    expect(visitStatusKey('confirmed')).toBe('Common.status.confirmed');
    expect(executionStatusKey('in_progress')).toBe('VisitExecution.executionStatus.inProgress');
    expect(executionServiceStatusKey('partially_performed')).toBe(
      'VisitExecution.serviceStatus.partiallyPerformed',
    );
    expect(executionStatusKey('unexpected')).toBe('VisitExecution.executionStatus.unknown');
  });

  it('maps documentation reasons, entry types and severity codes', () => {
    expect(documentationRequirementKey('SERVICE_EVIDENCE_REQUIRED')).toBe(
      'CareDocumentation.missingRequirements.serviceEvidence',
    );
    expect(documentationEntryTypeKey('care_note')).toBe(
      'CareDocumentation.visit.entryTypes.careNote',
    );
    expect(documentationSeverityKey('critical')).toBe(
      'CareDocumentation.visit.severityValues.critical',
    );
    expect(executionReasonKey('client_declined')).toBe('VisitExecution.reasons.clientDeclined');
    expect(documentationEntryTypeKey('unexpected')).toBe(
      'CareDocumentation.visit.entryTypes.unknown',
    );
  });

  it('localizes structured history and stable API error codes', () => {
    expect(auditActionKey('visit.employee_assigned')).toBe('Audit.actions.visitEmployeeAssigned');
    expect(auditActionKey('tenant.member.activated')).toBe('Audit.actions.memberActivated');
    expect(errorMessageKey('VISIT_EMPLOYEE_CONFLICT')).toBe('Errors.visitScheduleConflict');
    expect(errorMessageKey('UNKNOWN_ERROR')).toBe('Errors.generic');
  });
});
