import { describe, expect, test } from 'bun:test';

import de from '../../messages/de.json';
import en from '../../messages/en.json';
import { getClientMessages } from './client-messages';

const benefitAllocationMessageKeys = [
  'serviceAmount',
  'allocationRows',
  'addAllocationLine',
  'allocationLine',
  'fundingSource',
  'selectFundingSource',
  'allocationAmount',
  'allocationStatus',
  'provisionalAllocation',
  'confirmedAllocation',
  'removeAllocationLine',
  'removeAllocationLineShort',
  'allocationPreview',
  'remainingToAllocate',
  'unknownBalance',
  'allocatedAfterSave',
  'unallocatedAfterSave',
  'allocationExceedsRemaining',
  'enterServiceAmountForPreview',
  'reverseAllocation',
  'confirmAllocationReversal',
  'allocationReversalFailed',
  'correctionReason',
  'allocationReversalNote',
  'confirmReversal',
] as const;

function benefitAllocationMessages(messages: typeof en) {
  return Object.fromEntries(
    benefitAllocationMessageKeys.map((key) => [key, messages.Benefits[key]]),
  ) as Pick<typeof en.Benefits, (typeof benefitAllocationMessageKeys)[number]>;
}

describe('client translation messages', () => {
  test('includes translations used by client components in both locales', () => {
    const english = getClientMessages(en);
    const german = getClientMessages(de);

    expect(english.Common.language).toBe(en.Common.language);
    expect(english.Common.formValidation).toEqual(en.Common.formValidation);
    expect(english.Common.entitySelector).toEqual(en.Common.entitySelector);
    expect(english.Common.units).toEqual({
      occurrence: en.Common.units.occurrence,
      minute: en.Common.units.minute,
      hour: en.Common.units.hour,
      day: en.Common.units.day,
    });
    expect(english.Navigation).toEqual({
      currentOrganization: en.Navigation.currentOrganization,
      appearance: en.Navigation.appearance,
      light: en.Navigation.light,
      dark: en.Navigation.dark,
      system: en.Navigation.system,
    });
    expect(english.Auth).toEqual({
      signInWithAuthentik: en.Auth.signInWithAuthentik,
      redirecting: en.Auth.redirecting,
      signInFailed: en.Auth.signInFailed,
    });
    expect(english.Errors).toEqual({
      generic: en.Errors.generic,
      invalidRequest: en.Errors.invalidRequest,
      insufficientPermission: en.Errors.insufficientPermission,
      invitationAlreadyExists: en.Errors.invitationAlreadyExists,
      invitationEmailAmbiguous: en.Errors.invitationEmailAmbiguous,
      membershipRevoked: en.Errors.membershipRevoked,
      notFound: en.Errors.notFound,
      userAlreadyMember: en.Errors.userAlreadyMember,
      userDisabled: en.Errors.userDisabled,
    });
    expect(english.Caregiver.drafts).toEqual(en.Caregiver.drafts);
    expect(english.ServiceEvidence.care).toEqual(en.ServiceEvidence.care);
    expect(english.Visits).toEqual({
      detailsSheetTitle: en.Visits.detailsSheetTitle,
      detailsSheetDescription: en.Visits.detailsSheetDescription,
      closeDetails: en.Visits.closeDetails,
    });
    expect(english.Planning).toEqual({
      stopLabel: en.Planning.stopLabel,
      moveStopUp: en.Planning.moveStopUp,
      moveStopDown: en.Planning.moveStopDown,
      unsavedTourOrder: en.Planning.unsavedTourOrder,
      saveTourOrder: en.Planning.saveTourOrder,
    });
    expect(english.Services.pricing.units).toEqual(en.Services.pricing.units);
    expect(english.ServiceAgreements.costEstimate).toEqual({
      agreementTitle: en.ServiceAgreements.costEstimate.agreementTitle,
      loading: en.ServiceAgreements.costEstimate.loading,
      loadFailed: en.ServiceAgreements.costEstimate.loadFailed,
      noPrice: en.ServiceAgreements.costEstimate.noPrice,
      effectiveFrom: en.ServiceAgreements.costEstimate.effectiveFrom,
      period: en.ServiceAgreements.costEstimate.period,
      lineTotal: en.ServiceAgreements.costEstimate.lineTotal,
      pendingAddition: en.ServiceAgreements.costEstimate.pendingAddition,
      agreementTotal: en.ServiceAgreements.costEstimate.agreementTotal,
      calculableSubtotal: en.ServiceAgreements.costEstimate.calculableSubtotal,
      incompleteTotal: en.ServiceAgreements.costEstimate.incompleteTotal,
      aggregateTooLarge: en.ServiceAgreements.costEstimate.aggregateTooLarge,
      note: en.ServiceAgreements.costEstimate.note,
      reason: en.ServiceAgreements.costEstimate.reason,
    });
    expect(english.ServiceAgreements.weekdays).toEqual(en.ServiceAgreements.weekdays);
    expect(german.ServiceAgreements.costEstimate).toEqual({
      agreementTitle: de.ServiceAgreements.costEstimate.agreementTitle,
      loading: de.ServiceAgreements.costEstimate.loading,
      loadFailed: de.ServiceAgreements.costEstimate.loadFailed,
      noPrice: de.ServiceAgreements.costEstimate.noPrice,
      effectiveFrom: de.ServiceAgreements.costEstimate.effectiveFrom,
      period: de.ServiceAgreements.costEstimate.period,
      lineTotal: de.ServiceAgreements.costEstimate.lineTotal,
      pendingAddition: de.ServiceAgreements.costEstimate.pendingAddition,
      agreementTotal: de.ServiceAgreements.costEstimate.agreementTotal,
      calculableSubtotal: de.ServiceAgreements.costEstimate.calculableSubtotal,
      incompleteTotal: de.ServiceAgreements.costEstimate.incompleteTotal,
      aggregateTooLarge: de.ServiceAgreements.costEstimate.aggregateTooLarge,
      note: de.ServiceAgreements.costEstimate.note,
      reason: de.ServiceAgreements.costEstimate.reason,
    });
    expect(english.Benefits).toEqual(benefitAllocationMessages(en));
    expect(german.Benefits).toEqual(benefitAllocationMessages(de));
    expect(german.Common.language).toBe(de.Common.language);
    expect(german.Caregiver.drafts).toEqual(de.Caregiver.drafts);
    expect(german.Errors).toEqual({
      generic: de.Errors.generic,
      invalidRequest: de.Errors.invalidRequest,
      insufficientPermission: de.Errors.insufficientPermission,
      invitationAlreadyExists: de.Errors.invitationAlreadyExists,
      invitationEmailAmbiguous: de.Errors.invitationEmailAmbiguous,
      membershipRevoked: de.Errors.membershipRevoked,
      notFound: de.Errors.notFound,
      userAlreadyMember: de.Errors.userAlreadyMember,
      userDisabled: de.Errors.userDisabled,
    });
    expect(german.ServiceEvidence.care).toEqual(de.ServiceEvidence.care);
    expect(german.Visits).toEqual({
      detailsSheetTitle: de.Visits.detailsSheetTitle,
      detailsSheetDescription: de.Visits.detailsSheetDescription,
      closeDetails: de.Visits.closeDetails,
    });
    expect(german.Planning).toEqual({
      stopLabel: de.Planning.stopLabel,
      moveStopUp: de.Planning.moveStopUp,
      moveStopDown: de.Planning.moveStopDown,
      unsavedTourOrder: de.Planning.unsavedTourOrder,
      saveTourOrder: de.Planning.saveTourOrder,
    });
  });

  test('keeps the client message payload below one tenth of the full catalog', () => {
    const encoder = new TextEncoder();
    const fullCatalogBytes = encoder.encode(JSON.stringify(en)).byteLength;
    const clientCatalogBytes = encoder.encode(JSON.stringify(getClientMessages(en))).byteLength;

    expect(clientCatalogBytes).toBeLessThan(fullCatalogBytes / 10);
  });
});
