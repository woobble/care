type MessageCatalog = typeof import('../../messages/en.json');

export function getClientMessages(messages: MessageCatalog) {
  return {
    Common: {
      language: messages.Common.language,
      loadingPage: messages.Common.loadingPage,
      languages: messages.Common.languages,
      formValidation: messages.Common.formValidation,
      entitySelector: messages.Common.entitySelector,
      units: {
        occurrence: messages.Common.units.occurrence,
        minute: messages.Common.units.minute,
        hour: messages.Common.units.hour,
        day: messages.Common.units.day,
      },
    },
    Navigation: {
      currentOrganization: messages.Navigation.currentOrganization,
      appearance: messages.Navigation.appearance,
      light: messages.Navigation.light,
      dark: messages.Navigation.dark,
      system: messages.Navigation.system,
    },
    Auth: {
      signInWithAuthentik: messages.Auth.signInWithAuthentik,
      redirecting: messages.Auth.redirecting,
      signInFailed: messages.Auth.signInFailed,
    },
    Caregiver: {
      drafts: messages.Caregiver.drafts,
    },
    ServiceEvidence: {
      care: messages.ServiceEvidence.care,
    },
    Services: {
      pricing: {
        units: messages.Services.pricing.units,
      },
    },
    ServiceAgreements: {
      service: messages.ServiceAgreements.service,
      selectService: messages.ServiceAgreements.selectService,
      validFromForService: messages.ServiceAgreements.validFromForService,
      validUntilForService: messages.ServiceAgreements.validUntilForService,
      quantityOptional: messages.ServiceAgreements.quantityOptional,
      quantityWithUnit: messages.ServiceAgreements.quantityWithUnit,
      cadence: messages.ServiceAgreements.cadence,
      cadenceUnspecified: messages.ServiceAgreements.cadenceUnspecified,
      daily: messages.ServiceAgreements.daily,
      weekly: messages.ServiceAgreements.weekly,
      occurrencesPerWeek: messages.ServiceAgreements.occurrencesPerWeek,
      intervalDays: messages.ServiceAgreements.intervalDays,
      onDemand: messages.ServiceAgreements.onDemand,
      occurrencesPerWeekHelp: messages.ServiceAgreements.occurrencesPerWeekHelp,
      intervalDaysHelp: messages.ServiceAgreements.intervalDaysHelp,
      preferredTimeFrom: messages.ServiceAgreements.preferredTimeFrom,
      preferredTimeUntil: messages.ServiceAgreements.preferredTimeUntil,
      operationalNote: messages.ServiceAgreements.operationalNote,
      weekdaysLegend: messages.ServiceAgreements.weekdaysLegend,
      weekdays: messages.ServiceAgreements.weekdays,
      costEstimate: {
        agreementTitle: messages.ServiceAgreements.costEstimate.agreementTitle,
        loading: messages.ServiceAgreements.costEstimate.loading,
        loadFailed: messages.ServiceAgreements.costEstimate.loadFailed,
        noPrice: messages.ServiceAgreements.costEstimate.noPrice,
        effectiveFrom: messages.ServiceAgreements.costEstimate.effectiveFrom,
        period: messages.ServiceAgreements.costEstimate.period,
        lineTotal: messages.ServiceAgreements.costEstimate.lineTotal,
        pendingAddition: messages.ServiceAgreements.costEstimate.pendingAddition,
        agreementTotal: messages.ServiceAgreements.costEstimate.agreementTotal,
        calculableSubtotal: messages.ServiceAgreements.costEstimate.calculableSubtotal,
        incompleteTotal: messages.ServiceAgreements.costEstimate.incompleteTotal,
        aggregateTooLarge: messages.ServiceAgreements.costEstimate.aggregateTooLarge,
        note: messages.ServiceAgreements.costEstimate.note,
        reason: messages.ServiceAgreements.costEstimate.reason,
      },
    },
  };
}
