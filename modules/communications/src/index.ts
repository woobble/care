export {
  communicationsSchema,
  interactions,
  prospectInteractions,
  interactionAmendments,
  clientCommunicationPreferences,
} from './schema';
export {
  createCommunicationsApplicationService,
  CommunicationsApplicationService,
  CommunicationNotFoundError,
  CommunicationSourceNotFoundError,
  InvalidCommunicationInputError,
  CommunicationVersionConflictError,
  type CommunicationInput,
  type ProspectCommunicationCaseContext,
  type CommunicationAmendmentInput,
  type CommunicationListQuery,
  type CommunicationPreferencesInput,
  type CommunicationSourceReference,
} from './application/communications.application';
export {
  contactAuthorizationFor,
  type ContactAuthorizationBasis,
} from './domain/contact-authorization';
