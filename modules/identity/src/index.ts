export { identitySchema, users, tenantMemberships } from './schema';
export { seedSystemRoles } from './system-roles';
export { betterAuthSchema } from './auth-schema';
export { IdentityService } from './application/identity.service';
export { TenantAccessService } from './application/tenant-access.service';
export { TenantAccessError } from './application/tenant-access.service';
export type {
  TenantAdminScopeType,
  TenantScopeInput,
  TenantMemberView,
  TenantInvitationView,
} from './application/tenant-access.service';
export {
  activateMembership,
  deactivateMembership,
  revokeMembership,
  transitionInvitation,
  type InvitationStatus,
  type MembershipStatus,
} from './domain/membership';
export {
  DisabledUserError,
  TenantAccessDeniedError,
  IdentityMappingBrokenError,
  InvalidAuthorizationConfigurationError,
} from './application/identity.service';
export {
  MembershipAlreadyActiveError,
  MembershipRevokedError,
  InvalidMembershipTransitionError,
  InvitationNotPendingError,
} from './domain/membership';
