export { clientsSchema, clientRecords } from './schema';
export {
  Client,
  ClientArchivedError,
  InvalidClientPersonalDataError,
  InvalidClientTransitionError,
  type ClientStatus,
  type ClientSnapshot,
  type ClientPersonalData,
} from './domain/client';
export { ClientNotFoundError, InvalidPaginationError } from './application/client.service';
export {
  ClientApplicationService,
  createClientApplicationService,
} from './application/client.service';
