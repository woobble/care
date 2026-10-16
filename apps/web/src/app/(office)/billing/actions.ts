'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { getApiClient, getTenantHeader } from '@app/web/lib/api';
import { errorMessageKey } from '@app/web/i18n/errors';

import { lineAmountField } from './format';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const recipientTypes = ['client', 'payer'] as const;
const taxTreatments = ['taxable', 'tax_exempt', 'small_business'] as const;
const invoiceFormats = ['pdf', 'structured'] as const;
const payerTypes = ['statutory_insurance', 'private_insurance', 'other'] as const;
const arrangementTypes = ['direct_payer_billing', 'reimbursement_to_client', 'other'] as const;
const recipientEntityTypes = ['client', 'insurance', 'contact', 'other'] as const;
const mandateStatuses = ['authorized', 'pending', 'revoked', 'not_applicable'] as const;
const paymentMethods = ['bank_transfer', 'cash', 'other'] as const;
const payerDirectoryTypes = [
  'statutory_pflegekasse',
  'private_pflegeversicherung',
  'self_pay',
  'other',
] as const;
const claimChannels = [
  'manual_portal',
  'manual_email',
  'postal',
  'customer_reimbursement',
] as const;
const claimFundingTypes = [
  'statutory_long_term_care_insurance',
  'private_long_term_care_insurance',
  'self_pay',
  'other',
] as const;
const claimDecisions = [
  'accepted',
  'partially_accepted',
  'rejected',
  'clarification_required',
] as const;

async function actionErrorMessage(code: string): Promise<string> {
  const translate = await getTranslations();
  return translate(errorMessageKey(code));
}

export async function createDraftInvoiceAction(formData: FormData): Promise<void> {
  const organizationId = readUuid(formData.get('organizationId'));
  const facilityId = readUuid(formData.get('facilityId'));
  const clientId = readUuid(formData.get('clientId'));
  const recipientType = readChoice(formData.get('recipientType'), recipientTypes);
  const payerArrangementId = readOptionalUuid(formData.get('payerArrangementId'));
  const lines = readInvoiceLines(formData);
  if (!organizationId || !facilityId || !clientId || !recipientType || !lines) {
    redirect(billingPath('INVALID_REQUEST'));
  }
  if (
    (recipientType === 'payer' && !payerArrangementId) ||
    (recipientType === 'client' && payerArrangementId)
  ) {
    redirect(billingPath('INVOICE_RECIPIENT_INVALID'));
  }

  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/billing/invoices', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      facilityId,
      clientId,
      recipientType,
      ...(payerArrangementId ? { payerArrangementId } : {}),
      lines,
    },
  });
  if (error || !data) redirect(billingPath(error?.code ?? 'INVOICE_INVALID_STATE'));
  refreshBilling(clientId);
  redirect(`/billing/invoices/${data.id}?updated=draft`);
}

export async function updateDraftInvoiceAction(formData: FormData): Promise<void> {
  const invoiceId = readUuid(formData.get('invoiceId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const organizationId = readUuid(formData.get('organizationId'));
  const facilityId = readUuid(formData.get('facilityId'));
  const clientId = readUuid(formData.get('clientId'));
  const recipientType = readChoice(formData.get('recipientType'), recipientTypes);
  const payerArrangementId = readOptionalUuid(formData.get('payerArrangementId'));
  const lines = readInvoiceLines(formData);
  if (
    !invoiceId ||
    !expectedVersion ||
    !organizationId ||
    !facilityId ||
    !clientId ||
    !recipientType ||
    !lines
  ) {
    redirect(invoicePath(invoiceId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/billing/invoices/{id}', {
    params: { path: { id: invoiceId }, header: await getTenantHeader() },
    body: {
      organizationId,
      facilityId,
      clientId,
      recipientType,
      ...(payerArrangementId ? { payerArrangementId } : {}),
      expectedVersion,
      lines,
    },
  });
  if (error) redirect(invoicePath(invoiceId, error.code));
  refreshBilling(clientId);
  redirect(invoicePath(invoiceId, 'INVOICE_UPDATED'));
}

export async function cancelDraftInvoiceAction(formData: FormData): Promise<void> {
  const invoiceId = readUuid(formData.get('invoiceId'));
  if (!invoiceId) redirect(billingPath('INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/invoices/{id}/cancel', {
    params: { path: { id: invoiceId }, header: await getTenantHeader() },
  });
  if (error) redirect(invoicePath(invoiceId, error.code));
  revalidatePath('/billing');
  revalidatePath('/billing/invoices');
  redirect(invoicePath(invoiceId, 'INVOICE_CANCELLED'));
}

export async function issueInvoiceAction(formData: FormData): Promise<void> {
  const invoiceId = readUuid(formData.get('invoiceId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!invoiceId || !expectedVersion) redirect(invoicePath(invoiceId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/invoices/{id}/issue', {
    params: { path: { id: invoiceId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(invoicePath(invoiceId, error.code));
  refreshBilling();
  redirect(invoicePath(invoiceId, undefined, 'issued'));
}

export async function regenerateInvoicePdfAction(formData: FormData): Promise<void> {
  const invoiceId = readUuid(formData.get('invoiceId'));
  if (!invoiceId) redirect(billingPath('INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/invoices/{id}/pdf/regenerate', {
    params: { path: { id: invoiceId }, header: await getTenantHeader() },
  });
  if (error) redirect(invoicePath(invoiceId, error.code));
  redirect(invoicePath(invoiceId, 'PDF_REGENERATION_REQUESTED'));
}

export async function correctInvoiceAction(formData: FormData): Promise<void> {
  const invoiceId = readUuid(formData.get('invoiceId'));
  const reason = readString(formData.get('reason'));
  const lines = readCorrectionLines(formData);
  if (!invoiceId || !reason || !lines) redirect(invoicePath(invoiceId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/invoices/{id}/corrections', {
    params: { path: { id: invoiceId }, header: await getTenantHeader() },
    body: { reason, lines },
  });
  if (error) redirect(invoicePath(invoiceId, error.code));
  refreshBilling();
  redirect(invoicePath(invoiceId, 'INVOICE_CORRECTED'));
}

export async function saveBillingProfileAction(formData: FormData): Promise<void | string> {
  const organizationId = readUuid(formData.get('organizationId'));
  const taxTreatment = readChoice(formData.get('taxTreatment'), taxTreatments);
  const requiredInvoiceFormat = readChoice(formData.get('requiredInvoiceFormat'), invoiceFormats);
  const paymentTermsDays = readNonNegativeInteger(formData.get('paymentTermsDays'));
  const invoiceNumberPrefix = readString(formData.get('invoiceNumberPrefix'));
  const taxRateBasisPoints = readTaxRate(formData.get('taxRatePercent'));
  const expectedVersion = readOptionalPositiveInteger(formData.get('expectedVersion'));
  if (
    !organizationId ||
    !taxTreatment ||
    !requiredInvoiceFormat ||
    paymentTermsDays === null ||
    invoiceNumberPrefix === null ||
    taxRateBasisPoints === undefined ||
    expectedVersion === undefined
  ) {
    return actionErrorMessage('INVALID_BILLING_PROFILE');
  }
  const api = await getApiClient();
  const { error } = await api.PUT('/api/v1/billing/settings', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      taxNumber: readNullableText(formData.get('taxNumber')),
      vatId: readNullableText(formData.get('vatId')),
      creditorIdentifier: readNullableText(formData.get('creditorIdentifier')),
      bankAccountHolder: readNullableText(formData.get('bankAccountHolder')),
      iban: readNullableText(formData.get('iban')),
      bic: readNullableText(formData.get('bic')),
      paymentTermsDays,
      invoiceNumberPrefix,
      defaultCurrency: 'EUR',
      taxTreatment,
      ...(taxTreatment === 'taxable' ? { taxRateBasisPoints } : {}),
      ...(taxTreatment === 'taxable'
        ? {}
        : { taxExemptionBasis: readString(formData.get('taxExemptionBasis')) }),
      requireAcknowledgement: formData.get('requireAcknowledgement') === 'true',
      requiredInvoiceFormat,
      ...(expectedVersion ? { expectedVersion } : {}),
    },
  });
  if (error) return actionErrorMessage(error.code);
  revalidatePath('/billing');
  revalidatePath('/billing/settings');
  redirect(billingSettingsPath(undefined, 'saved'));
}

export async function createPayerArrangementAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const organizationId = readUuid(formData.get('organizationId'));
  const payerId = readUuid(formData.get('payerId'));
  const payerAssociation = readPayerAssociation(formData);
  const payerType = readChoice(formData.get('payerType'), payerTypes);
  const arrangementType = readChoice(formData.get('arrangementType'), arrangementTypes);
  const recipientType = readChoice(formData.get('recipientType'), recipientEntityTypes);
  const mandateStatus = readChoice(formData.get('mandateStatus'), mandateStatuses);
  const validFrom = readDate(formData.get('validFrom'));
  const validUntil = readOptionalDate(formData.get('validUntil'));
  if (
    !clientId ||
    !organizationId ||
    !payerId ||
    !payerAssociation ||
    !payerType ||
    !arrangementType ||
    !recipientType ||
    !mandateStatus ||
    !validFrom ||
    validUntil === undefined
  ) {
    redirect(clientInvoicesPath(clientId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/payer-arrangements', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      clientId,
      payerId,
      ...(payerAssociation.fundingSourceId
        ? { fundingSourceId: payerAssociation.fundingSourceId }
        : {}),
      ...(payerAssociation.clientInsuranceId
        ? { clientInsuranceId: payerAssociation.clientInsuranceId }
        : {}),
      payerType,
      payerReference: readNullableText(formData.get('payerReference')),
      arrangementType,
      recipientType,
      recipientName: readNullableText(formData.get('recipientName')),
      recipientAddress: readNullableText(formData.get('recipientAddress')),
      mandateStatus,
      documentedSource: readNullableText(formData.get('documentedSource')),
      documentedReference: readNullableText(formData.get('documentedReference')),
      validFrom,
      validUntil,
    },
  });
  if (error) redirect(clientInvoicesPath(clientId, error.code));
  revalidatePath(`/clients/${clientId}`);
  revalidatePath(clientInvoicesPath(clientId));
  redirect(clientInvoicesPath(clientId, undefined, 'PAYER_ARRANGEMENT_SAVED'));
}

export async function updatePayerArrangementAction(formData: FormData): Promise<void> {
  const clientId = readUuid(formData.get('clientId'));
  const id = readUuid(formData.get('arrangementId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const mandateStatus = readChoice(formData.get('mandateStatus'), mandateStatuses);
  const payerId = readOptionalUuid(formData.get('payerId'));
  const validUntil = readOptionalDate(formData.get('validUntil'));
  if (
    !clientId ||
    !id ||
    !expectedVersion ||
    !mandateStatus ||
    payerId === undefined ||
    validUntil === undefined
  ) {
    redirect(clientInvoicesPath(clientId, 'INVALID_REQUEST'));
  }
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/billing/payer-arrangements/{id}', {
    params: { path: { id }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      mandateStatus,
      payerId,
      validUntil,
      documentedSource: readNullableText(formData.get('documentedSource')),
      documentedReference: readNullableText(formData.get('documentedReference')),
    },
  });
  if (error) redirect(clientInvoicesPath(clientId, error.code));
  revalidatePath(clientInvoicesPath(clientId));
  redirect(clientInvoicesPath(clientId, undefined, 'PAYER_ARRANGEMENT_SAVED'));
}

export async function createPayerDirectoryEntryAction(formData: FormData): Promise<void | string> {
  const organizationId = readUuid(formData.get('organizationId'));
  const payerType = readChoice(formData.get('payerType'), payerDirectoryTypes);
  const name = readString(formData.get('name'));
  const validFrom = readDate(formData.get('validFrom'));
  const validUntil = readOptionalDate(formData.get('validUntil'));
  if (!organizationId || !payerType || !name || !validFrom || validUntil === undefined) {
    return actionErrorMessage('INVALID_REQUEST');
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/payers', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      payerType,
      name,
      payerIdentifier: readNullableText(formData.get('payerIdentifier')),
      addressText: readNullableText(formData.get('addressText')),
      billingContactName: readNullableText(formData.get('billingContactName')),
      billingContactEmail: readNullableText(formData.get('billingContactEmail')),
      billingContactPhone: readNullableText(formData.get('billingContactPhone')),
      submissionInstructions: readNullableText(formData.get('submissionInstructions')),
      status: 'active',
      validFrom,
      validUntil,
    },
  });
  if (error) return actionErrorMessage(error.code);
  revalidatePath('/billing/claims');
  revalidatePath('/billing/claims/settings');
  redirect(claimSettingsPath(undefined, 'payer-saved', organizationId));
}

export async function updatePayerDirectoryEntryAction(formData: FormData): Promise<void | string> {
  const payerId = readUuid(formData.get('payerId'));
  const organizationId = readUuid(formData.get('organizationId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const payerType = readChoice(formData.get('payerType'), payerDirectoryTypes);
  const name = readString(formData.get('name'));
  const status = readChoice(formData.get('status'), ['active', 'inactive'] as const);
  const validFrom = readDate(formData.get('validFrom'));
  const validUntil = readOptionalDate(formData.get('validUntil'));
  if (
    !payerId ||
    !organizationId ||
    !expectedVersion ||
    !payerType ||
    !name ||
    !status ||
    !validFrom ||
    validUntil === undefined
  ) {
    return actionErrorMessage('INVALID_REQUEST');
  }
  const api = await getApiClient();
  const { error } = await api.PATCH('/api/v1/billing/payers/{id}', {
    params: { path: { id: payerId }, header: await getTenantHeader() },
    body: {
      organizationId,
      expectedVersion,
      payerType,
      name,
      payerIdentifier: readNullableText(formData.get('payerIdentifier')),
      addressText: readNullableText(formData.get('addressText')),
      billingContactName: readNullableText(formData.get('billingContactName')),
      billingContactEmail: readNullableText(formData.get('billingContactEmail')),
      billingContactPhone: readNullableText(formData.get('billingContactPhone')),
      submissionInstructions: readNullableText(formData.get('submissionInstructions')),
      status,
      validFrom,
      ...(validUntil !== undefined ? { validUntil } : {}),
    },
  });
  if (error) return actionErrorMessage(error.code);
  revalidatePath('/billing/claims');
  revalidatePath('/billing/claims/settings');
  redirect(claimSettingsPath(undefined, 'payer-saved', organizationId));
}

export async function savePayerRequirementsAction(formData: FormData): Promise<void | string> {
  const payerId = readUuid(formData.get('payerId'));
  const organizationId = readUuid(formData.get('organizationId'));
  const channel = readChoice(formData.get('channel'), claimChannels);
  const fundingSourceType = readChoice(formData.get('fundingSourceType'), claimFundingTypes);
  const validFrom = readDate(formData.get('validFrom'));
  const validUntil = readOptionalDate(formData.get('validUntil'));
  const sourceName = readString(formData.get('sourceName'));
  const sourceVersion = readString(formData.get('sourceVersion'));
  const sourceEffectiveDate = readDate(formData.get('sourceEffectiveDate'));
  const sourceUrl = readNullableText(formData.get('sourceUrl'));
  if (
    !payerId ||
    !organizationId ||
    !channel ||
    !fundingSourceType ||
    !validFrom ||
    validUntil === undefined ||
    !sourceName ||
    !sourceVersion ||
    !sourceEffectiveDate ||
    (sourceUrl !== null && !/^https:\/\/\S+$/i.test(sourceUrl))
  ) {
    return actionErrorMessage('INVALID_PAYER_PROFILE');
  }
  const api = await getApiClient();
  const headers = await getTenantHeader();
  const profileResult = await api.GET('/api/v1/billing/payers/{id}/profiles', {
    params: { path: { id: payerId }, header: headers },
  });
  if (profileResult.error) return actionErrorMessage(profileResult.error.code);
  const profiles = (profileResult.data ?? []) as Array<{
    channel: string;
    fundingSourceType: string;
    version: number;
  }>;
  const expectedVersion = profiles
    .filter(
      (profile) => profile.channel === channel && profile.fundingSourceType === fundingSourceType,
    )
    .reduce((latest, profile) => Math.max(latest, profile.version), 0);
  const { error } = await api.POST('/api/v1/billing/payers/{id}/profiles', {
    params: { path: { id: payerId }, header: headers },
    body: {
      organizationId,
      channel,
      fundingSourceType,
      validFrom,
      ...(validUntil !== undefined ? { validUntil } : {}),
      sourceName,
      sourceVersion,
      sourceEffectiveDate,
      sourceUrl,
      requiresClientInsuranceNumber: formData.get('requiresClientInsuranceNumber') === 'true',
      requiresPayerIdentifier: formData.get('requiresPayerIdentifier') === 'true',
      requiresAcknowledgement: formData.get('requiresAcknowledgement') === 'true',
      requiresMandate: formData.get('requiresMandate') === 'true',
      requiresInvoicePdf: formData.get('requiresInvoicePdf') === 'true',
      requiresEvidencePdf: formData.get('requiresEvidencePdf') === 'true',
      requiresMandateDocument: formData.get('requiresMandateDocument') === 'true',
      requiresExternalReference: formData.get('requiresExternalReference') === 'true',
      requiresProviderRecognition: formData.get('requiresProviderRecognition') === 'true',
      expectedVersion,
    },
  });
  if (error) return actionErrorMessage(error.code);
  revalidatePath('/billing/claims');
  revalidatePath('/billing/claims/settings');
  redirect(claimSettingsPath(undefined, 'profile-saved', organizationId));
}

export async function createClaimAction(formData: FormData): Promise<void | string> {
  const invoiceId = readUuid(formData.get('invoiceId'));
  const expectedInvoiceVersion = readPositiveInteger(formData.get('expectedInvoiceVersion'));
  const payerArrangementId = readUuid(formData.get('payerArrangementId'));
  const payerBillingProfileId = readOptionalUuid(formData.get('payerBillingProfileId'));
  const lines = readClaimLines(formData);
  if (
    !invoiceId ||
    !expectedInvoiceVersion ||
    !payerArrangementId ||
    payerBillingProfileId === undefined ||
    !lines
  ) {
    return 'INVALID_REQUEST';
  }
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/billing/claims', {
    params: { header: await getTenantHeader() },
    body: {
      invoiceId,
      expectedInvoiceVersion,
      payerArrangementId,
      ...(payerBillingProfileId ? { payerBillingProfileId } : {}),
      lines,
    },
  });
  if (error || !data) return error?.code ?? 'CLAIM_NOT_FOUND';
  const detail = data as { claim?: { id?: string }; id?: string };
  const claimId = detail.claim?.id ?? detail.id;
  if (!claimId || !uuidPattern.test(claimId)) {
    return 'CLAIM_NOT_FOUND';
  }
  revalidatePath('/billing/claims');
  revalidatePath('/billing/invoices');
  redirect('/billing/claims/' + claimId + '?updated=created');
}

export async function prepareClaimAction(formData: FormData): Promise<void> {
  const claimId = readUuid(formData.get('claimId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!claimId || !expectedVersion) redirect(claimPath(claimId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/claims/{id}/prepare', {
    params: { path: { id: claimId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(claimPath(claimId, error.code));
  refreshClaims(claimId);
  redirect(claimPath(claimId, undefined, 'prepared'));
}

export async function submitClaimAction(formData: FormData): Promise<void> {
  const claimId = readUuid(formData.get('claimId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!claimId || !expectedVersion) redirect(claimPath(claimId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/claims/{id}/submit', {
    params: { path: { id: claimId }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      externalReference: readNullableText(formData.get('externalReference')),
      protectedNote: readNullableText(formData.get('protectedNote')),
    },
  });
  if (error) redirect(claimPath(claimId, error.code));
  refreshClaims(claimId);
  redirect(claimPath(claimId, undefined, 'submitted'));
}

export async function recordClaimDecisionAction(formData: FormData): Promise<void> {
  const claimId = readUuid(formData.get('claimId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  const decision = readChoice(formData.get('decision'), claimDecisions);
  const decisionDate = readDate(formData.get('decisionDate'));
  if (!claimId || !expectedVersion || !decision || !decisionDate) {
    redirect(claimPath(claimId, 'INVALID_CLAIM_DECISION'));
  }
  const lines = decision === 'clarification_required' ? [] : readClaimDecisionLines(formData);
  if (!lines) redirect(claimPath(claimId, 'INVALID_CLAIM_DECISION'));
  const acceptedCents = lines.reduce((total, line) => total + line.acceptedCents, 0);
  const rejectedCents = lines.reduce((total, line) => total + line.rejectedCents, 0);
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/claims/{id}/decision', {
    params: { path: { id: claimId }, header: await getTenantHeader() },
    body: {
      expectedVersion,
      decision,
      decisionDate,
      externalReference: readNullableText(formData.get('externalReference')),
      acceptedCents,
      rejectedCents,
      reasonCode: readNullableText(formData.get('reasonCode')),
      protectedExplanation: readNullableText(formData.get('protectedExplanation')),
      lines,
    },
  });
  if (error) redirect(claimPath(claimId, error.code));
  refreshClaims(claimId);
  redirect(claimPath(claimId, undefined, 'decision'));
}

export async function resubmitClaimAction(formData: FormData): Promise<void> {
  const claimId = readUuid(formData.get('claimId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!claimId || !expectedVersion) redirect(claimPath(claimId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { data, error } = await api.POST('/api/v1/billing/claims/{id}/resubmit', {
    params: { path: { id: claimId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error || !data) redirect(claimPath(claimId, error?.code ?? 'CLAIM_NOT_FOUND'));
  const detail = data as { claim?: { id?: string }; id?: string };
  const nextId = detail.claim?.id ?? detail.id;
  if (!nextId || !uuidPattern.test(nextId)) redirect(claimPath(claimId, 'CLAIM_NOT_FOUND'));
  refreshClaims(claimId);
  redirect('/billing/claims/' + nextId + '?updated=resubmitted');
}

export async function cancelClaimAction(formData: FormData): Promise<void> {
  const claimId = readUuid(formData.get('claimId'));
  const expectedVersion = readPositiveInteger(formData.get('expectedVersion'));
  if (!claimId || !expectedVersion) redirect(claimPath(claimId, 'INVALID_REQUEST'));
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/claims/{id}/cancel', {
    params: { path: { id: claimId }, header: await getTenantHeader() },
    body: { expectedVersion },
  });
  if (error) redirect(claimPath(claimId, error.code));
  refreshClaims(claimId);
  redirect(claimPath(claimId, undefined, 'cancelled'));
}

export async function recordPaymentAction(formData: FormData): Promise<void> {
  const organizationId = readUuid(formData.get('organizationId'));
  const invoiceId = readUuid(formData.get('invoiceId'));
  const amountCents = readEuroCents(formData.get('amount'));
  const receivedAt = readBerlinDateTime(formData.get('receivedAt'));
  const method = readChoice(formData.get('method'), paymentMethods);
  if (!organizationId || amountCents === null || !receivedAt || !method) {
    redirect(paymentPath(invoiceId, 'PAYMENT_AMOUNT_INVALID'));
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/payments', {
    params: { header: await getTenantHeader() },
    body: {
      organizationId,
      payerName: readNullableText(formData.get('payerName')),
      payerReference: readNullableText(formData.get('payerReference')),
      amountCents,
      receivedAt,
      method,
      reference: readNullableText(formData.get('reference')),
    },
  });
  if (error) redirect(paymentPath(invoiceId, error.code));
  refreshBilling();
  redirect(paymentPath(invoiceId, undefined, 'payment'));
}

export async function allocatePaymentAction(formData: FormData): Promise<void> {
  const paymentId = readUuid(formData.get('paymentId'));
  const invoiceId = readUuid(formData.get('invoiceId'));
  const claimId = readOptionalUuid(formData.get('claimId'));
  const amountCents = readEuroCents(formData.get('amount'));
  if (!paymentId || !invoiceId || claimId === undefined || amountCents === null) {
    redirect('/billing/payments?error=PAYMENT_AMOUNT_INVALID');
  }
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/payment-allocations', {
    params: { header: await getTenantHeader() },
    body: { paymentId, invoiceId, ...(claimId ? { claimId } : {}), amountCents },
  });
  if (error) {
    redirect(
      claimId
        ? claimPath(claimId, error.code)
        : '/billing/payments?error=' + encodeURIComponent(error.code),
    );
  }
  refreshBilling();
  if (claimId) {
    refreshClaims(claimId);
    redirect(claimPath(claimId, undefined, 'payment'));
  }
  redirect('/billing/payments?updated=allocation');
}

export async function reversePaymentAllocationAction(formData: FormData): Promise<void> {
  const id = readUuid(formData.get('allocationId'));
  const reason = readString(formData.get('reason'));
  if (!id || !reason) redirect('/billing/payments?error=PAYMENT_REVERSAL_CONFLICT');
  const api = await getApiClient();
  const { error } = await api.POST('/api/v1/billing/payment-allocations/{id}/reverse', {
    params: { path: { id }, header: await getTenantHeader() },
    body: { reason },
  });
  if (error) redirect(`/billing/payments?error=${encodeURIComponent(error.code)}`);
  refreshBilling();
  redirect('/billing/payments?updated=reversal');
}

function readClaimLines(formData: FormData) {
  const lines = [];
  for (const value of formData.getAll('invoiceLineId')) {
    if (typeof value !== 'string') return null;
    const invoiceLineId = readUuid(value);
    if (!invoiceLineId) return null;
    const amountCents = readNonNegativeEuroCents(formData.get('claimAmount-' + invoiceLineId));
    if (amountCents === null) return null;
    if (amountCents > 0) lines.push({ invoiceLineId, amountCents });
  }
  return lines.length ? lines : null;
}

function readClaimDecisionLines(formData: FormData) {
  const lines = [];
  for (const value of formData.getAll('claimLineId')) {
    if (typeof value !== 'string') return null;
    const claimLineId = readUuid(value);
    if (!claimLineId) return null;
    const acceptedCents = readNonNegativeEuroCents(formData.get('accepted-' + claimLineId));
    const rejectedCents = readNonNegativeEuroCents(formData.get('rejected-' + claimLineId));
    if (acceptedCents === null || rejectedCents === null) return null;
    lines.push({ claimLineId, acceptedCents, rejectedCents });
  }
  return lines.length ? lines : null;
}

function readInvoiceLines(formData: FormData) {
  const lines = [];
  for (const value of formData.getAll('selectedLine')) {
    if (typeof value !== 'string') return null;
    const [performedServiceId, rawAllocationId] = value.split('|');
    const parsedPerformedServiceId = readUuid(performedServiceId ?? null);
    const fundingAllocationId = rawAllocationId || null;
    const amountCents = readEuroCents(
      formData.get(lineAmountField(parsedPerformedServiceId ?? '', fundingAllocationId)),
    );
    if (
      !parsedPerformedServiceId ||
      (fundingAllocationId && !readUuid(fundingAllocationId)) ||
      amountCents === null
    ) {
      return null;
    }
    lines.push({
      performedServiceId: parsedPerformedServiceId,
      ...(fundingAllocationId ? { fundingAllocationId } : {}),
      amountCents,
    });
  }
  return lines.length ? lines : null;
}

function readPayerAssociation(formData: FormData): {
  fundingSourceId: string | null;
  clientInsuranceId: string | null;
} | null {
  const association = formData.get('payerAssociation');
  if (association === null) {
    const fundingSourceId = readOptionalUuid(formData.get('fundingSourceId'));
    const clientInsuranceId = readOptionalUuid(formData.get('clientInsuranceId'));
    if (fundingSourceId === undefined || clientInsuranceId === undefined) return null;
    return { fundingSourceId, clientInsuranceId };
  }
  const value = readString(association);
  if (!value) return { fundingSourceId: null, clientInsuranceId: null };
  const [kind, rawId] = value.split(':');
  const id = readUuid(rawId ?? null);
  if (!id) return null;
  if (kind === 'funding') return { fundingSourceId: id, clientInsuranceId: null };
  if (kind === 'insurance') return { fundingSourceId: null, clientInsuranceId: id };
  return null;
}

function readCorrectionLines(formData: FormData) {
  const lines = [];
  for (const value of formData.getAll('selectedCorrectionLine')) {
    if (typeof value !== 'string') return null;
    const invoiceLineId = readUuid(value);
    const amountCents = readEuroCents(formData.get(`correctionAmount-${value}`));
    if (!invoiceLineId || amountCents === null) return null;
    lines.push({ invoiceLineId, amountCents });
  }
  return lines.length ? lines : null;
}

function readString(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readUuid(value: FormDataEntryValue | null): string | null {
  const parsed = readString(value);
  return uuidPattern.test(parsed) ? parsed : null;
}

function readOptionalUuid(value: FormDataEntryValue | null): string | null | undefined {
  const parsed = readString(value);
  return parsed ? readUuid(value) : null;
}

function readChoice<const T extends readonly string[]>(
  value: FormDataEntryValue | null,
  choices: T,
): T[number] | null {
  const parsed = readString(value);
  return (choices as readonly string[]).includes(parsed) ? (parsed as T[number]) : null;
}

function readNullableText(value: FormDataEntryValue | null): string | null {
  const parsed = readString(value);
  return parsed || null;
}

function readPositiveInteger(value: FormDataEntryValue | null): number | null {
  const parsed = readString(value);
  if (!/^\d+$/.test(parsed)) return null;
  const number = Number(parsed);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function readOptionalPositiveInteger(value: FormDataEntryValue | null): number | null | undefined {
  const parsed = readString(value);
  return parsed ? readPositiveInteger(value) : null;
}

function readNonNegativeInteger(value: FormDataEntryValue | null): number | null {
  const parsed = readString(value);
  if (!/^\d+$/.test(parsed)) return null;
  const number = Number(parsed);
  return Number.isSafeInteger(number) ? number : null;
}

function readEuroCents(value: FormDataEntryValue | null): number | null {
  const parsed = readString(value).replace(',', '.');
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(parsed)) return null;
  const [euros = '0', fraction = ''] = parsed.split('.');
  const cents = BigInt(euros) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents > 0n && cents <= 2_000_000_000n ? Number(cents) : null;
}

function readNonNegativeEuroCents(value: FormDataEntryValue | null): number | null {
  const parsed = readString(value).replace(',', '.');
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(parsed)) return null;
  const [euros = '0', fraction = ''] = parsed.split('.');
  const cents = BigInt(euros) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents <= 2_000_000_000n ? Number(cents) : null;
}

function readTaxRate(value: FormDataEntryValue | null): number | null | undefined {
  const parsed = readString(value);
  if (!parsed) return null;
  const normalized = parsed.replace(',', '.');
  if (!/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const [whole = '0', fraction = ''] = normalized.split('.');
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return basisPoints >= 1 && basisPoints <= 10_000 ? basisPoints : undefined;
}

function readDate(value: FormDataEntryValue | null): string | null {
  const parsed = readString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) return null;
  const date = new Date(`${parsed}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== parsed ? null : parsed;
}

function readOptionalDate(value: FormDataEntryValue | null): string | null | undefined {
  const parsed = readString(value);
  return parsed ? readDate(value) : null;
}

function readBerlinDateTime(value: FormDataEntryValue | null): string | null {
  const parsed = readString(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(parsed);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  )
    return null;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(localAsUtc));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  const representedInUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
  );
  const instant = new Date(localAsUtc - (representedInUtc - localAsUtc));
  const check = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  const result = `${check.find((item) => item.type === 'year')?.value}-${check.find((item) => item.type === 'month')?.value}-${check.find((item) => item.type === 'day')?.value}T${check.find((item) => item.type === 'hour')?.value}:${check.find((item) => item.type === 'minute')?.value}`;
  return local === result ? instant.toISOString() : null;
}

function billingPath(error?: string, updated?: string): string {
  return queryPath('/billing', error, updated);
}

function billingSettingsPath(error?: string, updated?: string): string {
  return queryPath('/billing/settings', error, updated);
}

function invoicePath(invoiceId: string | null, error?: string, updated?: string): string {
  return invoiceId
    ? queryPath(`/billing/invoices/${invoiceId}`, error, updated)
    : billingPath(error, updated);
}

function clientInvoicesPath(clientId: string | null, error?: string, updated?: string): string {
  return clientId
    ? queryPath(`/clients/${clientId}/invoices`, error, updated)
    : billingPath(error, updated);
}

function claimPath(claimId: string | null, error?: string, updated?: string): string {
  return claimId
    ? queryPath('/billing/claims/' + claimId, error, updated)
    : claimsPath(error, updated);
}

function claimsPath(error?: string, updated?: string): string {
  return queryPath('/billing/claims', error, updated);
}

function paymentPath(invoiceId: string | null, error?: string, updated?: string): string {
  const query = new URLSearchParams();
  if (invoiceId) query.set('invoiceId', invoiceId);
  if (error) query.set('error', error);
  if (updated) query.set('updated', updated);
  return query.size ? `/billing/payments?${query.toString()}` : '/billing/payments';
}

function claimSettingsPath(error?: string, updated?: string, organizationId?: string): string {
  const query = new URLSearchParams();
  if (error) query.set('error', error);
  if (updated) query.set('updated', updated);
  if (organizationId) query.set('organizationId', organizationId);
  return query.size ? `/billing/claims/settings?${query.toString()}` : '/billing/claims/settings';
}

function queryPath(path: string, error?: string, updated?: string): string {
  const query = new URLSearchParams();
  if (error) query.set('error', error);
  if (updated) query.set('updated', updated);
  return query.size ? `${path}?${query.toString()}` : path;
}

function refreshBilling(clientId?: string): void {
  for (const path of [
    '/billing',
    '/billing/invoices',
    '/billing/receivables',
    '/billing/payments',
  ]) {
    revalidatePath(path);
  }
  if (clientId) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/invoices`);
  }
}

function refreshClaims(claimId?: string): void {
  revalidatePath('/billing/claims');
  revalidatePath('/billing/claims/settings');
  revalidatePath('/billing/invoices');
  if (claimId) revalidatePath('/billing/claims/' + claimId);
}
