export function evidenceStatusKey(
  status: string,
):
  | 'ServiceEvidence.status.awaitingAcknowledgement'
  | 'ServiceEvidence.status.acknowledged'
  | 'ServiceEvidence.status.declined'
  | 'ServiceEvidence.status.revoked'
  | 'ServiceEvidence.status.outdated'
  | 'ServiceEvidence.status.superseded'
  | 'ServiceEvidence.status.unknown' {
  const keys = {
    ready: 'ServiceEvidence.status.awaitingAcknowledgement',
    awaiting_acknowledgement: 'ServiceEvidence.status.awaitingAcknowledgement',
    acknowledged: 'ServiceEvidence.status.acknowledged',
    declined: 'ServiceEvidence.status.declined',
    revoked: 'ServiceEvidence.status.revoked',
    outdated: 'ServiceEvidence.status.outdated',
    superseded: 'ServiceEvidence.status.superseded',
  } as const;
  return status in keys ? keys[status as keyof typeof keys] : 'ServiceEvidence.status.unknown';
}

export function acknowledgementCapacityKey(
  capacity: string,
):
  | 'ServiceEvidence.care.capacities.client'
  | 'ServiceEvidence.care.capacities.legalGuardian'
  | 'ServiceEvidence.care.capacities.authorizedRepresentative'
  | 'ServiceEvidence.care.capacities.relative'
  | 'ServiceEvidence.care.capacities.other'
  | 'ServiceEvidence.care.capacities.unknown' {
  const keys = {
    client: 'ServiceEvidence.care.capacities.client',
    legal_guardian: 'ServiceEvidence.care.capacities.legalGuardian',
    authorized_representative: 'ServiceEvidence.care.capacities.authorizedRepresentative',
    relative: 'ServiceEvidence.care.capacities.relative',
    other: 'ServiceEvidence.care.capacities.other',
    unknown: 'ServiceEvidence.care.capacities.unknown',
  } as const;
  return capacity in keys
    ? keys[capacity as keyof typeof keys]
    : 'ServiceEvidence.care.capacities.unknown';
}

export function acknowledgementMethodKey(
  method: string,
):
  | 'ServiceEvidence.office.methods.signature'
  | 'ServiceEvidence.office.methods.typedConfirmation'
  | 'ServiceEvidence.office.methods.declined' {
  const keys = {
    touch_signature: 'ServiceEvidence.office.methods.signature',
    typed_confirmation: 'ServiceEvidence.office.methods.typedConfirmation',
    declined: 'ServiceEvidence.office.methods.declined',
  } as const;
  return method in keys
    ? keys[method as keyof typeof keys]
    : 'ServiceEvidence.office.methods.declined';
}

export function evidenceOutcomeKey(
  outcome: string,
):
  | 'ServiceEvidence.care.outcome.performed'
  | 'ServiceEvidence.care.outcome.partiallyPerformed'
  | 'ServiceEvidence.care.outcome.notPerformed'
  | 'ServiceEvidence.care.outcome.unknown' {
  const keys = {
    performed: 'ServiceEvidence.care.outcome.performed',
    partially_performed: 'ServiceEvidence.care.outcome.partiallyPerformed',
    not_performed: 'ServiceEvidence.care.outcome.notPerformed',
  } as const;
  return outcome in keys
    ? keys[outcome as keyof typeof keys]
    : 'ServiceEvidence.care.outcome.unknown';
}

export function declineReasonKey(
  reason: string | null | undefined,
):
  | 'ServiceEvidence.office.declineReasons.declinedWithoutReason'
  | 'ServiceEvidence.office.declineReasons.disagreesWithRecord'
  | 'ServiceEvidence.office.declineReasons.unableToSign'
  | 'ServiceEvidence.office.declineReasons.signatoryNotAvailable'
  | 'ServiceEvidence.office.declineReasons.other'
  | 'ServiceEvidence.office.declineReasons.unknown' {
  const keys = {
    declined_without_reason: 'ServiceEvidence.office.declineReasons.declinedWithoutReason',
    disagrees_with_record: 'ServiceEvidence.office.declineReasons.disagreesWithRecord',
    unable_to_sign: 'ServiceEvidence.office.declineReasons.unableToSign',
    signatory_not_available: 'ServiceEvidence.office.declineReasons.signatoryNotAvailable',
    other: 'ServiceEvidence.office.declineReasons.other',
  } as const;
  return reason && reason in keys
    ? keys[reason as keyof typeof keys]
    : 'ServiceEvidence.office.declineReasons.unknown';
}
