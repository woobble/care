import { describe, expect, test } from 'bun:test';
import {
  activateMembership,
  deactivateMembership,
  revokeMembership,
  transitionInvitation,
} from './membership';

describe('membership lifecycle', () => {
  test('allows pending and inactive membership activation', () => {
    expect(activateMembership('pending')).toBe('active');
    expect(activateMembership('inactive')).toBe('active');
  });

  test('only active membership can be deactivated', () => {
    expect(deactivateMembership('active')).toBe('inactive');
    expect(() => deactivateMembership('pending')).toThrow('INVALID_MEMBERSHIP_TRANSITION');
  });

  test('revocation is terminal', () => {
    expect(revokeMembership('pending')).toBe('revoked');
    expect(revokeMembership('active')).toBe('revoked');
    expect(revokeMembership('inactive')).toBe('revoked');
    expect(() => activateMembership('revoked')).toThrow('MEMBERSHIP_REVOKED');
    expect(() => revokeMembership('revoked')).toThrow('MEMBERSHIP_REVOKED');
  });
});

describe('invitation lifecycle', () => {
  test('only pending invitations can be accepted, expired, or revoked', () => {
    expect(transitionInvitation('pending', 'accepted')).toBe('accepted');
    expect(transitionInvitation('pending', 'expired')).toBe('expired');
    expect(transitionInvitation('pending', 'revoked')).toBe('revoked');
    expect(() => transitionInvitation('accepted', 'revoked')).toThrow('INVITATION_NOT_PENDING');
  });
});
