type MessageCatalog = typeof import('../../messages/en.json');

export function getClientMessages(messages: MessageCatalog) {
  return {
    Common: {
      language: messages.Common.language,
      loadingPage: messages.Common.loadingPage,
      languages: messages.Common.languages,
      formValidation: messages.Common.formValidation,
      entitySelector: messages.Common.entitySelector,
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
  };
}
