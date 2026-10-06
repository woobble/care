export type MembershipStatus = 'pending' | 'active' | 'inactive' | 'revoked';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export function activateMembership(status: MembershipStatus): MembershipStatus {
  if (status === 'active') throw new MembershipAlreadyActiveError();
  if (status === 'revoked') throw new MembershipRevokedError();
  return 'active';
}

export function deactivateMembership(status: MembershipStatus): MembershipStatus {
  if (status === 'revoked') throw new MembershipRevokedError();
  if (status !== 'active') throw new InvalidMembershipTransitionError(status, 'inactive');
  return 'inactive';
}

export function revokeMembership(status: MembershipStatus): MembershipStatus {
  if (status === 'revoked') throw new MembershipRevokedError();
  return 'revoked';
}

export function transitionInvitation(
  status: InvitationStatus,
  next: Exclude<InvitationStatus, 'pending'>,
): InvitationStatus {
  if (status !== 'pending') throw new InvitationNotPendingError(status);
  return next;
}

export class MembershipAlreadyActiveError extends Error {
  readonly code = 'MEMBERSHIP_ALREADY_ACTIVE';

  constructor() {
    super('Membership is already active');
    this.name = 'MembershipAlreadyActiveError';
  }
}

export class MembershipRevokedError extends Error {
  readonly code = 'MEMBERSHIP_REVOKED';

  constructor() {
    super('A revoked membership cannot be reactivated or changed');
    this.name = 'MembershipRevokedError';
  }
}

export class InvalidMembershipTransitionError extends Error {
  readonly code = 'INVALID_MEMBERSHIP_TRANSITION';

  constructor(
    readonly from: MembershipStatus,
    readonly to: MembershipStatus,
  ) {
    super(`Cannot change membership from ${from} to ${to}`);
    this.name = 'InvalidMembershipTransitionError';
  }
}

export class InvitationNotPendingError extends Error {
  readonly code = 'INVITATION_NOT_PENDING';

  constructor(readonly status: InvitationStatus) {
    super(`Cannot change a ${status} invitation`);
    this.name = 'InvitationNotPendingError';
  }
}
