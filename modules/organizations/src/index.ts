export { organizationsSchema, tenants, organizationsTable, facilities, teams } from './schema';
export {
  OrganizationApplicationService,
  OrganizationNotFoundError,
  OrganizationArchivedError,
  FacilityNotFoundError,
  FacilityArchivedError,
  TeamNotFoundError,
  TeamArchivedError,
  InvalidTeamAssignmentError,
} from './application/organization.service';
export {
  OrganizationHasActiveChildrenError,
  FacilityHasActiveTeamsError,
} from './domain/organization';
export { OrganizationRepository } from './infrastructure/persistence/organization.repository';
export type {
  FacilityData,
  FacilitySnapshot,
  OrganizationData,
  OrganizationSnapshot,
  StructureStatus,
  TeamData,
  TeamSnapshot,
} from './domain/organization';
