import type { components } from '@care/api-client';
import type en from '../../../../messages/en.json';

export type OperationsWorkItem = components['schemas']['OperationsWorkItemResponseDto'];
export type OperationsTask = components['schemas']['OperationsTaskResponseDto'];
export type OperationsIssueTitle = keyof (typeof en)['Operations']['issueTitles'];

const issueTitles: readonly OperationsIssueTitle[] = [
  'missing_assignment',
  'employee_overlap',
  'employee_absence',
  'outside_employee_availability',
  'employee_availability_unknown',
  'insufficient_travel_time',
  'travel_feasibility_unknown',
  'client_overlap',
  'employee_preference',
  'client_preference',
  'substitution_awaiting_confirmation',
  'unpublished_schedule_changes',
  'documentation_documentation_required',
  'documentation_visit_execution_required',
  'visit_execution_overdue',
  'documentation_service_evidence_required',
  'documentation_not_performed_reason_required',
  'documentation_partial_service_explanation_required',
  'acknowledgement_missing',
  'acknowledgement_declined',
  'acknowledgement_revoked',
  'evidence_outdated',
  'missing_entitlement',
  'unverified_balance',
  'carryover_expiring',
  'service_unallocated',
  'invoice_document_failed',
  'receivable_overdue',
  'claim_rejected',
  'claim_clarification',
  'claim_ready_to_submit',
  'claim_readiness_blocked',
  'claim_payment_outstanding',
  'admission_readiness_blocked',
  'admission_follow_up_due',
  'admission_follow_up_overdue',
  'admission_start_date',
  'benefit_entitlement_expiry',
  'agreement_expiry',
  'payer_authorization_expiry',
  'qualification_expiry',
  'receivable_due',
];

export function issueTitleKey(code: string): OperationsIssueTitle {
  return issueTitles.includes(code as OperationsIssueTitle)
    ? (code as OperationsIssueTitle)
    : 'missing_assignment';
}

export function categoryTranslationKey(
  category: OperationsWorkItem['category'],
):
  | 'categories.agreements'
  | 'categories.employees'
  | 'categories.onboarding'
  | 'scheduling'
  | 'visits'
  | 'documentation'
  | 'benefits'
  | 'billing'
  | 'claims' {
  if (category === 'agreements') return 'categories.agreements';
  if (category === 'employees') return 'categories.employees';
  if (category === 'onboarding') return 'categories.onboarding';
  return category;
}

export function workItemSourceHref(item: OperationsWorkItem): string {
  switch (item.sourceDomain) {
    case 'scheduling':
      return `/visits/${item.sourceEntityId}`;
    case 'visit_execution':
      return `/visits/${item.sourceEntityId}`;
    case 'care_documentation':
      return item.sourceEntityType === 'visit'
        ? `/visits/${item.sourceEntityId}`
        : '/documentation';
    case 'service_evidence':
      return item.sourceEntityType === 'evidence_package'
        ? `/service-evidence/${item.sourceEntityId}`
        : '/service-evidence';
    case 'benefits':
      return item.clientId ? `/clients/${item.clientId}/benefits` : '/benefits';
    case 'billing':
      return item.sourceEntityType === 'payer_arrangement' && item.clientId
        ? `/clients/${item.clientId}/invoices`
        : `/billing/invoices/${item.sourceEntityId}`;
    case 'claims':
      return `/billing/claims/${item.sourceEntityId}`;
    case 'onboarding':
      return `/admissions/${item.sourceEntityId}`;
    case 'service_agreements':
      return item.clientId
        ? `/clients/${item.clientId}/service-agreements`
        : '/operations/deadlines';
    case 'employee_qualifications':
      return item.employeeId ? `/employees/${item.employeeId}` : '/operations/deadlines';
    default:
      return '/operations/worklist';
  }
}

export function taskSourceHref(task: OperationsTask): string | null {
  if (
    !task.source ||
    typeof task.source !== 'object' ||
    !('type' in task.source) ||
    !('id' in task.source)
  ) {
    return null;
  }
  const source = task.source as { type: string; id: string };
  switch (source.type) {
    case 'client':
      return `/clients/${source.id}`;
    case 'visit':
      return `/visits/${source.id}`;
    case 'service_agreement':
      return task.clientId ? `/clients/${task.clientId}/service-agreements` : '/services';
    case 'service_evidence':
      return `/service-evidence/${source.id}`;
    case 'invoice':
      return `/billing/invoices/${source.id}`;
    case 'claim':
      return `/billing/claims/${source.id}`;
    case 'benefit_entitlement':
      return task.clientId ? `/clients/${task.clientId}/benefits` : '/benefits';
    case 'document':
      return `/documents/${source.id}/pdf`;
    case 'communication':
      return task.clientId ? `/clients/${task.clientId}/communications` : '/communications';
    default:
      return null;
  }
}

export function taskStatusTranslation(
  status: OperationsTask['status'],
): 'taskOpen' | 'taskInProgress' | 'taskCompleted' | 'taskCancelled' {
  switch (status) {
    case 'open':
      return 'taskOpen';
    case 'in_progress':
      return 'taskInProgress';
    case 'completed':
      return 'taskCompleted';
    case 'cancelled':
      return 'taskCancelled';
  }
}
